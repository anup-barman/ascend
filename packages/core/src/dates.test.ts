import { describe, expect, it } from 'vitest';

import {
  addDays,
  diffCalendarDays,
  epochSecondsToIsoDate,
  isIsoDate,
  parseIsoDate,
  toEpochDay,
  todayIso,
} from './dates';

describe('parseIsoDate', () => {
  it('accepts a real calendar date', () => {
    expect(parseIsoDate('2026-08-28')).toEqual({ year: 2026, month: 8, day: 28 });
  });

  it('rejects dates that overflow their month', () => {
    expect(parseIsoDate('2026-02-30')).toBeNull();
    expect(parseIsoDate('2026-04-31')).toBeNull();
  });

  it('handles leap years', () => {
    expect(parseIsoDate('2028-02-29')).not.toBeNull();
    expect(parseIsoDate('2027-02-29')).toBeNull();
  });

  it('rejects malformed input', () => {
    for (const bad of ['2026-8-28', '26-08-28', '2026/08/28', '', 'tomorrow', '2026-13-01']) {
      expect(parseIsoDate(bad), bad).toBeNull();
    }
  });

  it('isIsoDate mirrors parseIsoDate', () => {
    expect(isIsoDate('2026-08-28')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
  });
});

describe('diffCalendarDays', () => {
  it('counts whole calendar days forward', () => {
    expect(diffCalendarDays('2026-08-28', '2026-08-29')).toBe(1);
    expect(diffCalendarDays('2026-08-28', '2026-09-28')).toBe(31);
  });

  it('is negative when the target is in the past', () => {
    expect(diffCalendarDays('2026-08-28', '2026-08-21')).toBe(-7);
  });

  it('is zero for the same day', () => {
    expect(diffCalendarDays('2026-08-28', '2026-08-28')).toBe(0);
  });

  it('crosses a daylight-saving boundary without drift', () => {
    // Europe/US DST transitions fall in late March and late October.
    expect(diffCalendarDays('2026-03-28', '2026-03-30')).toBe(2);
    expect(diffCalendarDays('2026-10-24', '2026-10-26')).toBe(2);
  });

  it('crosses a year boundary and a leap day', () => {
    expect(diffCalendarDays('2026-12-31', '2027-01-01')).toBe(1);
    expect(diffCalendarDays('2028-02-28', '2028-03-01')).toBe(2); // leap year
    expect(diffCalendarDays('2027-02-28', '2027-03-01')).toBe(1); // non-leap
  });

  it('returns null for malformed input', () => {
    expect(diffCalendarDays('nope', '2026-08-28')).toBeNull();
    expect(diffCalendarDays('2026-08-28', 'nope')).toBeNull();
  });
});

describe('toEpochDay', () => {
  it('anchors on the Unix epoch', () => {
    expect(toEpochDay('1970-01-01')).toBe(0);
    expect(toEpochDay('1970-01-02')).toBe(1);
  });
});

describe('todayIso', () => {
  it('uses the local calendar date, not UTC', () => {
    // Local noon can never fall on a different local date than the one given.
    const localNoon = new Date(2026, 7, 28, 12, 0, 0);
    expect(todayIso(localNoon)).toBe('2026-08-28');
  });

  it('pads single-digit months and days', () => {
    expect(todayIso(new Date(2026, 0, 5, 12))).toBe('2026-01-05');
  });
});

describe('addDays', () => {
  it('moves forward and backward across month boundaries', () => {
    expect(addDays('2026-08-28', 4)).toBe('2026-09-01');
    expect(addDays('2026-09-01', -1)).toBe('2026-08-31');
  });

  it('handles leap days', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
  });

  it('returns null for malformed input', () => {
    expect(addDays('nope', 1)).toBeNull();
  });
});

describe('epochSecondsToIsoDate', () => {
  it('round-trips a local noon timestamp', () => {
    const localNoon = new Date(2026, 7, 28, 12, 0, 0);
    const seconds = Math.floor(localNoon.getTime() / 1000);
    expect(epochSecondsToIsoDate(seconds)).toBe('2026-08-28');
  });
});
