import { createHash, randomInt } from 'node:crypto';

import { ProviderRejectedError } from '../errors';
import type { HttpClient } from '../http';

/**
 * Typed Codeforces API client.
 *
 * Verified behaviour that shapes this design:
 * - `user.status` returns **both** regular and Gym submissions. Gym problems come
 *   back with `rating: null` and `tags: []`, but the submissions themselves are
 *   fully available without any credential.
 * - `contest.list?gym=true` is the authoritative set of Gym contest ids, and
 *   carries the ICPC provenance (`kind`, `icpcRegion`, `season`) that §37 needs.
 * - `contest.standings` on a Gym contest returns
 *   "You have to be authenticated to use this method", which means an
 *   apiKey/apiSig pair — a session cookie does not satisfy it.
 * - Every codeforces.com **HTML** page is behind a Cloudflare managed challenge,
 *   so scraping is not an option and is not attempted anywhere.
 */

const API_BASE = 'https://codeforces.com/api';

export interface CfUser {
  handle: string;
  rating?: number;
  maxRating?: number;
  rank?: string;
  maxRank?: string;
  country?: string;
  organization?: string;
}

export interface CfProblem {
  contestId?: number;
  problemsetName?: string;
  index: string;
  name: string;
  type?: string;
  points?: number;
  rating?: number;
  tags?: string[];
}

export interface CfMember {
  handle: string;
}

export interface CfParty {
  contestId?: number;
  members: CfMember[];
  participantType: string;
  teamId?: number;
  teamName?: string;
  ghost: boolean;
  room?: number;
  startTimeSeconds?: number;
}

export interface CfSubmission {
  id: number;
  contestId?: number;
  creationTimeSeconds: number;
  relativeTimeSeconds?: number;
  problem: CfProblem;
  author: CfParty;
  programmingLanguage: string;
  verdict?: string;
  testset?: string;
  passedTestCount?: number;
  timeConsumedMillis?: number;
  memoryConsumedBytes?: number;
}

export interface CfContest {
  id: number;
  name: string;
  type?: string;
  phase?: string;
  frozen?: boolean;
  durationSeconds?: number;
  startTimeSeconds?: number;
  relativeTimeSeconds?: number;
  kind?: string;
  icpcRegion?: string;
  country?: string;
  city?: string;
  season?: string;
  difficulty?: number;
  websiteUrl?: string;
  description?: string;
  preparedBy?: string;
}

export interface CfRatingChange {
  contestId: number;
  contestName: string;
  handle: string;
  rank: number;
  ratingUpdateTimeSeconds: number;
  oldRating: number;
  newRating: number;
}

export interface CfProblemResult {
  points: number;
  penalty?: number;
  rejectedAttemptCount: number;
  type: string;
  bestSubmissionTimeSeconds?: number;
}

export interface CfRanklistRow {
  party: CfParty;
  rank: number;
  points: number;
  penalty: number;
  successfulHackCount: number;
  unsuccessfulHackCount: number;
  problemResults: CfProblemResult[];
  lastSubmissionTimeSeconds?: number;
}

export interface CfStandings {
  contest: CfContest;
  problems: CfProblem[];
  rows: CfRanklistRow[];
}

interface CfEnvelope<T> {
  status: 'OK' | 'FAILED';
  comment?: string;
  result?: T;
}

/** Optional API credentials, needed only for Gym standings. */
export interface CfCredentials {
  apiKey: string;
  apiSecret: string;
}

/**
 * Builds the `apiSig` parameter Codeforces requires for authorized calls.
 *
 * `apiSig = rand + sha512(rand + "/" + method + "?" + sortedParams + "#" + secret)`,
 * where params are sorted lexicographically by key, then by value.
 */
export function buildApiSig(
  method: string,
  params: Record<string, string>,
  secret: string,
  rand: string,
): string {
  const query = Object.entries(params)
    .sort(([aKey, aValue], [bKey, bValue]) =>
      aKey === bKey ? aValue.localeCompare(bValue) : aKey.localeCompare(bKey),
    )
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  const digest = createHash('sha512')
    .update(`${rand}/${method}?${query}#${secret}`)
    .digest('hex');

  return `${rand}${digest}`;
}

export class CodeforcesApi {
  constructor(
    private readonly http: HttpClient,
    private readonly credentials: CfCredentials | null = null,
  ) {}

  get hasCredentials(): boolean {
    return this.credentials !== null;
  }

  #url(method: string, params: Record<string, string>, authorize: boolean): string {
    const query: Record<string, string> = { ...params };

    if (authorize && this.credentials) {
      query['apiKey'] = this.credentials.apiKey;
      query['time'] = String(Math.floor(Date.now() / 1000));
      const rand = String(randomInt(100_000, 999_999));
      query['apiSig'] = buildApiSig(method, query, this.credentials.apiSecret, rand);
    }

    const search = new URLSearchParams(query).toString();
    return `${API_BASE}/${method}?${search}`;
  }

  async #call<T>(
    method: string,
    params: Record<string, string>,
    options: { authorize?: boolean; conditional?: boolean } = {},
  ): Promise<T> {
    const url = this.#url(method, params, options.authorize ?? false);
    const envelope = await this.http.getJson<CfEnvelope<T>>(url, {
      ...(options.conditional !== undefined ? { conditional: options.conditional } : {}),
    });

    if (envelope.status !== 'OK' || envelope.result === undefined) {
      throw new ProviderRejectedError(
        `Codeforces ${method} failed: ${envelope.comment ?? 'unknown reason'}`,
        // Never include the URL: for authorized calls it carries the apiSig.
        undefined,
      );
    }

    return envelope.result;
  }

  async userInfo(handles: string[]): Promise<CfUser[]> {
    return this.#call<CfUser[]>('user.info', { handles: handles.join(';') });
  }

  async userRating(handle: string): Promise<CfRatingChange[]> {
    return this.#call<CfRatingChange[]>('user.rating', { handle });
  }

  /** One page of submissions, newest first. `from` is 1-based. */
  async userStatus(handle: string, from: number, count: number): Promise<CfSubmission[]> {
    return this.#call<CfSubmission[]>('user.status', {
      handle,
      from: String(from),
      count: String(count),
    });
  }

  /** Regular contests. Large and slow-changing, so revalidated conditionally. */
  async contestList(): Promise<CfContest[]> {
    return this.#call<CfContest[]>('contest.list', {}, { conditional: true });
  }

  /** Gym contests, including the ICPC provenance fields §37 prioritises on. */
  async gymContestList(): Promise<CfContest[]> {
    return this.#call<CfContest[]>('contest.list', { gym: 'true' }, { conditional: true });
  }

  /**
   * Standings for one contest. Gym contests require API credentials; without
   * them this throws and the caller degrades to a partial sync.
   */
  async contestStandings(
    contestId: number,
    handle: string,
    options: { gym?: boolean } = {},
  ): Promise<CfStandings> {
    return this.#call<CfStandings>(
      'contest.standings',
      {
        contestId: String(contestId),
        handles: handle,
        showUnofficial: 'true',
        ...(options.gym ? { asManager: 'false' } : {}),
      },
      { authorize: this.credentials !== null },
    );
  }
}
