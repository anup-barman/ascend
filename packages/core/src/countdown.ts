import { diffCalendarDays, todayIso } from './dates';
import type { Countdown, PreparationUrgency } from './types';

/**
 * Days-to-Regional and the urgency band derived from it (spec §3).
 *
 * The spec is explicit that a contest date must never be invented, so a missing
 * target is a first-class state (`NO_TARGET`) rather than a zero.
 */

/** Thresholds, in days remaining, for each urgency band. */
export const URGENCY_THRESHOLDS = {
  /** Spec §56 — radically reduced intensity. */
  final3: 3,
  /** Spec §55 — no new topics, simulate and reinforce. */
  final14: 14,
  imminent: 45,
  approaching: 120,
} as const;

export function urgencyFor(daysRemaining: number | null): PreparationUrgency {
  if (daysRemaining === null) return 'NO_TARGET';
  if (daysRemaining < 0) return 'PAST';
  if (daysRemaining <= URGENCY_THRESHOLDS.final3) return 'FINAL_3';
  if (daysRemaining <= URGENCY_THRESHOLDS.final14) return 'FINAL_14';
  if (daysRemaining <= URGENCY_THRESHOLDS.imminent) return 'IMMINENT';
  if (daysRemaining <= URGENCY_THRESHOLDS.approaching) return 'APPROACHING';
  return 'DISTANT';
}

/**
 * @param targetDate `YYYY-MM-DD` of the target Regional, or null if unconfigured.
 * @param today      The user's local calendar date; defaults to now.
 */
export function computeCountdown(
  targetDate: string | null | undefined,
  today: string = todayIso(),
): Countdown {
  if (!targetDate) {
    return { daysRemaining: null, weeksRemaining: null, urgency: 'NO_TARGET' };
  }

  const daysRemaining = diffCalendarDays(today, targetDate);
  if (daysRemaining === null) {
    // Malformed stored date — treat as unconfigured rather than guessing.
    return { daysRemaining: null, weeksRemaining: null, urgency: 'NO_TARGET' };
  }

  return {
    daysRemaining,
    weeksRemaining: daysRemaining >= 0 ? Math.ceil(daysRemaining / 7) : null,
    urgency: urgencyFor(daysRemaining),
  };
}

/** Headline string for the dashboard, e.g. `143 DAYS TO REGIONAL`. */
export function countdownHeadline(countdown: Countdown): string {
  const { daysRemaining } = countdown;
  if (daysRemaining === null) return 'NO TARGET CONTEST CONFIGURED';
  if (daysRemaining < 0) {
    const past = Math.abs(daysRemaining);
    return past === 1 ? 'REGIONAL WAS YESTERDAY' : `REGIONAL WAS ${past} DAYS AGO`;
  }
  if (daysRemaining === 0) return 'REGIONAL IS TODAY';
  if (daysRemaining === 1) return '1 DAY TO REGIONAL';
  return `${daysRemaining} DAYS TO REGIONAL`;
}
