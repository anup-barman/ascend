import {
  BotProtectionError,
  ProviderError,
  RateLimitedError,
} from './errors';

/**
 * The shared HTTP layer for every provider (spec §62: timeout, retry,
 * exponential backoff, rate limiting, caching).
 *
 * Verified rate limits:
 * - Codeforces API tolerates roughly one request every two seconds; bursts get
 *   a 403. `codeforces.com` is therefore serialized at 2100ms.
 * - kenkoooo.com (AtCoder Problems) asks crawlers for ~1 req/s and serves large
 *   static JSON, so it is serialized at 1100ms and cached conditionally.
 */

export const DEFAULT_USER_AGENT = 'Ascend/0.1 (personal ICPC training tool)';

/** Minimum spacing between requests, per host. */
export const HOST_MIN_INTERVAL_MS: Record<string, number> = {
  'codeforces.com': 2100,
  'kenkoooo.com': 1100,
  'atcoder.jp': 1100,
};

export const DEFAULT_MIN_INTERVAL_MS = 1000;

/**
 * Serializes requests per host with a minimum spacing.
 *
 * A single promise chain per host is simpler and stricter than a token bucket:
 * it makes bursts structurally impossible rather than merely unlikely, which is
 * what keeps Codeforces from returning 403.
 */
export class HostRateLimiter {
  #chains = new Map<string, Promise<void>>();
  #lastStart = new Map<string, number>();

  constructor(
    private readonly intervals: Record<string, number> = HOST_MIN_INTERVAL_MS,
    private readonly fallbackInterval: number = DEFAULT_MIN_INTERVAL_MS,
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
    private readonly now: () => number = () => Date.now(),
  ) {}

  intervalFor(host: string): number {
    return this.intervals[host] ?? this.fallbackInterval;
  }

  /** Runs `task` no sooner than `interval` after the previous task on that host. */
  async schedule<T>(host: string, task: () => Promise<T>): Promise<T> {
    const interval = this.intervalFor(host);
    const previous = this.#chains.get(host) ?? Promise.resolve();

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#chains.set(
      host,
      previous.then(() => gate),
    );

    await previous;

    const last = this.#lastStart.get(host);
    if (last !== undefined) {
      const wait = interval - (this.now() - last);
      if (wait > 0) await this.sleep(wait);
    }
    this.#lastStart.set(host, this.now());

    try {
      return await task();
    } finally {
      release();
    }
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Exponential backoff with full jitter.
 *
 * Jitter matters even for a single-user app: without it, a provider outage makes
 * every resource retry in lockstep.
 */
export function backoffDelayMs(
  attempt: number,
  options: { baseMs?: number; maxMs?: number; random?: () => number } = {},
): number {
  const base = options.baseMs ?? 1000;
  const max = options.maxMs ?? 30_000;
  const random = options.random ?? Math.random;
  const ceiling = Math.min(max, base * 2 ** attempt);
  return Math.round(ceiling * (0.5 + random() * 0.5));
}

export function parseRetryAfterMs(header: string | null, now: number = Date.now()): number | undefined {
  if (!header) return undefined;

  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - now);

  return undefined;
}

// ---------------------------------------------------------------------------

export interface CacheEntry {
  etag?: string | undefined;
  lastModified?: string | undefined;
  body: string;
  storedAt: number;
}

/** Conditional-request cache. Swappable so tests can use a plain Map. */
export interface CacheStore {
  get(key: string): CacheEntry | undefined;
  set(key: string, entry: CacheEntry): void;
}

export class MemoryCacheStore implements CacheStore {
  #entries = new Map<string, CacheEntry>();
  get(key: string): CacheEntry | undefined {
    return this.#entries.get(key);
  }
  set(key: string, entry: CacheEntry): void {
    this.#entries.set(key, entry);
  }
}

export interface HttpResponse {
  status: number;
  text: string;
  /** True when the server answered 304 and the cached body was reused. */
  fromCache: boolean;
}

/** A body the adapters are about to parse — what §7 stores in `raw_payloads`. */
export interface HttpResponseEvent {
  url: string;
  status: number;
  /** The response body, or the reused cached body when `fromCache`. */
  text: string;
  fromCache: boolean;
}

export interface HttpClientOptions {
  userAgent?: string;
  timeoutMs?: number;
  maxRetries?: number;
  limiter?: HostRateLimiter;
  cache?: CacheStore;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Called before each request; used for logging and raw-payload capture. */
  onRequest?: (url: string, attempt: number) => void;
  /**
   * Called for every body an adapter is given, so §7's raw payloads can be
   * persisted for offline replay. It fires for a served-from-cache 304 as well
   * as a fresh 200 — the adapter parses the same text either way — and does not
   * fire for an error response, whose body is a challenge page or an error
   * envelope rather than a payload worth replaying.
   *
   * It runs inside the rate-limited critical section, so it must be cheap and
   * must not throw: a failure to record a debug payload would otherwise fail
   * the sync that produced it.
   */
  onResponse?: (event: HttpResponseEvent) => void;
}

export class HttpClient {
  readonly #userAgent: string;
  readonly #timeoutMs: number;
  readonly #maxRetries: number;
  readonly #limiter: HostRateLimiter;
  readonly #cache: CacheStore;
  readonly #fetch: typeof fetch;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #onRequest: ((url: string, attempt: number) => void) | undefined;
  readonly #onResponse: ((event: HttpResponseEvent) => void) | undefined;

  constructor(options: HttpClientOptions = {}) {
    this.#userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    this.#maxRetries = options.maxRetries ?? 3;
    this.#limiter = options.limiter ?? new HostRateLimiter();
    this.#cache = options.cache ?? new MemoryCacheStore();
    this.#fetch = options.fetchImpl ?? fetch;
    this.#sleep = options.sleep ?? defaultSleep;
    this.#onRequest = options.onRequest;
    this.#onResponse = options.onResponse;
  }

  /**
   * GET with rate limiting, retries and conditional caching.
   *
   * `conditional` enables ETag/Last-Modified revalidation, which is what keeps
   * the multi-megabyte AtCoder problem catalogues cheap to re-check.
   */
  async get(
    url: string,
    options: { conditional?: boolean; headers?: Record<string, string> } = {},
  ): Promise<HttpResponse> {
    const host = new URL(url).host;
    const cached = options.conditional ? this.#cache.get(url) : undefined;

    let lastError: unknown;

    for (let attempt = 0; attempt <= this.#maxRetries; attempt += 1) {
      if (attempt > 0) {
        const delay =
          lastError instanceof RateLimitedError && lastError.retryAfterMs !== undefined
            ? lastError.retryAfterMs
            : backoffDelayMs(attempt - 1);
        await this.#sleep(delay);
      }

      try {
        return await this.#limiter.schedule(host, async () => {
          this.#onRequest?.(url, attempt);

          const headers: Record<string, string> = {
            'user-agent': this.#userAgent,
            accept: 'application/json, text/html;q=0.9, */*;q=0.8',
            ...options.headers,
          };
          if (cached?.etag) headers['if-none-match'] = cached.etag;
          if (cached?.lastModified) headers['if-modified-since'] = cached.lastModified;

          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), this.#timeoutMs);

          let response: Response;
          try {
            response = await this.#fetch(url, { headers, signal: controller.signal, redirect: 'follow' });
          } catch (cause) {
            throw new ProviderError(`Network request to ${url} failed`, {
              retryable: true,
              url,
              cause,
            });
          } finally {
            clearTimeout(timer);
          }

          if (response.status === 304 && cached) {
            const reused: HttpResponse = { status: 304, text: cached.body, fromCache: true };
            this.#onResponse?.({ url, ...reused });
            return reused;
          }

          if (response.status === 429) {
            throw new RateLimitedError(
              `Rate limited by ${host}`,
              parseRetryAfterMs(response.headers.get('retry-after')),
              url,
            );
          }

          // Cloudflare's managed challenge is permanent for non-browser clients.
          if (
            response.status === 403 &&
            (response.headers.get('cf-mitigated') === 'challenge' ||
              response.headers.get('server') === 'cloudflare')
          ) {
            const body = await response.text();
            if (/Just a moment|Enable JavaScript and cookies/i.test(body)) {
              throw new BotProtectionError(url);
            }
            throw new ProviderError(`${url} returned 403`, {
              retryable: false,
              status: 403,
              url,
            });
          }

          if (response.status >= 500) {
            throw new ProviderError(`${host} returned ${response.status}`, {
              retryable: true,
              status: response.status,
              url,
            });
          }

          if (!response.ok) {
            throw new ProviderError(`${url} returned ${response.status}`, {
              retryable: false,
              status: response.status,
              url,
            });
          }

          const text = await response.text();

          if (options.conditional) {
            this.#cache.set(url, {
              etag: response.headers.get('etag') ?? undefined,
              lastModified: response.headers.get('last-modified') ?? undefined,
              body: text,
              storedAt: Date.now(),
            });
          }

          const fresh: HttpResponse = { status: response.status, text, fromCache: false };
          this.#onResponse?.({ url, ...fresh });
          return fresh;
        });
      } catch (error) {
        lastError = error;
        if (!(error instanceof ProviderError) || !error.retryable) throw error;
        if (attempt === this.#maxRetries) throw error;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new ProviderError(`Request to ${url} failed`, { retryable: false, url });
  }

  async getJson<T>(
    url: string,
    options: { conditional?: boolean; headers?: Record<string, string> } = {},
  ): Promise<T> {
    const response = await this.get(url, options);
    try {
      return JSON.parse(response.text) as T;
    } catch (cause) {
      throw new ProviderError(`${url} did not return valid JSON`, {
        retryable: false,
        url,
        cause,
      });
    }
  }
}
