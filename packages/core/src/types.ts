/**
 * Shared domain vocabulary for Ascend.
 *
 * This module is intentionally dependency-free so that both the server and the
 * browser bundle can import it. Nothing here performs IO.
 */

// ---------------------------------------------------------------------------
// Providers (spec §1 — strictly these three, no generic multi-platform layer)
// ---------------------------------------------------------------------------

export const PROVIDERS = ['codeforces', 'codeforces_gym', 'atcoder'] as const;
export type Provider = (typeof PROVIDERS)[number];

export const PROVIDER_LABELS: Record<Provider, string> = {
  codeforces: 'Codeforces',
  codeforces_gym: 'Codeforces Gym',
  atcoder: 'AtCoder',
};

/** A contest's flavour. Gym is deliberately distinct from regular CF (§6B). */
export type ContestKind = 'regular' | 'gym' | 'atcoder';

// ---------------------------------------------------------------------------
// Sync (spec §7)
// ---------------------------------------------------------------------------

export type SyncStatus =
  | 'never_synced'
  | 'syncing'
  | 'up_to_date'
  | 'partially_synced'
  | 'failed';

export const SYNC_STATUS_LABELS: Record<SyncStatus, string> = {
  never_synced: 'NEVER SYNCED',
  syncing: 'SYNCING…',
  up_to_date: 'UP TO DATE',
  partially_synced: 'PARTIALLY SYNCED',
  failed: 'SYNC FAILED',
};

/**
 * Where a provider's incremental sync left off (§7).
 *
 * Kept deliberately small and provider-agnostic: Codeforces pages by submission
 * id, AtCoder Problems pages by `from_second`, and both are satisfied by these
 * two fields. A failed sync must leave this untouched so the retry resumes (§62).
 */
export interface SyncCursor {
  /** Newest provider item already stored, used to stop paging early. */
  lastSeenId?: string;
  /** Epoch seconds of the newest stored item, for `from_second`-style APIs. */
  lastSeenAt?: number;
  /** Opaque provider continuation token. */
  token?: string;
}

// ---------------------------------------------------------------------------
// Preparation phases (spec §4)
// ---------------------------------------------------------------------------

export const PREPARATION_PHASES = [
  'FOUNDATION',
  'SKILL_BUILDING',
  'PROBLEM_DEPTH',
  'CONTEST_TRAINING',
  'REGIONAL_SIMULATION',
  'FINAL_POLISH',
] as const;
export type PreparationPhase = (typeof PREPARATION_PHASES)[number];

export const PHASE_LABELS: Record<PreparationPhase, string> = {
  FOUNDATION: 'Foundation',
  SKILL_BUILDING: 'Skill Building',
  PROBLEM_DEPTH: 'Problem Depth',
  CONTEST_TRAINING: 'Contest Training',
  REGIONAL_SIMULATION: 'Regional Simulation',
  FINAL_POLISH: 'Final Polish',
};

/** Ordinal position of a phase, used for "pull back" / "push forward" logic. */
export function phaseIndex(phase: PreparationPhase): number {
  return PREPARATION_PHASES.indexOf(phase);
}

// ---------------------------------------------------------------------------
// Daily routing (spec §15) and session templates (spec §39)
// ---------------------------------------------------------------------------

export const TRAINING_MODES = [
  'LEARN',
  'PRACTICE',
  'REVIEW',
  'CONTEST',
  'SIMULATION',
  'RECOVERY',
  'ANALYSIS',
] as const;
export type TrainingMode = (typeof TRAINING_MODES)[number];

export const SESSION_TYPES = [
  'TOPIC_DRILL',
  'DEEP_PROBLEM',
  'SPEED_SESSION',
  'MIXED_SESSION',
  'MINI_CONTEST',
  'FULL_SIMULATION',
  'REVIEW_SESSION',
  'RECOVERY_SESSION',
] as const;
export type SessionType = (typeof SESSION_TYPES)[number];

/** Explicit objective of a session (spec §38 — never "solve 3 random problems"). */
export const TRAINING_OBJECTIVES = [
  'TOPIC_MASTERY',
  'PATTERN_RECOGNITION',
  'SPEED',
  'IMPLEMENTATION',
  'PROBLEM_SELECTION',
  'DEBUGGING',
  'MATHEMATICAL_THINKING',
  'CONTEST_ENDURANCE',
  'CONTEST_STRATEGY',
  'RETENTION',
  'ADVANCED_PROBLEM_SOLVING',
] as const;
export type TrainingObjective = (typeof TRAINING_OBJECTIVES)[number];

// ---------------------------------------------------------------------------
// Knowledge model (spec §13 states, §11 priority classes)
// ---------------------------------------------------------------------------

export const MASTERY_STATES = [
  'ENCOUNTERED',
  'LEARNED',
  'PRACTICED',
  'COMFORTABLE',
  'CONTEST_PROVEN',
  'RUSTY',
  'WEAK',
  'FORGOTTEN',
] as const;
export type MasteryState = (typeof MASTERY_STATES)[number];

export const PRIORITY_CLASSES = [
  'MUST_KNOW',
  'HIGH_VALUE',
  'USEFUL',
  'SPECIALIZED',
  'LOW_PRIORITY',
] as const;
export type PriorityClass = (typeof PRIORITY_CLASSES)[number];

/**
 * How much help the user needed (spec §26). A problem solved after seeing the
 * solution must never count as an independent solve.
 */
export const HELP_LEVELS = ['none', 'hint1', 'hint2', 'deep_hint', 'approach', 'full'] as const;
export type HelpLevel = (typeof HELP_LEVELS)[number];

/** Weight applied to a solve as evidence of mastery, by how much help was used. */
export const HELP_LEVEL_CREDIT: Record<HelpLevel, number> = {
  none: 1,
  hint1: 0.8,
  hint2: 0.6,
  deep_hint: 0.4,
  approach: 0.2,
  full: 0,
};

// ---------------------------------------------------------------------------
// Attempts (spec §12/§20 — only observable because Ascend instruments them)
// ---------------------------------------------------------------------------

/** Phases of work on a single problem, timed locally. */
export const ATTEMPT_PHASES = ['reading', 'thinking', 'coding', 'debugging'] as const;
export type AttemptPhase = (typeof ATTEMPT_PHASES)[number];

export type AttemptOutcome = 'in_progress' | 'solved' | 'abandoned' | 'unfinished';

export type AbandonReason =
  | 'too_hard'
  | 'no_idea_how_to_start'
  | 'stuck_debugging'
  | 'out_of_time'
  | 'lost_interest'
  | 'other';

/** Seconds spent in each phase of an attempt. */
export type PhaseTimings = Partial<Record<AttemptPhase, number>>;

// ---------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------

export type Verdict =
  | 'OK'
  | 'WRONG_ANSWER'
  | 'TIME_LIMIT_EXCEEDED'
  | 'MEMORY_LIMIT_EXCEEDED'
  | 'RUNTIME_ERROR'
  | 'COMPILATION_ERROR'
  | 'IDLENESS_LIMIT_EXCEEDED'
  | 'PRESENTATION_ERROR'
  | 'CHALLENGED'
  | 'SKIPPED'
  | 'TESTING'
  | 'PARTIAL'
  | 'REJECTED'
  | 'FAILED'
  | 'UNKNOWN';

/** Whether a verdict represents a successful solve. */
export function isAccepted(verdict: string): boolean {
  return verdict === 'OK';
}

/** Participation type, which is how timed vs untimed work is distinguished. */
export type ParticipantType =
  | 'CONTESTANT'
  | 'PRACTICE'
  | 'VIRTUAL'
  | 'MANAGER'
  | 'OUT_OF_COMPETITION';

/** Submissions made under real contest pressure (spec §12 timed-vs-untimed). */
export function isTimedParticipation(t: string): boolean {
  return t === 'CONTESTANT' || t === 'VIRTUAL';
}

// ---------------------------------------------------------------------------
// Readiness (spec §5 / §27)
// ---------------------------------------------------------------------------

export const READINESS_DIMENSIONS = [
  'algorithms',
  'implementation',
  'problem_recognition',
  'speed',
  'debugging',
  'contest_strategy',
  'mathematical_reasoning',
  'retention',
] as const;
export type ReadinessDimension = (typeof READINESS_DIMENSIONS)[number];

export const READINESS_DIMENSION_LABELS: Record<ReadinessDimension, string> = {
  algorithms: 'Algorithms',
  implementation: 'Implementation',
  problem_recognition: 'Problem Recognition',
  speed: 'Speed',
  debugging: 'Debugging',
  contest_strategy: 'Contest Strategy',
  mathematical_reasoning: 'Math',
  retention: 'Retention',
};

/**
 * A single readiness dimension. `value` is null when the evidence behind it is
 * too thin to report a number (spec §5 "not fake precision", §58 "never invent
 * user performance"). The UI renders null as an em dash, never as 0%.
 */
export interface DimensionScore {
  /** 0..1, or null when below the evidence threshold. */
  value: number | null;
  /** 0..1 confidence in the value. */
  confidence: number;
  /** How many independent observations fed this score. */
  evidenceCount: number;
  /** Observations still required before a number is shown. */
  evidenceNeeded: number;
}

export type ReadinessProfile = {
  overall: number | null;
  dimensions: Record<ReadinessDimension, DimensionScore>;
};

// ---------------------------------------------------------------------------
// Explainability (spec §36 / §46 — every recommendation carries its evidence)
// ---------------------------------------------------------------------------

/** One concrete, checkable fact drawn from the local database. */
export interface EvidenceItem {
  label: string;
  /** Rendered value. Always sourced from application data, never from an LLM. */
  value: string;
  /** Optional deep link, e.g. to a submission or problem. */
  href?: string;
}

/** The shape behind every "WHY THIS?" control. */
export interface Explanation {
  recommendation: string;
  reason: string;
  evidence: EvidenceItem[];
  expectedBenefit: string;
}

// ---------------------------------------------------------------------------
// Target event + countdown (spec §3)
// ---------------------------------------------------------------------------

export interface TargetEvent {
  id: number;
  name: string;
  /** Local calendar date, `YYYY-MM-DD`. Never inferred — the user sets it (§3). */
  date: string;
  location: string | null;
  notes: string | null;
}

/**
 * Urgency bands. `NO_TARGET` exists because the spec forbids inventing a
 * contest date, so the countdown must have a legitimate empty state.
 */
export type PreparationUrgency =
  | 'NO_TARGET'
  | 'DISTANT'
  | 'APPROACHING'
  | 'IMMINENT'
  | 'FINAL_14'
  | 'FINAL_3'
  | 'PAST';

export interface Countdown {
  /** Null when no target event is configured. */
  daysRemaining: number | null;
  weeksRemaining: number | null;
  urgency: PreparationUrgency;
}
