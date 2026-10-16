import { describe, expect, it } from 'vitest';

import { calendarPhaseFor, decidePhase } from './phase';
import type { PhaseSignals } from './phase';

/** Strong, complete evidence — overridden per test as needed. */
function signals(overrides: Partial<PhaseSignals> = {}): PhaseSignals {
  return {
    daysRemaining: 100,
    foundationCoverage: 0.9,
    overallReadiness: 0.75,
    technicalReadiness: 0.75,
    contestExecutionReadiness: 0.75,
    ...overrides,
  };
}

describe('calendarPhaseFor', () => {
  it('maps each band at its exact boundary', () => {
    expect(calendarPhaseFor(null)).toBeNull();
    expect(calendarPhaseFor(181)).toBe('FOUNDATION');
    expect(calendarPhaseFor(180)).toBe('SKILL_BUILDING');
    expect(calendarPhaseFor(121)).toBe('SKILL_BUILDING');
    expect(calendarPhaseFor(120)).toBe('PROBLEM_DEPTH');
    expect(calendarPhaseFor(61)).toBe('PROBLEM_DEPTH');
    expect(calendarPhaseFor(60)).toBe('CONTEST_TRAINING');
    expect(calendarPhaseFor(22)).toBe('CONTEST_TRAINING');
    expect(calendarPhaseFor(21)).toBe('REGIONAL_SIMULATION');
    expect(calendarPhaseFor(4)).toBe('REGIONAL_SIMULATION');
    expect(calendarPhaseFor(3)).toBe('FINAL_POLISH');
    expect(calendarPhaseFor(0)).toBe('FINAL_POLISH');
  });
});

describe('decidePhase — hard overrides (spec §55, §56)', () => {
  it('forces FINAL_POLISH inside 3 days even with weak fundamentals', () => {
    const decision = decidePhase(
      signals({ daysRemaining: 2, foundationCoverage: 0.1, overallReadiness: 0.2 }),
    );
    expect(decision.phase).toBe('FINAL_POLISH');
    expect(decision.overrides.join(' ')).toContain('2 days to Regional');
  });

  it('forces REGIONAL_SIMULATION inside 14 days, outranking the evidence ceiling', () => {
    const weak = decidePhase(
      signals({ daysRemaining: 10, foundationCoverage: 0.1, overallReadiness: 0.2 }),
    );
    expect(weak.phase).toBe('REGIONAL_SIMULATION');
    expect(weak.evidenceCeiling).toBe('FOUNDATION');
    expect(weak.overrides).toHaveLength(1);

    const strong = decidePhase(signals({ daysRemaining: 14 }));
    expect(strong.phase).toBe('REGIONAL_SIMULATION');
  });

  it('handles a target date that has already passed', () => {
    const decision = decidePhase(signals({ daysRemaining: -1 }));
    expect(decision.phase).toBe('FINAL_POLISH');
    expect(decision.overrides.join(' ')).toContain('passed');
  });
});

describe('decidePhase — evidence constrains the calendar (spec §4)', () => {
  it('pulls training back when fundamentals are missing', () => {
    const decision = decidePhase(
      signals({ daysRemaining: 30, foundationCoverage: 0.2, overallReadiness: 0.3 }),
    );
    expect(decision.calendarPhase).toBe('CONTEST_TRAINING');
    expect(decision.evidenceCeiling).toBe('FOUNDATION');
    expect(decision.phase).toBe('FOUNDATION');
    expect(decision.reasons.join(' ')).toContain('must-know topics');
  });

  it('caps at SKILL_BUILDING when there is no evidence at all', () => {
    const decision = decidePhase(
      signals({
        daysRemaining: 30,
        foundationCoverage: null,
        overallReadiness: null,
        technicalReadiness: null,
        contestExecutionReadiness: null,
      }),
    );
    expect(decision.evidenceCeiling).toBe('SKILL_BUILDING');
    expect(decision.phase).toBe('SKILL_BUILDING');
    expect(decision.reasons.join(' ')).toContain('No topic-coverage evidence');
  });

  it('does not push a distant user forward just because evidence is strong', () => {
    const decision = decidePhase(signals({ daysRemaining: 300 }));
    expect(decision.phase).toBe('FOUNDATION');
  });
});

describe('decidePhase — no target configured', () => {
  it('follows evidence and stops at CONTEST_TRAINING', () => {
    const decision = decidePhase(signals({ daysRemaining: null }));
    expect(decision.calendarPhase).toBeNull();
    expect(decision.phase).toBe('CONTEST_TRAINING');
    expect(decision.reasons.join(' ')).toContain('No target contest configured');
  });

  it('still respects a low evidence ceiling', () => {
    const decision = decidePhase(
      signals({ daysRemaining: null, foundationCoverage: 0.4, overallReadiness: 0.45 }),
    );
    expect(decision.phase).toBe('SKILL_BUILDING');
  });
});

describe('decidePhase — execution gap nudge (spec §4)', () => {
  it('moves toward contest work when execution lags technical skill', () => {
    const decision = decidePhase(
      signals({ daysRemaining: 100, technicalReadiness: 0.8, contestExecutionReadiness: 0.6 }),
    );
    expect(decision.calendarPhase).toBe('PROBLEM_DEPTH');
    expect(decision.phase).toBe('CONTEST_TRAINING');
    expect(decision.reasons.join(' ')).toContain('ahead of contest execution');
  });

  it('leaves the phase alone when the gap is small', () => {
    const decision = decidePhase(
      signals({ daysRemaining: 100, technicalReadiness: 0.7, contestExecutionReadiness: 0.65 }),
    );
    expect(decision.phase).toBe('PROBLEM_DEPTH');
  });

  it('does not nudge past a low evidence ceiling', () => {
    const decision = decidePhase(
      signals({
        daysRemaining: 100,
        foundationCoverage: 0.6,
        technicalReadiness: 0.8,
        contestExecutionReadiness: 0.5,
      }),
    );
    expect(decision.evidenceCeiling).toBe('PROBLEM_DEPTH');
    expect(decision.phase).toBe('PROBLEM_DEPTH');
  });

  it('does not nudge while fundamentals are still the priority', () => {
    const decision = decidePhase(
      signals({ daysRemaining: 300, technicalReadiness: 0.8, contestExecutionReadiness: 0.5 }),
    );
    expect(decision.phase).toBe('FOUNDATION');
  });
});
