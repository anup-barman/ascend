import { getHandle, recordRawPayload, type AscendDb } from '@ascend/db';
import type { Provider } from '@ascend/core';
import {
  createAdapters,
  describeRawRequest,
  type CfCredentials,
  type HttpResponseEvent,
  type PlatformAdapter,
} from '@ascend/providers';

import { runSync, type SyncEvent, type SyncRunOptions, type SyncRunResult } from './engine';

/**
 * Owns the one sync run a local, single-user app is ever allowed to have in
 * flight (spec §7).
 *
 * Two runs at once would fight over the same cursor and double every request
 * against a rate-limited API, so `POST /api/sync` is guarded here rather than in
 * the route: the guard belongs with the state it protects.
 *
 * The runner is also where the network meets the disk — building the adapters,
 * capturing raw payloads and fanning status events out to SSE subscribers — which
 * keeps `engine.ts` free of IO and therefore testable with scripted adapters.
 */

export interface SyncRunnerState {
  running: boolean;
  startedAt: number | null;
  /** The most recent completed run, so a page loaded after it still sees it. */
  lastResult: SyncRunResult | null;
  /**
   * Set when the engine itself threw rather than a provider failing.
   *
   * A provider failure is data — it lands in `sync_state` and in the run result.
   * This is the other case: a bug or a broken database, which has nowhere else to
   * be reported.
   */
  lastError: string | null;
}

export interface SyncRunnerOptions {
  /**
   * Overrides adapter construction.
   *
   * Real adapters reach the network the moment a run starts, so tests supply
   * scripted ones here. Called once per run, because a run's `HttpClient` owns
   * that run's conditional-request cache.
   */
  buildAdapters?: () => PlatformAdapter[];
}

/**
 * Persists a response body for offline replay (§7).
 *
 * Best-effort by design: this runs inside the HTTP client's rate-limited critical
 * section, so a failure to record a debug payload must never fail the sync that
 * produced it. A URL from a host Ascend does not recognise is ignored rather than
 * stored under a guessed provider.
 *
 * Returns whether a row was written, which is what makes it testable.
 */
export function captureRawPayload(db: AscendDb, event: HttpResponseEvent): boolean {
  try {
    const identity = describeRawRequest(event.url);
    if (!identity) return false;
    recordRawPayload(db, { ...identity, httpStatus: event.status, body: event.text });
    return true;
  } catch {
    return false;
  }
}

export class SyncRunner {
  readonly #db: AscendDb;
  readonly #buildAdapters: () => PlatformAdapter[];
  readonly #listeners = new Set<(event: SyncEvent) => void>();
  #inFlight: Promise<void> | null = null;
  #startedAt: number | null = null;
  #lastResult: SyncRunResult | null = null;
  #lastError: string | null = null;

  constructor(db: AscendDb, options: SyncRunnerOptions = {}) {
    this.#db = db;
    this.#buildAdapters = options.buildAdapters ?? (() => this.#realAdapters());
  }

  get state(): SyncRunnerState {
    return {
      running: this.#inFlight !== null,
      startedAt: this.#startedAt,
      lastResult: this.#lastResult,
      lastError: this.#lastError,
    };
  }

  /** Returns an unsubscribe function; SSE handlers call it on close. */
  subscribe(listener: (event: SyncEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #emit(event: SyncEvent): void {
    for (const listener of this.#listeners) {
      // One broken subscriber (a socket that died mid-write) must not abort the
      // run or starve the other subscribers.
      try {
        listener(event);
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * Persists a response body for offline replay (§7).
   *
   * Everything here is best-effort: it runs inside the HTTP client's rate-limited
   * critical section, so a failure to record a debug payload must never fail the
   * sync that produced it.
   */
  #recordResponse(event: HttpResponseEvent): void {
    captureRawPayload(this.#db, event);
  }

  /**
   * Codeforces API credentials, when the user has configured them.
   *
   * Always null today: the secret store still carries the useless session cookie
   * rather than an `apiKey`/`apiSecret` pair (TODO item 5). Standings enrichment
   * is optional — its absence is a warning, never a failure — so the sync works
   * unchanged until that lands.
   */
  #codeforcesCredentials(): CfCredentials | null {
    return null;
  }

  /**
   * The three real adapters over one shared HTTP client, so the per-host rate
   * limits hold across all of them.
   */
  #realAdapters(): PlatformAdapter[] {
    return createAdapters({
      codeforcesCredentials: this.#codeforcesCredentials(),
      http: { onResponse: (event) => this.#recordResponse(event) },
    }).all;
  }

  /**
   * Starts a run in the background, or reports that one is already going.
   *
   * The run is not awaited: a full sync spends minutes inside the Codeforces rate
   * limit, so holding the HTTP request open for it would time out. Progress is
   * published on the event stream instead, and `settle()` is how a script or a
   * test waits for the end.
   *
   * `already_running` is not an error the caller should retry into — the run in
   * flight is doing the work the caller wanted.
   */
  start(options: SyncRunOptions = {}): { started: boolean; reason?: 'already_running' } {
    if (this.#inFlight) return { started: false, reason: 'already_running' };

    const adapters = this.#buildAdapters();

    this.#startedAt = Math.floor(Date.now() / 1000);
    this.#lastError = null;

    // The chain never rejects: nothing awaits it, so a rejection here would be an
    // unhandled one, and the failure has a home in `lastError` instead.
    this.#inFlight = runSync(
      {
        db: this.#db,
        adapters,
        handleFor: (provider: Provider) => getHandle(this.#db, provider),
        onEvent: (event) => this.#emit(event),
      },
      options,
    )
      .then((result) => {
        this.#lastResult = result;
      })
      .catch((error: unknown) => {
        this.#lastError = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        this.#inFlight = null;
        this.#startedAt = null;
      });

    return { started: true };
  }

  /** Resolves once no run is in flight — used by the smoke script and tests. */
  async settle(): Promise<void> {
    while (this.#inFlight) await this.#inFlight;
  }
}
