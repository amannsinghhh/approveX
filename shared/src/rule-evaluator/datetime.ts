/**
 * Timezone-aware date parts, used by the date/time operators (B.1/B.2). All
 * comparisons store and reason in UTC epoch ms, but calendar-sensitive checks
 * (same day, day-of-week, time-of-day) must resolve in the tenant's timezone.
 * Intl.DateTimeFormat is available in Node and the browser, so no dependency.
 */

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  weekday: number; // 0 = Sunday .. 6 = Saturday
  minutesOfDay: number; // 0-1439, local wall-clock
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Cache formatters per timezone — constructing them is comparatively costly. */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let dtf = formatterCache.get(timezone);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      weekday: 'short',
    });
    formatterCache.set(timezone, dtf);
  }
  return dtf;
}

/** Breaks an epoch-ms instant into calendar parts in the given timezone. */
export function zonedParts(epochMs: number, timezone: string): ZonedParts {
  const parts = formatterFor(timezone).formatToParts(new Date(epochMs));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';

  // hour12:false can yield "24" at midnight in some engines — normalize to 0.
  let hour = Number(get('hour'));
  if (hour === 24) hour = 0;
  const minute = Number(get('minute'));

  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    weekday: WEEKDAY_INDEX[get('weekday')] ?? 0,
    minutesOfDay: hour * 60 + minute,
  };
}

/** True when two instants fall on the same calendar day in the timezone. */
export function sameZonedDay(a: number, b: number, timezone: string): boolean {
  const pa = zonedParts(a, timezone);
  const pb = zonedParts(b, timezone);
  return pa.year === pb.year && pa.month === pb.month && pa.day === pb.day;
}

/** Parses "HH:MM" to minutes-of-day, or null if malformed. */
export function parseClock(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/** Normalizes a DAY_OF_WEEK_IN entry (name or 0-6) to a weekday index. */
export function normalizeWeekday(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 && value <= 6 ? value : null;
  }
  if (typeof value === 'string') {
    const key = value.slice(0, 3).toLowerCase();
    const index = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(key);
    return index === -1 ? null : index;
  }
  return null;
}
