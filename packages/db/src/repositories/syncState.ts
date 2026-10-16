import { and, eq } from 'drizzle-orm';

import { nowEpochSeconds, PROVIDERS } from '@ascend/core';
import type { Provider, SyncStatus } from '@ascend/core';

import type { AscendDb } from '../client';
import { syncState, type SyncCursor } from '../schema';

/**
 * Sync bookkeeping (spec §7, §62).
 *
 * A failure is recorded here and nothing else changes — §62 requires that a
 * provider outage never destroys data that has already been synced. The UI reads
 * the summary to show SYNCING / UP TO DATE / PARTIALLY SYNCED / SYNC FAILED.
 */

export interface SyncStateRow {
  provider: Provider;
  resource: string;
  status: SyncStatus;
  cursor: SyncCursor | null;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  error: string | null;
  itemsSynced: number;
}

export interface ProviderSyncSummary {
  provider: Provider;
  status: SyncStatus;
  lastSuccessAt: number | null;
  /** First error across this provider's resources, if any. */
  error: string | null;
  resources: SyncStateRow[];
}

export interface SyncSummary {
  overall: SyncStatus;
  providers: ProviderSyncSummary[];
}

export function listSyncState(db: AscendDb): SyncStateRow[] {
  return db
    .select()
    .from(syncState)
    .all()
    .map((row) => ({
      provider: row.provider,
      resource: row.resource,
      status: row.status,
      cursor: row.cursor ?? null,
      lastAttemptAt: row.lastAttemptAt,
      lastSuccessAt: row.lastSuccessAt,
      error: row.error,
      itemsSynced: row.itemsSynced,
    }));
}

export function getSyncState(
  db: AscendDb,
  provider: Provider,
  resource: string,
): SyncStateRow | null {
  const row = db
    .select()
    .from(syncState)
    .where(and(eq(syncState.provider, provider), eq(syncState.resource, resource)))
    .get();
  if (!row) return null;
  return {
    provider: row.provider,
    resource: row.resource,
    status: row.status,
    cursor: row.cursor ?? null,
    lastAttemptAt: row.lastAttemptAt,
    lastSuccessAt: row.lastSuccessAt,
    error: row.error,
    itemsSynced: row.itemsSynced,
  };
}

export function getCursor(db: AscendDb, provider: Provider, resource: string): SyncCursor | null {
  return getSyncState(db, provider, resource)?.cursor ?? null;
}

function upsert(
  db: AscendDb,
  provider: Provider,
  resource: string,
  set: Partial<typeof syncState.$inferInsert>,
): void {
  const at = nowEpochSeconds();
  db.insert(syncState)
    .values({
      provider,
      resource,
      status: 'never_synced',
      itemsSynced: 0,
      updatedAt: at,
      ...set,
    })
    .onConflictDoUpdate({
      target: [syncState.provider, syncState.resource],
      set: { ...set, updatedAt: at },
    })
    .run();
}

export function markSyncing(db: AscendDb, provider: Provider, resource: string): void {
  upsert(db, provider, resource, { status: 'syncing', lastAttemptAt: nowEpochSeconds() });
}

export function markSyncSucceeded(
  db: AscendDb,
  provider: Provider,
  resource: string,
  options: { cursor?: SyncCursor | null; itemsSynced?: number } = {},
): void {
  const at = nowEpochSeconds();
  upsert(db, provider, resource, {
    status: 'up_to_date',
    lastAttemptAt: at,
    lastSuccessAt: at,
    error: null,
    ...(options.cursor !== undefined ? { cursor: options.cursor } : {}),
    ...(options.itemsSynced !== undefined ? { itemsSynced: options.itemsSynced } : {}),
  });
}

/**
 * Advances a cursor without touching status or error.
 *
 * The sync engine needs this because the Codeforces family shares one cursor
 * across two adapters: the shared position may only move once *both* have stored
 * their half, which is a different moment from either one reporting success.
 */
export function setCursor(
  db: AscendDb,
  provider: Provider,
  resource: string,
  cursor: SyncCursor,
): void {
  upsert(db, provider, resource, { cursor });
}

/**
 * Records a failure without touching the cursor, so the next attempt resumes
 * from the last known-good position instead of re-fetching everything.
 */
export function markSyncFailed(
  db: AscendDb,
  provider: Provider,
  resource: string,
  error: unknown,
): void {
  const message = error instanceof Error ? error.message : String(error);
  upsert(db, provider, resource, {
    status: 'failed',
    lastAttemptAt: nowEpochSeconds(),
    error: message.slice(0, 2000),
  });
}

/** Some data arrived but not all of it — e.g. Gym scraped, standings refused. */
export function markSyncPartial(
  db: AscendDb,
  provider: Provider,
  resource: string,
  reason: string,
  options: { cursor?: SyncCursor | null; itemsSynced?: number } = {},
): void {
  const at = nowEpochSeconds();
  upsert(db, provider, resource, {
    status: 'partially_synced',
    lastAttemptAt: at,
    lastSuccessAt: at,
    error: reason.slice(0, 2000),
    ...(options.cursor !== undefined ? { cursor: options.cursor } : {}),
    ...(options.itemsSynced !== undefined ? { itemsSynced: options.itemsSynced } : {}),
  });
}

/** Worst-wins ordering, so a single failure is never hidden by a success. */
const STATUS_SEVERITY: Record<SyncStatus, number> = {
  syncing: 4,
  failed: 3,
  partially_synced: 2,
  never_synced: 1,
  up_to_date: 0,
};

function worstStatus(statuses: SyncStatus[]): SyncStatus {
  let worst: SyncStatus = 'up_to_date';
  for (const status of statuses) {
    if (STATUS_SEVERITY[status] > STATUS_SEVERITY[worst]) worst = status;
  }
  return worst;
}

/**
 * Rolls per-resource rows up into the badge the UI shows. Providers with no rows
 * at all report `never_synced` rather than being omitted, so the user can always
 * see that a source has never been contacted.
 */
export function summarizeSync(rows: SyncStateRow[]): SyncSummary {
  const providers: ProviderSyncSummary[] = PROVIDERS.map((provider) => {
    const resources = rows.filter((row) => row.provider === provider);
    if (resources.length === 0) {
      return { provider, status: 'never_synced', lastSuccessAt: null, error: null, resources: [] };
    }

    const successTimes = resources
      .map((row) => row.lastSuccessAt)
      .filter((value): value is number => value !== null);

    return {
      provider,
      status: worstStatus(resources.map((row) => row.status)),
      // Oldest successful resource is the honest "last fully synced" moment.
      lastSuccessAt: successTimes.length === resources.length ? Math.min(...successTimes) : null,
      error: resources.find((row) => row.error !== null)?.error ?? null,
      resources,
    };
  });

  return {
    overall: worstStatus(providers.map((entry) => entry.status)),
    providers,
  };
}

export function getSyncSummary(db: AscendDb): SyncSummary {
  return summarizeSync(listSyncState(db));
}

/** Clears a stuck `syncing` row left behind by a crash or forced quit. */
export function resetStaleSyncing(db: AscendDb): void {
  db.update(syncState)
    .set({ status: 'failed', error: 'Interrupted before completing', updatedAt: nowEpochSeconds() })
    .where(eq(syncState.status, 'syncing'))
    .run();
}
