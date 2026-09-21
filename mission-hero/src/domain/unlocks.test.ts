import { describe, expect, it } from 'vitest';
import { describeRule, evaluateUnlockRule, type UnlockContext } from './unlocks';
import type { AchievementSnapshot } from './achievements';

const snapshot: AchievementSnapshot = {
  lifetimeXp: 650,
  rewardPoints: 40,
  totalStars: 12,
  starsByTrait: { kindness: 7, honesty: 5 },
  approvedTaskCount: 30,
  approvedTaskCountByCategory: { learning: 12 },
  longestStreak: 9,
  currentStreak: 4,
  level: 4,
  memoryApprovedCount: 3,
  secretMissionsCompleted: 2,
  wheelSpins: 1,
  perfectWeeks: 1,
};

const context: UnlockContext = { snapshot, unlockedAchievementKeys: ['first-mission'] };

describe('evaluateUnlockRule', () => {
  it('unlocks on reaching a level', () => {
    expect(evaluateUnlockRule({ type: 'LEVEL', threshold: 4 }, context)).toBe(true);
    expect(evaluateUnlockRule({ type: 'LEVEL', threshold: 5 }, context)).toBe(false);
  });

  it('unlocks on a named achievement', () => {
    expect(
      evaluateUnlockRule({ type: 'ACHIEVEMENT', achievementKey: 'first-mission' }, context),
    ).toBe(true);
    expect(evaluateUnlockRule({ type: 'ACHIEVEMENT', achievementKey: 'level-10' }, context)).toBe(
      false,
    );
    // A rule naming no achievement can never be satisfied.
    expect(evaluateUnlockRule({ type: 'ACHIEVEMENT' }, context)).toBe(false);
  });

  it('unlocks on character stars, overall or per trait', () => {
    expect(evaluateUnlockRule({ type: 'TOTAL_STARS', threshold: 12 }, context)).toBe(true);
    expect(evaluateUnlockRule({ type: 'TOTAL_STARS', threshold: 13 }, context)).toBe(false);
    expect(
      evaluateUnlockRule({ type: 'TRAIT_STARS', traitKey: 'kindness', threshold: 7 }, context),
    ).toBe(true);
    expect(
      evaluateUnlockRule({ type: 'TRAIT_STARS', traitKey: 'courage', threshold: 1 }, context),
    ).toBe(false);
  });

  it('uses the best streak a child has ever held', () => {
    // Current is 4, longest is 9 — an unlock once earned is never taken back.
    expect(evaluateUnlockRule({ type: 'STREAK', threshold: 7 }, context)).toBe(true);
  });

  it('unlocks on missions, quests and memory', () => {
    expect(evaluateUnlockRule({ type: 'TASKS_COMPLETED', threshold: 30 }, context)).toBe(true);
    expect(evaluateUnlockRule({ type: 'SECRET_MISSIONS', threshold: 2 }, context)).toBe(true);
    expect(evaluateUnlockRule({ type: 'MEMORY_MASTERED', threshold: 5 }, context)).toBe(false);
  });

  it('never unlocks from a malformed or unknown rule', () => {
    expect(evaluateUnlockRule({ type: 'NONSENSE' }, context)).toBe(false);
    expect(evaluateUnlockRule({}, context)).toBe(false);
    expect(evaluateUnlockRule(null, context)).toBe(false);
    expect(evaluateUnlockRule('LEVEL', context)).toBe(false);
    expect(evaluateUnlockRule(42, context)).toBe(false);
  });

  it('has no rule type that depends on spendable points (brief §20)', () => {
    // Spending Reward Points on real rewards must never cost a child their
    // free digital unlocks.
    const spent: UnlockContext = {
      ...context,
      snapshot: { ...snapshot, rewardPoints: 0 },
    };
    expect(evaluateUnlockRule({ type: 'LEVEL', threshold: 4 }, spent)).toBe(true);
    expect(evaluateUnlockRule({ type: 'TOTAL_STARS', threshold: 12 }, spent)).toBe(true);
  });
});

describe('describeRule', () => {
  it('says what is still needed, in plain words', () => {
    expect(describeRule({ type: 'LEVEL', threshold: 5 })).toBe('Reach level 5');
    expect(describeRule({ type: 'STREAK', threshold: 7 })).toBe('Keep a 7-day streak');
    expect(describeRule({ type: 'ALWAYS' })).toBe('Yours from the start.');
  });

  it('never blames the child for not having it yet', () => {
    const descriptions = [
      describeRule({ type: 'LEVEL', threshold: 9 }),
      describeRule({ type: 'TOTAL_STARS', threshold: 50 }),
      describeRule({ type: 'NONSENSE' }),
      describeRule(null),
    ];
    for (const text of descriptions) {
      expect(text.toLowerCase()).not.toMatch(/fail|not enough|only|behind|missing/);
    }
  });
});
