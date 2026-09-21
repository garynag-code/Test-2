/**
 * Achievement rules (BR-37).
 *
 * Each rule is a pure predicate over a snapshot of the child's totals, so
 * evaluation is cheap enough to run inside the same transaction as the award
 * that might have triggered it.
 */

export interface AchievementSnapshot {
  lifetimeXp: number;
  rewardPoints: number;
  totalStars: number;
  starsByTrait: Record<string, number>;
  approvedTaskCount: number;
  approvedTaskCountByCategory: Record<string, number>;
  longestStreak: number;
  currentStreak: number;
  level: number;
  memoryApprovedCount: number;
  secretMissionsCompleted: number;
  wheelSpins: number;
  perfectWeeks: number;
}

export type AchievementRuleType =
  | 'FIRST_TASK'
  | 'TASK_COUNT'
  | 'TASK_CATEGORY_COUNT'
  | 'LIFETIME_XP'
  | 'STAR_COUNT'
  | 'TRAIT_STAR_COUNT'
  | 'STREAK_DAYS'
  | 'LEVEL_REACHED'
  | 'MEMORY_COUNT'
  | 'SECRET_MISSION_COUNT'
  | 'FIRST_WHEEL_SPIN'
  | 'PERFECT_WEEK';

export interface AchievementRule {
  type: AchievementRuleType;
  threshold?: number;
  category?: string;
  traitKey?: string;
}

type Predicate = (snapshot: AchievementSnapshot, rule: AchievementRule) => boolean;

const atLeast = (value: number, rule: AchievementRule): boolean => value >= (rule.threshold ?? 1);

const RULES: Record<AchievementRuleType, Predicate> = {
  FIRST_TASK: (s) => s.approvedTaskCount >= 1,
  TASK_COUNT: (s, r) => atLeast(s.approvedTaskCount, r),
  TASK_CATEGORY_COUNT: (s, r) => atLeast(s.approvedTaskCountByCategory[r.category ?? ''] ?? 0, r),
  LIFETIME_XP: (s, r) => atLeast(s.lifetimeXp, r),
  STAR_COUNT: (s, r) => atLeast(s.totalStars, r),
  TRAIT_STAR_COUNT: (s, r) => atLeast(s.starsByTrait[r.traitKey ?? ''] ?? 0, r),
  STREAK_DAYS: (s, r) => atLeast(Math.max(s.currentStreak, s.longestStreak), r),
  LEVEL_REACHED: (s, r) => atLeast(s.level, r),
  MEMORY_COUNT: (s, r) => atLeast(s.memoryApprovedCount, r),
  SECRET_MISSION_COUNT: (s, r) => atLeast(s.secretMissionsCompleted, r),
  FIRST_WHEEL_SPIN: (s) => s.wheelSpins >= 1,
  PERFECT_WEEK: (s, r) => atLeast(s.perfectWeeks, r),
};

export function isAchievementRuleType(value: string): value is AchievementRuleType {
  return value in RULES;
}

/** Unknown rule types never unlock — a typo in seed data must not hand out XP. */
export function evaluateAchievement(
  ruleType: string,
  ruleConfig: unknown,
  snapshot: AchievementSnapshot,
): boolean {
  if (!isAchievementRuleType(ruleType)) return false;
  const config = (ruleConfig ?? {}) as Omit<AchievementRule, 'type'>;
  return RULES[ruleType](snapshot, { type: ruleType, ...config });
}

export interface AchievementDefinition {
  key: string;
  name: string;
  description: string;
  iconKey: string;
  ruleType: AchievementRuleType;
  ruleConfig: Record<string, unknown>;
  xpValue: number;
}

/** Seeded into every family (brief §24). Parents may add their own. */
export const DEFAULT_ACHIEVEMENTS: readonly AchievementDefinition[] = [
  {
    key: 'first-mission',
    name: 'First Mission',
    description: 'You completed your very first mission.',
    iconKey: 'rocket',
    ruleType: 'FIRST_TASK',
    ruleConfig: {},
    xpValue: 10,
  },
  {
    key: 'first-100-xp',
    name: 'First 100 XP',
    description: 'You earned your first 100 XP.',
    iconKey: 'zap',
    ruleType: 'LIFETIME_XP',
    ruleConfig: { threshold: 100 },
    xpValue: 10,
  },
  {
    key: 'streak-7',
    name: '7 Day Streak',
    description: 'Seven days of showing up.',
    iconKey: 'flame',
    ruleType: 'STREAK_DAYS',
    ruleConfig: { threshold: 7 },
    xpValue: 25,
  },
  {
    key: 'reading-champion',
    name: 'Reading Champion',
    description: 'Twenty reading missions done.',
    iconKey: 'book',
    ruleType: 'TASK_CATEGORY_COUNT',
    ruleConfig: { category: 'learning', threshold: 20 },
    xpValue: 30,
  },
  {
    key: 'helping-hero',
    name: 'Helping Hero',
    description: 'Ten helpfulness moments confirmed.',
    iconKey: 'hands',
    ruleType: 'TRAIT_STAR_COUNT',
    ruleConfig: { traitKey: 'helpfulness', threshold: 10 },
    xpValue: 25,
  },
  {
    key: 'memory-master',
    name: 'Memory Master',
    description: 'Ten things learned by heart.',
    iconKey: 'brain',
    ruleType: 'MEMORY_COUNT',
    ruleConfig: { threshold: 10 },
    xpValue: 30,
  },
  {
    key: 'perfect-week',
    name: 'Perfect Week',
    description: 'A whole week of missions complete.',
    iconKey: 'calendar',
    ruleType: 'PERFECT_WEEK',
    ruleConfig: { threshold: 1 },
    xpValue: 40,
  },
  {
    key: 'hundred-missions',
    name: '100 Missions Complete',
    description: 'One hundred missions. Incredible.',
    iconKey: 'target',
    ruleType: 'TASK_COUNT',
    ruleConfig: { threshold: 100 },
    xpValue: 75,
  },
  {
    key: 'kindness-hero',
    name: 'Kindness Hero',
    description: 'Fifteen kindness moments confirmed.',
    iconKey: 'heart',
    ruleType: 'TRAIT_STAR_COUNT',
    ruleConfig: { traitKey: 'kindness', threshold: 15 },
    xpValue: 30,
  },
  {
    key: 'secret-hunter',
    name: 'Secret Mission Hunter',
    description: 'Five secret missions completed.',
    iconKey: 'compass',
    ruleType: 'SECRET_MISSION_COUNT',
    ruleConfig: { threshold: 5 },
    xpValue: 25,
  },
  {
    key: 'first-spin',
    name: 'First Wheel Spin',
    description: 'You earned your first spin.',
    iconKey: 'disc',
    ruleType: 'FIRST_WHEEL_SPIN',
    ruleConfig: {},
    xpValue: 10,
  },
  {
    key: 'level-10',
    name: 'Level 10',
    description: 'You reached Mission Master.',
    iconKey: 'trophy',
    ruleType: 'LEVEL_REACHED',
    ruleConfig: { threshold: 10 },
    xpValue: 100,
  },
] as const;
