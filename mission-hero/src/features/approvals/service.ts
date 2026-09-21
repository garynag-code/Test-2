import { prisma, type Db } from '@/server/db/prisma';
import { notFound } from '@/server/errors';
import { assertCanApprove } from '@/server/auth/guards';
import type { Actor } from '@/server/auth/actor';
import { type LocalDate, utcDateToLocalDate } from '@/domain/dates';
import { ledgerKeys } from '@/domain/idempotency';
import { DEFAULT_LEVELS, resolveLevel, type LevelDefinition } from '@/domain/levels';
import { CELEBRATION, REDO } from '@/domain/copy';
import * as ledger from '@/features/ledger/service';
import * as streaks from '@/features/streaks/service';
import * as achievements from '@/features/achievements/service';
import * as audit from '@/features/audit/service';
import * as notifications from '@/features/notifications/service';
import * as taskRepo from '@/features/tasks/repo';
import {
  approveCompletionSchema,
  awardBonusSchema,
  rejectCompletionSchema,
  type ApproveCompletionInput,
  type AwardBonusInput,
  type RejectCompletionInput,
} from './schemas';
import type { CelebrationPayload } from './types';

/**
 * Vertical Slice 1 (brief §47): the transaction where value is created.
 *
 * The order inside the transaction matters and is fixed:
 *   lock → status guard → flip status → ledgers → streak → achievements →
 *   notify → audit.
 *
 * If any step throws, nothing happened: there is no state in which a completion
 * is approved but its XP was not written.
 */
export async function approveTaskCompletion(
  actor: Actor,
  input: ApproveCompletionInput,
): Promise<CelebrationPayload> {
  // BR-11: only a parent (or the system, for opt-in auto-approval) adjudicates.
  // A child actor is rejected here, before anything is read.
  assertCanApprove(actor);
  const parsed = approveCompletionSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    await taskRepo.lockCompletion(tx, parsed.completionId);

    const completion = await taskRepo.findCompletionForFamily(
      tx,
      parsed.completionId,
      actor.familyId,
    );
    // A completion in another family reads as missing (BR-58).
    if (!completion) throw notFound('That mission was not found.');

    // BR-12: approving something already resolved is a no-op that replays the
    // original outcome, so a double-tapped button cannot pay twice.
    if (completion.status !== 'PENDING') {
      return buildCelebration(tx, {
        completionId: completion.id,
        childId: completion.childId,
        familyId: completion.familyId,
        taskTitle: completion.task.title,
        iconKey: completion.task.iconKey,
        traitLabel: completion.task.trait?.label ?? null,
        leveledUp: false,
        streakMilestone: null,
        achievements: [],
      });
    }

    const { task, child } = completion;
    const localDate = utcDateToLocalDate(completion.occurrence.occurrenceDate);
    const previousXp = await ledger.getXpBalance(tx, child.id);

    await tx.taskCompletion.update({
      where: { id: completion.id },
      data: {
        status: 'APPROVED',
        resolvedAt: new Date(),
        resolvedByUserId: actor.type === 'parent' ? actor.userId : null,
      },
    });
    await tx.taskOccurrence.update({
      where: { id: completion.occurrenceId },
      data: { status: 'APPROVED' },
    });

    // --- ledgers -----------------------------------------------------------
    // One idempotency key per ledger per completion (BR-6).
    const key = ledgerKeys.taskCompletion(completion.id);
    const awardedByUserId = actor.type === 'parent' ? actor.userId : null;
    const common = {
      familyId: completion.familyId,
      childId: child.id,
      sourceType: 'TASK_COMPLETION' as const,
      sourceId: completion.id,
      awardedByUserId,
    };

    if (task.xpValue > 0) {
      await ledger.awardXp(tx, {
        ...common,
        amount: task.xpValue,
        idempotencyKey: `xp:${key}`,
        description: task.title,
      });
    }
    if (task.rewardPointsValue > 0) {
      await ledger.awardPoints(tx, {
        ...common,
        amount: task.rewardPointsValue,
        idempotencyKey: `points:${key}`,
        description: task.title,
      });
    }
    if (task.characterStarValue > 0 && task.characterTraitId) {
      await ledger.awardStars(tx, {
        ...common,
        traitId: task.characterTraitId,
        amount: task.characterStarValue,
        idempotencyKey: `star:${key}`,
        description: task.title,
      });
    }

    await tx.taskApproval.create({
      data: {
        completionId: completion.id,
        parentUserId: awardedByUserId,
        decision: 'APPROVE',
        encouragementMessage: parsed.encouragementMessage ?? null,
        xpAwarded: task.xpValue,
        pointsAwarded: task.rewardPointsValue,
        starsAwarded: task.characterStarValue,
      },
    });

    // --- progression -------------------------------------------------------
    let streakMilestone: number | null = null;
    if (task.streakEligible) {
      const outcome = await streaks.recordActivity(tx, {
        childId: child.id,
        familyId: completion.familyId,
        kind: 'ALL_DAILY_TASKS',
        date: localDate as LocalDate,
      });
      streakMilestone = outcome.milestoneReached;
    }

    const unlocked = await achievements.evaluateForChild(tx, {
      childId: child.id,
      familyId: completion.familyId,
    });

    const newXp = await ledger.getXpBalance(tx, child.id);
    const levels = await loadLevels(tx, completion.familyId);
    const leveledUp =
      resolveLevel(newXp, levels).level.levelNumber > resolveLevel(previousXp, levels).level.levelNumber;

    // --- tell everyone -----------------------------------------------------
    await notifications.notifyChild(tx, {
      familyId: completion.familyId,
      childId: child.id,
      kind: 'TASK_APPROVED',
      title: `${task.title} approved!`,
      body: describeAwards(task.xpValue, task.rewardPointsValue, task.characterStarValue),
      deepLink: '/kids/home',
      payload: { completionId: completion.id },
    });

    await audit.record(tx, {
      actor,
      action: 'COMPLETION_APPROVED',
      entityType: 'TaskCompletion',
      entityId: completion.id,
      before: { status: 'PENDING' },
      after: {
        status: 'APPROVED',
        xp: task.xpValue,
        points: task.rewardPointsValue,
        stars: task.characterStarValue,
      },
      familyId: completion.familyId,
    });

    return buildCelebration(tx, {
      completionId: completion.id,
      childId: child.id,
      familyId: completion.familyId,
      taskTitle: task.title,
      iconKey: task.iconKey,
      traitLabel: task.trait?.label ?? null,
      leveledUp,
      streakMilestone,
      achievements: unlocked.map((a) => ({
        key: a.key,
        name: a.name,
        description: a.description,
        iconKey: a.iconKey,
      })),
    });
  });
}

/**
 * BR-13/BR-14: a rejection or redo awards nothing and reopens the occurrence so
 * the child can try again. The copy is an invitation, never a punishment.
 */
export async function rejectTaskCompletion(actor: Actor, input: RejectCompletionInput) {
  assertCanApprove(actor);
  const parsed = rejectCompletionSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    await taskRepo.lockCompletion(tx, parsed.completionId);
    const completion = await taskRepo.findCompletionForFamily(tx, parsed.completionId, actor.familyId);
    if (!completion) throw notFound('That mission was not found.');
    if (completion.status !== 'PENDING') return completion;

    const parentName = await parentDisplayName(tx, actor);

    await tx.taskCompletion.update({
      where: { id: completion.id },
      data: {
        status: parsed.decision === 'ASK_QUESTION' ? 'PENDING' : 'REJECTED',
        resolvedAt: parsed.decision === 'ASK_QUESTION' ? null : new Date(),
        resolvedByUserId: actor.type === 'parent' ? actor.userId : null,
      },
    });

    if (parsed.decision !== 'ASK_QUESTION') {
      // Reopening the occurrence is what lets the child have another go.
      await tx.taskOccurrence.update({
        where: { id: completion.occurrenceId },
        data: { status: 'OPEN' },
      });
    }

    await tx.taskApproval.create({
      data: {
        completionId: completion.id,
        parentUserId: actor.type === 'parent' ? actor.userId : null,
        decision: parsed.decision,
        encouragementMessage: parsed.decision === 'ASK_QUESTION' ? null : parsed.message ?? null,
        question: parsed.decision === 'ASK_QUESTION' ? parsed.message ?? null : null,
        xpAwarded: 0,
        pointsAwarded: 0,
        starsAwarded: 0,
      },
    });

    await notifications.notifyChild(tx, {
      familyId: completion.familyId,
      childId: completion.childId,
      kind: 'TASK_REJECTED',
      title: completion.task.title,
      body: parsed.message ?? REDO.tryAgain(parentName),
      deepLink: '/kids/home',
    });

    await audit.record(tx, {
      actor,
      action:
        parsed.decision === 'REQUEST_REDO' ? 'COMPLETION_REDO_REQUESTED' : 'COMPLETION_REJECTED',
      entityType: 'TaskCompletion',
      entityId: completion.id,
      before: { status: 'PENDING' },
      after: { status: parsed.decision, xp: 0, points: 0, stars: 0 },
      familyId: completion.familyId,
    });

    return completion;
  });
}

/**
 * A deliberate manual award (brief §28). Separate from approval precisely so
 * that approvals cannot carry an amount, and always audited with a reason.
 */
export async function awardBonus(actor: Actor, input: AwardBonusInput) {
  if (actor.type !== 'parent') throw notFound();
  const parsed = awardBonusSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    const child = await tx.childProfile.findFirst({
      where: { id: parsed.childId, familyId: actor.familyId, deletedAt: null },
      select: { id: true, familyId: true },
    });
    if (!child) throw notFound();

    // A fresh id per deliberate award: a second bonus is possible, an
    // accidental double-submit of the same form is not.
    const adjustmentId = crypto.randomUUID();
    const common = {
      familyId: child.familyId,
      childId: child.id,
      sourceType: 'MANUAL_ADJUSTMENT' as const,
      sourceId: adjustmentId,
      awardedByUserId: actor.userId,
      reason: parsed.reason,
      description: parsed.reason,
    };

    if (parsed.xp > 0) {
      await ledger.awardXp(tx, {
        ...common,
        amount: parsed.xp,
        idempotencyKey: `xp:${ledgerKeys.manual(adjustmentId)}`,
      });
    }
    if (parsed.points > 0) {
      await ledger.awardPoints(tx, {
        ...common,
        amount: parsed.points,
        idempotencyKey: `points:${ledgerKeys.manual(adjustmentId)}`,
      });
    } else if (parsed.points < 0) {
      // Only Reward Points may ever be deducted (BR-7).
      await ledger.spendPoints(tx, {
        ...common,
        amount: Math.abs(parsed.points),
        idempotencyKey: `points:${ledgerKeys.manual(adjustmentId)}`,
      });
    }
    if (parsed.stars > 0 && parsed.traitId) {
      await ledger.awardStars(tx, {
        ...common,
        traitId: parsed.traitId,
        amount: parsed.stars,
        idempotencyKey: `star:${ledgerKeys.manual(adjustmentId)}`,
      });
    }

    await audit.record(tx, {
      actor,
      action: 'MANUAL_ADJUSTMENT',
      entityType: 'ChildProfile',
      entityId: child.id,
      after: { xp: parsed.xp, points: parsed.points, stars: parsed.stars },
      reason: parsed.reason,
    });

    return { adjustmentId };
  });
}

// --- helpers ---------------------------------------------------------------

async function loadLevels(db: Db, familyId: string): Promise<readonly LevelDefinition[]> {
  const rows = await db.level.findMany({ where: { familyId }, orderBy: { minLifetimeXp: 'asc' } });
  if (rows.length === 0) return DEFAULT_LEVELS;
  return rows.map((row) => ({
    levelNumber: row.levelNumber,
    name: row.name,
    minLifetimeXp: row.minLifetimeXp,
    iconKey: row.iconKey,
  }));
}

async function parentDisplayName(db: Db, actor: Actor): Promise<string> {
  if (actor.type !== 'parent') return 'A grown-up';
  const profile = await db.parentProfile.findUnique({
    where: { familyId_userId: { familyId: actor.familyId, userId: actor.userId } },
    select: { displayName: true },
  });
  return profile?.displayName ?? 'A grown-up';
}

function describeAwards(xp: number, points: number, stars: number): string {
  const parts: string[] = [];
  if (xp > 0) parts.push(`+${xp} XP`);
  if (points > 0) parts.push(`+${points} points`);
  if (stars > 0) parts.push(`+${stars} ${stars === 1 ? 'star' : 'stars'}`);
  return parts.join('  ') || 'Nice work!';
}

async function buildCelebration(
  db: Db,
  params: {
    completionId: string;
    childId: string;
    familyId: string;
    taskTitle: string;
    iconKey: string;
    traitLabel: string | null;
    leveledUp: boolean;
    streakMilestone: number | null;
    achievements: CelebrationPayload['achievements'];
  },
): Promise<CelebrationPayload> {
  const approval = await db.taskApproval.findFirst({
    where: { completionId: params.completionId, decision: 'APPROVE' },
    orderBy: { decidedAt: 'desc' },
  });

  const [balances, levels, streak] = await Promise.all([
    ledger.getBalances(db, params.childId),
    loadLevels(db, params.familyId),
    db.streak.findUnique({
      where: { childId_kind_key: { childId: params.childId, kind: 'ALL_DAILY_TASKS', key: '' } },
      select: { currentCount: true },
    }),
  ]);

  const parentName = approval?.parentUserId
    ? (
        await db.parentProfile.findUnique({
          where: { familyId_userId: { familyId: params.familyId, userId: approval.parentUserId } },
          select: { displayName: true },
        })
      )?.displayName ?? null
    : null;

  const progress = resolveLevel(balances.lifetimeXp, levels);

  return {
    title: CELEBRATION.missionComplete,
    taskTitle: params.taskTitle,
    iconKey: params.iconKey,
    awards: {
      xp: approval?.xpAwarded ?? 0,
      points: approval?.pointsAwarded ?? 0,
      stars: approval?.starsAwarded ?? 0,
      traitLabel: params.traitLabel,
    },
    encouragement: approval?.encouragementMessage ?? null,
    parentName,
    lifetimeXp: balances.lifetimeXp,
    levelNumber: progress.level.levelNumber,
    levelName: progress.level.name,
    levelProgress: progress.progress,
    xpToNextLevel: progress.xpToNext,
    leveledUp: params.leveledUp,
    streakDays: streak?.currentCount ?? 0,
    streakMilestone: params.streakMilestone,
    achievements: params.achievements,
  };
}

export async function listPendingApprovals(actor: Actor) {
  if (actor.type !== 'parent') throw notFound();
  const rows = await taskRepo.listPendingForFamily(prisma, actor.familyId);
  return rows.map((row) => ({
    completionId: row.id,
    childId: row.child.id,
    childNickname: row.child.nickname,
    childAvatarKey: row.child.avatarKey,
    taskTitle: row.task.title,
    iconKey: row.task.iconKey,
    submittedAt: row.submittedAt,
    childNote: row.childNote,
    evidenceText: row.evidence[0]?.textBody ?? null,
    xpValue: row.task.xpValue,
    rewardPointsValue: row.task.rewardPointsValue,
    characterStarValue: row.task.characterStarValue,
    traitLabel: row.task.trait?.label ?? null,
  }));
}
