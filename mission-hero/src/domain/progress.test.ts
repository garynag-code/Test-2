import { describe, expect, it } from 'vitest';
import { countPerfectWeeks, currentWeek, summariseWeeks, type OccurrenceSummary } from './progress';

/** Weekly progress maths (Sprint 4). 2026-09-21 is a Monday. */

const week1 = (status: OccurrenceSummary['status'] = 'APPROVED'): OccurrenceSummary[] =>
  ['2026-09-14', '2026-09-15', '2026-09-16'].map((date) => ({ date, status }));

describe('summariseWeeks', () => {
  it('groups occurrences into Monday-based weeks', () => {
    const weeks = summariseWeeks(
      [
        { date: '2026-09-20', status: 'APPROVED' }, // Sunday — belongs to the week starting the 14th
        { date: '2026-09-21', status: 'APPROVED' }, // Monday — a new week
      ],
      '2026-10-05',
    );

    expect(weeks.map((w) => w.weekStart)).toEqual(['2026-09-14', '2026-09-21']);
  });

  it('counts approved occurrences per week', () => {
    const weeks = summariseWeeks(
      [
        { date: '2026-09-14', status: 'APPROVED' },
        { date: '2026-09-15', status: 'APPROVED' },
        { date: '2026-09-16', status: 'MISSED' },
      ],
      '2026-10-05',
    );

    expect(weeks[0]).toMatchObject({ total: 3, approved: 2, perfect: false });
  });

  it('returns nothing for a child with no history', () => {
    expect(summariseWeeks([], '2026-09-21')).toEqual([]);
  });
});

describe('countPerfectWeeks', () => {
  it('counts a finished week where every occurrence was approved', () => {
    expect(countPerfectWeeks(week1(), '2026-09-28')).toBe(1);
  });

  it('does not count a week with anything unapproved', () => {
    const mixed: OccurrenceSummary[] = [
      { date: '2026-09-14', status: 'APPROVED' },
      { date: '2026-09-15', status: 'SUBMITTED' },
    ];
    expect(countPerfectWeeks(mixed, '2026-09-28')).toBe(0);
  });

  it('will not award a perfect week that is still running', () => {
    // Every occurrence so far is approved, but the week has not ended.
    const thisWeek: OccurrenceSummary[] = [
      { date: '2026-09-21', status: 'APPROVED' },
      { date: '2026-09-22', status: 'APPROVED' },
    ];
    expect(countPerfectWeeks(thisWeek, '2026-09-22')).toBe(0);

    // Once the week is over, it counts.
    expect(countPerfectWeeks(thisWeek, '2026-09-28')).toBe(1);
  });

  it('does not count an empty week as perfect', () => {
    expect(countPerfectWeeks([], '2026-09-28')).toBe(0);
  });

  it('counts several perfect weeks independently', () => {
    const occurrences: OccurrenceSummary[] = [
      { date: '2026-09-07', status: 'APPROVED' },
      { date: '2026-09-14', status: 'APPROVED' },
      { date: '2026-09-15', status: 'REJECTED' },
      { date: '2026-09-21', status: 'APPROVED' },
    ];
    expect(countPerfectWeeks(occurrences, '2026-10-05')).toBe(2);
  });
});

describe('currentWeek', () => {
  const thisWeek: OccurrenceSummary[] = [
    { date: '2026-09-21', status: 'APPROVED' },
    { date: '2026-09-22', status: 'APPROVED' },
    { date: '2026-09-23', status: 'OPEN' },
    { date: '2026-09-14', status: 'APPROVED' }, // last week, must be ignored
  ];

  it('counts only this week', () => {
    const week = currentWeek(thisWeek, '2026-09-23', 10);
    expect(week.weekStart).toBe('2026-09-21');
    expect(week.weekEnd).toBe('2026-09-27');
    expect(week.completed).toBe(2);
    expect(week.scheduled).toBe(3);
  });

  it('sets a target the child can actually reach', () => {
    // Three scheduled, family goal of 25: a bar to 25 could never fill.
    expect(currentWeek(thisWeek, '2026-09-23', 25).target).toBe(3);
    expect(currentWeek(thisWeek, '2026-09-23', 1).target).toBe(3);
  });

  it('falls back to the family goal when nothing is scheduled', () => {
    const week = currentWeek([], '2026-09-23', 25);
    expect(week.scheduled).toBe(0);
    expect(week.target).toBe(25);
  });

  it('reports remaining without ever going negative', () => {
    const allDone: OccurrenceSummary[] = [
      { date: '2026-09-21', status: 'APPROVED' },
      { date: '2026-09-22', status: 'APPROVED' },
    ];
    expect(currentWeek(allDone, '2026-09-23', 25).remaining).toBe(0);
  });

  it('pro-rates "on track" against the days already finished', () => {
    // A mission every day of the week, judged on Wednesday: two days are done,
    // so two approvals keep you on track.
    const week = (approvedDays: number): OccurrenceSummary[] =>
      Array.from({ length: 7 }, (_, i) => ({
        date: `2026-09-${21 + i}`,
        status: i < approvedDays ? ('APPROVED' as const) : ('OPEN' as const),
      }));

    expect(currentWeek(week(3), '2026-09-23', 25).onTrack).toBe(true);
    expect(currentWeek(week(2), '2026-09-23', 25).onTrack).toBe(true);
    expect(currentWeek(week(1), '2026-09-23', 25).onTrack).toBe(false);
  });

  it('treats a fresh week with nothing done as on track on Monday', () => {
    const week = currentWeek([{ date: '2026-09-21', status: 'OPEN' }], '2026-09-21', 7);
    expect(week.completed).toBe(0);
    expect(week.onTrack).toBe(true);
  });
});
