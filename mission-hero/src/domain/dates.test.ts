import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  eachDay,
  endOfWeek,
  fixedClock,
  isLocalDate,
  isWeekend,
  localDateToUtcDate,
  startOfWeek,
  toLocalDate,
  utcDateToLocalDate,
  weekdayOf,
} from './dates';

describe('local date validation', () => {
  it('accepts well-formed dates', () => {
    expect(isLocalDate('2026-02-28')).toBe(true);
    expect(isLocalDate('2024-02-29')).toBe(true); // leap year
  });

  it('rejects impossible and malformed dates', () => {
    expect(isLocalDate('2026-02-30')).toBe(false);
    expect(isLocalDate('2025-02-29')).toBe(false);
    expect(isLocalDate('2026-13-01')).toBe(false);
    expect(isLocalDate('26-01-01')).toBe(false);
    expect(isLocalDate('not-a-date')).toBe(false);
  });
});

describe('toLocalDate (BR-18)', () => {
  it('resolves an instant to the family timezone, not the server one', () => {
    // 23:30 UTC is already the next day in Johannesburg (+02:00).
    const instant = new Date('2026-03-10T23:30:00.000Z');
    expect(toLocalDate(instant, 'UTC')).toBe('2026-03-10');
    expect(toLocalDate(instant, 'Africa/Johannesburg')).toBe('2026-03-11');
    expect(toLocalDate(instant, 'America/New_York')).toBe('2026-03-10');
  });

  it('handles a timezone behind UTC crossing back a day', () => {
    const instant = new Date('2026-03-11T02:00:00.000Z');
    expect(toLocalDate(instant, 'America/Los_Angeles')).toBe('2026-03-10');
  });

  it('is stable across a DST transition', () => {
    // US DST begins 2026-03-08. Local midnight-ish on either side must land on
    // the correct calendar day.
    expect(toLocalDate(new Date('2026-03-08T06:30:00.000Z'), 'America/New_York')).toBe('2026-03-08');
    expect(toLocalDate(new Date('2026-03-09T03:30:00.000Z'), 'America/New_York')).toBe('2026-03-08');
  });
});

describe('date arithmetic', () => {
  it('adds and subtracts days across month and year boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
  });

  it('measures whole days in both directions', () => {
    expect(daysBetween('2026-01-01', '2026-01-08')).toBe(7);
    expect(daysBetween('2026-01-08', '2026-01-01')).toBe(-7);
    expect(daysBetween('2026-01-01', '2026-01-01')).toBe(0);
  });

  it('round-trips through a UTC Date without drifting', () => {
    expect(utcDateToLocalDate(localDateToUtcDate('2026-06-15'))).toBe('2026-06-15');
  });

  it('identifies weekdays with 0 = Sunday (BR-19)', () => {
    expect(weekdayOf('2026-09-20')).toBe(0); // Sunday
    expect(weekdayOf('2026-09-21')).toBe(1); // Monday
    expect(isWeekend('2026-09-19')).toBe(true); // Saturday
    expect(isWeekend('2026-09-21')).toBe(false);
  });

  it('uses Monday-based weeks', () => {
    expect(startOfWeek('2026-09-23')).toBe('2026-09-21');
    expect(startOfWeek('2026-09-20')).toBe('2026-09-14'); // Sunday belongs to the week just ending
    expect(endOfWeek('2026-09-23')).toBe('2026-09-27');
  });

  it('enumerates inclusive ranges', () => {
    expect(eachDay('2026-01-01', '2026-01-03')).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
    expect(eachDay('2026-01-01', '2026-01-01')).toHaveLength(1);
  });
});

describe('fixedClock', () => {
  it('returns the same instant every call and cannot be mutated by callers', () => {
    const clock = fixedClock('2026-09-21T10:00:00.000Z');
    const first = clock.now();
    first.setFullYear(1999);
    expect(clock.now().toISOString()).toBe('2026-09-21T10:00:00.000Z');
  });
});
