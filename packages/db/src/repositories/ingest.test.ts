import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { emptyFetchResult } from '@ascend/core';
import type {
  NormalizedContest,
  NormalizedProblem,
  NormalizedSubmission,
  ProviderFetchResult,
} from '@ascend/core';

import { openDatabase, type OpenedDatabase } from '../client';
import { runMigrations } from '../migrate';
import { ingestFetchResult, listSubmissionsForContests } from './ingest';

/**
 * Ingestion tests (spec §7, §62, §71's "sync deduplication").
 *
 * Every case here is a scenario the live providers actually produce: the same
 * page fetched twice, a Gym problem with no rating sharing a table with a rated
 * Codeforces one, a contest known only from a submission reference, a result row
 * whose start time is unknown. The SQLite behaviours being guarded against —
 * NULLs not colliding in a unique index, one orphan row aborting a whole
 * transaction — are silent when they go wrong, which is why they are pinned here.
 */

let dir: string;
let opened: OpenedDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ascend-ingest-'));
  opened = openDatabase(join(dir, 'ascend.db'));
  runMigrations(opened.db);
});

afterEach(() => {
  opened.close();
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Factories — defaults are the shape a real adapter emits.
// ---------------------------------------------------------------------------

function contest(overrides: Partial<NormalizedContest> = {}): NormalizedContest {
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
    url: 'https://codeforces.com/contest/1846',
    ...overrides,
  };
}

function problem(overrides: Partial<NormalizedProblem> = {}): NormalizedProblem {
  return {
    id: 'cf:1846:E2',
    provider: 'codeforces',
    contestId: 'cf:1846',
    index: 'E2',
    name: 'Rudolf and Snowflakes (hard version)',
    platformRating: 1900,
    ratingSource: 'codeforces',
    ratingIsExperimental: false,
    points: null,
    solvedCount: 4200,
    timeLimitMs: 2000,
    memoryLimitBytes: 268_435_456,
    url: 'https://codeforces.com/contest/1846/problem/E2',
    tags: ['brute force', 'math'],
    ...overrides,
  };
}

function submission(overrides: Partial<NormalizedSubmission> = {}): NormalizedSubmission {
  return {
    id: 'cf:210000001',
    provider: 'codeforces',
    providerSubmissionId: '210000001',
    problemId: 'cf:1846:E2',
    contestId: 'cf:1846',
    verdict: 'OK',
    language: 'GNU C++20',
    submittedAt: 1_688_003_600,
    relativeTimeSeconds: 3600,
    participantType: 'CONTESTANT',
    timeConsumedMs: 62,
    memoryConsumedBytes: 3_600_000,
    passedTestCount: 41,
    ...overrides,
  };
}

function payload(overrides: Partial<ProviderFetchResult> = {}): ProviderFetchResult {
  return { ...emptyFetchResult(), ...overrides };
}

/** Row counts straight from SQLite, bypassing every abstraction under test. */
function count(table: string): number {
  const row = opened.sqlite.prepare<[], { n: number }>(`select count(*) as n from ${table}`).get();
  return row?.n ?? 0;
}

function problemRow(id: string) {
  return opened.sqlite
    .prepare<
      [string],
      { platform_rating: number | null; rating_source: string | null; name: string; contest_id: string | null }
    >('select platform_rating, rating_source, name, contest_id from problems where id = ?')
    .get(id);
}

function contestRow(id: string) {
  return opened.sqlite
    .prepare<
      [string],
      { name: string; kind: string; start_at: number | null; icpc_region: string | null; is_icpc_style: number }
    >('select name, kind, start_at, icpc_region, is_icpc_style from contests where id = ?')
    .get(id);
}

function tagsOf(problemId: string): string[] {
  return opened.sqlite
    .prepare<[string], { tag: string }>('select tag from problem_tags where problem_id = ? order by tag')
    .all(problemId)
    .map((row) => row.tag);
}

// ---------------------------------------------------------------------------

describe('ingestFetchResult — foreign-key order', () => {
  it('stores a contest, its problem and a submission in one pass', () => {
    const result = ingestFetchResult(opened.db, {
      ...payload({
        contests: [contest()],
        problems: [problem()],
        submissions: [submission()],
      }),
    });

    expect(result.warnings).toEqual([]);
    expect(result.counts).toEqual({
      contests: 1,
      problems: 1,
      submissions: 1,
      contestResults: 0,
      ratingEvents: 0,
    });
    expect(count('contests')).toBe(1);
    expect(count('problems')).toBe(1);
    expect(count('submissions')).toBe(1);
    expect(tagsOf('cf:1846:E2')).toEqual(['brute force', 'math']);
  });

  it('links a submission to a problem stored by an earlier run', () => {
    ingestFetchResult(opened.db, payload({ contests: [contest()], problems: [problem()] }));

    // Second page carries only the submission — the parents are already in the DB.
    const result = ingestFetchResult(opened.db, payload({ submissions: [submission()] }));

    expect(result.warnings).toEqual([]);
    expect(result.counts.submissions).toBe(1);
    expect(count('submissions')).toBe(1);
  });
});

describe('ingestFetchResult — idempotency (§71 sync deduplication)', () => {
  it('re-ingesting the same payload changes no row counts', () => {
    const page = payload({
      contests: [contest()],
      problems: [problem()],
      submissions: [submission()],
      contestResults: [
        {
          contestId: 'cf:1846',
          participantType: 'CONTESTANT',
          rank: 512,
          points: null,
          penalty: 40,
          solvedCount: 3,
          problemCount: 6,
          ratingBefore: 1400,
          ratingAfter: 1436,
          performance: null,
          isRated: true,
          startedAt: 1_688_000_000,
        },
      ],
      ratingEvents: [
        {
          provider: 'codeforces',
          contestId: 'cf:1846',
          contestName: 'Codeforces Round 883',
          rank: 512,
          ratingBefore: 1400,
          ratingAfter: 1436,
          performance: null,
          at: 1_688_010_000,
        },
      ],
    });

    ingestFetchResult(opened.db, page);
    ingestFetchResult(opened.db, page);
    ingestFetchResult(opened.db, page);

    expect(count('contests')).toBe(1);
    expect(count('problems')).toBe(1);
    expect(count('problem_tags')).toBe(2);
    expect(count('submissions')).toBe(1);
    expect(count('contest_results')).toBe(1);
    expect(count('rating_events')).toBe(1);
  });

  it('deduplicates repeated ids inside a single payload', () => {
    // The AtCoder pager repeats the boundary second, so the same submission can
    // appear twice in one collected page.
    const result = ingestFetchResult(
      opened.db,
      payload({
        contests: [contest(), contest()],
        problems: [problem(), problem()],
        submissions: [submission(), submission()],
      }),
    );

    expect(result.counts).toMatchObject({ contests: 1, problems: 1, submissions: 1 });
    expect(count('submissions')).toBe(1);
  });

  it('updates a mutable verdict but keeps the original ingestedAt', () => {
    ingestFetchResult(
      opened.db,
      payload({
        contests: [contest()],
        problems: [problem()],
        submissions: [submission({ verdict: 'TESTING', passedTestCount: null })],
      }),
    );

    const firstSeen = opened.sqlite
      .prepare<[], { ingested_at: number }>('select ingested_at from submissions')
      .get()?.ingested_at;

    ingestFetchResult(opened.db, payload({ submissions: [submission({ verdict: 'OK' })] }));

    const row = opened.sqlite
      .prepare<
        [],
        { verdict: string; ingested_at: number; passed_test_count: number | null }
      >('select verdict, ingested_at, passed_test_count from submissions')
      .get();

    expect(row?.verdict).toBe('OK');
    expect(row?.passed_test_count).toBe(41);
    expect(row?.ingested_at).toBe(firstSeen);
  });
});

describe('ingestFetchResult — placeholders never overwrite real rows', () => {
  const real = contest({
    id: 'gym:104555',
    provider: 'codeforces_gym',
    providerContestId: '104555',
    name: '2023 ICPC Asia Dhaka Regional',
    kind: 'gym',
    isIcpcStyle: true,
    icpcRegion: 'Asia Dhaka',
    season: '2023-2024',
  });

  const synthesized = contest({
    id: 'gym:104555',
    provider: 'codeforces_gym',
    providerContestId: '104555',
    name: 'Gym contest 104555',
    kind: 'gym',
    phase: null,
    startAt: null,
    durationSeconds: null,
    isIcpcStyle: false,
    icpcRegion: null,
    season: null,
    url: null,
    isPlaceholder: true,
  });

  it('keeps the real contest when a placeholder arrives afterwards', () => {
    ingestFetchResult(opened.db, payload({ contests: [real] }));
    ingestFetchResult(opened.db, payload({ contests: [synthesized] }));

    expect(contestRow('gym:104555')).toMatchObject({
      name: '2023 ICPC Asia Dhaka Regional',
      icpc_region: 'Asia Dhaka',
      is_icpc_style: 1,
    });
  });

  it('lets a real contest replace a placeholder stored earlier', () => {
    ingestFetchResult(opened.db, payload({ contests: [synthesized] }));
    ingestFetchResult(opened.db, payload({ contests: [real] }));

    expect(contestRow('gym:104555')).toMatchObject({
      name: '2023 ICPC Asia Dhaka Regional',
      icpc_region: 'Asia Dhaka',
      is_icpc_style: 1,
      start_at: 1_688_000_000,
    });
  });

  it('prefers the real record when both are in the same payload, in either order', () => {
    ingestFetchResult(opened.db, payload({ contests: [synthesized, real] }));
    expect(contestRow('gym:104555')?.name).toBe('2023 ICPC Asia Dhaka Regional');

    ingestFetchResult(opened.db, payload({ contests: [real, synthesized] }));
    expect(contestRow('gym:104555')?.name).toBe('2023 ICPC Asia Dhaka Regional');
    expect(count('contests')).toBe(1);
  });

  it('applies the same rule to problems', () => {
    const realProblem = problem();
    const stub = problem({
      name: 'E2',
      platformRating: null,
      ratingSource: null,
      solvedCount: null,
      timeLimitMs: null,
      memoryLimitBytes: null,
      url: null,
      tags: [],
      isPlaceholder: true,
    });

    ingestFetchResult(opened.db, payload({ contests: [contest()], problems: [realProblem] }));
    ingestFetchResult(opened.db, payload({ problems: [stub] }));

    expect(problemRow('cf:1846:E2')).toMatchObject({
      name: 'Rudolf and Snowflakes (hard version)',
      platform_rating: 1900,
    });
  });
});

describe('ingestFetchResult — a null never erases a real value', () => {
  it('keeps a Codeforces rating when the same problem arrives without one', () => {
    ingestFetchResult(opened.db, payload({ contests: [contest()], problems: [problem()] }));

    // Every Gym problem reports rating: null, and Gym shares this table.
    ingestFetchResult(
      opened.db,
      payload({ problems: [problem({ platformRating: null, ratingSource: null })] }),
    );

    expect(problemRow('cf:1846:E2')).toMatchObject({
      platform_rating: 1900,
      rating_source: 'codeforces',
    });
  });

  it('keeps sparse contest metadata across a payload that omits it', () => {
    ingestFetchResult(opened.db, payload({ contests: [contest({ startAt: 1_688_000_000 })] }));
    ingestFetchResult(opened.db, payload({ contests: [contest({ startAt: null, url: null })] }));

    expect(contestRow('cf:1846')).toMatchObject({ start_at: 1_688_000_000 });
  });

  it('keeps a problem’s contest link when a later payload omits it', () => {
    ingestFetchResult(opened.db, payload({ contests: [contest()], problems: [problem()] }));
    ingestFetchResult(opened.db, payload({ problems: [problem({ contestId: null })] }));

    expect(problemRow('cf:1846:E2')?.contest_id).toBe('cf:1846');
  });
});

describe('ingestFetchResult — tags', () => {
  it('replaces the tag set when a payload carries tags', () => {
    ingestFetchResult(opened.db, payload({ contests: [contest()], problems: [problem()] }));
    ingestFetchResult(
      opened.db,
      payload({ problems: [problem({ tags: ['dp', 'graphs', 'greedy'] })] }),
    );

    expect(tagsOf('cf:1846:E2')).toEqual(['dp', 'graphs', 'greedy']);
  });

  it('leaves stored tags alone when the payload has none', () => {
    // Gym and AtCoder publish no tags at all: an empty list means "this source
    // does not know", not "this problem has none".
    ingestFetchResult(opened.db, payload({ contests: [contest()], problems: [problem()] }));
    ingestFetchResult(opened.db, payload({ problems: [problem({ tags: [] })] }));

    expect(tagsOf('cf:1846:E2')).toEqual(['brute force', 'math']);
  });

  it('deduplicates a repeated tag within one payload', () => {
    ingestFetchResult(
      opened.db,
      payload({ contests: [contest()], problems: [problem({ tags: ['dp', 'dp', 'math'] })] }),
    );

    expect(tagsOf('cf:1846:E2')).toEqual(['dp', 'math']);
  });
});

describe('ingestFetchResult — the nullable unique-index holes', () => {
  it('does not duplicate a contest result whose startedAt is unknown', () => {
    // NULLs do not collide in a SQLite unique index, so an upsert on
    // (contest_id, participant_type, started_at) would insert a second row here.
    const page = payload({
      contests: [contest()],
      contestResults: [
        {
          contestId: 'cf:1846',
          participantType: 'PRACTICE',
          rank: null,
          points: null,
          penalty: null,
          solvedCount: 2,
          problemCount: null,
          ratingBefore: null,
          ratingAfter: null,
          performance: null,
          isRated: false,
          startedAt: null,
        },
      ],
    });

    ingestFetchResult(opened.db, page);
    ingestFetchResult(opened.db, page);

    expect(count('contest_results')).toBe(1);
  });

  it('replaces a result rather than accumulating when the derivation changes', () => {
    const base = {
      contestId: 'cf:1846',
      participantType: 'CONTESTANT',
      rank: null,
      points: null,
      penalty: 20,
      solvedCount: 2,
      problemCount: 6,
      ratingBefore: null,
      ratingAfter: null,
      performance: null,
      isRated: false,
      startedAt: null,
    };

    ingestFetchResult(opened.db, payload({ contests: [contest()], contestResults: [base] }));
    // Re-derived from the full submission set: one more solve turned up.
    ingestFetchResult(
      opened.db,
      payload({ contestResults: [{ ...base, solvedCount: 3, penalty: 60 }] }),
    );

    expect(count('contest_results')).toBe(1);
    const row = opened.sqlite
      .prepare<[], { solved_count: number; penalty: number }>(
        'select solved_count, penalty from contest_results',
      )
      .get();
    expect(row).toMatchObject({ solved_count: 3, penalty: 60 });
  });

  it('keeps separate rows per participation type for the same contest', () => {
    const base = {
      contestId: 'cf:1846',
      rank: null,
      points: null,
      penalty: null,
      solvedCount: 1,
      problemCount: null,
      ratingBefore: null,
      ratingAfter: null,
      performance: null,
      isRated: false,
      startedAt: null,
    };

    ingestFetchResult(
      opened.db,
      payload({
        contests: [contest()],
        contestResults: [
          { ...base, participantType: 'CONTESTANT' },
          { ...base, participantType: 'PRACTICE' },
        ],
      }),
    );

    expect(count('contest_results')).toBe(2);
  });

  it('does not duplicate a rating event with no contest id', () => {
    const page = payload({
      ratingEvents: [
        {
          provider: 'atcoder',
          contestId: null,
          contestName: 'AtCoder Beginner Contest 300',
          rank: 900,
          ratingBefore: 700,
          ratingAfter: 754,
          performance: 1100,
          at: 1_682_000_000,
        },
      ],
    });

    ingestFetchResult(opened.db, page);
    ingestFetchResult(opened.db, page);

    expect(count('rating_events')).toBe(1);
  });

  it('upserts a rating event that does have a contest id', () => {
    const event = {
      provider: 'codeforces' as const,
      contestId: 'cf:1846',
      contestName: 'Codeforces Round 883',
      rank: 512,
      ratingBefore: 1400,
      ratingAfter: 1436,
      performance: null,
      at: 1_688_010_000,
    };

    ingestFetchResult(opened.db, payload({ contests: [contest()], ratingEvents: [event] }));
    ingestFetchResult(opened.db, payload({ ratingEvents: [{ ...event, rank: 480 }] }));

    expect(count('rating_events')).toBe(1);
    expect(
      opened.sqlite.prepare<[], { rank: number }>('select rank from rating_events').get()?.rank,
    ).toBe(480);
  });
});

describe('ingestFetchResult — unresolvable references are reported, not fatal', () => {
  it('skips a submission whose problem is nowhere and warns', () => {
    const result = ingestFetchResult(
      opened.db,
      payload({
        contests: [contest()],
        problems: [problem()],
        submissions: [
          submission(),
          submission({ id: 'cf:210000002', providerSubmissionId: '210000002', problemId: 'cf:9999:Z' }),
        ],
      }),
    );

    // The good row still lands: an FK violation would have aborted everything.
    expect(count('submissions')).toBe(1);
    expect(result.counts.submissions).toBe(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('cf:210000002');
    expect(result.warnings[0]).toMatch(/problem is not in this payload or the database/);
  });

  it('stores a problem whose contest is unknown, with its link dropped and a warning', () => {
    const result = ingestFetchResult(
      opened.db,
      payload({ problems: [problem({ contestId: 'cf:404' })] }),
    );

    expect(problemRow('cf:1846:E2')?.contest_id).toBeNull();
    expect(result.warnings[0]).toMatch(/referenced contest is not in this payload or the database/);
  });

  it('skips a contest result and a rating event for an unknown contest', () => {
    const result = ingestFetchResult(
      opened.db,
      payload({
        contestResults: [
          {
            contestId: 'cf:404',
            participantType: 'CONTESTANT',
            rank: null,
            points: null,
            penalty: null,
            solvedCount: 1,
            problemCount: null,
            ratingBefore: null,
            ratingAfter: null,
            performance: null,
            isRated: false,
            startedAt: null,
          },
        ],
        ratingEvents: [
          {
            provider: 'codeforces',
            contestId: 'cf:404',
            contestName: null,
            rank: null,
            ratingBefore: null,
            ratingAfter: null,
            performance: null,
            at: 1_688_010_000,
          },
        ],
      }),
    );

    expect(count('contest_results')).toBe(0);
    expect(count('rating_events')).toBe(0);
    expect(result.counts.contestResults).toBe(0);
    expect(result.counts.ratingEvents).toBe(0);
    expect(result.warnings).toHaveLength(2);
  });

  it('drops only the contest link when a submission names an unknown contest', () => {
    ingestFetchResult(opened.db, payload({ contests: [contest()], problems: [problem()] }));
    ingestFetchResult(opened.db, payload({ submissions: [submission({ contestId: 'cf:404' })] }));

    expect(
      opened.sqlite
        .prepare<[], { contest_id: string | null }>('select contest_id from submissions')
        .get()?.contest_id,
    ).toBeNull();
  });
});

describe('ingestFetchResult — empty payload', () => {
  it('writes nothing and warns about nothing', () => {
    const result = ingestFetchResult(opened.db, emptyFetchResult());

    expect(result.counts).toEqual({
      contests: 0,
      problems: 0,
      submissions: 0,
      contestResults: 0,
      ratingEvents: 0,
    });
    expect(result.warnings).toEqual([]);
    expect(count('contests')).toBe(0);
  });
});

describe('listSubmissionsForContests', () => {
  it('returns every stored submission for the requested contests', () => {
    ingestFetchResult(
      opened.db,
      payload({
        contests: [contest(), contest({ id: 'cf:1847', providerContestId: '1847' })],
        problems: [problem(), problem({ id: 'cf:1847:A', contestId: 'cf:1847', index: 'A' })],
        submissions: [
          submission(),
          submission({ id: 'cf:210000002', providerSubmissionId: '210000002', verdict: 'WRONG_ANSWER' }),
          submission({
            id: 'cf:210000003',
            providerSubmissionId: '210000003',
            problemId: 'cf:1847:A',
            contestId: 'cf:1847',
          }),
        ],
      }),
    );

    const rows = listSubmissionsForContests(opened.db, ['cf:1846']);
    expect(rows.map((row) => row.id).sort()).toEqual(['cf:210000001', 'cf:210000002']);
    // Shaped for re-derivation: the normalized fields come back intact.
    expect(rows[0]).toMatchObject({ problemId: 'cf:1846:E2', relativeTimeSeconds: 3600 });

    expect(listSubmissionsForContests(opened.db, ['cf:1846', 'cf:1847'])).toHaveLength(3);
    expect(listSubmissionsForContests(opened.db, [])).toEqual([]);
    expect(listSubmissionsForContests(opened.db, ['cf:404'])).toEqual([]);
  });
});
