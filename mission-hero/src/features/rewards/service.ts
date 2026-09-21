import { z } from 'zod';
import { prisma } from '@/server/db/prisma';
import { conflict, notFound, notEligible } from '@/server/errors';
import { assertSelfChild } from '@/server/auth/guards';
import type { Actor } from '@/server/auth/actor';
import { ledgerKeys } from '@/domain/idempotency';
import * as ledger from '@/features/ledger/service';
import * as audit from '@/features/audit/service';
import * as notifications from '@/features/notifications/service';

/**
 * Reward store (brief §19, BR-41 … BR-43).
 *
 * Points are debited at *request* time, not at fulfilment, so a child cannot
 * queue more redemptions than they can afford. A parent rejection writes an
 * explicit, keyed refund rather than editing anything.
 */

export const redeemSchema = z.object({ rewardId: z.string().uuid() });

export const createRewardSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).optional(),
  type: z
    .enum(['EXPERIENCE', 'PHYSICAL', 'PRIVILEGE', 'SCREEN_TIME', 'POCKET_MONEY', 'FOOD', 'PARENT_TIME', 'DIGITAL', 'CUSTOM'])
    .default('CUSTOM'),
  pointsCost: z.number().int().min(0).max(100_000),
  inventoryQuantity: z.number().int().min(0).max(10_000).nullable().optional(),
  requiresParentApproval: z.boolean().default(true),
  iconKey: z.string().trim().max(40).default('gift'),
});

export async function createReward(actor: Actor, input: z.infer<typeof createRewardSchema>) {
  if (actor.type !== 'parent') throw notFound();
  const parsed = createRewardSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    const reward = await tx.reward.create({
      data: {
        familyId: actor.familyId,
        name: parsed.name,
        description: parsed.description ?? null,
        type: parsed.type,
        pointsCost: parsed.pointsCost,
        inventoryQuantity: parsed.inventoryQuantity ?? null,
        requiresParentApproval: parsed.requiresParentApproval,
        iconKey: parsed.iconKey,
      },
    });
    await audit.record(tx, {
      actor,
      action: 'REWARD_CREATED',
      entityType: 'Reward',
      entityId: reward.id,
      after: { name: reward.name, pointsCost: reward.pointsCost },
    });
    return reward;
  });
}

export interface RewardCard {
  id: string;
  name: string;
  description: string | null;
  iconKey: string;
  pointsCost: number;
  affordable: boolean;
  pointsNeeded: number;
  inStock: boolean;
  requiresParentApproval: boolean;
}

export async function listRewardsForChild(
  actor: Actor,
  childId: string,
): Promise<RewardCard[]> {
  assertSelfChild(childId, actor);

  const [rewards, balance] = await Promise.all([
    prisma.reward.findMany({
      where: {
        familyId: actor.familyId,
        active: true,
        deletedAt: null,
        OR: [{ eligibility: { none: {} } }, { eligibility: { some: { childId } } }],
      },
      orderBy: { pointsCost: 'asc' },
    }),
    ledger.getPointsBalance(prisma, childId),
  ]);

  return rewards.map((reward) => ({
    id: reward.id,
    name: reward.name,
    description: reward.description,
    iconKey: reward.iconKey,
    pointsCost: reward.pointsCost,
    affordable: balance >= reward.pointsCost,
    pointsNeeded: Math.max(0, reward.pointsCost - balance),
    inStock: reward.inventoryQuantity === null || reward.inventoryQuantity > 0,
    requiresParentApproval: reward.requiresParentApproval,
  }));
}

/**
 * BR-41: the debit and the inventory decrement happen in one transaction under
 * a row lock, so two children cannot both claim the last one.
 */
export async function redeem(actor: Actor, input: { rewardId: string }) {
  if (actor.type !== 'child') throw notFound();
  const parsed = redeemSchema.parse(input);
  const childId = actor.childId;

  return prisma.$transaction(async (tx) => {
    // Lock the reward row first; every redemption of this reward queues here.
    await tx.$executeRaw`SELECT id FROM "Reward" WHERE id = ${parsed.rewardId} FOR UPDATE`;

    const reward = await tx.reward.findFirst({
      where: { id: parsed.rewardId, familyId: actor.familyId, deletedAt: null },
      include: { eligibility: true },
    });
    if (!reward) throw notFound('That reward was not found.');
    if (!reward.active) throw notEligible('INACTIVE', 'That reward is not available right now.');
    if (reward.expiresAt && reward.expiresAt < new Date()) {
      throw notEligible('EXPIRED', 'That reward has expired.');
    }
    if (reward.eligibility.length > 0 && !reward.eligibility.some((e) => e.childId === childId)) {
      throw notFound('That reward was not found.');
    }
    if (reward.inventoryQuantity !== null && reward.inventoryQuantity <= 0) {
      throw conflict('That one is all gone for now.');
    }

    const redemption = await tx.rewardRedemption.create({
      data: {
        rewardId: reward.id,
        childId,
        familyId: actor.familyId,
        pointsSpent: reward.pointsCost,
        status: reward.requiresParentApproval ? 'PENDING' : 'FULFILLED',
        resolvedAt: reward.requiresParentApproval ? null : new Date(),
      },
    });

    // Throws INSUFFICIENT_POINTS and rolls the whole thing back if short.
    if (reward.pointsCost > 0) {
      await ledger.spendPoints(tx, {
        familyId: actor.familyId,
        childId,
        amount: reward.pointsCost,
        sourceType: 'REWARD_REDEMPTION',
        sourceId: redemption.id,
        idempotencyKey: `points:${ledgerKeys.redemption(redemption.id)}`,
        description: `Redeemed: ${reward.name}`,
      });
    }

    if (reward.inventoryQuantity !== null) {
      await tx.reward.update({
        where: { id: reward.id },
        data: { inventoryQuantity: { decrement: 1 } },
      });
    }

    await notifications.notifyParents(tx, {
      familyId: actor.familyId,
      kind: 'REWARD_REQUESTED',
      title: `Reward requested: ${reward.name}`,
      body: `${reward.pointsCost} points`,
      deepLink: '/parent/rewards',
      payload: { redemptionId: redemption.id },
    });

    await audit.record(tx, {
      actor,
      action: 'REWARD_REDEEMED',
      entityType: 'RewardRedemption',
      entityId: redemption.id,
      after: { rewardId: reward.id, pointsSpent: reward.pointsCost, status: redemption.status },
    });

    return {
      redemption,
      balanceAfter: await ledger.getPointsBalance(tx, childId),
    };
  });
}

/**
 * BR-43: rejecting a pending redemption refunds the points as a positive ledger
 * row with its own key, and returns the item to stock.
 */
export async function resolveRedemption(
  actor: Actor,
  input: { redemptionId: string; approve: boolean; note?: string },
) {
  if (actor.type !== 'parent') throw notFound();

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "RewardRedemption" WHERE id = ${input.redemptionId} FOR UPDATE`;

    const redemption = await tx.rewardRedemption.findFirst({
      where: { id: input.redemptionId, familyId: actor.familyId },
      include: { reward: true },
    });
    if (!redemption) throw notFound();
    if (redemption.status !== 'PENDING') return redemption;

    const updated = await tx.rewardRedemption.update({
      where: { id: redemption.id },
      data: {
        status: input.approve ? 'FULFILLED' : 'REJECTED',
        resolvedAt: new Date(),
        resolvedByUserId: actor.userId,
        note: input.note ?? null,
      },
    });

    if (!input.approve && redemption.pointsSpent > 0) {
      await ledger.awardPoints(tx, {
        familyId: actor.familyId,
        childId: redemption.childId,
        amount: redemption.pointsSpent,
        sourceType: 'REDEMPTION_REFUND',
        sourceId: redemption.id,
        idempotencyKey: `points:${ledgerKeys.redemptionRefund(redemption.id)}`,
        awardedByUserId: actor.userId,
        description: `Points returned: ${redemption.reward.name}`,
      });

      if (redemption.reward.inventoryQuantity !== null) {
        await tx.reward.update({
          where: { id: redemption.rewardId },
          data: { inventoryQuantity: { increment: 1 } },
        });
      }
    }

    await notifications.notifyChild(tx, {
      familyId: actor.familyId,
      childId: redemption.childId,
      kind: input.approve ? 'REWARD_FULFILLED' : 'ENCOURAGEMENT',
      title: redemption.reward.name,
      body: input.approve
        ? 'Your reward is ready!'
        : input.note ?? 'Your points have been returned.',
      deepLink: '/kids/rewards',
    });

    await audit.record(tx, {
      actor,
      action: 'REDEMPTION_RESOLVED',
      entityType: 'RewardRedemption',
      entityId: redemption.id,
      before: { status: 'PENDING' },
      after: { status: updated.status, refunded: !input.approve },
    });

    return updated;
  });
}

export async function listPendingRedemptions(actor: Actor) {
  if (actor.type !== 'parent') throw notFound();
  return prisma.rewardRedemption.findMany({
    where: { familyId: actor.familyId, status: 'PENDING' },
    orderBy: { requestedAt: 'asc' },
    include: { reward: true, child: { select: { nickname: true, avatarKey: true } } },
  });
}
