import { and, eq, sql } from 'drizzle-orm';

import { nowEpochSeconds } from '@ascend/core';
import type { Provider } from '@ascend/core';

import type { AscendDb } from '../client';
import { rawPayloads } from '../schema';

/**
 * Raw provider responses, kept so a parsing bug can be replayed offline instead
 * of re-hitting a rate-limited API (spec §7).
 *
 * One row per `(provider, endpoint, request_key)`: a re-fetch of the same request
 * updates that row in place rather than appending, so the store stays the size of
 * the distinct request set instead of growing with every sync.
 *
 * This is a debug store, not a data source. Nothing downstream reads it, and a
 * failure to write one must never fail the sync that produced it — the caller
 * wiring `HttpClient`'s `onResponse` hook is responsible for that guard.
 */

/**
 * Bodies larger than this are recorded as omitted rather than stored.
 *
 * The cap is generous on purpose: AtCoder's `problems.json` and
 * `problem-models.json` are the largest payloads Ascend fetches and are exactly
 * the ones whose parsing is worth replaying, so the cap exists to bound a
 * pathological response, not to exclude the normal catalogues.
 */
export const MAX_RAW_BODY_BYTES = 8_000_000;

export interface RawPayloadInput {
  provider: Provider;
  /** Logical source, e.g. `api/user.status`. */
  endpoint: string;
  /** Distinguishes calls to the same endpoint. Must not contain credentials. */
  requestKey?: string;
  httpStatus?: number | null;
  body: string;
  /** Unix epoch seconds; defaults to now. */
  fetchedAt?: number;
}

export interface RawPayloadRecord {
  /** False when the body exceeded `MAX_RAW_BODY_BYTES` and was not kept. */
  stored: boolean;
  /** Size of the response as received, whether or not it was kept. */
  bodyBytes: number;
}

export interface StoredRawPayload {
  provider: Provider;
  endpoint: string;
  requestKey: string;
  httpStatus: number | null;
  fetchedAt: number;
  body: string;
  bodyBytes: number;
  bodyOmitted: boolean;
}

/**
 * An empty incoming body must not erase a good stored one.
 *
 * A 304 hands back the cached body so it arrives non-empty, but a truncated
 * proxy response or an error page read as success would otherwise replace a
 * payload that still replays. An *omitted* body is different: it is a deliberate,
 * self-describing record of a response too large to keep, and it overwrites.
 */
const KEEP_STORED_BODY = `excluded."body" = '' and excluded."body_omitted" = 0`;

function keepStoredWhenEmpty(column: string) {
  return sql.raw(
    `case when ${KEEP_STORED_BODY} then "raw_payloads"."${column}" else excluded."${column}" end`,
  );
}

/** Stores or refreshes one raw response. */
export function recordRawPayload(db: AscendDb, input: RawPayloadInput): RawPayloadRecord {
  const bodyBytes = Buffer.byteLength(input.body, 'utf8');
  const omitted = bodyBytes > MAX_RAW_BODY_BYTES;
  const requestKey = input.requestKey ?? '';

  const row = {
    provider: input.provider,
    endpoint: input.endpoint,
    requestKey,
    httpStatus: input.httpStatus ?? null,
    fetchedAt: input.fetchedAt ?? nowEpochSeconds(),
    body: omitted ? '' : input.body,
    bodyBytes,
    bodyOmitted: omitted,
  };

  db.insert(rawPayloads)
    .values(row)
    .onConflictDoUpdate({
      target: [rawPayloads.provider, rawPayloads.endpoint, rawPayloads.requestKey],
      set: {
        httpStatus: sql`excluded."http_status"`,
        fetchedAt: sql`excluded."fetched_at"`,
        body: keepStoredWhenEmpty('body'),
        bodyBytes: keepStoredWhenEmpty('body_bytes'),
        bodyOmitted: keepStoredWhenEmpty('body_omitted'),
      },
    })
    .run();

  return { stored: !omitted, bodyBytes };
}

/** Reads one stored payload back, for replay and for tests. */
export function getRawPayload(
  db: AscendDb,
  provider: Provider,
  endpoint: string,
  requestKey = '',
): StoredRawPayload | undefined {
  const rows = db
    .select()
    .from(rawPayloads)
    .where(
      and(
        eq(rawPayloads.provider, provider),
        eq(rawPayloads.endpoint, endpoint),
        eq(rawPayloads.requestKey, requestKey),
      ),
    )
    .limit(1)
    .all();

  const row = rows[0];
  if (!row) return undefined;

  return {
    provider: row.provider,
    endpoint: row.endpoint,
    requestKey: row.requestKey,
    httpStatus: row.httpStatus,
    fetchedAt: row.fetchedAt,
    body: row.body,
    bodyBytes: row.bodyBytes,
    bodyOmitted: row.bodyOmitted,
  };
}
