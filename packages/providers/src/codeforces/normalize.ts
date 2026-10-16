import { contestId as makeContestId, contestUrl, problemId as makeProblemId, problemUrl } from '@ascend/core';
import type { Provider } from '@ascend/core';

import type {
  NormalizedContest,
  NormalizedContestResult,
  NormalizedProblem,
  NormalizedRatingEvent,
  NormalizedSubmission,
  NormalizedUserProfile,
} from '../types';
import type { CfContest, CfRatingChange, CfSubmission, CfUser } from './api';

/** Pure Codeforces → normalized mapping. No IO, so all of it is unit-testable. */

export function normalizeUser(user: CfUser): NormalizedUserProfile {
  return {
    provider: 'codeforces',
    handle: user.handle,
    rating: user.rating ?? null,
    maxRating: user.maxRating ?? null,
    rank: user.rank ?? null,
    maxRank: user.maxRank ?? null,
    country: user.country ?? null,
    organization: user.organization ?? null,
  };
}

/**
 * Whether a Gym contest is ICPC-style *material* (spec §37).
 *
 * Deliberately not the same thing as Codeforces' `type: "ICPC"`, which only
 * describes penalty-based scoring. **Verified against `contest.list?gym=true`:**
 * every one of the 2624 Gym contests is typed either `ICPC` (2218) or `IOI`
 * (406), so the type says nothing about provenance and reading it flagged 85% of
 * the Gym as ICPC material — including topic drills and university championships.
 * `kind` and `icpcRegion` are the real signal: 519 sets declare
 * `kind: "Official ICPC Contest"` and 410 carry a region.
 */
export function isIcpcStyleGymContest(contest: CfContest): boolean {
  if (contest.icpcRegion) return true;
  return contest.kind !== undefined && /ICPC/i.test(contest.kind);
}

export function normalizeContest(contest: CfContest, provider: Provider): NormalizedContest {
  const isGym = provider === 'codeforces_gym';
  return {
    id: makeContestId(provider, contest.id),
    provider,
    providerContestId: String(contest.id),
    name: contest.name,
    kind: isGym ? 'gym' : 'regular',
    phase: contest.phase ?? null,
    startAt: contest.startTimeSeconds ?? null,
    durationSeconds: contest.durationSeconds ?? null,
    isIcpcStyle: isGym ? isIcpcStyleGymContest(contest) : false,
    icpcRegion: contest.icpcRegion ?? null,
    country: contest.country ?? null,
    city: contest.city ?? null,
    season: contest.season ?? null,
    url: contestUrl(provider, contest.id),
  };
}

/**
 * A synthetic contest record for a Gym contest seen only through a submission.
 *
 * `contest.list?gym=true` covers 2600+ contests, but if a submission ever
 * references one that is missing from the list, the submission still needs a
 * contest row to hang off rather than being dropped.
 */
export function placeholderContest(provider: Provider, providerContestId: number): NormalizedContest {
  return {
    id: makeContestId(provider, providerContestId),
    provider,
    providerContestId: String(providerContestId),
    name: `${provider === 'codeforces_gym' ? 'Gym' : 'Contest'} ${providerContestId}`,
    kind: provider === 'codeforces_gym' ? 'gym' : 'regular',
    phase: null,
    startAt: null,
    durationSeconds: null,
    isIcpcStyle: false,
    icpcRegion: null,
    country: null,
    city: null,
    season: null,
    url: contestUrl(provider, providerContestId),
    isPlaceholder: true,
  };
}

export function normalizeProblem(
  submission: CfSubmission,
  provider: Provider,
): NormalizedProblem | null {
  const { problem } = submission;
  const contestRef = problem.contestId ?? submission.contestId;
  if (contestRef === undefined) return null;

  const isGym = provider === 'codeforces_gym';

  return {
    id: makeProblemId(provider, contestRef, problem.index),
    provider,
    contestId: makeContestId(provider, contestRef),
    index: problem.index,
    name: problem.name,
    // Gym problems carry no rating at all — this is null for every one of them.
    platformRating: problem.rating ?? null,
    ratingSource: problem.rating === undefined ? null : 'codeforces',
    ratingIsExperimental: false,
    points: problem.points ?? null,
    solvedCount: null,
    timeLimitMs: null,
    memoryLimitBytes: null,
    url: problemUrl(provider, contestRef, problem.index),
    // Gym publishes no tags; regular Codeforces problems do.
    tags: isGym ? [] : (problem.tags ?? []),
  };
}

export function normalizeSubmission(
  submission: CfSubmission,
  provider: Provider,
): NormalizedSubmission | null {
  const contestRef = submission.problem.contestId ?? submission.contestId;
  if (contestRef === undefined) return null;

  return {
    id: `${provider === 'codeforces_gym' ? 'gym' : 'cf'}:${submission.id}`,
    provider,
    providerSubmissionId: String(submission.id),
    problemId: makeProblemId(provider, contestRef, submission.problem.index),
    contestId: makeContestId(provider, contestRef),
    // A submission still being judged has no verdict yet.
    verdict: submission.verdict ?? 'TESTING',
    language: submission.programmingLanguage ?? null,
    submittedAt: submission.creationTimeSeconds,
    relativeTimeSeconds:
      submission.relativeTimeSeconds !== undefined &&
      // Codeforces uses a sentinel for "not in contest" rather than omitting it.
      submission.relativeTimeSeconds < 1_000_000_000
        ? submission.relativeTimeSeconds
        : null,
    participantType: submission.author.participantType ?? null,
    timeConsumedMs: submission.timeConsumedMillis ?? null,
    memoryConsumedBytes: submission.memoryConsumedBytes ?? null,
    passedTestCount: submission.passedTestCount ?? null,
  };
}

export function normalizeRatingEvents(changes: CfRatingChange[]): NormalizedRatingEvent[] {
  return changes.map((change) => ({
    provider: 'codeforces' as Provider,
    contestId: makeContestId('codeforces', change.contestId),
    contestName: change.contestName,
    rank: change.rank,
    ratingBefore: change.oldRating,
    ratingAfter: change.newRating,
    performance: null,
    at: change.ratingUpdateTimeSeconds,
  }));
}

/** Penalty minutes added per rejected attempt under ICPC rules. */
export const ICPC_PENALTY_PER_REJECTION = 20;

/**
 * Derives the user's own contest results from their submissions.
 *
 * This is done from submissions rather than from `contest.standings` on purpose:
 * standings on a Gym contest require API credentials, and everything §19/§20
 * actually asks for — first-accept time, attempt order, penalty, whether easy
 * problems were converted — is already present in the submission stream. So
 * contest analysis works for Gym with no credential at all.
 */
export function deriveContestResults(
  submissions: NormalizedSubmission[],
  contestsById: Map<string, NormalizedContest>,
  ratingByContestId: Map<string, NormalizedRatingEvent>,
): NormalizedContestResult[] {
  interface Group {
    contestId: string;
    participantType: string;
    startedAt: number | null;
    byProblem: Map<string, NormalizedSubmission[]>;
  }

  const groups = new Map<string, Group>();

  for (const submission of submissions) {
    if (!submission.contestId || !submission.participantType) continue;

    const key = `${submission.contestId}|${submission.participantType}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        contestId: submission.contestId,
        participantType: submission.participantType,
        startedAt: null,
        byProblem: new Map(),
      };
      groups.set(key, group);
    }

    const list = group.byProblem.get(submission.problemId) ?? [];
    list.push(submission);
    group.byProblem.set(submission.problemId, list);
  }

  const results: NormalizedContestResult[] = [];

  for (const group of groups.values()) {
    const contest = contestsById.get(group.contestId);
    const rating = ratingByContestId.get(group.contestId);

    let solvedCount = 0;
    let penalty = 0;
    let penaltyComputable = group.participantType === 'CONTESTANT' || group.participantType === 'VIRTUAL';

    for (const attempts of group.byProblem.values()) {
      const ordered = [...attempts].sort((a, b) => a.submittedAt - b.submittedAt);
      const acceptedIndex = ordered.findIndex((s) => s.verdict === 'OK');
      if (acceptedIndex === -1) continue;

      solvedCount += 1;

      const accepted = ordered[acceptedIndex];
      if (!accepted) continue;

      if (accepted.relativeTimeSeconds === null) {
        // Without in-contest timing there is no honest penalty to report.
        penaltyComputable = false;
        continue;
      }

      const rejectedBefore = ordered
        .slice(0, acceptedIndex)
        .filter((s) => s.verdict !== 'COMPILATION_ERROR' && s.verdict !== 'TESTING').length;

      penalty +=
        Math.floor(accepted.relativeTimeSeconds / 60) +
        rejectedBefore * ICPC_PENALTY_PER_REJECTION;
    }

    const startedAt =
      group.startedAt ??
      (contest?.startAt ??
        Math.min(...[...group.byProblem.values()].flat().map((s) => s.submittedAt)));

    results.push({
      contestId: group.contestId,
      participantType: group.participantType,
      rank: rating?.rank ?? null,
      points: null,
      penalty: penaltyComputable ? penalty : null,
      solvedCount,
      // Requires the contest's full problem list, which needs standings.
      problemCount: null,
      ratingBefore: rating?.ratingBefore ?? null,
      ratingAfter: rating?.ratingAfter ?? null,
      performance: null,
      isRated: rating !== undefined,
      startedAt: Number.isFinite(startedAt) ? startedAt : null,
    });
  }

  return results;
}
