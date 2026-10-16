import { PROVIDER_LABELS, PROVIDERS, SYNC_STATUS_LABELS } from '@ascend/core';
import type { Provider, SyncStatus } from '@ascend/core';

import type {
  ProviderSyncSummary,
  SyncOutcomeStatus,
  SyncProviderOutcome,
  SyncRunnerState,
  SyncSummary,
} from './api';
import type { Severity } from './components/ui';

/**
 * The sync view model (spec §7, §58).
 *
 * Pure, so the rules that make the badge honest are unit-testable without a DOM:
 *
 * 1. **A provider with no handle is not a failure.** It reports `skipped` and the
 *    UI offers Settings, rather than showing NEVER SYNCED against a source the
 *    user never asked for.
 * 2. **The badge rolls up only configured providers.** The server's `overall`
 *    counts all three, so a user with a Codeforces handle and no AtCoder one
 *    would read NEVER SYNCED forever after a perfect sync.
 * 3. **A degraded status always carries its reason.** PARTIALLY SYNCED or SYNC
 *    FAILED with nothing to read is the silent-missing-data failure §7 forbids.
 */

const OUTCOME_LABELS: Record<SyncOutcomeStatus, string> = {
  ...SYNC_STATUS_LABELS,
  skipped: 'NO HANDLE',
};

export interface SyncHandles {
  codeforces: string | null;
  atcoder: string | null;
}

export interface ProviderSyncView {
  provider: Provider;
  label: string;
  status: SyncOutcomeStatus;
  statusLabel: string;
  severity: Severity;
  /** False when no handle is configured, so nothing has ever been attempted. */
  configured: boolean;
  lastSuccessAt: number | null;
  /** Warnings, or the failure reason. Empty only when there is nothing wrong. */
  messages: string[];
  /** Items stored by the most recent attempt; null before any attempt. */
  itemsSynced: number | null;
}

export interface SyncView {
  status: SyncStatus;
  statusLabel: string;
  severity: Severity;
  running: boolean;
  /** No provider has a handle — there is nothing to synchronize yet. */
  needsHandles: boolean;
  providers: ProviderSyncView[];
  /** Set when the engine broke rather than a provider failing. */
  engineError: string | null;
}

/** Status → reserved colour. Colour never travels without its label (§41). */
export function syncSeverity(status: SyncOutcomeStatus): Severity {
  switch (status) {
    case 'up_to_date':
      return 'good';
    case 'partially_synced':
      return 'warning';
    case 'failed':
      return 'critical';
    case 'syncing':
    case 'never_synced':
    case 'skipped':
      return 'unknown';
  }
}

/** Worst-wins, matching `summarizeSync` so the badge and the server agree. */
const STATUS_SEVERITY: Record<SyncStatus, number> = {
  syncing: 4,
  failed: 3,
  partially_synced: 2,
  never_synced: 1,
  up_to_date: 0,
};

function worst(statuses: SyncStatus[]): SyncStatus {
  let result: SyncStatus = 'up_to_date';
  for (const status of statuses) {
    if (STATUS_SEVERITY[status] > STATUS_SEVERITY[result]) result = status;
  }
  return result;
}

/** Gym is the same Codeforces account — it has no handle of its own (§1). */
function handleFor(handles: SyncHandles, provider: Provider): string | null {
  return provider === 'atcoder' ? handles.atcoder : handles.codeforces;
}

/**
 * Why this provider is not clean.
 *
 * `sync_state.error` is written by whichever run produced the status, so it is
 * the authority on *whether* something is wrong. The run result holds the same
 * text as a list instead of one joined column, so it is preferred for display —
 * but only while it still describes the status on record.
 */
function messagesFor(
  row: ProviderSyncSummary,
  outcome: SyncProviderOutcome | undefined,
): string[] {
  if (row.status !== 'failed' && row.status !== 'partially_synced') return [];

  if (outcome && outcome.status === row.status) {
    if (outcome.warnings.length > 0) return outcome.warnings;
    if (outcome.error) return [outcome.error];
  }

  return row.error ? [row.error] : [];
}

export function buildSyncView(input: {
  summary: SyncSummary;
  run: SyncRunnerState | null;
  handles: SyncHandles;
}): SyncView {
  const { summary, run, handles } = input;
  const outcomes = new Map<Provider, SyncProviderOutcome>();
  for (const outcome of run?.lastResult?.providers ?? []) outcomes.set(outcome.provider, outcome);

  const providers: ProviderSyncView[] = [];
  const configuredStatuses: SyncStatus[] = [];

  for (const provider of PROVIDERS) {
    const row = summary.providers.find((entry) => entry.provider === provider);
    const configured = handleFor(handles, provider) !== null;

    if (!configured) {
      providers.push({
        provider,
        label: PROVIDER_LABELS[provider],
        status: 'skipped',
        statusLabel: OUTCOME_LABELS.skipped,
        severity: syncSeverity('skipped'),
        configured: false,
        lastSuccessAt: null,
        messages: [],
        itemsSynced: null,
      });
      continue;
    }

    const status: SyncStatus = row?.status ?? 'never_synced';
    configuredStatuses.push(status);

    const resources = row?.resources ?? [];
    providers.push({
      provider,
      label: PROVIDER_LABELS[provider],
      status,
      statusLabel: OUTCOME_LABELS[status],
      severity: syncSeverity(status),
      configured: true,
      lastSuccessAt: row?.lastSuccessAt ?? null,
      messages: row ? messagesFor(row, outcomes.get(provider)) : [],
      itemsSynced:
        resources.length > 0
          ? resources.reduce((total, resource) => total + resource.itemsSynced, 0)
          : null,
    });
  }

  const running = run?.running === true;
  // A run that has started but not yet marked its first provider is still a run;
  // reading `up_to_date` in that window would be wrong for as long as it lasts.
  const status: SyncStatus = running
    ? 'syncing'
    : configuredStatuses.length === 0
      ? 'never_synced'
      : worst(configuredStatuses);

  return {
    status,
    statusLabel: OUTCOME_LABELS[status],
    severity: syncSeverity(status),
    running,
    needsHandles: configuredStatuses.length === 0,
    providers,
    engineError: run?.lastError ?? null,
  };
}
