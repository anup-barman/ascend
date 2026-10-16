import type { Provider, SyncCursor } from '@ascend/core';

import { CredentialError, ProviderError } from '../errors';
import type {
  NormalizedProblem,
  NormalizedSubmission,
  NormalizedUserProfile,
  PlatformAdapter,
  ProviderFetchResult,
  SyncRequest,
} from '../types';
import { emptyFetchResult } from '../types';
import { ATCODER_PAGE_SIZE, AtCoderApi } from './api';
import type { AcContest, AcProblem, AcProblemModel, AcSubmission } from './api';
import {
  normalizeContest,
  normalizeContestResults,
  normalizeProblem,
  normalizeRatingEvents,
  normalizeSubmission,
  placeholderContest,
  placeholderProblem,
} from './normalize';

/** Safety valve; 500 rows per page means this covers 40k submissions. */
const MAX_PAGES = 80;

export class AtCoderAdapter implements PlatformAdapter {
  readonly provider: Provider = 'atcoder';
  readonly label = 'AtCoder';

  constructor(private readonly api: AtCoderApi) {}

  async getUserProfile(handle: string): Promise<NormalizedUserProfile> {
    // AtCoder has no user endpoint; the rating history doubles as existence proof.
    let history;
    try {
      history = await this.api.ratingHistory(handle);
    } catch (error) {
      throw new CredentialError(
        `Could not read AtCoder history for "${handle}" — check the handle. (${
          error instanceof Error ? error.message : 'unknown error'
        })`,
      );
    }

    const rated = history.filter((entry) => entry.IsRated);
    const latest = rated.at(-1);
    const maxRating = rated.reduce((max, entry) => Math.max(max, entry.NewRating), 0);

    return {
      provider: this.provider,
      handle,
      rating: latest?.NewRating ?? null,
      maxRating: maxRating > 0 ? maxRating : null,
      rank: null,
      maxRank: null,
      country: null,
      organization: null,
    };
  }

  async sync(request: SyncRequest): Promise<ProviderFetchResult> {
    const result = emptyFetchResult();
    const warnings: string[] = [];

    // --- Submissions ------------------------------------------------------
    // `from_second` is inclusive, so the boundary second repeats between pages;
    // dedupe by id or the last submission of each page is counted twice.
    const raw = new Map<number, AcSubmission>();
    let fromSecond = request.cursor.lastSeenAt ?? 0;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const batch = await this.api.userSubmissions(request.handle, fromSecond);
      if (batch.length === 0) break;

      let newest = fromSecond;
      let added = 0;
      for (const submission of batch) {
        if (!raw.has(submission.id)) {
          raw.set(submission.id, submission);
          added += 1;
        }
        newest = Math.max(newest, submission.epoch_second);
      }

      if (batch.length < ATCODER_PAGE_SIZE) break;

      // Every row shared one second: step past it, or this loops forever.
      fromSecond = newest === fromSecond ? fromSecond + 1 : newest;
      if (added === 0) break;

      if (page === MAX_PAGES - 1) {
        warnings.push('Stopped after 40,000 AtCoder submissions; the next sync continues from here.');
      }
    }

    const submissions = [...raw.values()].sort((a, b) => a.epoch_second - b.epoch_second);

    // --- Catalogues -------------------------------------------------------
    // Only fetched when there is something to describe; all conditionally cached.
    const contestsById = new Map<string, AcContest>();
    const problemsById = new Map<string, AcProblem>();
    let models: Record<string, AcProblemModel> = {};

    if (submissions.length > 0) {
      try {
        for (const contest of await this.api.contests()) contestsById.set(contest.id, contest);
      } catch (error) {
        warnings.push(
          `AtCoder contest catalogue unavailable (${
            error instanceof Error ? error.message : 'unknown error'
          }); contest names and in-contest timing may be missing.`,
        );
      }

      try {
        for (const problem of await this.api.problems()) problemsById.set(problem.id, problem);
      } catch (error) {
        warnings.push(
          `AtCoder problem catalogue unavailable (${
            error instanceof Error ? error.message : 'unknown error'
          }); problem names may be missing.`,
        );
      }

      try {
        models = await this.api.problemModels();
      } catch (error) {
        warnings.push(
          'AtCoder difficulty estimates unavailable this run; difficulty will be inferred from your own history instead.',
        );
      }
    }

    // --- Normalize --------------------------------------------------------
    const normalizedProblems = new Map<string, NormalizedProblem>();
    const normalizedContests = new Map<string, ReturnType<typeof normalizeContest>>();
    const normalizedSubmissions: NormalizedSubmission[] = [];

    let newestAt = request.cursor.lastSeenAt ?? 0;
    let newestId = request.cursor.lastSeenId ? Number(request.cursor.lastSeenId) : 0;

    for (const submission of submissions) {
      const contest = contestsById.get(submission.contest_id);
      const normalized = normalizeSubmission(submission, contest);
      normalizedSubmissions.push(normalized);

      if (!normalizedContests.has(normalized.contestId ?? '')) {
        const contestRecord = contest
          ? normalizeContest(contest)
          : placeholderContest(submission.contest_id);
        normalizedContests.set(contestRecord.id, contestRecord);
      }

      if (!normalizedProblems.has(normalized.problemId)) {
        const catalogued = problemsById.get(submission.problem_id);
        normalizedProblems.set(
          normalized.problemId,
          catalogued
            ? normalizeProblem(catalogued, models[submission.problem_id])
            : placeholderProblem(submission),
        );
      }

      newestAt = Math.max(newestAt, submission.epoch_second);
      newestId = Math.max(newestId, submission.id);
    }

    // --- Rating history and contest results -------------------------------
    try {
      const history = await this.api.ratingHistory(request.handle);
      result.ratingEvents = normalizeRatingEvents(history);

      const solvedByContest = new Map<string, number>();
      const seen = new Set<string>();
      for (const submission of normalizedSubmissions) {
        if (submission.verdict !== 'OK' || !submission.contestId) continue;
        const key = `${submission.contestId}|${submission.problemId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        solvedByContest.set(submission.contestId, (solvedByContest.get(submission.contestId) ?? 0) + 1);
      }

      result.contestResults = normalizeContestResults(history, solvedByContest);
    } catch (error) {
      if (error instanceof ProviderError && !error.retryable) {
        warnings.push('AtCoder rating history was unavailable this run.');
      } else {
        throw error;
      }
    }

    result.submissions = normalizedSubmissions;
    result.problems = [...normalizedProblems.values()];
    result.contests = [...normalizedContests.values()];
    result.warnings = warnings;

    const cursor: SyncCursor = {
      ...(newestId > 0 ? { lastSeenId: String(newestId) } : {}),
      ...(newestAt > 0 ? { lastSeenAt: newestAt } : {}),
    };
    result.cursor = cursor;

    return result;
  }

  /** AtCoder HTML is not bot-challenged, so source really is retrievable. */
  async getSubmissionSource(submission: NormalizedSubmission): Promise<string | null> {
    const contestRef = submission.contestId?.split(':')[1];
    if (!contestRef) return null;
    return this.api.submissionSource(contestRef, submission.providerSubmissionId);
  }
}
