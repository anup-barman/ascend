import {
  computeCountdown,
  countdownHeadline,
  decidePhase,
  todayIso,
  type Countdown,
  type PreparationPhase,
} from '@ascend/core';
import type { PhaseDecision } from '@ascend/core/phase';
import {
  getActiveTargetEvent,
  getAvailability,
  getHandle,
  getProfile,
  getSettings,
  getSyncSummary,
  isOnboarded,
  type AscendDb,
  type SyncSummary,
} from '@ascend/db';
import type { AscendSettings, TargetEvent } from '@ascend/core';

import { describeSecrets, SecretsUnavailableError, type SecretStatus } from '../secrets';

/**
 * The single bootstrap payload the UI shell reads on load.
 *
 * One round trip gives the countdown, phase, sync status and configuration, so
 * the dashboard can render its top-level answer — "what should I do today?" —
 * without a waterfall of requests.
 */
export interface AppState {
  onboarded: boolean;
  profile: { displayName: string | null; teamName: string | null };
  handles: { codeforces: string | null; atcoder: string | null };
  targetEvent: TargetEvent | null;
  countdown: Countdown;
  countdownHeadline: string;
  /** Null until there is any evidence at all to reason about. */
  phase: PhaseDecision | null;
  availability: number[];
  settings: AscendSettings;
  secrets: SecretStatus[];
  /** How secrets are protected: `passphrase` or `keyfile`. */
  secretsKeySource: string | null;
  /** Populated when the secret store exists but cannot be read. */
  secretsError: string | null;
  sync: SyncSummary;
  today: string;
}

/**
 * Builds the phase decision from whatever evidence exists.
 *
 * In M1 there is no synced history, so every readiness signal is null and the
 * engine deliberately caps the phase at SKILL_BUILDING rather than flattering
 * the user with a phase they have not earned (spec §58).
 */
function currentPhase(countdown: Countdown): PhaseDecision {
  return decidePhase({
    daysRemaining: countdown.daysRemaining,
    foundationCoverage: null,
    overallReadiness: null,
    technicalReadiness: null,
    contestExecutionReadiness: null,
  });
}

export function buildAppState(db: AscendDb): AppState {
  const today = todayIso();
  const targetEvent = getActiveTargetEvent(db);
  const countdown = computeCountdown(targetEvent?.date ?? null, today);

  let secrets: SecretStatus[] = [];
  let secretsKeySource: string | null = null;
  let secretsError: string | null = null;
  try {
    const described = describeSecrets();
    secrets = described.secrets;
    secretsKeySource = described.keySource;
  } catch (error) {
    // A broken secret store must not take the whole app down — the user needs
    // the UI in order to fix it.
    secretsError =
      error instanceof SecretsUnavailableError ? error.message : 'Secret store unreadable';
  }

  return {
    onboarded: isOnboarded(db),
    profile: getProfile(db),
    handles: {
      codeforces: getHandle(db, 'codeforces'),
      atcoder: getHandle(db, 'atcoder'),
    },
    targetEvent,
    countdown,
    countdownHeadline: countdownHeadline(countdown),
    phase: currentPhase(countdown),
    availability: getAvailability(db),
    settings: getSettings(db),
    secrets,
    secretsKeySource,
    secretsError,
    sync: getSyncSummary(db),
    today,
  };
}

export type { PreparationPhase };
