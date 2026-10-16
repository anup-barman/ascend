import {
  getCursor,
  getSyncSummary,
  ingestFetchResult,
  listContestsByIds,
  listRatingEventsForContests,
  listSubmissionsForContests,
  markSyncFailed,
  markSyncing,
  markSyncPartial,
  markSyncSucceeded,
  setCursor,
  type AscendDb,
  type SyncSummary,
} from '@ascend/db';
import { nowEpochSeconds, PROVIDERS } from '@ascend/core';
import type {
  NormalizedContest,
  NormalizedContestResult,
  NormalizedRatingEvent,
  NormalizedSubmission,
  Provider,
  ProviderFetchResult,
  SyncCursor,
  SyncStatus,
} from '@ascend/core';
import { deriveContestResults, emptyFetchResult, type PlatformAdapter } from '@ascend/providers';

/**
 * The sync engine (spec §7, §37, §62).
 *
 * Everything the run is allowed to do to `sync_state` is decided here, and three
 * rules govern it:
 *
 * 1. **A failure changes nothing but the status.** No rows are deleted and the
 *    cursor does not move, so the retry resumes instead of re-fetching (§62).
 * 2. **Warnings are reported, not swallowed.** A run that fetched some of what it
 *    wanted reports PARTIALLY SYNCED with the reason attached (§7, §58).
 * 3. **Contest results are re-derived from the complete stored history**, never
 *    from the incremental page alone — a contest straddling the cursor boundary
 *    would otherwise be scored from half its submissions.
 *
 * Adapters run in the order they are given, which is `createAdapters().all`.
 */

/** All three adapters do everything in one submission-history pass. */
export const SYNC_RESOURCE = 'submissions';

/**
 * Providers that share a cursor.
 *
 * `user.status` returns regular and Gym submissions in one response, so both
 * Codeforces adapters consume a single paging pass and there is only one position
 * to remember. It is stored under `codeforces` and mirrored onto `codeforces_gym`.
 */
function cursorOwner(provider: Provider): Provider {
  return provider === 'codeforces_gym' ? 'codeforces' : provider;
}

/** Gym has no identity of its own — it is the same Codeforces account (§1). */
function handleOwner(provider: Provider): Provider {
  return provider === 'codeforces_gym' ? 'codeforces' : provider;
}

export type SyncOutcomeStatus = SyncStatus | 'skipped';

export interface SyncProviderOutcome {
  provider: Provider;
  label: string;
  status: SyncOutcomeStatus;
  /** Submissions stored by this provider in this run. */
  itemsSynced: number;
  /** Everything the user should know about what did not arrive. */
  warnings: string[];
  /** Set only when the status is `failed`. */
  error: string | null;
  /** Set only when the status is `skipped`. */
  skippedReason: string | null;
}

export interface SyncRunResult {
  startedAt: number;
  finishedAt: number;
  /** Worst-wins across every provider that ran. */
  overall: SyncStatus;
  providers: SyncProviderOutcome[];
}

export interface SyncEvent {
  at: number;
  kind: 'started' | 'provider_started' | 'provider_finished' | 'finished';
  provider?: Provider;
  message?: string;
  /** The full status roll-up, so a subscriber can render without bookkeeping. */
  summary: SyncSummary;
}

export interface SyncEngineDeps {
  db: AscendDb;
  /** In `createAdapters().all` order. */
  adapters: PlatformAdapter[];
  /** The configured handle for a provider, or null when there is none. */
  handleFor: (provider: Provider) => string | null;
  onEvent?: (event: SyncEvent) => void;
}

export interface SyncRunOptions {
  /** Restrict the run to these providers. Defaults to every adapter given. */
  only?: Provider[];
  /** Passed through to the adapters as a paging safety valve. */
  maxItems?: number;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Worst-wins, matching `summarizeSync` so the badge and the run agree. */
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

/**
 * Recomputes solved counts from stored submissions.
 *
 * AtCoder's results come from the rating history, which lists every contest the
 * user ever entered, while the solve counts are computed from the submissions in
 * the payload. On an incremental sync that is only the newest page, so every
 * older contest would arrive with no count and — because results are replaced
 * per `(contest, participation)` — erase the count already stored.
 *
 * A count is therefore overridden only for contests the stored history actually
 * has submissions for. No evidence means the payload's own value stands, rather
 * than a confident zero (§58).
 */
export function withStoredSolveCounts(
  results: NormalizedContestResult[],
  stored: NormalizedSubmission[],
): NormalizedContestResult[] {
  const solvedByContest = new Map<string, Set<string>>();
  const seenContests = new Set<string>();

  for (const submission of stored) {
    if (!submission.contestId) continue;
    seenContests.add(submission.contestId);
    if (submission.verdict !== 'OK') continue;
    let solved = solvedByContest.get(submission.contestId);
    if (!solved) {
      solved = new Set();
      solvedByContest.set(submission.contestId, solved);
    }
    solved.add(submission.problemId);
  }

  return results.map((result) => {
    if (!seenContests.has(result.contestId)) return result;
    return { ...result, solvedCount: solvedByContest.get(result.contestId)?.size ?? 0 };
  });
}

function toMap<T, K>(items: T[], key: (item: T) => K): Map<K, T> {
  const map = new Map<K, T>();
  for (const item of items) map.set(key(item), item);
  return map;
}

/**
 * Re-scores the contests a payload touched, using every submission stored for
 * them rather than just the ones that arrived.
 *
 * The Codeforces family reconstructs results from the submission stream, so those
 * are recomputed outright. AtCoder's come from its rating history, which carries
 * rank and performance that no submission reveals, so only the solve counts are
 * corrected.
 */
export function reconcileContestResults(
  db: AscendDb,
  provider: Provider,
  payload: ProviderFetchResult,
): { results: NormalizedContestResult[]; warnings: string[] } {
  const touched = new Set<string>();
  for (const submission of payload.submissions) {
    if (submission.contestId) touched.add(submission.contestId);
  }
  for (const result of payload.contestResults) touched.add(result.contestId);

  if (touched.size === 0) return { results: [], warnings: [] };

  const ids = [...touched];
  const stored = listSubmissionsForContests(db, ids);

  if (provider === 'atcoder') {
    return { results: withStoredSolveCounts(payload.contestResults, stored), warnings: [] };
  }

  const contestsById = toMap<NormalizedContest, string>(listContestsByIds(db, ids), (c) => c.id);
  const ratingByContestId = new Map<string, NormalizedRatingEvent>();
  for (const event of listRatingEventsForContests(db, ids)) {
    if (event.contestId) ratingByContestId.set(event.contestId, event);
  }

  return {
    results: deriveContestResults(stored, contestsById, ratingByContestId),
    warnings: [],
  };
}

/**
 * Runs one sync pass.
 *
 * Cursors are read once, before anything runs, so both Codeforces adapters see
 * the same starting position and the memoized `user.status` pass serves both.
 */
export async function runSync(
  deps: SyncEngineDeps,
  options: SyncRunOptions = {},
): Promise<SyncRunResult> {
  const { db, adapters, handleFor } = deps;
  const startedAt = nowEpochSeconds();

  const selected = options.only
    ? adapters.filter((adapter) => options.only?.includes(adapter.provider))
    : adapters;

  const emit = (kind: SyncEvent['kind'], provider?: Provider, message?: string): void => {
    deps.onEvent?.({
      at: nowEpochSeconds(),
      kind,
      ...(provider ? { provider } : {}),
      ...(message ? { message } : {}),
      summary: getSyncSummary(db),
    });
  };

  // One snapshot for the whole run: a provider that advances the shared cursor
  // mid-run must not change what its sibling asks for.
  const startCursors = new Map<Provider, SyncCursor>();
  for (const provider of PROVIDERS) {
    startCursors.set(provider, getCursor(db, cursorOwner(provider), SYNC_RESOURCE) ?? {});
  }

  const outcomes: SyncProviderOutcome[] = [];
  /** Cursor each family may advance to, applied only once the family is clean. */
  const nextCursors = new Map<Provider, SyncCursor>();

  emit('started');

  for (const adapter of selected) {
    const provider = adapter.provider;
    const handle = handleFor(handleOwner(provider));

    if (!handle) {
      outcomes.push({
        provider,
        label: adapter.label,
        status: 'skipped',
        itemsSynced: 0,
        warnings: [],
        error: null,
        skippedReason: `No ${adapter.label} handle is configured.`,
      });
      continue;
    }

    markSyncing(db, provider, SYNC_RESOURCE);
    emit('provider_started', provider, `Syncing ${adapter.label}…`);

    try {
      const result = await adapter.sync({
        handle,
        cursor: startCursors.get(provider) ?? {},
        ...(options.maxItems !== undefined ? { maxItems: options.maxItems } : {}),
      });

      const ingested = ingestFetchResult(db, result);

      // Re-scored results replace the payload's own, so they are ingested as a
      // second payload carrying nothing else.
      const reconciled = reconcileContestResults(db, provider, result);
      const reingested =
        reconciled.results.length > 0
          ? ingestFetchResult(db, { ...emptyFetchResult(), contestResults: reconciled.results })
          : null;

      const warnings = [
        ...result.warnings,
        ...ingested.warnings,
        ...(reingested?.warnings ?? []),
        ...reconciled.warnings,
      ];

      const itemsSynced = ingested.counts.submissions;

      if (warnings.length > 0) {
        markSyncPartial(db, provider, SYNC_RESOURCE, warnings.join(' · '), { itemsSynced });
      } else {
        markSyncSucceeded(db, provider, SYNC_RESOURCE, { itemsSynced });
      }

      nextCursors.set(cursorOwner(provider), result.cursor);

      outcomes.push({
        provider,
        label: adapter.label,
        status: warnings.length > 0 ? 'partially_synced' : 'up_to_date',
        itemsSynced,
        warnings,
        error: null,
        skippedReason: null,
      });
    } catch (error) {
      markSyncFailed(db, provider, SYNC_RESOURCE, error);
      outcomes.push({
        provider,
        label: adapter.label,
        status: 'failed',
        itemsSynced: 0,
        warnings: [],
        error: messageOf(error),
        skippedReason: null,
      });
    }

    emit('provider_finished', provider);
  }

  // The shared Codeforces position may only advance once both adapters have
  // stored their half of the response: Gym succeeding while the regular half
  // failed to ingest would otherwise skip submissions nothing ever stored.
  for (const [owner, cursor] of nextCursors) {
    const family = outcomes.filter((outcome) => cursorOwner(outcome.provider) === owner);
    if (family.some((outcome) => outcome.status === 'failed')) continue;
    for (const outcome of family) setCursor(db, outcome.provider, SYNC_RESOURCE, cursor);
  }

  const ran = outcomes.filter(
    (outcome): outcome is SyncProviderOutcome & { status: SyncStatus } =>
      outcome.status !== 'skipped',
  );
  const finishedAt = nowEpochSeconds();

  emit('finished');

  return {
    startedAt,
    finishedAt,
    // Nothing ran means nothing is known — not "everything is fine" (§58).
    overall: ran.length === 0 ? 'never_synced' : worst(ran.map((outcome) => outcome.status)),
    providers: outcomes,
  };
}
