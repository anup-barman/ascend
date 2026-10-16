import { PREPARATION_PHASES, phaseIndex } from './types';
import type { PreparationPhase } from './types';

/**
 * Preparation-phase engine (spec §4, §54, §55, §56).
 *
 * The spec is emphatic that phases must NOT be purely calendar-based. So the
 * calendar proposes a phase, evidence imposes a *ceiling* on it (you cannot
 * meaningfully do contest training on missing fundamentals), a lagging contest
 * execution can nudge training forward, and the final-14 and final-3 windows
 * are hard overrides that outrank everything.
 */

/** Lower bound of days-remaining for each calendar-suggested phase. */
export const CALENDAR_PHASE_THRESHOLDS = {
  foundation: 180,
  skillBuilding: 120,
  problemDepth: 60,
  contestTraining: 21,
  regionalSimulation: 3,
} as const;

/** Gap between technical skill and contest execution that justifies a nudge. */
export const EXECUTION_GAP_THRESHOLD = 0.12;

export interface PhaseSignals {
  /** Calendar days to the Regional; null when no target event is configured. */
  daysRemaining: number | null;
  /** 0..1 share of MUST_KNOW/HIGH_VALUE topics at COMFORTABLE or better. */
  foundationCoverage: number | null;
  /** 0..1 overall readiness. */
  overallReadiness: number | null;
  /** 0..1 algorithms + implementation. */
  technicalReadiness: number | null;
  /** 0..1 contest strategy + speed. */
  contestExecutionReadiness: number | null;
}

export interface PhaseDecision {
  phase: PreparationPhase;
  /** What the calendar alone would suggest; null without a target date. */
  calendarPhase: PreparationPhase | null;
  /** The furthest phase the evidence supports. */
  evidenceCeiling: PreparationPhase;
  /** Human-readable justification, surfaced by the "WHY?" control (§46). */
  reasons: string[];
  /** Hard rules that fired and outranked the rest. */
  overrides: string[];
}

/** Returns whichever phase comes first in the progression. */
function earlierOf(a: PreparationPhase, b: PreparationPhase): PreparationPhase {
  return phaseIndex(a) <= phaseIndex(b) ? a : b;
}

export function calendarPhaseFor(daysRemaining: number | null): PreparationPhase | null {
  if (daysRemaining === null) return null;
  const t = CALENDAR_PHASE_THRESHOLDS;
  if (daysRemaining > t.foundation) return 'FOUNDATION';
  if (daysRemaining > t.skillBuilding) return 'SKILL_BUILDING';
  if (daysRemaining > t.problemDepth) return 'PROBLEM_DEPTH';
  if (daysRemaining > t.contestTraining) return 'CONTEST_TRAINING';
  if (daysRemaining > t.regionalSimulation) return 'REGIONAL_SIMULATION';
  return 'FINAL_POLISH';
}

/**
 * The furthest phase the user's evidence supports. Thin evidence deliberately
 * caps at SKILL_BUILDING rather than assuming competence (spec §58).
 */
function evidenceCeilingFor(signals: PhaseSignals, reasons: string[]): PreparationPhase {
  const { foundationCoverage, overallReadiness } = signals;

  let ceiling: PreparationPhase = 'FINAL_POLISH';

  if (foundationCoverage === null) {
    ceiling = earlierOf(ceiling, 'SKILL_BUILDING');
    reasons.push('No topic-coverage evidence yet, so advanced phases are held back.');
  } else if (foundationCoverage < 0.35) {
    ceiling = earlierOf(ceiling, 'FOUNDATION');
    reasons.push(
      `Only ${Math.round(foundationCoverage * 100)}% of must-know topics are comfortable — fundamentals come first.`,
    );
  } else if (foundationCoverage < 0.55) {
    ceiling = earlierOf(ceiling, 'SKILL_BUILDING');
    reasons.push(
      `${Math.round(foundationCoverage * 100)}% must-know coverage still leaves core gaps to close.`,
    );
  } else if (foundationCoverage < 0.75) {
    ceiling = earlierOf(ceiling, 'PROBLEM_DEPTH');
    reasons.push(
      `${Math.round(foundationCoverage * 100)}% must-know coverage supports depth work but not full contest training.`,
    );
  }

  if (overallReadiness === null) {
    ceiling = earlierOf(ceiling, 'SKILL_BUILDING');
  } else if (overallReadiness < 0.4) {
    ceiling = earlierOf(ceiling, 'SKILL_BUILDING');
    reasons.push(`Overall readiness is ${Math.round(overallReadiness * 100)}%.`);
  } else if (overallReadiness < 0.55) {
    ceiling = earlierOf(ceiling, 'PROBLEM_DEPTH');
    reasons.push(`Overall readiness is ${Math.round(overallReadiness * 100)}%.`);
  }

  return ceiling;
}

export function decidePhase(signals: PhaseSignals): PhaseDecision {
  const reasons: string[] = [];
  const overrides: string[] = [];

  const calendarPhase = calendarPhaseFor(signals.daysRemaining);
  const evidenceCeiling = evidenceCeilingFor(signals, reasons);
  const { daysRemaining } = signals;

  // --- Hard overrides (spec §55, §56) ------------------------------------
  if (daysRemaining !== null && daysRemaining < 0) {
    overrides.push('The configured target date has passed.');
    return {
      phase: 'FINAL_POLISH',
      calendarPhase,
      evidenceCeiling,
      reasons,
      overrides,
    };
  }

  if (daysRemaining !== null && daysRemaining <= 3) {
    overrides.push(
      `${daysRemaining} days to Regional: light review, pattern recall and rest only (§56).`,
    );
    return { phase: 'FINAL_POLISH', calendarPhase, evidenceCeiling, reasons, overrides };
  }

  if (daysRemaining !== null && daysRemaining <= 14) {
    overrides.push(
      `${daysRemaining} days to Regional: no new topics, simulate and reinforce known material (§55).`,
    );
    return {
      phase: 'REGIONAL_SIMULATION',
      calendarPhase,
      evidenceCeiling,
      reasons,
      overrides,
    };
  }

  // --- Calendar proposes, evidence constrains ----------------------------
  // Without a target date, simulation and polish phases are meaningless — they
  // only exist relative to a contest — so evidence alone caps at contest training.
  let phase = calendarPhase ?? earlierOf(evidenceCeiling, 'CONTEST_TRAINING');
  if (calendarPhase === null) {
    reasons.push('No target contest configured, so the phase follows evidence alone.');
  }

  if (phaseIndex(phase) > phaseIndex(evidenceCeiling)) {
    reasons.push(
      `Held at ${evidenceCeiling} instead of the calendar's ${phase}: the evidence does not support skipping ahead.`,
    );
    phase = evidenceCeiling;
  }

  // --- Nudge forward when execution lags technical skill (spec §4) -------
  const { technicalReadiness, contestExecutionReadiness } = signals;
  const canReachContestTraining = phaseIndex(evidenceCeiling) >= phaseIndex('CONTEST_TRAINING');
  const pastFoundations = phaseIndex(phase) >= phaseIndex('PROBLEM_DEPTH');

  if (
    canReachContestTraining &&
    pastFoundations &&
    technicalReadiness !== null &&
    contestExecutionReadiness !== null &&
    technicalReadiness - contestExecutionReadiness >= EXECUTION_GAP_THRESHOLD
  ) {
    if (phaseIndex(phase) < phaseIndex('CONTEST_TRAINING')) {
      reasons.push(
        `Technical skill (${Math.round(technicalReadiness * 100)}%) is ahead of contest execution (${Math.round(
          contestExecutionReadiness * 100,
        )}%), so training moves toward contest work.`,
      );
      phase = 'CONTEST_TRAINING';
    }
  }

  return { phase, calendarPhase, evidenceCeiling, reasons, overrides };
}

/** What each phase prioritises and suppresses (spec §4, §54). */
export const PHASE_GUIDANCE: Record<
  PreparationPhase,
  { prioritise: string[]; suppress: string[] }
> = {
  FOUNDATION: {
    prioritise: ['core algorithms', 'implementation fluency', 'broad topic coverage'],
    suppress: ['contest simulation volume', 'obscure specialised topics'],
  },
  SKILL_BUILDING: {
    prioritise: ['must-know topic mastery', 'targeted practice', 'prerequisite closure'],
    suppress: ['low-value topics', 'long simulations'],
  },
  PROBLEM_DEPTH: {
    prioritise: ['harder problems', 'pattern recognition', 'deep single-problem work'],
    suppress: ['easy-problem volume', 'unnecessary breadth'],
  },
  CONTEST_TRAINING: {
    prioritise: ['mixed timed practice', 'problem selection', 'speed', 'mini contests'],
    suppress: ['new specialised topics'],
  },
  REGIONAL_SIMULATION: {
    prioritise: [
      'full-length simulations',
      'known weak areas',
      'implementation reliability',
      'repeated mistakes',
      'time management',
    ],
    suppress: ['syllabus expansion', 'unfamiliar techniques'],
  },
  FINAL_POLISH: {
    prioritise: [
      'light review',
      'pattern recall',
      'implementation templates',
      'contest strategy',
      'rest',
    ],
    suppress: ['new topics', 'heavy training load', 'demoralising hard problems'],
  },
};

/** Every phase, in order — convenient for progress bars. */
export const PHASE_ORDER: readonly PreparationPhase[] = PREPARATION_PHASES;
