import { READINESS_DIMENSIONS } from './types';
import type { Provider, ReadinessDimension } from './types';

/**
 * Application settings (spec §64).
 *
 * The *shape* of configuration lives here, in the dependency-free core, because
 * both the server and the browser need it. `@ascend/db` owns only its
 * persistence, and the engines read their tunables from it — §27 requires the
 * readiness formula to be configurable rather than hardcoded, and §37 requires
 * the same of the problem-source preference.
 */

export type AiProvider = 'anthropic' | 'openai' | 'ollama';

export interface AiSettings {
  /** Whether AI features are active. Everything degrades without them (§71). */
  enabled: boolean;
  provider: AiProvider;
  /** Routine coaching language and problem classification. */
  model: string;
  /** Contest analysis and code review, where depth is worth the cost. */
  deepModel: string;
  /** For local models (Ollama) or a proxy. */
  baseUrl: string | null;
}

export interface SyncSettings {
  autoSyncOnLaunch: boolean;
  /** Background sync cadence while the app is open (§7). */
  intervalMinutes: number;
  /** Fetch submission source code, which requires scraping (§21). */
  fetchSubmissionSources: boolean;
}

export interface TrainingSettings {
  /** Weekdays the user prefers to train, 0 = Sunday. */
  preferredDays: number[];
  simulationsPerWeek: number;
  /** Minutes below which the planner will not schedule a deep problem. */
  minDeepWorkMinutes: number;
}

/** Weighting of the readiness dimensions (§27). */
export type ReadinessWeights = Record<ReadinessDimension, number>;

/**
 * Problem-source preference (§37). Gym leads by default because it is the
 * closest material to a real Regional, but the spec forbids hardcoding that as
 * an absolute rule, so it stays a weight the coach can trade off per objective.
 */
export type SourceWeights = Record<Provider, number>;

export interface AscendSettings {
  ai: AiSettings;
  sync: SyncSettings;
  training: TrainingSettings;
  readinessWeights: ReadinessWeights;
  sourceWeights: SourceWeights;
}

export const DEFAULT_READINESS_WEIGHTS: ReadinessWeights = {
  algorithms: 1,
  implementation: 1,
  problem_recognition: 1.2,
  speed: 0.9,
  debugging: 0.8,
  contest_strategy: 1.2,
  mathematical_reasoning: 0.7,
  retention: 0.9,
};

export const DEFAULT_SETTINGS: AscendSettings = {
  ai: {
    enabled: false,
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    deepModel: 'claude-opus-5',
    baseUrl: null,
  },
  sync: {
    autoSyncOnLaunch: true,
    intervalMinutes: 60,
    fetchSubmissionSources: true,
  },
  training: {
    preferredDays: [0, 1, 2, 3, 4, 5, 6],
    simulationsPerWeek: 1,
    minDeepWorkMinutes: 60,
  },
  readinessWeights: DEFAULT_READINESS_WEIGHTS,
  sourceWeights: {
    codeforces_gym: 1.3,
    codeforces: 1,
    atcoder: 0.8,
  },
};

export type SettingsSection = keyof AscendSettings;

export const SETTINGS_SECTIONS = Object.keys(DEFAULT_SETTINGS) as SettingsSection[];

/** A section-wise patch, so updating one value never rewrites the rest. */
export type SettingsPatch = {
  [K in SettingsSection]?: Partial<AscendSettings[K]>;
};

/**
 * A fresh, fully-owned copy of the defaults.
 *
 * Written out explicitly rather than via `structuredClone` so this module needs
 * no ambient platform globals — it has to typecheck with no DOM and no Node types.
 */
export function defaultSettings(): AscendSettings {
  return {
    ai: { ...DEFAULT_SETTINGS.ai },
    sync: { ...DEFAULT_SETTINGS.sync },
    training: {
      ...DEFAULT_SETTINGS.training,
      preferredDays: [...DEFAULT_SETTINGS.training.preferredDays],
    },
    readinessWeights: { ...DEFAULT_SETTINGS.readinessWeights },
    sourceWeights: { ...DEFAULT_SETTINGS.sourceWeights },
  };
}

/**
 * Merges stored sections over the defaults.
 *
 * Unknown stored keys are ignored and missing ones fall back, so a setting added
 * by a later version simply appears with its default instead of needing a data
 * migration. A corrupt weight is repaired rather than allowed to poison scoring.
 */
export function mergeSettings(stored: Map<string, unknown>): AscendSettings {
  const merged = defaultSettings();

  for (const section of SETTINGS_SECTIONS) {
    const value = stored.get(section);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
    Object.assign(merged[section], value);
  }

  for (const dimension of READINESS_DIMENSIONS) {
    const weight = merged.readinessWeights[dimension];
    if (typeof weight !== 'number' || !Number.isFinite(weight)) {
      merged.readinessWeights[dimension] = DEFAULT_READINESS_WEIGHTS[dimension];
    }
  }

  return merged;
}
