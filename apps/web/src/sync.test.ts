import { describe, expect, it } from 'vitest';

import type { Provider, SyncStatus } from '@ascend/core';

import type {
  ProviderSyncSummary,
  SyncProviderOutcome,
  SyncRunnerState,
  SyncSummary,
} from './api';
import { buildSyncView, type SyncHandles } from './sync';

/**
 * The sync badge is the only thing standing between the user and a silent data
 * gap, so its honesty rules are tested rather than trusted (spec §7, §58).
 */

const BOTH_HANDLES: SyncHandles = { codeforces: 'AnupBarman', atcoder: 'anup' };

function row(
  provider: Provider,
  status: SyncStatus,
  overrides: Partial<ProviderSyncSummary> = {},
): ProviderSyncSummary {
  return {
    provider,
    status,
    lastSuccessAt: null,
    error: null,
    resources: [
      {
        provider,
        resource: 'submissions',
        status,
        lastAttemptAt: 1_700_000_000,
        lastSuccessAt: null,
        error: overrides.error ?? null,
        itemsSynced: 0,
      },
    ],
    ...overrides,
  };
}

function summary(rows: ProviderSyncSummary[], overall: SyncStatus): SyncSummary {
  return { overall, providers: rows };
}

function outcome(
  provider: Provider,
  status: SyncProviderOutcome['status'],
  overrides: Partial<SyncProviderOutcome> = {},
): SyncProviderOutcome {
  return {
    provider,
    label: provider,
    status,
    itemsSynced: 0,
    warnings: [],
    error: null,
    skippedReason: null,
    ...overrides,
  };
}

function runState(providers: SyncProviderOutcome[], running = false): SyncRunnerState {
  return {
    running,
    startedAt: running ? 1_700_000_000 : null,
    lastResult: {
      startedAt: 1_700_000_000,
      finishedAt: 1_700_000_100,
      overall: 'up_to_date',
      providers,
    },
    lastError: null,
  };
}

function viewOf(provider: Provider, view: ReturnType<typeof buildSyncView>) {
  const entry = view.providers.find((candidate) => candidate.provider === provider);
  if (!entry) throw new Error(`no view for ${provider}`);
  return entry;
}

describe('sync view model (spec §7, §58)', () => {
  it('reports a provider with no handle as skipped rather than as a failure', () => {
    const view = buildSyncView({
      summary: summary([], 'never_synced'),
      run: null,
      handles: { codeforces: 'AnupBarman', atcoder: null },
    });

    expect(viewOf('atcoder', view).status).toBe('skipped');
    expect(viewOf('atcoder', view).configured).toBe(false);
    expect(viewOf('atcoder', view).severity).not.toBe('critical');
  });

  it('treats Codeforces Gym as configured by the Codeforces handle', () => {
    const view = buildSyncView({
      summary: summary([], 'never_synced'),
      run: null,
      handles: { codeforces: 'AnupBarman', atcoder: null },
    });

    expect(viewOf('codeforces_gym', view).configured).toBe(true);
  });

  it('ignores unconfigured providers when rolling the badge up', () => {
    // The server honestly reports never_synced overall because AtCoder has no
    // rows; with no AtCoder handle that would leave the badge permanently wrong.
    const view = buildSyncView({
      summary: summary(
        [row('codeforces', 'up_to_date'), row('codeforces_gym', 'up_to_date')],
        'never_synced',
      ),
      run: null,
      handles: { codeforces: 'AnupBarman', atcoder: null },
    });

    expect(view.status).toBe('up_to_date');
    expect(view.needsHandles).toBe(false);
  });

  it('never reports up to date while a configured provider has never synced', () => {
    const view = buildSyncView({
      summary: summary(
        [row('codeforces', 'up_to_date'), row('codeforces_gym', 'up_to_date')],
        'never_synced',
      ),
      run: null,
      handles: BOTH_HANDLES,
    });

    expect(view.status).toBe('never_synced');
  });

  it('rolls a single failure up over successful siblings', () => {
    const view = buildSyncView({
      summary: summary(
        [
          row('codeforces', 'up_to_date'),
          row('codeforces_gym', 'failed', { error: 'Codeforces returned 403' }),
          row('atcoder', 'up_to_date'),
        ],
        'failed',
      ),
      run: null,
      handles: BOTH_HANDLES,
    });

    expect(view.status).toBe('failed');
    expect(view.severity).toBe('critical');
  });

  it('says nothing is wrong when nothing is wrong', () => {
    const view = buildSyncView({
      summary: summary(
        [
          row('codeforces', 'up_to_date'),
          row('codeforces_gym', 'up_to_date'),
          row('atcoder', 'up_to_date'),
        ],
        'up_to_date',
      ),
      run: runState([outcome('codeforces', 'up_to_date')]),
      handles: BOTH_HANDLES,
    });

    expect(view.providers.every((entry) => entry.messages.length === 0)).toBe(true);
  });

  it('surfaces the reason behind a partially synced provider', () => {
    const view = buildSyncView({
      summary: summary(
        [row('codeforces_gym', 'partially_synced', { error: 'Standings need a Codeforces API key' })],
        'partially_synced',
      ),
      run: null,
      handles: BOTH_HANDLES,
    });

    expect(viewOf('codeforces_gym', view).messages).toEqual([
      'Standings need a Codeforces API key',
    ]);
  });

  it('surfaces the reason behind a failed provider', () => {
    const view = buildSyncView({
      summary: summary([row('atcoder', 'failed', { error: 'fetch failed' })], 'failed'),
      run: null,
      handles: BOTH_HANDLES,
    });

    expect(viewOf('atcoder', view).messages).toEqual(['fetch failed']);
  });

  it('prefers the run result warnings, which are a list rather than one column', () => {
    const view = buildSyncView({
      summary: summary(
        [row('codeforces_gym', 'partially_synced', { error: 'first · second' })],
        'partially_synced',
      ),
      run: runState([
        outcome('codeforces_gym', 'partially_synced', { warnings: ['first', 'second'] }),
      ]),
      handles: BOTH_HANDLES,
    });

    expect(viewOf('codeforces_gym', view).messages).toEqual(['first', 'second']);
  });

  it('falls back to the stored reason when the run result describes another status', () => {
    // A stale outcome from an earlier run must never explain away the status
    // currently on record.
    const view = buildSyncView({
      summary: summary([row('atcoder', 'failed', { error: 'kenkoooo timed out' })], 'failed'),
      run: runState([outcome('atcoder', 'up_to_date')]),
      handles: BOTH_HANDLES,
    });

    expect(viewOf('atcoder', view).messages).toEqual(['kenkoooo timed out']);
  });

  it('reports syncing while a run is in flight, before any provider is marked', () => {
    const view = buildSyncView({
      summary: summary([row('codeforces', 'up_to_date')], 'up_to_date'),
      run: runState([], true),
      handles: { codeforces: 'AnupBarman', atcoder: null },
    });

    expect(view.status).toBe('syncing');
    expect(view.running).toBe(true);
  });

  it('reports that handles are needed when none are configured', () => {
    const view = buildSyncView({
      summary: summary([], 'never_synced'),
      run: null,
      handles: { codeforces: null, atcoder: null },
    });

    expect(view.needsHandles).toBe(true);
    expect(view.status).toBe('never_synced');
    expect(view.providers.every((entry) => entry.status === 'skipped')).toBe(true);
  });

  it('reports no item count before a provider has ever been attempted', () => {
    const view = buildSyncView({
      summary: summary([], 'never_synced'),
      run: null,
      handles: BOTH_HANDLES,
    });

    expect(viewOf('codeforces', view).itemsSynced).toBeNull();
  });

  it('sums items stored across a provider resources', () => {
    const base = row('codeforces', 'up_to_date');
    const view = buildSyncView({
      summary: summary(
        [
          {
            ...base,
            resources: [
              { ...base.resources[0]!, itemsSynced: 12 },
              { ...base.resources[0]!, resource: 'contests', itemsSynced: 3 },
            ],
          },
        ],
        'up_to_date',
      ),
      run: null,
      handles: BOTH_HANDLES,
    });

    expect(viewOf('codeforces', view).itemsSynced).toBe(15);
  });

  it('surfaces an engine failure, which has nowhere else to be reported', () => {
    const view = buildSyncView({
      summary: summary([row('codeforces', 'up_to_date')], 'up_to_date'),
      run: { running: false, startedAt: null, lastResult: null, lastError: 'database is locked' },
      handles: BOTH_HANDLES,
    });

    expect(view.engineError).toBe('database is locked');
  });
});
