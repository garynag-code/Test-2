/**
 * Weekly progress maths (brief §25, Sprint 4).
 *
 * Pure: callers hand in occurrences already resolved to family-local dates, so
 * nothing here needs to know about timezones.
 */

import { type LocalDate, daysBetween, endOfWeek, startOfWeek } from './dates';

export type OccurrenceOutcome =
  'OPEN' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'MISSED' | 'SKIPPED';

export interface OccurrenceSummary {
  date: LocalDate;
  status: OccurrenceOutcome;
}

export interface WeekSummary {
  weekStart: LocalDate;
  weekEnd: LocalDate;
  total: number;
  approved: number;
  /** True only for a week that has ended with every occurrence approved. */
  perfect: boolean;
}

/**
 * Groups occurrences into Monday-based weeks.
 *
 * A week counts as perfect only once it is fully in the past: awarding "Perfect
 * Week" on a Monday morning because the day's one task is done would cheapen
 * it, and the child would have no way to understand why it appeared.
 */
export function summariseWeeks(
  occurrences: readonly OccurrenceSummary[],
  today: LocalDate,
): WeekSummary[] {
  const byWeek = new Map<LocalDate, OccurrenceSummary[]>();

  for (const occurrence of occurrences) {
    const weekStart = startOfWeek(occurrence.date);
    const bucket = byWeek.get(weekStart);
    if (bucket) bucket.push(occurrence);
    else byWeek.set(weekStart, [occurrence]);
  }

  return [...byWeek.entries()]
    .map(([weekStart, items]) => {
      const approved = items.filter((item) => item.status === 'APPROVED').length;
      const weekEnd = endOfWeek(weekStart);
      const weekHasEnded = daysBetween(weekEnd, today) > 0;
      return {
        weekStart,
        weekEnd,
        total: items.length,
        approved,
        perfect: weekHasEnded && items.length > 0 && approved === items.length,
      } satisfies WeekSummary;
    })
    .sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
}

export function countPerfectWeeks(
  occurrences: readonly OccurrenceSummary[],
  today: LocalDate,
): number {
  return summariseWeeks(occurrences, today).filter((week) => week.perfect).length;
}

export interface CurrentWeek {
  weekStart: LocalDate;
  weekEnd: LocalDate;
  completed: number;
  /** Occurrences actually scheduled this week — the honest denominator. */
  scheduled: number;
  /** The family's aspiration, which may exceed what is scheduled. */
  target: number;
  remaining: number;
  onTrack: boolean;
}

/**
 * The weekly quest widget.
 *
 * The target is what is actually scheduled this week, not the family's goal.
 * A bar a child cannot fill however hard they work is demotivating, and the
 * family goal is an aspiration for *configuring tasks* rather than a number to
 * stare at. The goal is only used as a fallback so a week with nothing
 * scheduled does not render as 0 / 0.
 */
export function currentWeek(
  occurrences: readonly OccurrenceSummary[],
  today: LocalDate,
  familyTarget: number,
): CurrentWeek {
  const weekStart = startOfWeek(today);
  const weekEnd = endOfWeek(today);
  const thisWeek = occurrences.filter((item) => startOfWeek(item.date) === weekStart);

  const completed = thisWeek.filter((item) => item.status === 'APPROVED').length;
  const scheduled = thisWeek.length;
  const target = scheduled > 0 ? scheduled : Math.max(0, familyTarget);
  // Days already finished, so Monday morning is never "behind".
  const daysElapsed = Math.max(0, daysBetween(weekStart, today));

  return {
    weekStart,
    weekEnd,
    completed,
    scheduled,
    target,
    remaining: Math.max(0, target - completed),
    onTrack: completed >= Math.floor((target * daysElapsed) / 7),
  };
}
