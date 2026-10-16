import type { SyncCursor } from '@ascend/core';

import { ProviderError } from '../errors';
import type {
  NormalizedContest,
  NormalizedProblem,
  NormalizedRatingEvent,
  NormalizedSubmission,
  ProviderFetchResult,
} from '../types';
import { emptyFetchResult } from '../types';
import type { CodeforcesApi, CfContest, CfSubmission } from './api';
import {
  deriveContestResults,
  normalizeContest,
  normalizeProblem,
  normalizeRatingEvents,
  normalizeSubmission,
  placeholderContest,
} from './normalize';

/**
 * Fetches the Codeforces submission stream once and splits it into its regular
 * and Gym halves.
 *
 * This exists because `user.status` returns **both** kinds of submission in one
 * stream. Two independent adapters would each have to page the entire history
 * against an API that tolerates one request every two seconds. So the two
 * adapters share this source and each takes its own slice of a single fetch.
 *
 * Consequently the Codeforces family shares one cursor: the sync engine stores
 * it under `(codeforces, submissions)` and mirrors it onto the Gym row.
 */

const PAGE_SIZE = 500;
/** Safety valve so a pathological history cannot page forever. */
const MAX_PAGES = 80;

export interface CodeforcesBundle {
  regular: ProviderFetchResult;
  gym: ProviderFetchResult;
  /** Total submissions examined across both halves. */
  fetched: number;
}

export class CodeforcesSource {
  #cache = new Map<string, Promise<CodeforcesBundle>>();

  constructor(private readonly api: CodeforcesApi) {}

  /** Memoized per handle+cursor so both adapters trigger exactly one fetch. */
  load(handle: string, cursor: SyncCursor): Promise<CodeforcesBundle> {
    const key = `${handle}|${cursor.lastSeenId ?? ''}`;
    let pending = this.#cache.get(key);
    if (!pending) {
      pending = this.#load(handle, cursor);
      this.#cache.set(key, pending);
    }
    return pending;
  }

  /** Forget memoized results so a later run re-fetches. */
  reset(): void {
    this.#cache.clear();
  }

  async #load(handle: string, cursor: SyncCursor): Promise<CodeforcesBundle> {
    const warnings: string[] = [];

    // Authoritative Gym id set — a submission is Gym iff its contest is listed here.
    const gymContests = new Map<number, CfContest>();
    try {
      for (const contest of await this.api.gymContestList()) {
        gymContests.set(contest.id, contest);
      }
    } catch (error) {
      // Without the list, Gym submissions cannot be distinguished from regular
      // ones. Better to report a partial sync than to mislabel the user's history.
      warnings.push(
        `Could not load the Gym contest list, so Gym submissions were not separated this run (${
          error instanceof Error ? error.message : 'unknown error'
        }).`,
      );
    }

    const lastSeenId = cursor.lastSeenId ? Number(cursor.lastSeenId) : 0;
    const raw: CfSubmission[] = [];
    let reachedKnown = false;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const batch = await this.api.userStatus(handle, page * PAGE_SIZE + 1, PAGE_SIZE);
      if (batch.length === 0) break;

      for (const submission of batch) {
        // Ids increase over time, so this is a reliable incremental stop.
        if (Number.isFinite(lastSeenId) && lastSeenId > 0 && submission.id <= lastSeenId) {
          reachedKnown = true;
          break;
        }
        raw.push(submission);
      }

      if (reachedKnown || batch.length < PAGE_SIZE) break;

      if (page === MAX_PAGES - 1) {
        warnings.push(
          `Stopped after ${MAX_PAGES * PAGE_SIZE} submissions; the next sync will continue from here.`,
        );
      }
    }

    // Regular contest metadata, only fetched when regular contests were seen.
    const regularContestIds = new Set<number>();
    const gymContestIds = new Set<number>();
    for (const submission of raw) {
      const contestRef = submission.problem.contestId ?? submission.contestId;
      if (contestRef === undefined) continue;
      if (gymContests.has(contestRef)) gymContestIds.add(contestRef);
      else regularContestIds.add(contestRef);
    }

    const regularContests = new Map<number, CfContest>();
    if (regularContestIds.size > 0) {
      try {
        for (const contest of await this.api.contestList()) {
          if (regularContestIds.has(contest.id)) regularContests.set(contest.id, contest);
        }
      } catch (error) {
        warnings.push(
          `Could not load Codeforces contest metadata (${
            error instanceof Error ? error.message : 'unknown error'
          }); contest names may be missing until the next sync.`,
        );
      }
    }

    // Rating history is regular-Codeforces only; Gym is unrated by definition.
    let ratingEvents: NormalizedRatingEvent[] = [];
    try {
      ratingEvents = normalizeRatingEvents(await this.api.userRating(handle));
    } catch (error) {
      if (error instanceof ProviderError && !error.retryable) {
        warnings.push('Rating history was unavailable this run.');
      } else {
        throw error;
      }
    }

    const regular = emptyFetchResult();
    const gym = emptyFetchResult();

    const problems = { regular: new Map<string, NormalizedProblem>(), gym: new Map<string, NormalizedProblem>() };
    const contests = { regular: new Map<string, NormalizedContest>(), gym: new Map<string, NormalizedContest>() };
    const submissions = { regular: [] as NormalizedSubmission[], gym: [] as NormalizedSubmission[] };

    let newestId = lastSeenId;
    let newestAt = cursor.lastSeenAt ?? 0;

    for (const submission of raw) {
      const contestRef = submission.problem.contestId ?? submission.contestId;
      if (contestRef === undefined) continue;

      const isGym = gymContests.has(contestRef);
      const provider = isGym ? 'codeforces_gym' : 'codeforces';
      const bucket = isGym ? 'gym' : 'regular';

      const normalizedSubmission = normalizeSubmission(submission, provider);
      const normalizedProblem = normalizeProblem(submission, provider);
      if (!normalizedSubmission || !normalizedProblem) continue;

      submissions[bucket].push(normalizedSubmission);

      // Prefer whichever record carries a rating — later pages may lack it.
      const existing = problems[bucket].get(normalizedProblem.id);
      if (!existing || (existing.platformRating === null && normalizedProblem.platformRating !== null)) {
        problems[bucket].set(normalizedProblem.id, normalizedProblem);
      }

      const contestKey = normalizedSubmission.contestId;
      if (contestKey && !contests[bucket].has(contestKey)) {
        const source = isGym ? gymContests.get(contestRef) : regularContests.get(contestRef);
        contests[bucket].set(
          contestKey,
          source ? normalizeContest(source, provider) : placeholderContest(provider, contestRef),
        );
      }

      newestId = Math.max(newestId, submission.id);
      newestAt = Math.max(newestAt, submission.creationTimeSeconds);
    }

    const ratingByContest = new Map(
      ratingEvents.filter((event) => event.contestId !== null).map((event) => [event.contestId!, event]),
    );

    regular.submissions = submissions.regular;
    regular.problems = [...problems.regular.values()];
    regular.contests = [...contests.regular.values()];
    regular.ratingEvents = ratingEvents;
    regular.contestResults = deriveContestResults(
      submissions.regular,
      contests.regular,
      ratingByContest,
    );
    regular.warnings = warnings;

    gym.submissions = submissions.gym;
    gym.problems = [...problems.gym.values()];
    gym.contests = [...contests.gym.values()];
    gym.ratingEvents = [];
    gym.contestResults = deriveContestResults(submissions.gym, contests.gym, new Map());
    gym.warnings = warnings;

    const nextCursor: SyncCursor = {
      ...(newestId > 0 ? { lastSeenId: String(newestId) } : {}),
      ...(newestAt > 0 ? { lastSeenAt: newestAt } : {}),
    };
    regular.cursor = nextCursor;
    gym.cursor = nextCursor;

    return { regular, gym, fetched: raw.length };
  }
}
