/**
 * Character badge tiers (brief §9, BR-35).
 */

import { CHARACTER_BADGE_THRESHOLDS } from './constants';

export type BadgeTier = 'BRONZE' | 'SILVER' | 'GOLD' | 'DIAMOND';

export const BADGE_TIERS: readonly BadgeTier[] = ['BRONZE', 'SILVER', 'GOLD', 'DIAMOND'];

export function thresholdFor(tier: BadgeTier): number {
  return CHARACTER_BADGE_THRESHOLDS[tier];
}

/** The tiers a count newly satisfies, given what is already unlocked. */
export function tiersUnlockedBy(count: number, alreadyUnlocked: readonly BadgeTier[]): BadgeTier[] {
  return BADGE_TIERS.filter(
    (tier) => count >= thresholdFor(tier) && !alreadyUnlocked.includes(tier),
  );
}

export function highestTier(count: number): BadgeTier | null {
  let best: BadgeTier | null = null;
  for (const tier of BADGE_TIERS) if (count >= thresholdFor(tier)) best = tier;
  return best;
}

export interface BadgeProgress {
  currentTier: BadgeTier | null;
  nextTier: BadgeTier | null;
  count: number;
  remaining: number;
}

export function badgeProgress(count: number): BadgeProgress {
  const currentTier = highestTier(count);
  const nextTier = BADGE_TIERS.find((tier) => count < thresholdFor(tier)) ?? null;
  return {
    currentTier,
    nextTier,
    count,
    remaining: nextTier ? thresholdFor(nextTier) - count : 0,
  };
}

/** Default badge names per trait (brief §9). Families may add their own. */
export const DEFAULT_CHARACTER_BADGE_NAMES: Record<string, string> = {
  kindness: 'Kindness Hero',
  honesty: 'Truth Teller',
  helpfulness: 'Helping Hand',
  peacemaking: 'Peacemaker',
  courage: 'Brave Heart',
  gratitude: 'Gratitude Champion',
  perseverance: 'Never Give Up',
  listening: 'Great Listener',
  'self-control': 'Self Control Superstar',
  encouragement: 'Encourager',
  responsibility: 'Responsibility Hero',
  generosity: 'Generous Heart',
  respect: 'Respect Champion',
  forgiveness: 'Forgiving Heart',
  patience: 'Patience Master',
  humility: 'Humble Hero',
  teamwork: 'Team Player',
  integrity: 'Integrity Hero',
};
