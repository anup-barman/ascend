import type {
  AscendSettings,
  Countdown,
  PhaseDecision,
  Provider,
  SyncStatus,
  TargetEvent,
} from '@ascend/core';

/**
 * Typed client for the local API.
 *
 * The shapes here mirror the server's responses. They are declared on this side
 * rather than imported from `@ascend/server` because the browser bundle must
 * never pull in the database package.
 */

export interface SecretStatus {
  name: 'codeforces_session' | 'anthropic_api_key' | 'openai_api_key';
  present: boolean;
  updatedAt: number | null;
}

export interface SyncStateRow {
  provider: Provider;
  resource: string;
  status: SyncStatus;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  error: string | null;
  itemsSynced: number;
}

export interface ProviderSyncSummary {
  provider: Provider;
  status: SyncStatus;
  lastSuccessAt: number | null;
  error: string | null;
  resources: SyncStateRow[];
}

export interface SyncSummary {
  overall: SyncStatus;
  providers: ProviderSyncSummary[];
}

/** `skipped` is not a sync state — no run was attempted, because no handle exists. */
export type SyncOutcomeStatus = SyncStatus | 'skipped';

export interface SyncProviderOutcome {
  provider: Provider;
  label: string;
  status: SyncOutcomeStatus;
  itemsSynced: number;
  warnings: string[];
  error: string | null;
  skippedReason: string | null;
}

export interface SyncRunResult {
  startedAt: number;
  finishedAt: number;
  overall: SyncStatus;
  providers: SyncProviderOutcome[];
}

export interface SyncRunnerState {
  running: boolean;
  startedAt: number | null;
  lastResult: SyncRunResult | null;
  /** Set when the engine itself broke, rather than a provider failing. */
  lastError: string | null;
}

export interface SyncStatusResponse extends SyncSummary {
  run: SyncRunnerState;
}

/** A progress frame from `GET /api/sync/events` (`event: sync`). */
export interface SyncEvent {
  at: number;
  kind: 'started' | 'provider_started' | 'provider_finished' | 'finished';
  provider?: Provider;
  message?: string;
  /** The whole roll-up, so a subscriber renders without accumulating state. */
  summary: SyncSummary;
}

/** The stream's first frame (`event: ready`), sent on connect. */
export interface SyncReadyFrame {
  summary: SyncSummary;
  run: SyncRunnerState;
}

export interface SyncStartResult {
  started: boolean;
  /** A run was already in flight — it is doing the work, so this is not a failure. */
  alreadyRunning: boolean;
  run: SyncRunnerState | null;
}

export interface AppState {
  onboarded: boolean;
  profile: { displayName: string | null; teamName: string | null };
  handles: { codeforces: string | null; atcoder: string | null };
  targetEvent: TargetEvent | null;
  countdown: Countdown;
  countdownHeadline: string;
  phase: PhaseDecision | null;
  availability: number[];
  settings: AscendSettings;
  secrets: SecretStatus[];
  secretsKeySource: string | null;
  secretsError: string | null;
  sync: SyncSummary;
  today: string;
}

export interface ApiIssue {
  path: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues: ApiIssue[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Message for a specific field, so forms can show errors inline. */
  issueFor(path: string): string | undefined {
    return this.issues.find((issue) => issue.path === path)?.message;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    let issues: ApiIssue[] = [];
    try {
      const body = (await response.json()) as { message?: string; issues?: ApiIssue[] };
      if (body.message) message = body.message;
      if (body.issues) issues = body.issues;
    } catch {
      // Non-JSON error body; the status line is the best we have.
    }
    throw new ApiError(response.status, message, issues);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

export const api = {
  getState: () => request<AppState>('/api/state'),

  completeOnboarding: (input: {
    profile?: { displayName?: string | null; teamName?: string | null };
    handles: { codeforces?: string | null; atcoder?: string | null };
    targetEvent?: {
      name: string;
      date: string;
      location?: string | null;
      notes?: string | null;
    } | null;
    availability?: number[];
    training?: { preferredDays?: number[]; simulationsPerWeek?: number };
  }) => request<AppState>('/api/onboarding', { method: 'POST', ...json(input) }),

  setTargetEvent: (input: {
    name: string;
    date: string;
    location?: string | null;
    notes?: string | null;
  }) =>
    request<{ targetEvent: TargetEvent; state: AppState }>('/api/target-event', {
      method: 'PUT',
      ...json(input),
    }),

  clearTargetEvent: () =>
    request<{ targetEvent: null; state: AppState }>('/api/target-event', { method: 'DELETE' }),

  setHandles: (input: { codeforces?: string | null; atcoder?: string | null }) =>
    request<{ accounts: unknown[] }>('/api/handles', { method: 'PUT', ...json(input) }),

  setAvailability: (minutes: number[]) =>
    request<{ minutes: number[] }>('/api/availability', { method: 'PUT', ...json({ minutes }) }),

  updateSettings: (patch: Record<string, unknown>) =>
    request<AscendSettings>('/api/settings', { method: 'PATCH', ...json(patch) }),

  setSecret: (name: SecretStatus['name'], value: string) =>
    request<void>(`/api/secrets/${name}`, { method: 'PUT', ...json({ value }) }),

  deleteSecret: (name: SecretStatus['name']) =>
    request<void>(`/api/secrets/${name}`, { method: 'DELETE' }),

  getSyncStatus: () => request<SyncStatusResponse>('/api/sync/status'),

  /**
   * Starts a sync run.
   *
   * A 409 means a run is already going, which is the state the caller wanted to
   * reach — reporting it as an error would put a failure message on a button
   * press that did exactly the right thing.
   */
  triggerSync: async (): Promise<SyncStartResult> => {
    try {
      const response = await request<{ started: boolean; run: SyncRunnerState }>('/api/sync', {
        method: 'POST',
      });
      return { started: response.started, alreadyRunning: false, run: response.run };
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        return { started: false, alreadyRunning: true, run: null };
      }
      throw error;
    }
  },
};
