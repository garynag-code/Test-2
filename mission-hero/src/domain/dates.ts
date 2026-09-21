/**
 * Calendar-day helpers.
 *
 * Every "one per day" rule in Mission Hero is evaluated in the *family's*
 * timezone (BR-18), never the server's and never the browser's. A plain
 * `YYYY-MM-DD` string is the canonical representation of a local day; it is
 * unambiguous, sorts correctly, and maps straight onto a Postgres `date`.
 */

export type LocalDate = string; // YYYY-MM-DD

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isLocalDate(value: string): value is LocalDate {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  // Reject impossible days such as 2026-02-30.
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

export function assertLocalDate(value: string): LocalDate {
  if (!isLocalDate(value)) throw new Error(`Invalid local date: ${value}`);
  return value;
}

/** The calendar day an instant falls on, in the given IANA timezone. */
export function toLocalDate(instant: Date, timezone: string): LocalDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * A `Date` positioned at midnight UTC on the given local day.
 * Postgres `date` columns are timezone-less, so storing the day at UTC midnight
 * round-trips exactly through Prisma without drifting by a day.
 */
export function localDateToUtcDate(date: LocalDate): Date {
  return new Date(`${assertLocalDate(date)}T00:00:00.000Z`);
}

export function utcDateToLocalDate(value: Date): LocalDate {
  return value.toISOString().slice(0, 10) as LocalDate;
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const d = localDateToUtcDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return utcDateToLocalDate(d);
}

/** Whole days from `a` to `b`; negative when `b` precedes `a`. */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  const MS_PER_DAY = 86_400_000;
  return Math.round(
    (localDateToUtcDate(b).getTime() - localDateToUtcDate(a).getTime()) / MS_PER_DAY,
  );
}

/** 0 = Sunday … 6 = Saturday (BR-19). */
export function weekdayOf(date: LocalDate): number {
  return localDateToUtcDate(date).getUTCDay();
}

export function isWeekend(date: LocalDate): boolean {
  const day = weekdayOf(date);
  return day === 0 || day === 6;
}

/** Monday-based week start, matching how families read a "week". */
export function startOfWeek(date: LocalDate): LocalDate {
  const day = weekdayOf(date);
  const offset = day === 0 ? -6 : 1 - day;
  return addDays(date, offset);
}

export function endOfWeek(date: LocalDate): LocalDate {
  return addDays(startOfWeek(date), 6);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function eachDay(from: LocalDate, to: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  const span = daysBetween(from, to);
  for (let i = 0; i <= span; i += 1) out.push(addDays(from, i));
  return out;
}

/**
 * Time is injected rather than read from the ambient clock so every rule that
 * depends on "now" can be tested deterministically (docs/08 §8).
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export function fixedClock(instant: Date | string): Clock {
  const at = typeof instant === 'string' ? new Date(instant) : instant;
  return { now: () => new Date(at.getTime()) };
}
