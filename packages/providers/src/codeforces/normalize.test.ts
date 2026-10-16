import { describe, expect, it } from 'vitest';

import { buildApiSig } from './api';
import type { CfContest, CfSubmission } from './api';
import {
  deriveContestResults,
  ICPC_PENALTY_PER_REJECTION,
  isIcpcStyleGymContest,
  normalizeProblem,
  normalizeSubmission,
} from './normalize';
import type { NormalizedContest, NormalizedSubmission } from '../types';

function submission(overrides: Partial<CfSubmission> = {}): CfSubmission {
  return {
    id: 1,
    contestId: 1846,
    creationTimeSeconds: 1_700_000_000,
    problem: { contestId: 1846, index: 'A', name: 'Problem A', rating: 800, tags: ['math'] },
    author: { members: [{ handle: 'x' }], participantType: 'PRACTICE', ghost: false },
    programmingLanguage: 'GNU C++20',
    verdict: 'OK',
    ...overrides,
  };
}

describe('isIcpcStyleGymContest (spec §37)', () => {
  it('accepts contests with real ICPC provenance', () => {
    expect(isIcpcStyleGymContest({ id: 1, name: 'x', icpcRegion: 'Asia' } as CfContest)).toBe(true);
    expect(
      isIcpcStyleGymContest({ id: 1, name: 'x', kind: 'Official ICPC Contest' } as CfContest),
    ).toBe(true);
  });

  it('rejects gym contests with no ICPC signal', () => {
    expect(
      isIcpcStyleGymContest({ id: 1, name: 'x', kind: 'Official School Contest' } as CfContest),
    ).toBe(false);
    expect(isIcpcStyleGymContest({ id: 1, name: 'x' } as CfContest)).toBe(false);
  });

  // Every Gym contest is typed ICPC or IOI — the type describes scoring, not
  // provenance, so reading it flagged 85% of the Gym as ICPC material. These are
  // the real shapes of three sets this user actually entered.
  it('ignores the ICPC contest type, which every gym set carries', () => {
    expect(
      isIcpcStyleGymContest({
        id: 1,
        name: 'Interactive Problem Training Contest',
        type: 'ICPC',
        kind: 'Training Contest',
      } as CfContest),
    ).toBe(false);
    expect(
      isIcpcStyleGymContest({
        id: 2,
        name: '2018 JUST Programming Contest 1.0',
        type: 'ICPC',
        kind: 'Official School Contest',
      } as CfContest),
    ).toBe(false);
    expect(
      isIcpcStyleGymContest({
        id: 3,
        name: '2019 ICPC Asia Amritapuri',
        type: 'ICPC',
        kind: 'Official ICPC Contest',
      } as CfContest),
    ).toBe(true);
  });
});

describe('normalizeProblem', () => {
  it('keeps Codeforces ratings and tags', () => {
    const problem = normalizeProblem(submission(), 'codeforces');
    expect(problem).toMatchObject({
      id: 'cf:1846:A',
      platformRating: 800,
      ratingSource: 'codeforces',
      tags: ['math'],
    });
  });

  it('treats a Gym problem as unrated and untagged, which is the truth', () => {
    const problem = normalizeProblem(
      submission({
        problem: { contestId: 106608, index: 'G', name: 'Speed Sorting', tags: [] },
        contestId: 106608,
      }),
      'codeforces_gym',
    );
    expect(problem).toMatchObject({
      id: 'gym:106608:G',
      platformRating: null,
      ratingSource: null,
      tags: [],
    });
  });

  it('returns null rather than inventing an id when there is no contest', () => {
    const orphan = submission({ contestId: undefined, problem: { index: 'A', name: 'x' } });
    expect(normalizeProblem(orphan, 'codeforces')).toBeNull();
  });
});

describe('normalizeSubmission', () => {
  it('records in-contest timing when present', () => {
    const normalized = normalizeSubmission(
      submission({ relativeTimeSeconds: 1227, author: { members: [], participantType: 'CONTESTANT', ghost: false } }),
      'codeforces',
    );
    expect(normalized).toMatchObject({
      id: 'cf:1',
      relativeTimeSeconds: 1227,
      participantType: 'CONTESTANT',
    });
  });

  it('discards the out-of-contest sentinel Codeforces sends for practice', () => {
    // Codeforces reports a huge relativeTimeSeconds rather than omitting it.
    const normalized = normalizeSubmission(submission({ relativeTimeSeconds: 2_000_000_000 }), 'codeforces');
    expect(normalized?.relativeTimeSeconds).toBeNull();
  });

  it('prefixes Gym submissions distinctly from regular ones', () => {
    const gym = normalizeSubmission(
      submission({ id: 99, contestId: 106608, problem: { contestId: 106608, index: 'B', name: 'x' } }),
      'codeforces_gym',
    );
    expect(gym?.id).toBe('gym:99');
    expect(gym?.problemId).toBe('gym:106608:B');
  });

  it('maps a still-judging submission to TESTING rather than dropping it', () => {
    const normalized = normalizeSubmission(submission({ verdict: undefined }), 'codeforces');
    expect(normalized?.verdict).toBe('TESTING');
  });
});

// ---------------------------------------------------------------------------

function sub(overrides: Partial<NormalizedSubmission>): NormalizedSubmission {
  return {
    id: 'cf:1',
    provider: 'codeforces',
    providerSubmissionId: '1',
    problemId: 'cf:100:A',
    contestId: 'cf:100',
    verdict: 'OK',
    language: 'C++',
    submittedAt: 1000,
    relativeTimeSeconds: 600,
    participantType: 'CONTESTANT',
    timeConsumedMs: null,
    memoryConsumedBytes: null,
    passedTestCount: null,
    ...overrides,
  };
}

const contest: NormalizedContest = {
  id: 'cf:100',
  provider: 'codeforces',
  providerContestId: '100',
  name: 'Test contest',
  kind: 'regular',
  phase: 'FINISHED',
  startAt: 400,
  durationSeconds: 7200,
  isIcpcStyle: false,
  icpcRegion: null,
  country: null,
  city: null,
  season: null,
  url: null,
};

describe('deriveContestResults', () => {
  const contests = new Map([[contest.id, contest]]);

  it('counts distinct solved problems, not accepted submissions', () => {
    const results = deriveContestResults(
      [
        sub({ id: 'cf:1', problemId: 'cf:100:A' }),
        sub({ id: 'cf:2', problemId: 'cf:100:A' }), // resubmitted the same problem
        sub({ id: 'cf:3', problemId: 'cf:100:B' }),
      ],
      contests,
      new Map(),
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.solvedCount).toBe(2);
  });

  it('applies ICPC penalty: solve minute plus 20 per rejected attempt', () => {
    const results = deriveContestResults(
      [
        sub({ id: 'cf:1', problemId: 'cf:100:A', verdict: 'WRONG_ANSWER', submittedAt: 100, relativeTimeSeconds: 120 }),
        sub({ id: 'cf:2', problemId: 'cf:100:A', verdict: 'WRONG_ANSWER', submittedAt: 200, relativeTimeSeconds: 240 }),
        sub({ id: 'cf:3', problemId: 'cf:100:A', verdict: 'OK', submittedAt: 300, relativeTimeSeconds: 600 }),
      ],
      contests,
      new Map(),
    );

    // 10 minutes at the accept + two rejections.
    expect(results[0]?.penalty).toBe(10 + 2 * ICPC_PENALTY_PER_REJECTION);
  });

  it('does not penalise a compile error, matching ICPC rules', () => {
    const results = deriveContestResults(
      [
        sub({ id: 'cf:1', problemId: 'cf:100:A', verdict: 'COMPILATION_ERROR', submittedAt: 100, relativeTimeSeconds: 120 }),
        sub({ id: 'cf:2', problemId: 'cf:100:A', verdict: 'OK', submittedAt: 300, relativeTimeSeconds: 600 }),
      ],
      contests,
      new Map(),
    );
    expect(results[0]?.penalty).toBe(10);
  });

  it('ignores unsolved problems in both the count and the penalty', () => {
    const results = deriveContestResults(
      [
        sub({ id: 'cf:1', problemId: 'cf:100:A', verdict: 'OK', relativeTimeSeconds: 60 }),
        sub({ id: 'cf:2', problemId: 'cf:100:B', verdict: 'WRONG_ANSWER', relativeTimeSeconds: 120 }),
      ],
      contests,
      new Map(),
    );
    expect(results[0]?.solvedCount).toBe(1);
    expect(results[0]?.penalty).toBe(1);
  });

  it('reports no penalty when the work was untimed', () => {
    const results = deriveContestResults(
      [sub({ participantType: 'PRACTICE', relativeTimeSeconds: null })],
      contests,
      new Map(),
    );
    expect(results[0]?.penalty).toBeNull();
    expect(results[0]?.solvedCount).toBe(1);
  });

  it('separates contest participation from later practice on the same contest', () => {
    const results = deriveContestResults(
      [
        sub({ id: 'cf:1', participantType: 'CONTESTANT', problemId: 'cf:100:A' }),
        sub({ id: 'cf:2', participantType: 'PRACTICE', problemId: 'cf:100:B', relativeTimeSeconds: null }),
      ],
      contests,
      new Map(),
    );
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.participantType).sort()).toEqual(['CONTESTANT', 'PRACTICE']);
  });

  it('attaches rating movement when the contest was rated', () => {
    const results = deriveContestResults(contests.size ? [sub({})] : [], contests, new Map([
      [
        'cf:100',
        {
          provider: 'codeforces' as const,
          contestId: 'cf:100',
          contestName: 'Test contest',
          rank: 1234,
          ratingBefore: 1100,
          ratingAfter: 1183,
          performance: null,
          at: 5000,
        },
      ],
    ]));

    expect(results[0]).toMatchObject({ rank: 1234, ratingBefore: 1100, ratingAfter: 1183, isRated: true });
  });

  it('marks an unrated contest as such rather than guessing', () => {
    const results = deriveContestResults([sub({})], contests, new Map());
    expect(results[0]?.isRated).toBe(false);
    expect(results[0]?.rank).toBeNull();
  });
});

describe('buildApiSig', () => {
  it('is deterministic for a given rand and sorts parameters', () => {
    const a = buildApiSig('contest.standings', { contestId: '1', apiKey: 'k' }, 'secret', '123456');
    const b = buildApiSig('contest.standings', { apiKey: 'k', contestId: '1' }, 'secret', '123456');
    expect(a).toBe(b);
    expect(a.startsWith('123456')).toBe(true);
    // rand + sha512 hex
    expect(a).toHaveLength(6 + 128);
  });

  it('changes when the secret changes', () => {
    const a = buildApiSig('user.info', { handles: 'x' }, 'secret-a', '111111');
    const b = buildApiSig('user.info', { handles: 'x' }, 'secret-b', '111111');
    expect(a).not.toBe(b);
  });
});
