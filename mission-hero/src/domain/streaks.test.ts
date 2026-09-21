import { describe, expect, it } from 'vitest';
import {
  EMPTY_STREAK,
  effectiveStreakCount,
  nextMilestone,
  recordStreakActivity,
  type StreakOutcome,
} from './streaks';

describe('recordStreakActivity (BR-38)', () => {
  it('starts a streak at 1', () => {
    const result = recordStreakActivity(EMPTY_STREAK, '2026-09-21');
    expect(result.currentCount).toBe(1);
    expect(result.longestCount).toBe(1);
    expect(result.startedDate).toBe('2026-09-21');
    expect(result.changed).toBe(true);
    expect(result.restarted).toBe(false);
  });

  it('increments on a consecutive day', () => {
    let state = recordStreakActivity(EMPTY_STREAK, '2026-09-21');
    state = recordStreakActivity(state, '2026-09-22');
    state = recordStreakActivity(state, '2026-09-23');
    expect(state.currentCount).toBe(3);
    expect(state.startedDate).toBe('2026-09-21');
  });

  it('is a no-op when the same day is recorded twice', () => {
    const first = recordStreakActivity(EMPTY_STREAK, '2026-09-21');
    const second = recordStreakActivity(first, '2026-09-21');
    expect(second.currentCount).toBe(1);
    expect(second.changed).toBe(false);
  });

  it('restarts at 1 after a gap, without any penalty (BR-40)', () => {
    let state = EMPTY_STREAK;
    for (const date of ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']) {
      state = recordStreakActivity(state, date);
    }
    expect(state.currentCount).toBe(4);

    const afterGap = recordStreakActivity(state, '2026-09-10');
    expect(afterGap.currentCount).toBe(1);
    expect(afterGap.restarted).toBe(true);
    // BR-39: the best is remembered so the child has something to aim at.
    expect(afterGap.longestCount).toBe(4);
  });

  it('never rewinds when an older date arrives late', () => {
    const state = recordStreakActivity(EMPTY_STREAK, '2026-09-21');
    const stale = recordStreakActivity(state, '2026-09-19');
    expect(stale.currentCount).toBe(1);
    expect(stale.lastActivityDate).toBe('2026-09-21');
    expect(stale.changed).toBe(false);
  });

  it('keeps longestCount monotonic across any sequence (BR-39)', () => {
    let state: StreakOutcome = recordStreakActivity(EMPTY_STREAK, '2026-09-01');
    let best = state.longestCount;
    const days = ['2026-09-02', '2026-09-05', '2026-09-06', '2026-09-07', '2026-09-07', '2026-09-20'];
    for (const date of days) {
      state = recordStreakActivity(state, date);
      expect(state.longestCount).toBeGreaterThanOrEqual(best);
      best = state.longestCount;
    }
    expect(state.longestCount).toBe(3);
  });

  it('reports the milestone reached by this activity, and only on that day', () => {
    const milestones: (number | null)[] = [];
    let state: StreakOutcome = recordStreakActivity(EMPTY_STREAK, '2026-09-01');
    milestones.push(state.milestoneReached);
    for (let day = 2; day <= 7; day += 1) {
      state = recordStreakActivity(state, `2026-09-0${day}`);
      milestones.push(state.milestoneReached);
    }
    // Only days 3 and 7 are milestones; the rest celebrate nothing extra.
    expect(milestones).toEqual([null, null, 3, null, null, null, 7]);
  });
});

describe('effectiveStreakCount', () => {
  it('still counts a streak whose last activity was yesterday', () => {
    const state = { currentCount: 5, longestCount: 5, lastActivityDate: '2026-09-20', startedDate: '2026-09-16' };
    expect(effectiveStreakCount(state, '2026-09-21')).toBe(5);
  });

  it('shows zero once a day has been skipped, without writing anything', () => {
    const state = { currentCount: 5, longestCount: 5, lastActivityDate: '2026-09-19', startedDate: '2026-09-15' };
    expect(effectiveStreakCount(state, '2026-09-21')).toBe(0);
  });

  it('is zero for a child who has never acted', () => {
    expect(effectiveStreakCount(EMPTY_STREAK, '2026-09-21')).toBe(0);
  });
});

describe('nextMilestone', () => {
  it('points at the next target', () => {
    expect(nextMilestone(0)).toBe(3);
    expect(nextMilestone(3)).toBe(7);
    expect(nextMilestone(99)).toBe(100);
    expect(nextMilestone(100)).toBeNull();
  });
});
