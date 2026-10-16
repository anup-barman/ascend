import { describe, expect, it } from 'vitest';

import { computeCountdown, countdownHeadline, urgencyFor } from './countdown';

const TODAY = '2026-08-28';

describe('computeCountdown', () => {
  it('reports NO_TARGET rather than inventing a date (spec §3)', () => {
    for (const missing of [null, undefined, '']) {
      const countdown = computeCountdown(missing, TODAY);
      expect(countdown).toEqual({
        daysRemaining: null,
        weeksRemaining: null,
        urgency: 'NO_TARGET',
      });
    }
  });

  it('treats a malformed stored date as unconfigured, not as zero days', () => {
    expect(computeCountdown('2026-02-30', TODAY).urgency).toBe('NO_TARGET');
    expect(computeCountdown('not-a-date', TODAY).daysRemaining).toBeNull();
  });

  it('counts days to the target', () => {
    expect(computeCountdown('2027-01-18', TODAY).daysRemaining).toBe(143);
    expect(computeCountdown('2026-08-29', TODAY).daysRemaining).toBe(1);
    expect(computeCountdown('2026-08-28', TODAY).daysRemaining).toBe(0);
  });

  it('rounds weeks up so a partial week still counts', () => {
    expect(computeCountdown('2026-09-04', TODAY).weeksRemaining).toBe(1); // 7 days
    expect(computeCountdown('2026-09-05', TODAY).weeksRemaining).toBe(2); // 8 days
    expect(computeCountdown('2026-08-28', TODAY).weeksRemaining).toBe(0);
  });

  it('handles a target date in the past', () => {
    const countdown = computeCountdown('2026-08-21', TODAY);
    expect(countdown.daysRemaining).toBe(-7);
    expect(countdown.weeksRemaining).toBeNull();
    expect(countdown.urgency).toBe('PAST');
  });
});

describe('urgencyFor', () => {
  it('maps each band at its exact boundary', () => {
    expect(urgencyFor(null)).toBe('NO_TARGET');
    expect(urgencyFor(-1)).toBe('PAST');
    expect(urgencyFor(0)).toBe('FINAL_3');
    expect(urgencyFor(3)).toBe('FINAL_3');
    expect(urgencyFor(4)).toBe('FINAL_14');
    expect(urgencyFor(14)).toBe('FINAL_14');
    expect(urgencyFor(15)).toBe('IMMINENT');
    expect(urgencyFor(45)).toBe('IMMINENT');
    expect(urgencyFor(46)).toBe('APPROACHING');
    expect(urgencyFor(120)).toBe('APPROACHING');
    expect(urgencyFor(121)).toBe('DISTANT');
  });
});

describe('countdownHeadline', () => {
  it('never shows a fabricated countdown', () => {
    expect(countdownHeadline(computeCountdown(null, TODAY))).toBe(
      'NO TARGET CONTEST CONFIGURED',
    );
  });

  it('reads naturally at the edges', () => {
    expect(countdownHeadline(computeCountdown('2026-08-28', TODAY))).toBe('REGIONAL IS TODAY');
    expect(countdownHeadline(computeCountdown('2026-08-29', TODAY))).toBe('1 DAY TO REGIONAL');
    expect(countdownHeadline(computeCountdown('2027-01-18', TODAY))).toBe(
      '143 DAYS TO REGIONAL',
    );
    expect(countdownHeadline(computeCountdown('2026-08-27', TODAY))).toBe(
      'REGIONAL WAS YESTERDAY',
    );
    expect(countdownHeadline(computeCountdown('2026-08-21', TODAY))).toBe(
      'REGIONAL WAS 7 DAYS AGO',
    );
  });
});
