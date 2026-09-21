import type { Db } from '@/server/db/prisma';
import { DEFAULT_TRAITS } from '@/domain/traits';
import { DEFAULT_LEVELS } from '@/domain/levels';
import { DEFAULT_ACHIEVEMENTS } from '@/domain/achievements';
import { BADGE_TIERS, DEFAULT_CHARACTER_BADGE_NAMES, thresholdFor } from '@/domain/badges';
import { DEFAULT_AVATAR_ITEMS, DEFAULT_COLLECTIBLES } from '@/domain/collectibles';

/**
 * Platform defaults are *cloned* into each family rather than shared.
 *
 * That is what lets a parent rename "Self Control", reorder the cards or add a
 * trait of their own without affecting anyone else — and it keeps the platform
 * free of any single worldview (brief, opening section).
 */

export const DEFAULT_TASK_CATEGORIES = [
  { key: 'morning', label: 'Morning', iconKey: 'sunrise', colorKey: 'xp' },
  { key: 'evening', label: 'Evening', iconKey: 'moon', colorKey: 'points' },
  { key: 'learning', label: 'Learning', iconKey: 'book', colorKey: 'brand' },
  { key: 'helping', label: 'Helping', iconKey: 'hands', colorKey: 'success' },
  { key: 'health', label: 'Health', iconKey: 'heart', colorKey: 'star' },
  { key: 'faith-values', label: 'Faith & Values', iconKey: 'sparkles', colorKey: 'accent' },
] as const;

export const DEFAULT_REWARD_CATEGORIES = [
  { key: 'treats', label: 'Treats', iconKey: 'ice-cream' },
  { key: 'screen-time', label: 'Screen Time', iconKey: 'gamepad' },
  { key: 'experiences', label: 'Experiences', iconKey: 'ticket' },
  { key: 'privileges', label: 'Privileges', iconKey: 'star' },
  { key: 'pocket-money', label: 'Pocket Money', iconKey: 'coins' },
] as const;

/**
 * Creates every default a family needs to be immediately playable — a parent
 * who stops after adding one child still gets traits, levels, badges and
 * achievements (docs/04 J1).
 */
export async function seedFamilyDefaults(db: Db, familyId: string): Promise<void> {
  await db.familySetting.create({ data: { familyId } });

  await db.taskCategory.createMany({
    data: DEFAULT_TASK_CATEGORIES.map((category, index) => ({
      familyId,
      ...category,
      sortOrder: index,
    })),
    skipDuplicates: true,
  });

  await db.rewardCategory.createMany({
    data: DEFAULT_REWARD_CATEGORIES.map((category, index) => ({
      familyId,
      ...category,
      sortOrder: index,
    })),
    skipDuplicates: true,
  });

  await db.level.createMany({
    data: DEFAULT_LEVELS.map((level) => ({ familyId, ...level })),
    skipDuplicates: true,
  });

  await db.characterTrait.createMany({
    data: DEFAULT_TRAITS.map((trait, index) => ({
      familyId,
      key: trait.key,
      label: trait.label,
      emoji: trait.emoji,
      colorKey: trait.colorKey,
      description: trait.description,
      promptText: trait.promptText,
      sortOrder: index,
    })),
    skipDuplicates: true,
  });

  await db.achievement.createMany({
    data: DEFAULT_ACHIEVEMENTS.map((achievement) => ({
      familyId,
      key: achievement.key,
      name: achievement.name,
      description: achievement.description,
      iconKey: achievement.iconKey,
      ruleType: achievement.ruleType,
      ruleConfig: achievement.ruleConfig as object,
      xpValue: achievement.xpValue,
    })),
    skipDuplicates: true,
  });

  await db.digitalCollectible.createMany({
    data: DEFAULT_COLLECTIBLES.map((collectible) => ({
      familyId,
      key: collectible.key,
      name: collectible.name,
      type: collectible.type,
      iconKey: collectible.iconKey,
      rarity: collectible.rarity,
      unlockRule: collectible.unlockRule as object,
    })),
    skipDuplicates: true,
  });

  await db.avatarItem.createMany({
    data: DEFAULT_AVATAR_ITEMS.map((item) => ({
      familyId,
      key: item.key,
      name: item.name,
      slot: item.slot,
      iconKey: item.iconKey,
      rarity: item.rarity,
      unlockRule: item.unlockRule as object,
    })),
    skipDuplicates: true,
  });

  // One badge per trait per tier (Bronze → Diamond).
  const traits = await db.characterTrait.findMany({
    where: { familyId },
    select: { id: true, key: true, label: true },
  });

  await db.characterBadge.createMany({
    data: traits.flatMap((trait) =>
      BADGE_TIERS.map((tier) => ({
        familyId,
        traitId: trait.id,
        name: DEFAULT_CHARACTER_BADGE_NAMES[trait.key] ?? `${trait.label} Hero`,
        tier,
        threshold: thresholdFor(tier),
        iconKey: 'medal',
        description: `${thresholdFor(tier)} confirmed ${trait.label.toLowerCase()} moments.`,
      })),
    ),
    skipDuplicates: true,
  });
}
