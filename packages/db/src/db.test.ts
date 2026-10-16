import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '@ascend/core';

import { openDatabase, type OpenedDatabase } from './client';
import { runMigrations } from './migrate';
import {
  DEFAULT_AVAILABILITY,
  ensureProfile,
  getAvailability,
  getHandle,
  getPlatformAccounts,
  getProfile,
  isOnboarded,
  markHandleVerified,
  markOnboarded,
  setAvailability,
  updateProfile,
  upsertPlatformAccount,
} from './repositories/profile';
import { getSettings, updateSettings } from './repositories/settings';
import {
  getCursor,
  getSyncSummary,
  markSyncFailed,
  markSyncPartial,
  markSyncSucceeded,
  markSyncing,
  resetStaleSyncing,
  summarizeSync,
} from './repositories/syncState';
import {
  clearActiveTargetEvent,
  getActiveTargetEvent,
  InvalidTargetDateError,
  listTargetEvents,
  setActiveTargetEvent,
} from './repositories/targetEvents';

let dir: string;
let opened: OpenedDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ascend-test-'));
  opened = openDatabase(join(dir, 'ascend.db'));
  runMigrations(opened.db);
});

afterEach(() => {
  opened.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('migrations', () => {
  it('creates the full schema on a fresh database', () => {
    const tables = opened.sqlite
      .prepare<[], { name: string }>(
        "select name from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '__drizzle%'",
      )
      .all()
      .map((row) => row.name)
      .sort();

    // Spot-check the tables spec §49 names explicitly.
    for (const expected of [
      'coach_decisions',
      'coach_memory',
      'contest_results',
      'contests',
      'goals',
      'mistake_occurrences',
      'mistakes',
      'problem_tags',
      'problems',
      'settings',
      'submissions',
      'sync_state',
      'target_events',
      'topic_mastery',
      'topic_nodes',
      'training_session_items',
      'training_sessions',
      'user_profile',
    ]) {
      expect(tables, expected).toContain(expected);
    }
  });

  it('is idempotent when run again', () => {
    expect(() => runMigrations(opened.db)).not.toThrow();
  });

  it('enforces foreign keys', () => {
    expect(() =>
      opened.sqlite
        .prepare(
          'insert into problem_tags (problem_id, tag) values (?, ?)',
        )
        .run('cf:9999:A', 'dp'),
    ).toThrow(/FOREIGN KEY/i);
  });
});

describe('settings', () => {
  it('returns defaults on an empty database', () => {
    expect(getSettings(opened.db)).toEqual(DEFAULT_SETTINGS);
  });

  it('merges a partial patch over the defaults without losing siblings', () => {
    const updated = updateSettings(opened.db, { ai: { enabled: true } });
    expect(updated.ai.enabled).toBe(true);
    // Untouched keys in the same section survive.
    expect(updated.ai.model).toBe(DEFAULT_SETTINGS.ai.model);
    // Untouched sections survive.
    expect(updated.sync).toEqual(DEFAULT_SETTINGS.sync);
  });

  it('persists across reopening the database', () => {
    updateSettings(opened.db, { sync: { intervalMinutes: 15 } });
    const path = opened.path;
    opened.close();

    opened = openDatabase(path);
    expect(getSettings(opened.db).sync.intervalMinutes).toBe(15);
  });

  it('defaults AI to Claude but disabled, so the app works without a key', () => {
    const settings = getSettings(opened.db);
    expect(settings.ai.provider).toBe('anthropic');
    expect(settings.ai.enabled).toBe(false);
  });

  it('repairs a corrupt readiness-weights object', () => {
    updateSettings(opened.db, {
      readinessWeights: { speed: 'nonsense' as unknown as number },
    });
    expect(getSettings(opened.db).readinessWeights.speed).toBe(
      DEFAULT_SETTINGS.readinessWeights.speed,
    );
  });
});

describe('profile', () => {
  it('creates exactly one profile row, idempotently', () => {
    ensureProfile(opened.db);
    ensureProfile(opened.db);
    const count = opened.sqlite
      .prepare<[], { n: number }>('select count(*) as n from user_profile')
      .get();
    expect(count?.n).toBe(1);
  });

  it('tracks onboarding completion once', () => {
    expect(isOnboarded(opened.db)).toBe(false);
    markOnboarded(opened.db);
    const first = getProfile(opened.db).onboardedAt;
    expect(first).not.toBeNull();

    markOnboarded(opened.db);
    expect(getProfile(opened.db).onboardedAt).toBe(first);
  });

  it('stores team info locally without any multi-user infrastructure', () => {
    const profile = updateProfile(opened.db, { displayName: 'khun', teamName: 'Ascend' });
    expect(profile).toMatchObject({ displayName: 'khun', teamName: 'Ascend' });
  });
});

describe('availability', () => {
  it('returns a sensible default week', () => {
    expect(getAvailability(opened.db)).toEqual(DEFAULT_AVAILABILITY);
  });

  it('round-trips a custom week', () => {
    const week = [0, 45, 45, 45, 45, 90, 240];
    expect(setAvailability(opened.db, week)).toEqual(week);
    expect(getAvailability(opened.db)).toEqual(week);
  });

  it('ignores invalid entries and clamps to a real day', () => {
    setAvailability(opened.db, [-5, Number.NaN, 60, 99999, 0, 0, 0]);
    const week = getAvailability(opened.db);
    expect(week[0]).toBe(DEFAULT_AVAILABILITY[0]); // negative ignored
    expect(week[1]).toBe(DEFAULT_AVAILABILITY[1]); // NaN ignored
    expect(week[2]).toBe(60);
    expect(week[3]).toBe(24 * 60); // clamped
  });
});

describe('platform accounts', () => {
  it('stores one handle per provider', () => {
    upsertPlatformAccount(opened.db, 'codeforces', '  tourist  ');
    upsertPlatformAccount(opened.db, 'atcoder', 'tourist');
    expect(getHandle(opened.db, 'codeforces')).toBe('tourist');
    expect(getPlatformAccounts(opened.db)).toHaveLength(2);
  });

  it('clears verification when the handle changes', () => {
    upsertPlatformAccount(opened.db, 'codeforces', 'first');
    markHandleVerified(opened.db, 'codeforces');
    expect(getPlatformAccounts(opened.db)[0]?.verifiedAt).not.toBeNull();

    upsertPlatformAccount(opened.db, 'codeforces', 'second');
    expect(getPlatformAccounts(opened.db)[0]?.verifiedAt).toBeNull();
  });
});

describe('target event (spec §3)', () => {
  it('has no target until the user configures one', () => {
    expect(getActiveTargetEvent(opened.db)).toBeNull();
  });

  it('stores and reads back the active event', () => {
    const event = setActiveTargetEvent(opened.db, {
      name: 'ICPC Asia Dhaka Regional',
      date: '2027-01-18',
      location: 'Dhaka',
    });
    expect(event).toMatchObject({ name: 'ICPC Asia Dhaka Regional', date: '2027-01-18' });
    expect(getActiveTargetEvent(opened.db)?.date).toBe('2027-01-18');
  });

  it('rejects an impossible date rather than storing garbage', () => {
    expect(() =>
      setActiveTargetEvent(opened.db, { name: 'Bad', date: '2027-02-30' }),
    ).toThrow(InvalidTargetDateError);
    expect(getActiveTargetEvent(opened.db)).toBeNull();
  });

  it('keeps only one event active when a new one is set', () => {
    setActiveTargetEvent(opened.db, { name: 'First', date: '2027-01-18' });
    setActiveTargetEvent(opened.db, { name: 'Second', date: '2027-03-01' });

    expect(getActiveTargetEvent(opened.db)?.name).toBe('Second');
    expect(listTargetEvents(opened.db)).toHaveLength(2);
  });

  it('can be cleared back to the no-target state', () => {
    setActiveTargetEvent(opened.db, { name: 'First', date: '2027-01-18' });
    clearActiveTargetEvent(opened.db);
    expect(getActiveTargetEvent(opened.db)).toBeNull();
  });
});

describe('sync state (spec §7, §62)', () => {
  it('reports never_synced for providers that have never been contacted', () => {
    const summary = getSyncSummary(opened.db);
    expect(summary.overall).toBe('never_synced');
    expect(summary.providers).toHaveLength(3);
    expect(summary.providers.map((p) => p.provider)).toEqual([
      'codeforces',
      'codeforces_gym',
      'atcoder',
    ]);
  });

  it('records a successful sync with its cursor', () => {
    markSyncing(opened.db, 'codeforces', 'submissions');
    markSyncSucceeded(opened.db, 'codeforces', 'submissions', {
      cursor: { lastSeenId: 'cf:100' },
      itemsSynced: 42,
    });

    expect(getCursor(opened.db, 'codeforces', 'submissions')).toEqual({ lastSeenId: 'cf:100' });
    const cf = getSyncSummary(opened.db).providers.find((p) => p.provider === 'codeforces');
    expect(cf?.status).toBe('up_to_date');
    expect(cf?.error).toBeNull();
  });

  it('a failure preserves the last good cursor and the data behind it', () => {
    markSyncSucceeded(opened.db, 'codeforces', 'submissions', {
      cursor: { lastSeenId: 'cf:100' },
      itemsSynced: 42,
    });
    markSyncFailed(opened.db, 'codeforces', 'submissions', new Error('503 from Codeforces'));

    // §62: the cursor survives, so the retry resumes instead of refetching all.
    expect(getCursor(opened.db, 'codeforces', 'submissions')).toEqual({ lastSeenId: 'cf:100' });

    const cf = getSyncSummary(opened.db).providers.find((p) => p.provider === 'codeforces');
    expect(cf?.status).toBe('failed');
    expect(cf?.error).toContain('503');
  });

  it('records partial syncs distinctly from failures', () => {
    markSyncPartial(opened.db, 'codeforces_gym', 'gym_submissions', 'Standings not accessible');
    const gym = getSyncSummary(opened.db).providers.find((p) => p.provider === 'codeforces_gym');
    expect(gym?.status).toBe('partially_synced');
  });

  it('surfaces the worst status rather than hiding a failure behind a success', () => {
    markSyncSucceeded(opened.db, 'codeforces', 'contests');
    markSyncFailed(opened.db, 'codeforces', 'submissions', new Error('rate limited'));

    const cf = getSyncSummary(opened.db).providers.find((p) => p.provider === 'codeforces');
    expect(cf?.status).toBe('failed');
    // Not every resource succeeded, so there is no honest "fully synced" moment.
    expect(cf?.lastSuccessAt).toBeNull();
  });

  it('clears a syncing row left behind by a crash', () => {
    markSyncing(opened.db, 'atcoder', 'submissions');
    expect(getSyncSummary(opened.db).overall).toBe('syncing');

    resetStaleSyncing(opened.db);
    const ac = getSyncSummary(opened.db).providers.find((p) => p.provider === 'atcoder');
    expect(ac?.status).toBe('failed');
    expect(ac?.error).toContain('Interrupted');
  });
});

describe('summarizeSync', () => {
  it('prefers syncing over failed so in-flight work is visible', () => {
    const summary = summarizeSync([
      {
        provider: 'codeforces',
        resource: 'a',
        status: 'failed',
        cursor: null,
        lastAttemptAt: 1,
        lastSuccessAt: null,
        error: 'boom',
        itemsSynced: 0,
      },
      {
        provider: 'codeforces',
        resource: 'b',
        status: 'syncing',
        cursor: null,
        lastAttemptAt: 2,
        lastSuccessAt: null,
        error: null,
        itemsSynced: 0,
      },
    ]);
    expect(summary.overall).toBe('syncing');
  });
});
