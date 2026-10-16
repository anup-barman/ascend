import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { emptyFetchResult } from '@ascend/core';
import type {
  NormalizedContest,
  NormalizedProblem,
  NormalizedRatingEvent,
  NormalizedSubmission,
  Provider,
  ProviderFetchResult,
  SyncCursor,
} from '@ascend/core';
import {
  getSyncState,
  openDatabase,
  runMigrations,
  upsertPlatformAccount,
  type OpenedDatabase,
} from '@ascend/db';
import type { PlatformAdapter, SyncRequest } from '@ascend/providers';

import { runSync, SYNC_RESOURCE, withStoredSolveCounts, type SyncEvent } from './engine';

/**
 * Sync engine tests (spec §7, §62, §71's "sync deduplication").
 *
 * The adapters here are scripted rather than mocked HTTP: what is under test is
 * the engine's bookkeeping — which cursor moves, which status is written, what
 * survives a failure — and that is decided entirely by what an adapter returns or
 * throws. §62's promise is the one most of these pin down: a provider outage must
 * leave the database exactly as it was and must not advance the cursor, or the
 * retry would skip whatever it failed to fetch.
 */

let dir: string;
let opened: OpenedDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ascend-sync-'));
  opened = openDatabase(join(dir, 'ascend.db'));
  runMigrations(opened.db);
  upsertPlatformAccount(opened.db, 'codeforces', 'tourist');
  upsertPlatformAccount(opened.db, 'atcoder', 'chokudai');
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
// Scripted adapters
// ---------------------------------------------------------------------------

interface ScriptedOptions {
  provider: Provider;
  /** Returned from `sync`, or thrown if it is an Error. */
  result: ProviderFetchResult | Error;
}

function scripted(options: ScriptedOptions): PlatformAdapter & { requests: SyncRequest[] } {
  const requests: SyncRequest[] = [];
  return {
    provider: options.provider,
    label: options.provider,
    requests,
    async getUserProfile(handle: string) {
      return {
        provider: options.provider,
        handle,
        rating: null,
        maxRating: null,
        rank: null,
        maxRank: null,
        country: null,
        organization: null,
      };
    },
    async sync(request: SyncRequest) {
      requests.push(request);
      if (options.result instanceof Error) throw options.result;
      return options.result;
    },
  };
}

// ---------------------------------------------------------------------------
// Payload factories — the shape the real adapters emit.
// ---------------------------------------------------------------------------

function cfContest(overrides: Partial<NormalizedContest> = {}): NormalizedContest {
  return {
    id: 'cf:1846',
    provider: 'codeforces',
    providerContestId: '1846',
    name: 'Codeforces Round 883',
    kind: 'regular',
    phase: 'FINISHED',
    startAt: 1_688_000_000,
    durationSeconds: 7200,
    isIcpcStyle: false,
    icpcRegion: null,
    country: null,
    city: null,
    season: null,
    url: null,
    ...overrides,
  };
}

function cfProblem(overrides: Partial<NormalizedProblem> = {}): NormalizedProblem {
  return {
    id: 'cf:1846:A',
    provider: 'codeforces',
    contestId: 'cf:1846',
    index: 'A',
    name: 'Rudolph and Cut the Rope',
    platformRating: 800,
    ratingSource: 'codeforces',
    ratingIsExperimental: false,
    points: null,
    solvedCount: null,
    timeLimitMs: null,
    memoryLimitBytes: null,
    url: null,
    tags: ['math'],
    ...overrides,
  };
}

function cfSubmission(overrides: Partial<NormalizedSubmission> = {}): NormalizedSubmission {
  return {
    id: 'cf:210000001',
    provider: 'codeforces',
    providerSubmissionId: '210000001',
    problemId: 'cf:1846:A',
    contestId: 'cf:1846',
    verdict: 'OK',
    language: 'GNU C++20',
    submittedAt: 1_688_000_600,
    relativeTimeSeconds: 600,
    participantType: 'CONTESTANT',
    timeConsumedMs: 30,
    memoryConsumedBytes: 0,
    passedTestCount: 20,
    ...overrides,
  };
}

/** One contest, one problem, one accepted in-contest submission. */
function cfPayload(cursor: SyncCursor, extra: Partial<ProviderFetchResult> = {}): ProviderFetchResult {
  return {
    ...emptyFetchResult(),
    contests: [cfContest()],
    problems: [cfProblem()],
    submissions: [cfSubmission()],
    cursor,
    ...extra,
  };
}

// ---------------------------------------------------------------------------

describe('runSync', () => {
  it('ingests a clean run, records UP TO DATE and advances the cursor', async () => {
    const adapter = scripted({
      provider: 'codeforces',
      result: cfPayload({ lastSeenId: '210000001' }),
    });

    const result = await runSync({
      db: opened.db,
      adapters: [adapter],
      handleFor: () => 'tourist',
    });

    expect(result.overall).toBe('up_to_date');
    expect(result.providers[0]?.itemsSynced).toBe(1);
    expect(count('submissions')).toBe(1);

    const state = getSyncState(opened.db, 'codeforces', SYNC_RESOURCE);
    expect(state?.status).toBe('up_to_date');
    expect(state?.cursor).toEqual({ lastSeenId: '210000001' });
    expect(adapter.requests[0]?.handle).toBe('tourist');
    // A first run starts from nothing, not from a fabricated position.
    expect(adapter.requests[0]?.cursor).toEqual({});
  });

  it('reports PARTIALLY SYNCED with the reason when the fetch returns warnings', async () => {
    const adapter = scripted({
      provider: 'codeforces_gym',
      result: cfPayload({ lastSeenId: '1' }, { warnings: ['Standings need a Codeforces API key.'] }),
    });

    const result = await runSync({
      db: opened.db,
      adapters: [adapter],
      handleFor: () => 'tourist',
    });

    expect(result.overall).toBe('partially_synced');
    const state = getSyncState(opened.db, 'codeforces_gym', SYNC_RESOURCE);
    expect(state?.status).toBe('partially_synced');
    expect(state?.error).toContain('Codeforces API key');
    // Partial is still progress: the data that did arrive was stored.
    expect(count('submissions')).toBe(1);
  });

  it('leaves rows and the cursor untouched when a provider fails (§62)', async () => {
    await runSync({
      db: opened.db,
      adapters: [scripted({ provider: 'codeforces', result: cfPayload({ lastSeenId: '10' }) })],
      handleFor: () => 'tourist',
    });

    const before = count('submissions');

    const result = await runSync({
      db: opened.db,
      adapters: [
        scripted({ provider: 'codeforces', result: new Error('403 Forbidden from codeforces.com') }),
      ],
      handleFor: () => 'tourist',
    });

    expect(result.overall).toBe('failed');
    expect(result.providers[0]?.error).toContain('403');
    expect(count('submissions')).toBe(before);

    const state = getSyncState(opened.db, 'codeforces', SYNC_RESOURCE);
    expect(state?.status).toBe('failed');
    // The retry must resume, so the last good position has to survive.
    expect(state?.cursor).toEqual({ lastSeenId: '10' });
  });

  it('resumes from the stored cursor on the next run', async () => {
    await runSync({
      db: opened.db,
      adapters: [scripted({ provider: 'atcoder', result: { ...emptyFetchResult(), cursor: { lastSeenAt: 1_700_000_000 } } })],
      handleFor: () => 'chokudai',
    });

    const second = scripted({ provider: 'atcoder', result: emptyFetchResult() });
    await runSync({ db: opened.db, adapters: [second], handleFor: () => 'chokudai' });

    expect(second.requests[0]?.cursor).toEqual({ lastSeenAt: 1_700_000_000 });
  });

  it('changes no counts when the same payload is synced twice', async () => {
    const payload = cfPayload({ lastSeenId: '210000001' });

    await runSync({
      db: opened.db,
      adapters: [scripted({ provider: 'codeforces', result: payload })],
      handleFor: () => 'tourist',
    });
    const first = {
      contests: count('contests'),
      problems: count('problems'),
      submissions: count('submissions'),
      results: count('contest_results'),
    };

    await runSync({
      db: opened.db,
      adapters: [scripted({ provider: 'codeforces', result: payload })],
      handleFor: () => 'tourist',
    });

    expect({
      contests: count('contests'),
      problems: count('problems'),
      submissions: count('submissions'),
      results: count('contest_results'),
    }).toEqual(first);
  });

  it('skips a provider with no configured handle without writing a sync row', async () => {
    const adapter = scripted({ provider: 'atcoder', result: emptyFetchResult() });

    const result = await runSync({
      db: opened.db,
      adapters: [adapter],
      handleFor: () => null,
    });

    expect(result.providers[0]?.status).toBe('skipped');
    expect(result.providers[0]?.skippedReason).toContain('handle');
    expect(adapter.requests).toHaveLength(0);
    expect(getSyncState(opened.db, 'atcoder', SYNC_RESOURCE)).toBeNull();
    // Nothing ran, so nothing is known — not "up to date".
    expect(result.overall).toBe('never_synced');
  });

  it('emits a started, per-provider and finished event stream', async () => {
    const events: SyncEvent[] = [];

    await runSync({
      db: opened.db,
      adapters: [scripted({ provider: 'codeforces', result: cfPayload({ lastSeenId: '1' }) })],
      handleFor: () => 'tourist',
      onEvent: (event) => events.push(event),
    });

    expect(events.map((event) => event.kind)).toEqual([
      'started',
      'provider_started',
      'provider_finished',
      'finished',
    ]);
    // The final frame is what the badge renders, so it must carry the outcome.
    // The roll-up stays `never_synced` overall because the other two providers
    // genuinely have never been contacted — that is the honest answer (§58).
    const final = events.at(-1)?.summary;
    expect(final?.providers.find((entry) => entry.provider === 'codeforces')?.status).toBe(
      'up_to_date',
    );
    expect(final?.overall).toBe('never_synced');
  });
});

describe('runSync and the shared Codeforces cursor', () => {
  it('gives both Codeforces adapters the same pre-run cursor and mirrors the advance', async () => {
    const cf = scripted({ provider: 'codeforces', result: cfPayload({ lastSeenId: '99' }) });
    const gym = scripted({
      provider: 'codeforces_gym',
      result: { ...emptyFetchResult(), cursor: { lastSeenId: '99' } },
    });

    await runSync({ db: opened.db, adapters: [cf, gym], handleFor: () => 'tourist' });

    // One `user.status` pass serves both, so both must ask from the same place.
    expect(cf.requests[0]?.cursor).toEqual({});
    expect(gym.requests[0]?.cursor).toEqual({});

    expect(getSyncState(opened.db, 'codeforces', SYNC_RESOURCE)?.cursor).toEqual({
      lastSeenId: '99',
    });
    expect(getSyncState(opened.db, 'codeforces_gym', SYNC_RESOURCE)?.cursor).toEqual({
      lastSeenId: '99',
    });
  });

  it('holds the shared cursor back when either half of the family fails', async () => {
    const cf = scripted({ provider: 'codeforces', result: new Error('timeout') });
    const gym = scripted({
      provider: 'codeforces_gym',
      result: { ...emptyFetchResult(), cursor: { lastSeenId: '500' } },
    });

    await runSync({ db: opened.db, adapters: [cf, gym], handleFor: () => 'tourist' });

    // Advancing on Gym's success alone would skip submissions the regular
    // adapter never ingested.
    expect(getSyncState(opened.db, 'codeforces', SYNC_RESOURCE)?.cursor).toBeNull();
    expect(getSyncState(opened.db, 'codeforces_gym', SYNC_RESOURCE)?.cursor).toBeNull();
    expect(getSyncState(opened.db, 'codeforces_gym', SYNC_RESOURCE)?.status).toBe('up_to_date');
  });

  it('does not hold AtCoder back because Codeforces failed', async () => {
    const cf = scripted({ provider: 'codeforces', result: new Error('timeout') });
    const ac = scripted({
      provider: 'atcoder',
      result: { ...emptyFetchResult(), cursor: { lastSeenAt: 42 } },
    });

    const result = await runSync({ db: opened.db, adapters: [cf, ac], handleFor: () => 'handle' });

    expect(result.overall).toBe('failed');
    expect(getSyncState(opened.db, 'atcoder', SYNC_RESOURCE)?.cursor).toEqual({
      lastSeenAt: 42,
    });
  });
});

describe('runSync contest-result re-derivation', () => {
  it('derives a Codeforces result from the full stored submission history', async () => {
    // First run: one wrong answer, no accept yet.
    await runSync({
      db: opened.db,
      adapters: [
        scripted({
          provider: 'codeforces',
          result: cfPayload(
            { lastSeenId: '1' },
            {
              submissions: [
                cfSubmission({
                  id: 'cf:1',
                  providerSubmissionId: '1',
                  verdict: 'WRONG_ANSWER',
                  submittedAt: 1_688_000_300,
                  relativeTimeSeconds: 300,
                }),
              ],
            },
          ),
        }),
      ],
      handleFor: () => 'tourist',
    });

    // Second run brings only the accept — the rejection is already stored.
    await runSync({
      db: opened.db,
      adapters: [
        scripted({
          provider: 'codeforces',
          result: cfPayload(
            { lastSeenId: '2' },
            {
              submissions: [
                cfSubmission({
                  id: 'cf:2',
                  providerSubmissionId: '2',
                  verdict: 'OK',
                  submittedAt: 1_688_000_900,
                  relativeTimeSeconds: 900,
                }),
              ],
            },
          ),
        }),
      ],
      handleFor: () => 'tourist',
    });

    const row = opened.sqlite
      .prepare<[string], { solved_count: number; penalty: number }>(
        'select solved_count, penalty from contest_results where contest_id = ?',
      )
      .get('cf:1846');

    // 15 minutes to the accept plus one 20-minute rejection penalty: the
    // rejection is only visible if the whole stored history was rescored.
    expect(row?.solved_count).toBe(1);
    expect(row?.penalty).toBe(35);
  });

  it('keeps an AtCoder solve count that the incremental page cannot see', async () => {
    const acContest: NormalizedContest = {
      id: 'ac:abc300',
      provider: 'atcoder',
      providerContestId: 'abc300',
      name: 'AtCoder Beginner Contest 300',
      kind: 'atcoder',
      phase: 'FINISHED',
      startAt: 1_682_000_000,
      durationSeconds: 6000,
      isIcpcStyle: false,
      icpcRegion: null,
      country: null,
      city: null,
      season: null,
      url: null,
    };
    const acProblem: NormalizedProblem = {
      ...cfProblem(),
      id: 'ac:abc300_a',
      provider: 'atcoder',
      contestId: 'ac:abc300',
      index: 'A',
      name: 'N-choice question',
      platformRating: null,
      ratingSource: null,
      tags: [],
    };
    const acSubmission: NormalizedSubmission = {
      ...cfSubmission(),
      id: 'ac:1',
      provider: 'atcoder',
      providerSubmissionId: '1',
      problemId: 'ac:abc300_a',
      contestId: 'ac:abc300',
      submittedAt: 1_682_000_300,
      participantType: 'CONTESTANT',
    };
    const ratingEvent: NormalizedRatingEvent = {
      provider: 'atcoder',
      contestId: 'ac:abc300',
      contestName: acContest.name,
      rank: 120,
      ratingBefore: 1000,
      ratingAfter: 1050,
      performance: 1400,
      at: 1_682_006_000,
    };

    // First run carries the submission, so the count can be computed.
    await runSync({
      db: opened.db,
      adapters: [
        scripted({
          provider: 'atcoder',
          result: {
            ...emptyFetchResult(),
            contests: [acContest],
            problems: [acProblem],
            submissions: [acSubmission],
            ratingEvents: [ratingEvent],
            contestResults: [
              {
                contestId: 'ac:abc300',
                participantType: 'CONTESTANT',
                rank: 120,
                points: null,
                penalty: null,
                solvedCount: 1,
                problemCount: null,
                ratingBefore: 1000,
                ratingAfter: 1050,
                performance: 1400,
                isRated: true,
                startedAt: acContest.startAt,
              },
            ],
            cursor: { lastSeenAt: 1_682_000_300 },
          },
        }),
      ],
      handleFor: () => 'chokudai',
    });

    // The second run re-sends the rating history — every contest the user ever
    // entered — but no submissions, so its own solve counts are null.
    await runSync({
      db: opened.db,
      adapters: [
        scripted({
          provider: 'atcoder',
          result: {
            ...emptyFetchResult(),
            ratingEvents: [ratingEvent],
            contestResults: [
              {
                contestId: 'ac:abc300',
                participantType: 'CONTESTANT',
                rank: 120,
                points: null,
                penalty: null,
                solvedCount: null,
                problemCount: null,
                ratingBefore: 1000,
                ratingAfter: 1050,
                performance: 1400,
                isRated: true,
                startedAt: acContest.startAt,
              },
            ],
            cursor: { lastSeenAt: 1_682_000_301 },
          },
        }),
      ],
      handleFor: () => 'chokudai',
    });

    const row = opened.sqlite
      .prepare<[string], { solved_count: number | null; rank: number | null }>(
        'select solved_count, rank from contest_results where contest_id = ?',
      )
      .get('ac:abc300');

    expect(row?.solved_count).toBe(1);
    // Rank comes from the rating history and only the history knows it.
    expect(row?.rank).toBe(120);
  });
});

describe('withStoredSolveCounts', () => {
  const result = {
    contestId: 'ac:abc300',
    participantType: 'CONTESTANT',
    rank: 1,
    points: null,
    penalty: null,
    solvedCount: 4,
    problemCount: null,
    ratingBefore: null,
    ratingAfter: null,
    performance: null,
    isRated: true,
    startedAt: null,
  };

  it('leaves a count alone when no submission for that contest is stored', () => {
    expect(withStoredSolveCounts([result], [])[0]?.solvedCount).toBe(4);
  });

  it('counts distinct accepted problems, not accepted submissions', () => {
    const stored = [
      cfSubmission({ id: 'a', problemId: 'ac:abc300_a', contestId: 'ac:abc300' }),
      cfSubmission({ id: 'b', problemId: 'ac:abc300_a', contestId: 'ac:abc300' }),
      cfSubmission({ id: 'c', problemId: 'ac:abc300_b', contestId: 'ac:abc300' }),
    ];
    expect(withStoredSolveCounts([result], stored)[0]?.solvedCount).toBe(2);
  });

  it('reports zero when the contest was attempted but nothing was solved', () => {
    const stored = [
      cfSubmission({ id: 'a', contestId: 'ac:abc300', verdict: 'WRONG_ANSWER' }),
    ];
    expect(withStoredSolveCounts([result], stored)[0]?.solvedCount).toBe(0);
  });
});
