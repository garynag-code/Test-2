/**
 * Unlock rules for digital collectibles and avatar items (brief §20, §21).
 *
 * Deliberately *not* driven by spendable points: a child who spends their
 * Reward Points on real-world rewards must not fall behind on the free digital
 * ones. Unlocks come from levels, achievements, character stars, streaks and
 * quests instead.
 */

import type { AchievementSnapshot } from './achievements';

export type UnlockRuleType =
  | 'ALWAYS'
  | 'LEVEL'
  | 'ACHIEVEMENT'
  | 'TOTAL_STARS'
  | 'TRAIT_STARS'
  | 'STREAK'
  | 'TASKS_COMPLETED'
  | 'SECRET_MISSIONS'
  | 'MEMORY_MASTERED';

export interface UnlockRule {
  type: UnlockRuleType;
  threshold?: number;
  traitKey?: string;
  achievementKey?: string;
}

export interface UnlockContext {
  snapshot: AchievementSnapshot;
  /** Keys of achievements the child has already unlocked. */
  unlockedAchievementKeys: readonly string[];
}

const atLeast = (value: number, rule: UnlockRule): boolean => value >= (rule.threshold ?? 1);

const RULES: Record<UnlockRuleType, (context: UnlockContext, rule: UnlockRule) => boolean> = {
  ALWAYS: () => true,
  LEVEL: ({ snapshot }, rule) => atLeast(snapshot.level, rule),
  ACHIEVEMENT: ({ unlockedAchievementKeys }, rule) =>
    Boolean(rule.achievementKey) && unlockedAchievementKeys.includes(rule.achievementKey!),
  TOTAL_STARS: ({ snapshot }, rule) => atLeast(snapshot.totalStars, rule),
  TRAIT_STARS: ({ snapshot }, rule) =>
    atLeast(snapshot.starsByTrait[rule.traitKey ?? ''] ?? 0, rule),
  STREAK: ({ snapshot }, rule) =>
    atLeast(Math.max(snapshot.currentStreak, snapshot.longestStreak), rule),
  TASKS_COMPLETED: ({ snapshot }, rule) => atLeast(snapshot.approvedTaskCount, rule),
  SECRET_MISSIONS: ({ snapshot }, rule) => atLeast(snapshot.secretMissionsCompleted, rule),
  MEMORY_MASTERED: ({ snapshot }, rule) => atLeast(snapshot.memoryApprovedCount, rule),
};

export function isUnlockRuleType(value: string): value is UnlockRuleType {
  return value in RULES;
}

/**
 * An unknown or malformed rule never unlocks. Seed data with a typo must not
 * hand out a collectible, and it must not crash the page either.
 */
export function evaluateUnlockRule(rule: unknown, context: UnlockContext): boolean {
  if (!rule || typeof rule !== 'object') return false;
  const candidate = rule as UnlockRule;
  if (typeof candidate.type !== 'string' || !isUnlockRuleType(candidate.type)) return false;
  return RULES[candidate.type](context, candidate);
}

/** Human-readable progress for a locked item — "3 more days to go". */
export function describeRule(rule: unknown): string {
  if (!rule || typeof rule !== 'object') return 'Keep going to unlock this.';
  const candidate = rule as UnlockRule;
  const n = candidate.threshold ?? 1;

  switch (candidate.type) {
    case 'ALWAYS':
      return 'Yours from the start.';
    case 'LEVEL':
      return `Reach level ${n}`;
    case 'ACHIEVEMENT':
      return 'Earn a special achievement';
    case 'TOTAL_STARS':
      return `Earn ${n} character stars`;
    case 'TRAIT_STARS':
      return `Earn ${n} ${candidate.traitKey ?? 'character'} stars`;
    case 'STREAK':
      return `Keep a ${n}-day streak`;
    case 'TASKS_COMPLETED':
      return `Complete ${n} missions`;
    case 'SECRET_MISSIONS':
      return `Finish ${n} quests`;
    case 'MEMORY_MASTERED':
      return `Learn ${n} things by heart`;
    default:
      return 'Keep going to unlock this.';
  }
}
