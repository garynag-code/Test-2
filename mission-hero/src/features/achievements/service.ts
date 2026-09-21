import type { Db } from '@/server/db/prisma';
import { ledgerKeys } from '@/domain/idempotency';
import { evaluateAchievement, type AchievementSnapshot } from '@/domain/achievements';
import { resolveLevel, type LevelDefinition } from '@/domain/levels';
import * as ledger from '@/features/ledger/service';
import * as streaks from '@/features/streaks/service';

/**
 * Achievement evaluation (BR-37).
 *
 * Runs inside the same transaction as the award that may have triggered it, so
 * a child never sees XP land without the badge that should have come with it.
 * Unlocks are unique per `(childId, achievementId)`, so re-evaluating is safe.
 */

export interface UnlockedAchievement {
  id: string;
  key: string;
  name: string;
  description: string;
  iconKey: string;
  xpAwarded: number;
}

export async function buildSnapshot(
  db: Db,
  childId: string,
  levels: readonly LevelDefinition[],
): Promise<AchievementSnapshot> {
  const [balances, starRows, approvedTasks, memoryCount, missionCount, spinCount, longestStreak] =
    await Promise.all([
      ledger.getBalances(db, childId),
      db.characterStarTransaction.groupBy({
        by: ['traitId'],
        where: { childId },
        _sum: { amount: true },
      }),
      db.taskCompletion.findMany({
        where: { childId, status: 'APPROVED' },
        select: { task: { select: { category: { select: { key: true } } } } },
      }),
      db.memorySubmission.count({ where: { childId, status: 'APPROVED' } }),
      db.secretMissionSubmission.count({ where: { childId, status: 'APPROVED' } }),
      db.rewardSpin.count({ where: { childId } }),
      streaks.longestForChild(db, childId),
    ]);

  const traits = await db.characterTrait.findMany({
    where: { id: { in: starRows.map((r) => r.traitId) } },
    select: { id: true, key: true },
  });
  const traitKeyById = new Map(traits.map((t) => [t.id, t.key]));

  const starsByTrait: Record<string, number> = {};
  for (const row of starRows) {
    const key = traitKeyById.get(row.traitId);
    if (key) starsByTrait[key] = row._sum.amount ?? 0;
  }

  const approvedTaskCountByCategory: Record<string, number> = {};
  for (const completion of approvedTasks) {
    const key = completion.task.category?.key;
    if (key) approvedTaskCountByCategory[key] = (approvedTaskCountByCategory[key] ?? 0) + 1;
  }

  return {
    lifetimeXp: balances.lifetimeXp,
    rewardPoints: balances.rewardPoints,
    totalStars: balances.characterStars,
    starsByTrait,
    approvedTaskCount: approvedTasks.length,
    approvedTaskCountByCategory,
    longestStreak,
    currentStreak: longestStreak,
    level: resolveLevel(balances.lifetimeXp, levels).level.levelNumber,
    memoryApprovedCount: memoryCount,
    secretMissionsCompleted: missionCount,
    wheelSpins: spinCount,
    // Perfect weeks are computed by the progress feature; achievements that
    // depend on them are evaluated when that number is recomputed.
    perfectWeeks: 0,
  };
}

/**
 * Unlocks every newly-earned achievement and pays out its XP.
 *
 * Returns only what was *newly* unlocked, so the celebration screen never
 * replays a badge the child already has.
 */
export async function evaluateForChild(
  db: Db,
  params: { childId: string; familyId: string },
): Promise<UnlockedAchievement[]> {
  const levels = await db.level.findMany({
    where: { familyId: params.familyId },
    orderBy: { minLifetimeXp: 'asc' },
  });
  const levelDefs: LevelDefinition[] = levels.map((l) => ({
    levelNumber: l.levelNumber,
    name: l.name,
    minLifetimeXp: l.minLifetimeXp,
    iconKey: l.iconKey,
  }));

  const [achievements, existing] = await Promise.all([
    db.achievement.findMany({ where: { familyId: params.familyId, active: true } }),
    db.achievementUnlock.findMany({
      where: { childId: params.childId },
      select: { achievementId: true },
    }),
  ]);

  const alreadyUnlocked = new Set(existing.map((u) => u.achievementId));
  const candidates = achievements.filter((a) => !alreadyUnlocked.has(a.id));
  if (candidates.length === 0) return [];

  const snapshot = await buildSnapshot(db, params.childId, levelDefs);
  const unlocked: UnlockedAchievement[] = [];

  for (const achievement of candidates) {
    if (!evaluateAchievement(achievement.ruleType, achievement.ruleConfig, snapshot)) continue;

    try {
      await db.achievementUnlock.create({
        data: { childId: params.childId, achievementId: achievement.id },
      });
    } catch {
      // A concurrent transaction unlocked it first; nothing more to do.
      continue;
    }

    if (achievement.xpValue > 0) {
      await ledger.awardXp(db, {
        familyId: params.familyId,
        childId: params.childId,
        amount: achievement.xpValue,
        sourceType: 'ACHIEVEMENT',
        sourceId: achievement.id,
        idempotencyKey: ledgerKeys.achievement(achievement.id),
        description: `Achievement: ${achievement.name}`,
      });
    }

    unlocked.push({
      id: achievement.id,
      key: achievement.key,
      name: achievement.name,
      description: achievement.description,
      iconKey: achievement.iconKey,
      xpAwarded: achievement.xpValue,
    });
  }

  return unlocked;
}
