import { ProviderError } from '../errors';
import type { HttpClient } from '../http';

/**
 * AtCoder data access.
 *
 * AtCoder publishes no official API for submissions, so this uses two sources:
 *
 * - **AtCoder Problems** (kenkoooo.com), the community dataset, for submissions
 *   and estimated problem difficulty. It is a third-party service: it can change
 *   or go down, it asks crawlers for about one request per second, and its
 *   difficulties are *estimates* — some flagged experimental, many negative.
 * - **atcoder.jp** itself for rating history (`/users/{handle}/history/json`) and
 *   submission source. Unlike Codeforces, AtCoder's HTML is not behind a bot
 *   challenge, so source really can be fetched.
 *
 * Verified: `v3/user/submissions` returns at most 500 rows per call and is
 * inclusive of `from_second`, so the boundary second repeats between pages and
 * callers must dedupe by submission id.
 */

const PROBLEMS_BASE = 'https://kenkoooo.com/atcoder';
const ATCODER_BASE = 'https://atcoder.jp';

export const ATCODER_PAGE_SIZE = 500;

export interface AcSubmission {
  id: number;
  epoch_second: number;
  problem_id: string;
  contest_id: string;
  user_id: string;
  language: string;
  point: number;
  length: number;
  result: string;
  execution_time: number | null;
}

export interface AcProblem {
  id: string;
  contest_id: string;
  problem_index: string;
  name: string;
  title: string;
}

export interface AcContest {
  id: string;
  start_epoch_second: number;
  duration_second: number;
  title: string;
  rate_change: string;
}

export interface AcProblemModel {
  slope?: number;
  intercept?: number;
  variance?: number;
  difficulty?: number;
  discrimination?: number;
  irt_loglikelihood?: number;
  irt_users?: number;
  is_experimental?: boolean;
}

export interface AcHistoryEntry {
  IsRated: boolean;
  Place: number;
  OldRating: number;
  NewRating: number;
  Performance: number;
  InnerPerformance: number;
  ContestScreenName: string;
  ContestName: string;
  ContestNameEn?: string;
  EndTime: string;
}

export class AtCoderApi {
  constructor(private readonly http: HttpClient) {}

  /**
   * One page of submissions, oldest first, inclusive of `fromSecond`.
   * Callers must dedupe: the boundary second is returned again on the next page.
   */
  async userSubmissions(handle: string, fromSecond: number): Promise<AcSubmission[]> {
    const url = `${PROBLEMS_BASE}/atcoder-api/v3/user/submissions?user=${encodeURIComponent(
      handle,
    )}&from_second=${fromSecond}`;
    return this.http.getJson<AcSubmission[]>(url);
  }

  /** Full problem catalogue. Large and slow-moving, so revalidated conditionally. */
  async problems(): Promise<AcProblem[]> {
    return this.http.getJson<AcProblem[]>(`${PROBLEMS_BASE}/resources/problems.json`, {
      conditional: true,
    });
  }

  async contests(): Promise<AcContest[]> {
    return this.http.getJson<AcContest[]>(`${PROBLEMS_BASE}/resources/contests.json`, {
      conditional: true,
    });
  }

  /** Estimated difficulties, keyed by problem id. */
  async problemModels(): Promise<Record<string, AcProblemModel>> {
    return this.http.getJson<Record<string, AcProblemModel>>(
      `${PROBLEMS_BASE}/resources/problem-models.json`,
      { conditional: true },
    );
  }

  /** Official rating history, including per-contest performance. */
  async ratingHistory(handle: string): Promise<AcHistoryEntry[]> {
    const url = `${ATCODER_BASE}/users/${encodeURIComponent(handle)}/history/json`;
    return this.http.getJson<AcHistoryEntry[]>(url);
  }

  /**
   * Submission source. AtCoder serves this as plain HTML, so a single request is
   * enough — no browser engine and no credential required.
   */
  async submissionSource(contestId: string, submissionId: string): Promise<string | null> {
    const url = `${ATCODER_BASE}/contests/${contestId}/submissions/${submissionId}`;
    const response = await this.http.get(url, { headers: { accept: 'text/html' } });

    const match = /<pre[^>]*id="submission-code"[^>]*>([\s\S]*?)<\/pre>/.exec(response.text);
    if (!match?.[1]) return null;

    return decodeHtmlEntities(match[1].replace(/<[^>]+>/g, ''));
  }

  /** Problem statement text, used for subtopic classification (§10). */
  async problemStatement(contestId: string, taskId: string): Promise<string | null> {
    const url = `${ATCODER_BASE}/contests/${contestId}/tasks/${taskId}`;
    try {
      const response = await this.http.get(url, { headers: { accept: 'text/html' } });
      const match = /<div id="task-statement"[\s\S]*?>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/.exec(
        response.text,
      );
      const body = match?.[1] ?? response.text;
      return decodeHtmlEntities(body.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim();
    } catch (error) {
      if (error instanceof ProviderError && !error.retryable) return null;
      throw error;
    }
  }
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (match) => ENTITIES[match] ?? match)
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}
