/**
 * Schedule expansion (BR-18 … BR-24).
 *
 * Pure, timezone-agnostic: callers hand in local dates already resolved in the
 * family's timezone, so this module never has to know about offsets or DST.
 */

import {
  type LocalDate,
  addDays,
  assertLocalDate,
  daysBetween,
  daysInMonth,
  eachDay,
  isWeekend,
  weekdayOf,
} from './dates';

export type Frequency =
  | 'ONE_TIME'
  | 'DAILY'
  | 'WEEKDAYS'
  | 'WEEKENDS'
  | 'SELECTED_DAYS'
  | 'WEEKLY'
  | 'MONTHLY'
  | 'QUARTERLY'
  | 'ANNUAL'
  | 'CUSTOM';

export interface ScheduleSpec {
  frequency: Frequency;
  /** Repeat every N periods. Must be ≥ 1 (enforced by a CHECK constraint too). */
  interval?: number;
  /** 0 = Sunday … 6 = Saturday. Used by SELECTED_DAYS and WEEKLY. */
  weekdays?: readonly number[];
  /** Day of month for MONTHLY / QUARTERLY / ANNUAL. Clamped to the month's length (BR-22). */
  monthDay?: number | null;
  /** 1–12, for ANNUAL. */
  month?: number | null;
  startDate: LocalDate;
  endDate?: LocalDate | null;
}

/** Safety valve: a range longer than this is a bug, not a schedule. */
const MAX_RANGE_DAYS = 366 * 3;

/**
 * Every date the schedule is due within `[from, to]`, ascending and unique.
 *
 * Dates outside `[startDate, endDate]` are never emitted (BR-21).
 */
export function expandSchedule(spec: ScheduleSpec, from: LocalDate, to: LocalDate): LocalDate[] {
  assertLocalDate(from);
  assertLocalDate(to);
  if (daysBetween(from, to) < 0) return [];
  if (daysBetween(from, to) > MAX_RANGE_DAYS) {
    throw new Error(`expandSchedule range too large: ${from}..${to}`);
  }

  const interval = Math.max(1, Math.floor(spec.interval ?? 1));
  const windowStart = laterOf(from, spec.startDate);
  const windowEnd = spec.endDate ? earlierOf(to, spec.endDate) : to;
  if (daysBetween(windowStart, windowEnd) < 0) return [];

  switch (spec.frequency) {
    case 'ONE_TIME':
      return within(spec.startDate, windowStart, windowEnd) ? [spec.startDate] : [];

    case 'DAILY':
      // interval > 1 means "every N days", counted from startDate.
      return eachDay(windowStart, windowEnd).filter(
        (d) => mod(daysBetween(spec.startDate, d), interval) === 0,
      );

    case 'WEEKDAYS':
      return eachDay(windowStart, windowEnd).filter((d) => !isWeekend(d));

    case 'WEEKENDS':
      return eachDay(windowStart, windowEnd).filter((d) => isWeekend(d));

    case 'SELECTED_DAYS':
    case 'WEEKLY': {
      const days = normaliseWeekdays(spec.weekdays, spec.startDate);
      if (days.length === 0) return [];
      return eachDay(windowStart, windowEnd).filter(
        (d) => days.includes(weekdayOf(d)) && mod(weeksSince(spec.startDate, d), interval) === 0,
      );
    }

    case 'MONTHLY':
      return monthlyDates(spec, windowStart, windowEnd, interval, 1);

    case 'QUARTERLY':
      return monthlyDates(spec, windowStart, windowEnd, interval, 3);

    case 'ANNUAL':
      return annualDates(spec, windowStart, windowEnd, interval);

    case 'CUSTOM':
      // CUSTOM is SELECTED_DAYS with an explicit interval; kept distinct so the
      // parent UI can present it differently without changing the maths.
      return expandSchedule({ ...spec, frequency: 'SELECTED_DAYS' }, from, to);

    default: {
      const exhaustive: never = spec.frequency;
      throw new Error(`Unsupported frequency: ${String(exhaustive)}`);
    }
  }
}

/** Whether a single date is due — cheaper than expanding a range of one. */
export function isDueOn(spec: ScheduleSpec, date: LocalDate): boolean {
  return expandSchedule(spec, date, date).length === 1;
}

/** The next due date strictly after `after`, or null within the lookahead window. */
export function nextDueDate(
  spec: ScheduleSpec,
  after: LocalDate,
  lookaheadDays = 366,
): LocalDate | null {
  const dates = expandSchedule(spec, addDays(after, 1), addDays(after, lookaheadDays));
  return dates[0] ?? null;
}

// --- helpers ---------------------------------------------------------------

function mod(value: number, m: number): number {
  return ((value % m) + m) % m;
}

function laterOf(a: LocalDate, b: LocalDate): LocalDate {
  return daysBetween(a, b) > 0 ? b : a;
}

function earlierOf(a: LocalDate, b: LocalDate): LocalDate {
  return daysBetween(a, b) < 0 ? b : a;
}

function within(date: LocalDate, from: LocalDate, to: LocalDate): boolean {
  return daysBetween(from, date) >= 0 && daysBetween(date, to) >= 0;
}

/** Falls back to the start date's own weekday, so a WEEKLY task always recurs. */
function normaliseWeekdays(weekdays: readonly number[] | undefined, startDate: LocalDate): number[] {
  const provided = (weekdays ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  if (provided.length > 0) return [...new Set(provided)].sort((a, b) => a - b);
  return [weekdayOf(startDate)];
}

/** Whole weeks between two dates, measured from the start date's week. */
function weeksSince(startDate: LocalDate, date: LocalDate): number {
  const startWeekMonday = mondayOf(startDate);
  const dateWeekMonday = mondayOf(date);
  return Math.round(daysBetween(startWeekMonday, dateWeekMonday) / 7);
}

function mondayOf(date: LocalDate): LocalDate {
  const day = weekdayOf(date);
  return addDays(date, day === 0 ? -6 : 1 - day);
}

function monthlyDates(
  spec: ScheduleSpec,
  from: LocalDate,
  to: LocalDate,
  interval: number,
  monthsPerPeriod: number,
): LocalDate[] {
  const [startYear, startMonth] = splitYm(spec.startDate);
  const targetDay = spec.monthDay ?? Number(spec.startDate.slice(8, 10));
  const step = interval * monthsPerPeriod;
  const out: LocalDate[] = [];

  const [fromYear, fromMonth] = splitYm(from);
  const [toYear, toMonth] = splitYm(to);
  const firstIndex = fromYear * 12 + (fromMonth - 1);
  const lastIndex = toYear * 12 + (toMonth - 1);
  const startIndex = startYear * 12 + (startMonth - 1);

  for (let idx = firstIndex; idx <= lastIndex; idx += 1) {
    if (idx < startIndex) continue;
    if (mod(idx - startIndex, step) !== 0) continue;
    const year = Math.floor(idx / 12);
    const month = (idx % 12) + 1;
    // BR-22: day 31 in a 30-day month becomes the last day of that month.
    const day = Math.min(targetDay, daysInMonth(year, month));
    const candidate = ymd(year, month, day);
    if (within(candidate, from, to)) out.push(candidate);
  }
  return out;
}

function annualDates(
  spec: ScheduleSpec,
  from: LocalDate,
  to: LocalDate,
  interval: number,
): LocalDate[] {
  const [startYear] = splitYm(spec.startDate);
  const month = spec.month ?? Number(spec.startDate.slice(5, 7));
  const targetDay = spec.monthDay ?? Number(spec.startDate.slice(8, 10));
  const out: LocalDate[] = [];

  for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year += 1) {
    if (year < startYear) continue;
    if (mod(year - startYear, interval) !== 0) continue;
    const day = Math.min(targetDay, daysInMonth(year, month));
    const candidate = ymd(year, month, day);
    if (within(candidate, from, to)) out.push(candidate);
  }
  return out;
}

function splitYm(date: LocalDate): [number, number] {
  return [Number(date.slice(0, 4)), Number(date.slice(5, 7))];
}

function ymd(year: number, month: number, day: number): LocalDate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
