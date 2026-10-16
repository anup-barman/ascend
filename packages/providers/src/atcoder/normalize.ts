import { contestId as makeContestId, contestUrl, problemId as makeProblemId, problemUrl } from '@ascend/core';
import type { Provider } from '@ascend/core';

import type {
  NormalizedContest,
  NormalizedContestResult,
  NormalizedProblem,
  NormalizedRatingEvent,
  NormalizedSubmission,
} from '../types';
import type { AcContest, AcHistoryEntry, AcProblem, AcProblemModel, AcSubmission } from './api';

/** Pure AtCoder → normalized mapping. */

const PROVIDER: Provider = 'atcoder';

/** AtCoder result codes → Ascend's verdict vocabulary. */
export function normalizeVerdict(result: string): string {
  switch (result.toUpperCase()) {
    case 'AC':
      return 'OK';
    case 'WA':
      return 'WRONG_ANSWER';
    case 'TLE':
      return 'TIME_LIMIT_EXCEEDED';
    case 'MLE':
      return 'MEMORY_LIMIT_EXCEEDED';
    case 'RE':
      return 'RUNTIME_ERROR';
    case 'CE':
      return 'COMPILATION_ERROR';
    case 'OLE':
    case 'QLE':
      return 'REJECTED';
    case 'IE':
      return 'FAILED';
    case 'WJ':
    case 'WR':
      return 'TESTING';
    default:
      return 'UNKNOWN';
  }
}

/**
 * AtCoder Problems' difficulty correction for very easy problems.
 *
 * The raw IRT estimate goes negative for easy problems — 933 of them in the
 * current dataset — which is meaningless as a difficulty. The community formula
 * compresses those onto a positive scale so they can be compared with
 * Codeforces ratings; above 400 the estimate is used as-is.
 */
export function correctDifficulty(raw: number): number {
  if (raw >= 400) return Math.round(raw);
  return Math.round(400 / Math.exp(1 - raw / 400));
}

export function normalizeContest(contest: AcContest): NormalizedContest {
  return {
    id: makeContestId(PROVIDER, contest.id),
    provider: PROVIDER,
    providerContestId: contest.id,
    name: contest.title,
    kind: 'atcoder',
    phase: null,
    startAt: contest.start_epoch_second > 0 ? contest.start_epoch_second : null,
    durationSeconds: contest.duration_second > 0 ? contest.duration_second : null,
    // AtCoder is valuable for algorithmic reasoning (§37), not as ICPC material.
    isIcpcStyle: false,
    icpcRegion: null,
    country: null,
    city: null,
    season: null,
    url: contestUrl(PROVIDER, contest.id),
  };
}

export function placeholderContest(contestId: string): NormalizedContest {
  return {
    id: makeContestId(PROVIDER, contestId),
    provider: PROVIDER,
    providerContestId: contestId,
    name: contestId,
    kind: 'atcoder',
    phase: null,
    startAt: null,
    durationSeconds: null,
    isIcpcStyle: false,
    icpcRegion: null,
    country: null,
    city: null,
    season: null,
    url: contestUrl(PROVIDER, contestId),
    isPlaceholder: true,
  };
}

export function normalizeProblem(
  problem: AcProblem,
  model: AcProblemModel | undefined,
): NormalizedProblem {
  const raw = model?.difficulty;
  const hasEstimate = typeof raw === 'number' && Number.isFinite(raw);

  return {
    id: makeProblemId(PROVIDER, problem.contest_id, problem.id),
    provider: PROVIDER,
    contestId: makeContestId(PROVIDER, problem.contest_id),
    index: problem.problem_index,
    name: problem.name,
    platformRating: hasEstimate ? correctDifficulty(raw) : null,
    ratingSource: hasEstimate ? 'atcoder_estimate' : null,
    ratingIsExperimental: model?.is_experimental === true,
    points: null,
    solvedCount: null,
    timeLimitMs: null,
    memoryLimitBytes: null,
    url: problemUrl(PROVIDER, problem.contest_id, problem.id),
    // AtCoder publishes no tags at all.
    tags: [],
  };
}

/** A problem referenced by a submission but absent from the catalogue. */
export function placeholderProblem(submission: AcSubmission): NormalizedProblem {
  return {
    id: makeProblemId(PROVIDER, submission.contest_id, submission.problem_id),
    provider: PROVIDER,
    contestId: makeContestId(PROVIDER, submission.contest_id),
    index: submission.problem_id.split('_').pop() ?? submission.problem_id,
    name: submission.problem_id,
    platformRating: null,
    ratingSource: null,
    ratingIsExperimental: false,
    points: submission.point > 0 ? submission.point : null,
    solvedCount: null,
    timeLimitMs: null,
    memoryLimitBytes: null,
    url: problemUrl(PROVIDER, submission.contest_id, submission.problem_id),
    tags: [],
  };
}

/**
 * Normalizes a submission, inferring whether it was made under contest pressure.
 *
 * AtCoder Problems does not record participation type, but a submission whose
 * timestamp falls inside the contest window was necessarily made during the
 * contest. That inference is what gives AtCoder the timed-vs-untimed signal
 * §12 needs, and it also yields a real in-contest solve time.
 */
export function normalizeSubmission(
  submission: AcSubmission,
  contest: AcContest | undefined,
): NormalizedSubmission {
  let participantType: string | null = null;
  let relativeTimeSeconds: number | null = null;

  if (contest && contest.start_epoch_second > 0 && contest.duration_second > 0) {
    const offset = submission.epoch_second - contest.start_epoch_second;
    const inWindow = offset >= 0 && offset <= contest.duration_second;
    participantType = inWindow ? 'CONTESTANT' : 'PRACTICE';
    if (inWindow) relativeTimeSeconds = offset;
  }

  return {
    id: `ac:${submission.id}`,
    provider: PROVIDER,
    providerSubmissionId: String(submission.id),
    problemId: makeProblemId(PROVIDER, submission.contest_id, submission.problem_id),
    contestId: makeContestId(PROVIDER, submission.contest_id),
    verdict: normalizeVerdict(submission.result),
    language: submission.language,
    submittedAt: submission.epoch_second,
    relativeTimeSeconds,
    participantType,
    timeConsumedMs: submission.execution_time ?? null,
    memoryConsumedBytes: null,
    passedTestCount: null,
  };
}

/** Contest id embedded in `ContestScreenName`, e.g. `abc350.contest.atcoder.jp`. */
export function contestIdFromScreenName(screenName: string): string | null {
  const [id] = screenName.split('.');
  return id && id.length > 0 ? id : null;
}

export function normalizeRatingEvents(history: AcHistoryEntry[]): NormalizedRatingEvent[] {
  return history.map((entry) => {
    const contestRef = contestIdFromScreenName(entry.ContestScreenName);
    const at = Math.floor(Date.parse(entry.EndTime) / 1000);

    return {
      provider: PROVIDER,
      contestId: contestRef ? makeContestId(PROVIDER, contestRef) : null,
      contestName: entry.ContestName,
      rank: entry.Place,
      // Unrated appearances report 0/0, which is absence rather than a rating.
      ratingBefore: entry.IsRated ? entry.OldRating : null,
      ratingAfter: entry.IsRated ? entry.NewRating : null,
      performance: entry.Performance > 0 ? entry.Performance : null,
      at: Number.isFinite(at) ? at : 0,
    };
  });
}

/** Contest results straight from the official history, plus derived solve counts. */
export function normalizeContestResults(
  history: AcHistoryEntry[],
  solvedByContest: Map<string, number>,
): NormalizedContestResult[] {
  return history.flatMap((entry) => {
    const contestRef = contestIdFromScreenName(entry.ContestScreenName);
    if (!contestRef) return [];

    const id = makeContestId(PROVIDER, contestRef);
    const at = Math.floor(Date.parse(entry.EndTime) / 1000);

    return [
      {
        contestId: id,
        participantType: 'CONTESTANT',
        rank: entry.Place,
        points: null,
        // AtCoder penalties are not exposed by either source.
        penalty: null,
        solvedCount: solvedByContest.get(id) ?? null,
        problemCount: null,
        ratingBefore: entry.IsRated ? entry.OldRating : null,
        ratingAfter: entry.IsRated ? entry.NewRating : null,
        performance: entry.Performance > 0 ? entry.Performance : null,
        isRated: entry.IsRated,
        startedAt: Number.isFinite(at) ? at : null,
      },
    ];
  });
}
