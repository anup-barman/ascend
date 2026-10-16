import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { emptyFetchResult } from '@ascend/core';
import type { ProviderFetchResult } from '@ascend/core';
import {
  getRawPayload,
  openDatabase,
  runMigrations,
  upsertPlatformAccount,
  type OpenedDatabase,
} from '@ascend/db';
import type { PlatformAdapter, SyncRequest } from '@ascend/providers';

import { captureRawPayload, SyncRunner } from './runner';
import type { SyncEvent } from './engine';

/**
 * Runner tests — the concurrency guard and the event fan-out (spec §7).
 *
 * Adapters are injected because the real ones reach the network the moment a run
 * starts; what is being pinned here is that a second trigger cannot start a
 * competing run over the same cursor, and that a subscriber sees the run.
 */

let dir: string;
let opened: OpenedDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ascend-runner-'));
  opened = openDatabase(join(dir, 'ascend.db'));
  runMigrations(opened.db);
  upsertPlatformAccount(opened.db, 'codeforces', 'tourist');
});

afterEach(() => {
  opened.close();
  rmSync(dir, { recursive: true, force: true });
});

/** An adapter whose `sync` finishes only when the test releases it. */
function gated(): {
  adapter: PlatformAdapter;
  release: () => void;
  calls: SyncRequest[];
} {
  const calls: SyncRequest[] = [];
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  return {
    calls,
    release: () => release(),
    adapter: {
      provider: 'codeforces',
      label: 'Codeforces',
      async getUserProfile(handle: string) {
        return {
          provider: 'codeforces' as const,
          handle,
          rating: null,
          maxRating: null,
          rank: null,
          maxRank: null,
          country: null,
          organization: null,
        };
      },
      async sync(request: SyncRequest): Promise<ProviderFetchResult> {
        calls.push(request);
        await gate;
        return { ...emptyFetchResult(), cursor: { lastSeenId: '7' } };
      },
    },
  };
}

describe('SyncRunner', () => {
  it('refuses a second run while one is in flight', async () => {
    const { adapter, release, calls } = gated();
    const runner = new SyncRunner(opened.db, { buildAdapters: () => [adapter] });

    expect(runner.start()).toEqual({ started: true });
    expect(runner.state.running).toBe(true);

    // Two runs would fight over one cursor and double every rate-limited request.
    expect(runner.start()).toEqual({ started: false, reason: 'already_running' });

    release();
    await runner.settle();

    expect(calls).toHaveLength(1);
    expect(runner.state.running).toBe(false);
    expect(runner.state.lastResult?.overall).toBe('up_to_date');
  });

  it('accepts a new run once the previous one has finished', async () => {
    const first = gated();
    const second = gated();
    let build = 0;
    const runner = new SyncRunner(opened.db, {
      buildAdapters: () => [build++ === 0 ? first.adapter : second.adapter],
    });

    runner.start();
    first.release();
    await runner.settle();

    expect(runner.start()).toEqual({ started: true });
    second.release();
    await runner.settle();

    // The second run resumes from where the first one left off.
    expect(second.calls[0]?.cursor).toEqual({ lastSeenId: '7' });
  });

  it('publishes events to subscribers and stops on unsubscribe', async () => {
    const { adapter, release } = gated();
    const runner = new SyncRunner(opened.db, { buildAdapters: () => [adapter] });

    const seen: SyncEvent[] = [];
    const unsubscribe = runner.subscribe((event) => seen.push(event));

    runner.start();
    release();
    await runner.settle();

    expect(seen.map((event) => event.kind)).toContain('finished');

    const afterUnsubscribe = seen.length;
    unsubscribe();
    runner.start();
    release();
    await runner.settle();

    expect(seen).toHaveLength(afterUnsubscribe);
  });

  it('keeps running when a subscriber throws', async () => {
    const { adapter, release } = gated();
    const runner = new SyncRunner(opened.db, { buildAdapters: () => [adapter] });

    runner.subscribe(() => {
      throw new Error('socket closed');
    });

    runner.start();
    release();
    await runner.settle();

    // A dead SSE socket must not fail the sync that was writing to it.
    expect(runner.state.lastError).toBeNull();
    expect(runner.state.lastResult).not.toBeNull();
  });

  it('is still usable after adapter construction fails', async () => {
    const { adapter, release } = gated();
    let attempt = 0;
    const runner = new SyncRunner(opened.db, {
      buildAdapters: () => {
        if (attempt++ === 0) throw new Error('adapter construction failed');
        return [adapter];
      },
    });

    // Construction happens before anything is claimed, so the caller sees the
    // error and no run is left half-started.
    expect(() => runner.start()).toThrow('adapter construction failed');
    expect(runner.state.running).toBe(false);

    expect(runner.start()).toEqual({ started: true });
    release();
    await runner.settle();
    expect(runner.state.lastResult).not.toBeNull();
  });
});

describe('captureRawPayload', () => {
  it('stores a response body under its provider, endpoint and request key (§7)', () => {
    const stored = captureRawPayload(opened.db, {
      url: 'https://codeforces.com/api/user.status?handle=tourist&from=1&count=100',
      status: 200,
      text: '{"status":"OK","result":[]}',
      fromCache: false,
    });

    expect(stored).toBe(true);
    const row = getRawPayload(
      opened.db,
      'codeforces',
      'api/user.status',
      'count=100&from=1&handle=tourist',
    );
    expect(row?.body).toBe('{"status":"OK","result":[]}');
    expect(row?.httpStatus).toBe(200);
  });

  it('ignores a host Ascend does not recognise rather than guessing a provider', () => {
    expect(
      captureRawPayload(opened.db, {
        url: 'https://example.com/whatever',
        status: 200,
        text: '{}',
        fromCache: false,
      }),
    ).toBe(false);
  });

  it('never lets a storage failure escape into the sync', () => {
    opened.close();
    // The database is gone; the hook still has to return rather than throw,
    // because it runs inside the rate-limited critical section.
    expect(
      captureRawPayload(opened.db, {
        url: 'https://codeforces.com/api/user.info?handles=tourist',
        status: 200,
        text: '{}',
        fromCache: false,
      }),
    ).toBe(false);
    // Reopen so the shared afterEach can close it without erroring.
    opened = openDatabase(join(dir, 'ascend.db'));
  });
});
