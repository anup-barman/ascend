import { describe, expect, it } from 'vitest';

import { decodeHtmlEntities } from './api';
import type { AcContest, AcHistoryEntry, AcSubmission } from './api';
import {
  contestIdFromScreenName,
  correctDifficulty,
  normalizeContestResults,
  normalizeRatingEvents,
  normalizeSubmission,
  normalizeVerdict,
} from './normalize';

function submission(overrides: Partial<AcSubmission> = {}): AcSubmission {
  return {
    id: 52612109,
    epoch_second: 1_713_619_944,
    problem_id: 'abc350_a',
    contest_id: 'abc350',
    user_id: 'AnupBarman',
    language: 'C++ 20 (gcc 12.2)',
    point: 0,
    length: 400,
    result: 'WA',
    execution_time: 1,
    ...overrides,
  };
}

const contest: AcContest = {
  id: 'abc350',
  start_epoch_second: 1_713_600_000,
  duration_second: 6000,
  title: 'AtCoder Beginner Contest 350',
  rate_change: '~ 1999',
};

describe('normalizeVerdict', () => {
  it('maps AtCoder codes onto Ascend verdicts', () => {
    expect(normalizeVerdict('AC')).toBe('OK');
    expect(normalizeVerdict('WA')).toBe('WRONG_ANSWER');
    expect(normalizeVerdict('TLE')).toBe('TIME_LIMIT_EXCEEDED');
    expect(normalizeVerdict('MLE')).toBe('MEMORY_LIMIT_EXCEEDED');
    expect(normalizeVerdict('RE')).toBe('RUNTIME_ERROR');
    expect(normalizeVerdict('CE')).toBe('COMPILATION_ERROR');
    expect(normalizeVerdict('WJ')).toBe('TESTING');
  });

  it('does not silently mislabel an unknown code as accepted', () => {
    expect(normalizeVerdict('ZZZ')).toBe('UNKNOWN');
  });
});

describe('correctDifficulty', () => {
  it('leaves ordinary estimates alone', () => {
    expect(correctDifficulty(1200)).toBe(1200);
    expect(correctDifficulty(400)).toBe(400);
  });

  it('lifts negative estimates onto a positive scale', () => {
    // 933 problems in the live dataset have a negative raw difficulty; a
    // negative "difficulty" is meaningless to the recommender.
    expect(correctDifficulty(-848)).toBeGreaterThan(0);
    expect(correctDifficulty(-848)).toBeLessThan(400);
    expect(correctDifficulty(0)).toBeLessThan(400);
  });

  it('is monotonic across the correction boundary', () => {
    const values = [-1000, -500, -100, 0, 200, 399, 400, 800];
    const corrected = values.map(correctDifficulty);
    for (let i = 1; i < corrected.length; i += 1) {
      expect(corrected[i]!).toBeGreaterThanOrEqual(corrected[i - 1]!);
    }
  });
});

describe('normalizeSubmission', () => {
  it('infers in-contest participation from the contest window', () => {
    const inContest = normalizeSubmission(
      submission({ epoch_second: contest.start_epoch_second + 1200 }),
      contest,
    );
    expect(inContest.participantType).toBe('CONTESTANT');
    expect(inContest.relativeTimeSeconds).toBe(1200);
  });

  it('treats a submission after the contest as practice', () => {
    const later = normalizeSubmission(
      submission({ epoch_second: contest.start_epoch_second + contest.duration_second + 60 }),
      contest,
    );
    expect(later.participantType).toBe('PRACTICE');
    expect(later.relativeTimeSeconds).toBeNull();
  });

  it('claims nothing about participation when the contest is unknown', () => {
    const unknown = normalizeSubmission(submission(), undefined);
    expect(unknown.participantType).toBeNull();
    expect(unknown.relativeTimeSeconds).toBeNull();
  });

  it('builds stable composite ids', () => {
    const normalized = normalizeSubmission(submission(), contest);
    expect(normalized.id).toBe('ac:52612109');
    expect(normalized.problemId).toBe('ac:abc350:abc350_a');
    expect(normalized.contestId).toBe('ac:abc350');
  });
});

describe('contestIdFromScreenName', () => {
  it('extracts the contest id', () => {
    expect(contestIdFromScreenName('abc350.contest.atcoder.jp')).toBe('abc350');
  });

  it('returns null for an empty screen name', () => {
    expect(contestIdFromScreenName('')).toBeNull();
  });
});

function history(overrides: Partial<AcHistoryEntry> = {}): AcHistoryEntry {
  return {
    IsRated: true,
    Place: 8935,
    OldRating: 0,
    NewRating: 9,
    Performance: 63,
    InnerPerformance: 63,
    ContestScreenName: 'abc351.contest.atcoder.jp',
    ContestName: 'AtCoder Beginner Contest 351',
    EndTime: '2024-04-27T23:40:00+09:00',
    ...overrides,
  };
}

describe('normalizeRatingEvents', () => {
  it('keeps rated movement and performance', () => {
    const [event] = normalizeRatingEvents([history()]);
    expect(event).toMatchObject({
      contestId: 'ac:abc351',
      rank: 8935,
      ratingBefore: 0,
      ratingAfter: 9,
      performance: 63,
    });
    expect(event?.at).toBeGreaterThan(0);
  });

  it('reports null rather than 0 for an unrated appearance', () => {
    // AtCoder sends 0/0 for unrated contests; storing 0 would read as a real rating.
    const [event] = normalizeRatingEvents([
      history({ IsRated: false, OldRating: 0, NewRating: 0, Performance: 0 }),
    ]);
    expect(event?.ratingBefore).toBeNull();
    expect(event?.ratingAfter).toBeNull();
    expect(event?.performance).toBeNull();
  });
});

describe('normalizeContestResults', () => {
  it('joins official placement with the solve count derived from submissions', () => {
    const results = normalizeContestResults([history()], new Map([['ac:abc351', 3]]));
    expect(results[0]).toMatchObject({
      contestId: 'ac:abc351',
      rank: 8935,
      solvedCount: 3,
      isRated: true,
      participantType: 'CONTESTANT',
    });
  });

  it('leaves solve count null when nothing was synced for that contest', () => {
    const results = normalizeContestResults([history()], new Map());
    expect(results[0]?.solvedCount).toBeNull();
  });
});

describe('decodeHtmlEntities', () => {
  it('decodes the entities that appear in submitted source', () => {
    expect(decodeHtmlEntities('#include&lt;bits/stdc++.h&gt;')).toBe('#include<bits/stdc++.h>');
    expect(decodeHtmlEntities('a &amp;&amp; b')).toBe('a && b');
    expect(decodeHtmlEntities('&quot;x&quot;')).toBe('"x"');
    expect(decodeHtmlEntities('i&#39;m')).toBe("i'm");
  });

  it('decodes numeric and hex references', () => {
    expect(decodeHtmlEntities('&#65;&#x42;')).toBe('AB');
  });

  it('leaves unknown entities untouched rather than mangling code', () => {
    expect(decodeHtmlEntities('&unknownentity;')).toBe('&unknownentity;');
  });
});
