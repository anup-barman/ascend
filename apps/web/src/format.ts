/** Presentation helpers. */

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function weekdayName(weekday: number): string {
  return WEEKDAY_NAMES[weekday] ?? '?';
}

/**
 * "2 hours ago" (spec §2 — the last-synchronized display).
 * Returns "never" for null, which is the honest state before any sync.
 */
export function relativeTime(epochSeconds: number | null): string {
  if (epochSeconds === null) return 'never';

  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - epochSeconds);
  if (seconds < 45) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? 'day' : 'days'} ago`;

  const months = Math.round(days / 30);
  return `${months} ${months === 1 ? 'month' : 'months'} ago`;
}

/** `120` → `2h`, `45` → `45m`, `0` → `rest day`. */
export function formatMinutes(minutes: number): string {
  if (minutes <= 0) return 'rest day';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
}

/** `2027-01-18` → `18 Jan 2027`, without pulling in a date library. */
export function formatIsoDate(iso: string): string {
  const parts = iso.split('-');
  const [year, month, day] = parts;
  if (year === undefined || month === undefined || day === undefined) return iso;

  const monthNames = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const name = monthNames[Number(month) - 1] ?? month;
  return `${Number(day)} ${name} ${year}`;
}

/** Turns `SKILL_BUILDING` into `Skill Building` for display. */
export function humanizeConstant(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((word) => (word.length > 0 ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(' ');
}
