import type { ContestKind, Provider, SyncCursor } from './types';

/**
 * The normalized platform vocabulary (spec §7, §61).
 *
 * These shapes live in the dependency-free core rather than in
 * `@ascend/providers` because they are the boundary *contract*, not provider
 * detail: the adapters produce them, `@ascend/db` ingests them, and the engines
 * reason over them. Keeping them here means `@ascend/db` never has to depend on
 * `@ascend/providers` — the same reason `SyncCursor` and `AscendSettings` live
 * here. `@ascend/providers` re-exports every one of them, so adapter code can go
 * on importing them from where it produces them.
 *
 * Provider-specific shapes (`CfSubmission`, `AcContest`, …) still stop inside
 * `@ascend/providers`. Nothing below is provider-specific.
 */

export interface NormalizedUserProfile {
  provider: Provider;
  handle: string;
  rating: number | null;
  maxRating: number | null;
  rank: string | null;
  maxRank: string | null;
  country: string | null;
  organization: string | null;
}

export interface NormalizedContest {
  /** Composite id, e.g. `cf:1846`, `gym:106608`, `ac:abc350`. */
  id: string;
  provider: Provider;
  providerContestId: string;
  name: string;
  kind: ContestKind;
  phase: string | null;
  startAt: number | null;
  durationSeconds: number | null;
  /** True for ICPC-style sets (§6B, §37). */
  isIcpcStyle: boolean;
  icpcRegion: string | null;
  country: string | null;
  city: string | null;
  season: string | null;
  url: string | null;
  /**
   * True when this record was synthesized because the contest was referenced by
   * a submission but missing from the provider's catalogue. Ingestion must not
   * let a placeholder overwrite a real record.
   */
  isPlaceholder?: boolean;
}

export interface NormalizedProblem {
  id: string;
  provider: Provider;
  contestId: string | null;
  index: string;
  name: string;
  /**
   * Null for every Gym problem — Gym carries no rating at all. The difficulty
   * model treats "unknown" as a first-class case (§17), not an edge case.
   */
  platformRating: number | null;
  ratingSource: string | null;
  /** AtCoder difficulties are estimates and some are flagged experimental. */
  ratingIsExperimental: boolean;
  points: number | null;
  solvedCount: number | null;
  timeLimitMs: number | null;
  memoryLimitBytes: number | null;
  url: string | null;
  /** Raw provider tags. Empty for Gym and AtCoder, which publish none. */
  tags: string[];
  /** As for contests: synthesized from a submission, must not clobber a real row. */
  isPlaceholder?: boolean;
}

export interface NormalizedSubmission {
  id: string;
  provider: Provider;
  providerSubmissionId: string;
  problemId: string;
  contestId: string | null;
  verdict: string;
  language: string | null;
  submittedAt: number;
  /** Present only for in-contest submissions — the only reliable solve timing. */
  relativeTimeSeconds: number | null;
  participantType: string | null;
  timeConsumedMs: number | null;
  memoryConsumedBytes: number | null;
  passedTestCount: number | null;
}

export interface NormalizedContestResult {
  contestId: string;
  participantType: string;
  rank: number | null;
  points: number | null;
  penalty: number | null;
  solvedCount: number | null;
  problemCount: number | null;
  ratingBefore: number | null;
  ratingAfter: number | null;
  performance: number | null;
  isRated: boolean;
  startedAt: number | null;
}

export interface NormalizedRatingEvent {
  provider: Provider;
  contestId: string | null;
  contestName: string | null;
  rank: number | null;
  ratingBefore: number | null;
  ratingAfter: number | null;
  performance: number | null;
  at: number;
}

/**
 * One adapter's contribution to a sync run.
 *
 * `warnings` is what turns a run into PARTIALLY SYNCED (§7): data that could not
 * be fetched is reported rather than silently missing.
 */
export interface ProviderFetchResult {
  contests: NormalizedContest[];
  problems: NormalizedProblem[];
  submissions: NormalizedSubmission[];
  contestResults: NormalizedContestResult[];
  ratingEvents: NormalizedRatingEvent[];
  warnings: string[];
  cursor: SyncCursor;
}

export function emptyFetchResult(): ProviderFetchResult {
  return {
    contests: [],
    problems: [],
    submissions: [],
    contestResults: [],
    ratingEvents: [],
    warnings: [],
    cursor: {},
  };
}
