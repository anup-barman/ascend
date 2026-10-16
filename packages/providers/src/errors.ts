/**
 * Provider errors.
 *
 * These are deliberately specific: §62 requires that a provider failure never
 * destroys stored data, and the sync engine decides whether to retry, degrade to
 * a partial sync, or surface an actionable message based on which of these it caught.
 */

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly options: {
      /** Whether retrying later could plausibly succeed. */
      retryable: boolean;
      status?: number | undefined;
      url?: string | undefined;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = 'ProviderError';
  }

  get retryable(): boolean {
    return this.options.retryable;
  }

  get status(): number | undefined {
    return this.options.status;
  }
}

/** The provider answered, but reported a logical failure (e.g. CF `status: FAILED`). */
export class ProviderRejectedError extends ProviderError {
  constructor(message: string, url?: string) {
    super(message, { retryable: false, url });
    this.name = 'ProviderRejectedError';
  }
}

/** Rate limited. Carries the server's own advice when it gave any. */
export class RateLimitedError extends ProviderError {
  constructor(
    message: string,
    readonly retryAfterMs: number | undefined,
    url?: string,
  ) {
    super(message, { retryable: true, status: 429, url });
    this.name = 'RateLimitedError';
  }
}

/**
 * The request was blocked by bot protection.
 *
 * Codeforces serves every HTML page behind a Cloudflare managed challenge
 * (`cf-mitigated: challenge`), which no HTTP client and no headless browser can
 * clear. This is a permanent condition, not a transient failure, so the sync
 * engine must degrade rather than retry forever.
 */
export class BotProtectionError extends ProviderError {
  constructor(url: string) {
    super(
      `${url} is behind a Cloudflare challenge and cannot be fetched programmatically.`,
      { retryable: false, status: 403, url },
    );
    this.name = 'BotProtectionError';
  }
}

/** A credential is missing or no longer valid. Actionable by the user. */
export class CredentialError extends ProviderError {
  constructor(message: string) {
    super(message, { retryable: false });
    this.name = 'CredentialError';
  }
}

export function isRetryable(error: unknown): boolean {
  return error instanceof ProviderError ? error.retryable : false;
}
