import type {
  NormalizedSubmission,
  NormalizedUserProfile,
  Provider,
  ProviderFetchResult,
  SyncCursor,
} from '@ascend/core';

/**
 * The adapter contract (spec §61).
 *
 * The normalized entity shapes themselves live in `@ascend/core` so that
 * `@ascend/db` can ingest them without depending on this package; they are
 * re-exported here because this is where they are produced.
 */

export type {
  NormalizedContest,
  NormalizedContestResult,
  NormalizedProblem,
  NormalizedRatingEvent,
  NormalizedSubmission,
  NormalizedUserProfile,
  ProviderFetchResult,
} from '@ascend/core';
export { emptyFetchResult } from '@ascend/core';

export interface SyncRequest {
  handle: string;
  /** Where the previous successful run stopped. */
  cursor: SyncCursor;
  /** Stop paging once this many items have been collected. 0 means no limit. */
  maxItems?: number;
}

export interface PlatformAdapter {
  readonly provider: Provider;
  /** Human label for status messages. */
  readonly label: string;

  /** Confirms the handle exists and returns headline figures. */
  getUserProfile(handle: string): Promise<NormalizedUserProfile>;

  /**
   * Everything derivable from the user's submission history, in one pass.
   *
   * Submissions arrive from the providers carrying their problem and contest
   * metadata inline, so splitting this into three calls would mean three times
   * the requests against a rate-limited API for no benefit.
   */
  sync(request: SyncRequest): Promise<ProviderFetchResult>;

  /**
   * Source code for one submission, when the provider allows it.
   *
   * Absent on the Codeforces adapters: every Codeforces HTML page sits behind a
   * Cloudflare managed challenge, so source cannot be fetched programmatically.
   */
  getSubmissionSource?(submission: NormalizedSubmission): Promise<string | null>;
}
