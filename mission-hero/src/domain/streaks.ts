/**
 * Streak arithmetic (BR-38 … BR-40).
 *
 * The product rule that matters most here is the *absence* of a penalty: a
 * broken streak simply starts again at 1, and the longest count never falls.
 */

import { type LocalDate, daysBetween } from './dates';
import { STREAK_MILESTONES } from './constants';

export interface StreakState {
  currentCount: number;
  longestCount: number;
  lastActivityDate: LocalDate | null;
  startedDate: LocalDate | null;
}

export interface StreakOutcome extends StreakState {
  /** False when the activity happened again on a day already counted. */
  changed: boolean;
  /** True when the gap was larger than a day and the count restarted. */
  restarted: boolean;
  /** A milestone reached by *this* activity, if any — drives the celebration. */
  milestoneReached: number | null;
}

export const EMPTY_STREAK: StreakState = {
  currentCount: 0,
  longestCount: 0,
  lastActivityDate: null,
  startedDate: null,
};

/**
 * Applies one day's qualifying activity.
 *
 * - same day as the last activity → no change (BR-38)
 * - exactly one day later → increment
 * - any larger gap, or a first activity → restart at 1
 * - a date *before* the last activity is ignored; streaks never rewind
 */
export function recordStreakActivity(state: StreakState, date: LocalDate): StreakOutcome {
  const unchanged = (overrides: Partial<StreakOutcome> = {}): StreakOutcome => ({
    ...state,
    changed: false,
    restarted: false,
    milestoneReached: null,
    ...overrides,
  });

  if (state.lastActivityDate) {
    const gap = daysBetween(state.lastActivityDate, date);
    if (gap <= 0) return unchanged();

    if (gap === 1) {
      const currentCount = state.currentCount + 1;
      return {
        currentCount,
        longestCount: Math.max(state.longestCount, currentCount),
        lastActivityDate: date,
        startedDate: state.startedDate,
        changed: true,
        restarted: false,
        milestoneReached: milestoneFor(currentCount),
      };
    }
  }

  return {
    currentCount: 1,
    longestCount: Math.max(state.longestCount, 1),
    lastActivityDate: date,
    startedDate: date,
    changed: true,
    restarted: state.lastActivityDate !== null,
    milestoneReached: milestoneFor(1),
  };
}

/**
 * The count a streak would show *today* — a streak whose last activity is older
 * than yesterday is already over, even though nothing has written to it.
 */
export function effectiveStreakCount(state: StreakState, today: LocalDate): number {
  if (!state.lastActivityDate) return 0;
  const gap = daysBetween(state.lastActivityDate, today);
  return gap <= 1 ? state.currentCount : 0;
}

export function milestoneFor(count: number): number | null {
  return STREAK_MILESTONES.includes(count as (typeof STREAK_MILESTONES)[number]) ? count : null;
}

export function nextMilestone(count: number): number | null {
  return STREAK_MILESTONES.find((m) => m > count) ?? null;
}
