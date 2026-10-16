/**
 * Calendar-date helpers.
 *
 * Ascend stores target dates as plain `YYYY-MM-DD` strings and counts *calendar*
 * days, because "days to Regional" is a wall-clock question, not a duration.
 * Dates are compared by projecting them onto UTC midnight, which makes the
 * difference immune to daylight-saving shifts.
 */

/** A plain calendar date, `YYYY-MM-DD`. */
export type IsoDate = string;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export interface DateParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

/** Parses `YYYY-MM-DD`, returning null unless it is a real calendar date. */
export function parseIsoDate(value: string): DateParts | null {
  const match = ISO_DATE_RE.exec(value);
  if (!match) return null;

  const [, rawYear, rawMonth, rawDay] = match;
  if (rawYear === undefined || rawMonth === undefined || rawDay === undefined) return null;

  const year = Number(rawYear);
  const month = Number(rawMonth);
  const day = Number(rawDay);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  // Reject dates that overflow their month (e.g. 2026-02-30).
  const asUtc = new Date(Date.UTC(year, month - 1, day));
  if (
    asUtc.getUTCFullYear() !== year ||
    asUtc.getUTCMonth() !== month - 1 ||
    asUtc.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

export function isIsoDate(value: string): boolean {
  return parseIsoDate(value) !== null;
}

/** Days since the Unix epoch, treating the date as UTC midnight. */
export function toEpochDay(value: string): number | null {
  const parts = parseIsoDate(value);
  if (!parts) return null;
  return Date.UTC(parts.year, parts.month - 1, parts.day) / MS_PER_DAY;
}

/** The user's *local* calendar date, which is what "today" means to them. */
export function todayIso(now: Date = new Date()): IsoDate {
  const year = String(now.getFullYear()).padStart(4, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Whole calendar days from `from` to `to`; negative if `to` is earlier. */
export function diffCalendarDays(from: string, to: string): number | null {
  const a = toEpochDay(from);
  const b = toEpochDay(to);
  if (a === null || b === null) return null;
  return b - a;
}

export function addDays(value: string, days: number): IsoDate | null {
  const epochDay = toEpochDay(value);
  if (epochDay === null) return null;
  const shifted = new Date((epochDay + days) * MS_PER_DAY);
  const year = String(shifted.getUTCFullYear()).padStart(4, '0');
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Unix epoch *seconds*, the unit every timestamp column in the schema uses. */
export function nowEpochSeconds(now: Date = new Date()): number {
  return Math.floor(now.getTime() / 1000);
}

/** ISO date for an epoch-seconds timestamp, in local time. */
export function epochSecondsToIsoDate(epochSeconds: number): IsoDate {
  return todayIso(new Date(epochSeconds * 1000));
}
