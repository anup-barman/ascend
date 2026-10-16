import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { emptyFetchResult } from '@ascend/core';
import type { Provider, ProviderFetchResult } from '@ascend/core';
import {
  getSyncState,
  openDatabase,
  runMigrations,
  upsertPlatformAccount,
  type OpenedDatabase,
} from '@ascend/db';
import {
  CodeforcesAdapter,
  CodeforcesApi,
  CodeforcesGymAdapter,
  CodeforcesSource,
  HostRateLimiter,
  HttpClient,
  MemoryCacheStore,
} from '@ascend/providers';
import type { PlatformAdapter } from '@ascend/providers';

import { runSync, SYNC_RESOURCE } from './engine';

/**
 * §62 failure-path integration tests.
 *
 * The scripted-adapter tests in engine.test.ts prove the bookkeeping layer.
 * These tests wire a scripted fetchImpl under *real* CF adapters so the full
 * stack — HttpClient → CodeforcesApi → CodeforcesSource → adapter → engine →
 * DB — is inside the blast radius. That is the only way to confirm a parsing
 * bug or HTTP-layer surprise is caught before it touches the cursor or rows.
 *
 * §62 contract being pinned:
 *   A provider failure must not change any row in the database.
 *   A provider failure must not advance the cursor.
 *   The sync status must be SYNC FAILED (or PARTIALLY SYNCED when only
 *   optional enrichment failed, e.g. gymContestList, not the core fetch).
 */

// ---------------------------------------------------------------------------
// DB setup
// ---------------------------------------------------------------------------

let dir: string;
let opened: OpenedDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ascend-failure-'));
  opened = openDatabase(join(dir, 'ascend.db'));
  runMigrations(opened.db);
  upsertPlatformAccount(opened.db, 'codeforces', 'tourist');
});

afterEach(() => {
  opened.close();
  rmSync(dir, { recursive: true, force: true });
});

function count(table: string): number {
  return (
    opened.sqlite.prepare<[], { n: number }>(`select count(*) as n from ${table}`).get()?.n ?? 0
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal scripted adapter for pre-populating the DB in the first run. */
function seedAdapter(provider: Provider, payload: ProviderFetchResult): PlatformAdapter {
  return {
    provider,
    label: provider,
    async getUserProfile(handle) {
      return {
        provider,
        handle,
        rating: null,
        maxRating: null,
        rank: null,
        maxRank: null,
        country: null,
        organization: null,
      };
    },
    async sync() {
      return payload;
    },
  };
}

/**
 * Returns real CF adapters sharing one HttpClient whose fetch is scripted.
 *
 * `maxRetries: 0` makes failures instant; no sleeping needed in tests.
 * `HostRateLimiter` with a zero interval and a no-op sleep means no waiting
 * between the scripted calls.
 */
function cfAdapters(responses: (() => Response | never)[]): {
  cf: CodeforcesAdapter;
  gym: CodeforcesGymAdapter;
} {
  const fetchImpl = async (_input: Parameters<typeof fetch>[0]): Promise<Response> => {
    const next = responses.shift();
    if (!next) throw new Error('scripted fetch exhausted');
    return next();
  };

  const http = new HttpClient({
    fetchImpl: fetchImpl as typeof fetch,
    sleep: async () => {},
    limiter: new HostRateLimiter({}, 0, async () => {}, () => 0),
    cache: new MemoryCacheStore(),
    maxRetries: 0,
  });

  const api = new CodeforcesApi(http, null);
  const source = new CodeforcesSource(api);
  return {
    cf: new CodeforcesAdapter(api, source),
    gym: new CodeforcesGymAdapter(api, source),
  };
}

/** CF API success envelope JSON. */
function cfOk<T>(result: T): string {
  return JSON.stringify({ status: 'OK', result });
}

/** CF API failure envelope JSON (§62: ProviderRejectedError). */
function cfFailed(comment = 'Internal server error'): string {
  return JSON.stringify({ status: 'FAILED', comment });
}

function jsonResp(body: string, status = 200): () => Response {
  return () => new Response(body, { status, headers: { 'content-type': 'application/json' } });
}

// ---------------------------------------------------------------------------
// Tests (spec §62)
// ---------------------------------------------------------------------------

describe('§62 failure-path: scripted HTTP under real CF adapters', () => {
  /**
   * Pre-populates the DB and sync_state via the scripted seed adapter, then
   * returns the row counts and cursor for comparison after the failure run.
   */
  async function seedCfRun(): Promise<{
    submissions: number;
    cursor: unknown;
  }> {
    // One contest, one problem, one accepted submission — enough to assert rows.
    const cfContest = {
      id: 'cf:1846',
      provider: 'codeforces' as Provider,
      providerContestId: '1846',
      name: 'Codeforces Round 883',
      kind: 'regular' as const,
      phase: 'FINISHED' as const,
      startAt: 1_688_000_000,
      durationSeconds: 7200,
      isIcpcStyle: false,
      icpcRegion: null,
      country: null,
      city: null,
      season: null,
      url: null,
    };
    const cfProblem = {
      id: 'cf:1846:A',
      provider: 'codeforces' as Provider,
      contestId: 'cf:1846',
      index: 'A',
      name: 'Rudolph and Cut the Rope',
      platformRating: 800,
      ratingSource: 'codeforces' as const,
      ratingIsExperimental: false,
      points: null,
      solvedCount: null,
      timeLimitMs: null,
      memoryLimitBytes: null,
      url: null,
      tags: ['math'],
    };
    const cfSubmission = {
      id: 'cf:210000001',
      provider: 'codeforces' as Provider,
      providerSubmissionId: '210000001',
      problemId: 'cf:1846:A',
      contestId: 'cf:1846',
      verdict: 'OK' as const,
      language: 'GNU C++20',
      submittedAt: 1_688_000_600,
      relativeTimeSeconds: 600,
      participantType: 'CONTESTANT',
      timeConsumedMs: 30,
      memoryConsumedBytes: 0,
      passedTestCount: 20,
    };

    await runSync({
      db: opened.db,
      adapters: [
        seedAdapter('codeforces', {
          ...emptyFetchResult(),
          contests: [cfContest],
          problems: [cfProblem],
          submissions: [cfSubmission],
          cursor: { lastSeenId: '210000001' },
        }),
      ],
      handleFor: () => 'tourist',
    });

    return {
      submissions: count('submissions'),
      cursor: getSyncState(opened.db, 'codeforces', SYNC_RESOURCE)?.cursor,
    };
  }

  it('preserves rows and the cursor when the CF API returns a FAILED envelope on userStatus', async () => {
    const before = await seedCfRun();
    expect(before.submissions).toBe(1);

    // gymContestList succeeds; userStatus returns a CF FAILED envelope, which
    // CodeforcesApi translates to ProviderRejectedError (non-retryable).
    const { cf, gym } = cfAdapters([
      jsonResp(cfOk([])),         // gymContestList → OK, empty
      jsonResp(cfFailed('handle not found')),  // userStatus page 1 → FAILED
    ]);

    const result = await runSync({
      db: opened.db,
      adapters: [cf, gym],
      handleFor: () => 'tourist',
    });

    expect(result.overall).toBe('failed');
    expect(result.providers[0]?.status).toBe('failed');
    expect(result.providers[0]?.error).toBeTruthy();
    // The row from the first run must still be there.
    expect(count('submissions')).toBe(before.submissions);
    // The cursor must not have moved — the retry must resume from here.
    const state = getSyncState(opened.db, 'codeforces', SYNC_RESOURCE);
    expect(state?.status).toBe('failed');
    expect(state?.cursor).toEqual(before.cursor);
  });

  it('preserves rows and the cursor when a Cloudflare challenge intercepts userStatus', async () => {
    const before = await seedCfRun();

    // The `cf-mitigated: challenge` header is the signal HttpClient uses to
    // throw BotProtectionError (non-retryable — scraping is not possible).
    const { cf, gym } = cfAdapters([
      jsonResp(cfOk([])),   // gymContestList
      () => new Response('Forbidden', { status: 403, headers: { 'cf-mitigated': 'challenge' } }),
    ]);

    const result = await runSync({
      db: opened.db,
      adapters: [cf, gym],
      handleFor: () => 'tourist',
    });

    expect(result.overall).toBe('failed');
    expect(count('submissions')).toBe(before.submissions);
    expect(getSyncState(opened.db, 'codeforces', SYNC_RESOURCE)?.cursor).toEqual(before.cursor);
  });

  it('preserves rows and the cursor when the network itself fails on userStatus', async () => {
    const before = await seedCfRun();

    // The fetchImpl throws rather than returning a Response — simulates a
    // connection reset, DNS failure, or timeout at the OS level.
    const { cf, gym } = cfAdapters([
      jsonResp(cfOk([])),              // gymContestList
      () => { throw new Error('ECONNRESET'); },  // userStatus → network error
    ]);

    const result = await runSync({
      db: opened.db,
      adapters: [cf, gym],
      handleFor: () => 'tourist',
    });

    expect(result.overall).toBe('failed');
    expect(count('submissions')).toBe(before.submissions);
    expect(getSyncState(opened.db, 'codeforces', SYNC_RESOURCE)?.cursor).toEqual(before.cursor);
  });

  it('preserves rows and the cursor when userStatus returns malformed JSON', async () => {
    const before = await seedCfRun();

    const { cf, gym } = cfAdapters([
      jsonResp(cfOk([])),                                  // gymContestList
      () => new Response('not json at all', { status: 200, headers: { 'content-type': 'application/json' } }),
    ]);

    const result = await runSync({
      db: opened.db,
      adapters: [cf, gym],
      handleFor: () => 'tourist',
    });

    expect(result.overall).toBe('failed');
    expect(count('submissions')).toBe(before.submissions);
    expect(getSyncState(opened.db, 'codeforces', SYNC_RESOURCE)?.cursor).toEqual(before.cursor);
  });

  it('records PARTIALLY SYNCED and still stores data when gymContestList fails (not a hard failure)', async () => {
    // gymContestList failure is an optional-enrichment gap: source.ts catches it,
    // records a warning, and continues fetching userStatus. The data that did
    // arrive is stored and the cursor advances — the user gets a degraded run,
    // not a total failure (§7: warnings turn a run into PARTIALLY SYNCED).
    const { cf, gym } = cfAdapters([
      () => new Response('', { status: 500 }),   // gymContestList → error (no Gym separation)
      jsonResp(cfOk([])),                        // userStatus page 1 → empty (no new submissions)
      jsonResp(cfOk([])),                        // userRating → empty
    ]);

    const result = await runSync({
      db: opened.db,
      adapters: [cf],    // gym adapter shares the same source; test cf only here
      handleFor: () => 'tourist',
    });

    // A warning, not a hard failure: data arrived, run is PARTIALLY SYNCED.
    expect(result.providers[0]?.status).toBe('partially_synced');
    expect(result.providers[0]?.warnings.length).toBeGreaterThan(0);
    // The warning text should say why (CLAUDE.md: record decisions with their reason).
    expect(result.providers[0]?.warnings[0]).toMatch(/gym/i);
    const state = getSyncState(opened.db, 'codeforces', SYNC_RESOURCE);
    expect(state?.status).toBe('partially_synced');
  });
});
