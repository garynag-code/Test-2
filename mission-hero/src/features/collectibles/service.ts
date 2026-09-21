import { prisma, type Db } from '@/server/db/prisma';
import { notFound } from '@/server/errors';
import { assertSelfChild } from '@/server/auth/guards';
import type { Actor } from '@/server/auth/actor';
import { DEFAULT_LEVELS, type LevelDefinition } from '@/domain/levels';
import { describeRule, evaluateUnlockRule, type UnlockContext } from '@/domain/unlocks';
import * as achievements from '@/features/achievements/service';
import * as notifications from '@/features/notifications/service';

/**
 * Digital collectibles and avatar items (brief §20/§21).
 *
 * Evaluated alongside achievements, inside the same transaction as whatever
 * award may have earned them, so a child never sees the XP land without the pet
 * that came with it.
 */

export interface UnlockedItem {
  kind: 'COLLECTIBLE' | 'AVATAR_ITEM';
  key: string;
  name: string;
  iconKey: string;
  rarity: string;
}

async function buildContext(
  db: Db,
  params: { childId: string; familyId: string },
): Promise<UnlockContext> {
  const [levelRows, family, unlocked] = await Promise.all([
    db.level.findMany({ where: { familyId: params.familyId }, orderBy: { minLifetimeXp: 'asc' } }),
    db.family.findUnique({ where: { id: params.familyId }, select: { timezone: true } }),
    db.achievementUnlock.findMany({
      where: { childId: params.childId },
      include: { achievement: { select: { key: true } } },
    }),
  ]);

  const levels: readonly LevelDefinition[] =
    levelRows.length > 0
      ? levelRows.map((row) => ({
          levelNumber: row.levelNumber,
          name: row.name,
          minLifetimeXp: row.minLifetimeXp,
          iconKey: row.iconKey,
        }))
      : DEFAULT_LEVELS;

  const snapshot = await achievements.buildSnapshot(
    db,
    params.childId,
    levels,
    family?.timezone ?? 'UTC',
  );

  return { snapshot, unlockedAchievementKeys: unlocked.map((row) => row.achievement.key) };
}

/** Unlocks everything newly earned. Returns only what is new, for celebration. */
export async function evaluateForChild(
  db: Db,
  params: { childId: string; familyId: string },
): Promise<UnlockedItem[]> {
  const [collectibles, avatarItems, ownedCollectibles, ownedItems] = await Promise.all([
    db.digitalCollectible.findMany({ where: { familyId: params.familyId } }),
    db.avatarItem.findMany({ where: { familyId: params.familyId } }),
    db.childCollectible.findMany({
      where: { childId: params.childId },
      select: { collectibleId: true },
    }),
    db.childAvatarItem.findMany({
      where: { childId: params.childId },
      select: { avatarItemId: true },
    }),
  ]);

  const ownedCollectibleIds = new Set(ownedCollectibles.map((row) => row.collectibleId));
  const ownedItemIds = new Set(ownedItems.map((row) => row.avatarItemId));

  const candidateCollectibles = collectibles.filter((row) => !ownedCollectibleIds.has(row.id));
  const candidateItems = avatarItems.filter((row) => !ownedItemIds.has(row.id));
  if (candidateCollectibles.length === 0 && candidateItems.length === 0) return [];

  const context = await buildContext(db, params);
  const unlocked: UnlockedItem[] = [];

  for (const collectible of candidateCollectibles) {
    if (!evaluateUnlockRule(collectible.unlockRule, context)) continue;
    const { count } = await db.childCollectible.createMany({
      data: [{ childId: params.childId, collectibleId: collectible.id }],
      skipDuplicates: true,
    });
    if (count === 0) continue;
    unlocked.push({
      kind: 'COLLECTIBLE',
      key: collectible.key,
      name: collectible.name,
      iconKey: collectible.iconKey,
      rarity: collectible.rarity,
    });
  }

  for (const item of candidateItems) {
    if (!evaluateUnlockRule(item.unlockRule, context)) continue;
    const { count } = await db.childAvatarItem.createMany({
      data: [{ childId: params.childId, avatarItemId: item.id, slot: item.slot }],
      skipDuplicates: true,
    });
    if (count === 0) continue;
    unlocked.push({
      kind: 'AVATAR_ITEM',
      key: item.key,
      name: item.name,
      iconKey: item.iconKey,
      rarity: item.rarity,
    });
  }

  if (unlocked.length > 0) {
    await notifications.notifyChild(db, {
      familyId: params.familyId,
      childId: params.childId,
      kind: 'BADGE_UNLOCKED',
      title: unlocked.length === 1 ? 'New unlock!' : `${unlocked.length} new unlocks!`,
      body: unlocked.map((item) => `${item.iconKey} ${item.name}`).join(', '),
      deepLink: '/kids/me',
    });
  }

  return unlocked;
}

export interface CollectionEntry {
  id: string;
  key: string;
  name: string;
  iconKey: string;
  rarity: string;
  type: string;
  owned: boolean;
  /** What still has to happen, for a locked item. */
  requirement: string;
}

export interface AvatarEntry extends CollectionEntry {
  slot: string;
  equipped: boolean;
}

export async function getCollection(actor: Actor, childId: string) {
  assertSelfChild(childId, actor);
  const child = await prisma.childProfile.findFirst({
    where: { id: childId, familyId: actor.familyId, deletedAt: null },
    select: { id: true },
  });
  if (!child) throw notFound();

  const [collectibles, avatarItems, owned, ownedItems] = await Promise.all([
    prisma.digitalCollectible.findMany({
      where: { familyId: actor.familyId },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.avatarItem.findMany({
      where: { familyId: actor.familyId },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.childCollectible.findMany({ where: { childId }, select: { collectibleId: true } }),
    prisma.childAvatarItem.findMany({ where: { childId } }),
  ]);

  const ownedIds = new Set(owned.map((row) => row.collectibleId));
  const itemById = new Map(ownedItems.map((row) => [row.avatarItemId, row]));

  return {
    collectibles: collectibles.map((row) => ({
      id: row.id,
      key: row.key,
      name: row.name,
      iconKey: row.iconKey,
      rarity: row.rarity,
      type: row.type,
      owned: ownedIds.has(row.id),
      requirement: describeRule(row.unlockRule),
    })) satisfies CollectionEntry[],
    avatarItems: avatarItems.map((row) => ({
      id: row.id,
      key: row.key,
      name: row.name,
      iconKey: row.iconKey,
      rarity: row.rarity,
      type: row.slot,
      slot: row.slot,
      owned: itemById.has(row.id),
      equipped: itemById.get(row.id)?.equipped ?? false,
      requirement: describeRule(row.unlockRule),
    })) satisfies AvatarEntry[],
  };
}

/**
 * Equipping is exclusive per slot, enforced by a partial unique index; the
 * clear-then-set happens in one transaction so the index is never violated.
 */
export async function equipItem(actor: Actor, avatarItemId: string) {
  if (actor.type !== 'child') throw notFound();

  return prisma.$transaction(async (tx) => {
    const owned = await tx.childAvatarItem.findFirst({
      where: {
        childId: actor.childId,
        avatarItemId,
        item: { familyId: actor.familyId },
      },
      include: { item: { select: { slot: true, name: true } } },
    });
    if (!owned) throw notFound('You have not unlocked that yet.');

    const alreadyOn = owned.equipped;

    await tx.childAvatarItem.updateMany({
      where: { childId: actor.childId, slot: owned.slot, equipped: true },
      data: { equipped: false },
    });

    if (!alreadyOn) {
      await tx.childAvatarItem.update({ where: { id: owned.id }, data: { equipped: true } });
    }

    return { equipped: !alreadyOn, slot: owned.slot, name: owned.item.name };
  });
}

export async function getEquipped(childId: string) {
  return prisma.childAvatarItem.findMany({
    where: { childId, equipped: true },
    include: { item: { select: { key: true, name: true, iconKey: true, slot: true } } },
  });
}
