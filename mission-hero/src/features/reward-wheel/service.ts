import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { prisma, type Db } from '@/server/db/prisma';
import { notEligible, notFound } from '@/server/errors';
import { assertSelfChild } from '@/server/auth/guards';
import type { Actor } from '@/server/auth/actor';
import { drawSegment, evaluateEligibility, type WheelSegment } from '@/domain/wheel';
import { ledgerKeys } from '@/domain/idempotency';
import { type LocalDate, localDateToUtcDate, startOfWeek } from '@/domain/dates';
import * as ledger from '@/features/ledger/service';
import * as achievements from '@/features/achievements/service';
import * as audit from '@/features/audit/service';
import * as notifications from '@/features/notifications/service';
import type { SpinResult, WheelView } from './types';

/**
 * Vertical Slice 3 (brief §49).
 *
 * The wheel is the one place a child could plausibly try to cheat, so it is the
 * strictest path in the system: the browser sends no random value, eligibility
 * is re-checked inside the transaction, the draw uses `crypto.randomInt` over
 * integer weights, and the RewardSpin row is committed before the client is
 * told anything (BR-45/46). Refreshing mid-animation shows the persisted
 * result; there is no way to re-roll.
 */

export const spinSchema = z.object({ wheelId: z.string().uuid() });

export async function getWheelForChild(
  actor: Actor,
  params: { childId: string; today: LocalDate; now?: Date },
): Promise<WheelView | null> {
  assertSelfChild(params.childId, actor);
  const now = params.now ?? new Date();

  const wheel = await prisma.rewardWheel.findFirst({
    where: { familyId: actor.familyId, active: true },
    include: { items: { where: { active: true }, orderBy: { segmentIndex: 'asc' } } },
  });
  if (!wheel) return null;

  const [balance, spinsToday, spinsThisWeek, lastSpin] = await Promise.all([
    ledger.getPointsBalance(prisma, params.childId),
    countSpins(params.childId, wheel.id, params.today, params.today),
    countSpins(params.childId, wheel.id, startOfWeek(params.today), params.today),
    prisma.rewardSpin.findFirst({
      where: { childId: params.childId, wheelId: wheel.id },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
  ]);

  const eligibility = evaluateEligibility({
    active: wheel.active,
    balance,
    pointThreshold: wheel.pointThreshold,
    deductPoints: wheel.deductPoints,
    pointsCost: wheel.pointsCost,
    spinsToday,
    spinsThisWeek,
    spinsPerDay: wheel.spinsPerDay,
    spinsPerWeek: wheel.spinsPerWeek,
    cooldownMinutes: wheel.cooldownMinutes,
    lastSpinAt: lastSpin?.createdAt ?? null,
    now,
    segmentCount: wheel.items.length,
  });

  return {
    wheelId: wheel.id,
    name: wheel.name,
    segments: wheel.items.map((item) => ({
      id: item.id,
      label: item.label,
      iconKey: item.iconKey,
      colorKey: item.colorKey,
      segmentIndex: item.segmentIndex,
    })),
    pointThreshold: wheel.pointThreshold,
    deductPoints: wheel.deductPoints,
    pointsCost: wheel.pointsCost,
    balance,
    eligible: eligibility.eligible,
    reason: eligibility.reason,
    pointsNeeded: eligibility.pointsNeeded,
    availableAt: eligibility.availableAt,
    spinsToday,
    spinsPerDay: wheel.spinsPerDay,
  };
}

export async function spin(
  actor: Actor,
  input: { wheelId: string; today: LocalDate; now?: Date },
): Promise<SpinResult> {
  if (actor.type !== 'child') throw notFound();
  const parsed = spinSchema.parse({ wheelId: input.wheelId });
  const now = input.now ?? new Date();
  const childId = actor.childId;

  return prisma.$transaction(async (tx) => {
    // Serialises this child's spins so two taps cannot both pass the limit check.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`spin:${childId}`}))`;

    const wheel = await tx.rewardWheel.findFirst({
      where: { id: parsed.wheelId, familyId: actor.familyId, active: true },
      include: { items: { where: { active: true }, orderBy: { segmentIndex: 'asc' } } },
    });
    if (!wheel) throw notFound('That wheel was not found.');

    const [balance, spinsToday, spinsThisWeek, lastSpin] = await Promise.all([
      ledger.getPointsBalance(tx, childId),
      countSpins(childId, wheel.id, input.today, input.today, tx),
      countSpins(childId, wheel.id, startOfWeek(input.today), input.today, tx),
      tx.rewardSpin.findFirst({
        where: { childId, wheelId: wheel.id },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);

    // Re-checked here, not trusted from the page that rendered the button.
    const eligibility = evaluateEligibility({
      active: wheel.active,
      balance,
      pointThreshold: wheel.pointThreshold,
      deductPoints: wheel.deductPoints,
      pointsCost: wheel.pointsCost,
      spinsToday,
      spinsThisWeek,
      spinsPerDay: wheel.spinsPerDay,
      spinsPerWeek: wheel.spinsPerWeek,
      cooldownMinutes: wheel.cooldownMinutes,
      lastSpinAt: lastSpin?.createdAt ?? null,
      now,
      segmentCount: wheel.items.length,
    });
    if (!eligibility.eligible) {
      throw notEligible(
        eligibility.reason ?? 'NOT_ELIGIBLE',
        ineligibleMessage(eligibility.reason),
      );
    }

    // BR-48: a segment a child has already won its maximum of drops out of the
    // draw entirely rather than being re-rolled.
    const winCounts = await tx.rewardSpin.groupBy({
      by: ['wheelItemId'],
      where: { childId, wheelId: wheel.id },
      _count: { _all: true },
    });
    const winsByItem = new Map(winCounts.map((row) => [row.wheelItemId, row._count._all]));

    const candidates: WheelSegment[] = wheel.items
      .filter((item) => {
        if (item.maxWinsPerChild === null) return true;
        return (winsByItem.get(item.id) ?? 0) < item.maxWinsPerChild;
      })
      .map((item) => ({
        id: item.id,
        label: item.label,
        weight: item.weight,
        segmentIndex: item.segmentIndex,
      }));

    if (candidates.length === 0) {
      throw notEligible('NO_SEGMENTS', 'No prizes left on this wheel right now.');
    }

    // The outcome. `randomInt` is the CSPRNG — not Math.random, and not the browser.
    const drawn = drawSegment(candidates, (max) => randomInt(max));
    const winningItem = wheel.items.find((item) => item.id === drawn.segment.id);
    if (!winningItem) throw notFound();

    const spinRow = await tx.rewardSpin.create({
      data: {
        wheelId: wheel.id,
        childId,
        familyId: actor.familyId,
        wheelItemId: winningItem.id,
        segmentIndex: winningItem.segmentIndex,
        pointsSpent: wheel.deductPoints ? wheel.pointsCost : 0,
        localDate: localDateToUtcDate(input.today),
      },
    });

    if (wheel.deductPoints && wheel.pointsCost > 0) {
      await ledger.spendPoints(tx, {
        familyId: actor.familyId,
        childId,
        amount: wheel.pointsCost,
        sourceType: 'WHEEL_SPIN',
        sourceId: spinRow.id,
        idempotencyKey: `points:${ledgerKeys.wheelSpinCost(spinRow.id)}`,
        description: `Wheel spin: ${winningItem.label}`,
      });
    }

    await achievements.evaluateForChild(tx, { childId, familyId: actor.familyId });

    await notifications.notifyParents(tx, {
      familyId: actor.familyId,
      kind: 'WHEEL_SPUN',
      title: 'Wheel spun!',
      body: `Won: ${winningItem.label}`,
      deepLink: '/parent/progress',
      payload: { spinId: spinRow.id },
    });

    await audit.record(tx, {
      actor,
      action: 'WHEEL_SPUN',
      entityType: 'RewardSpin',
      entityId: spinRow.id,
      after: {
        label: winningItem.label,
        segmentIndex: winningItem.segmentIndex,
        pointsSpent: spinRow.pointsSpent,
        totalWeight: drawn.totalWeight,
      },
    });

    return {
      spinId: spinRow.id,
      segmentIndex: winningItem.segmentIndex,
      label: winningItem.label,
      iconKey: winningItem.iconKey,
      pointsSpent: spinRow.pointsSpent,
      balanceAfter: await ledger.getPointsBalance(tx, childId),
    };
  });
}

/** Replays a persisted spin. A refresh mid-animation lands here. */
export async function getSpin(actor: Actor, spinId: string): Promise<SpinResult> {
  const spinRow = await prisma.rewardSpin.findFirst({
    where: { id: spinId, familyId: actor.familyId },
    include: { item: true },
  });
  if (!spinRow) throw notFound();
  assertSelfChild(spinRow.childId, actor);

  return {
    spinId: spinRow.id,
    segmentIndex: spinRow.segmentIndex,
    label: spinRow.item.label,
    iconKey: spinRow.item.iconKey,
    pointsSpent: spinRow.pointsSpent,
    balanceAfter: await ledger.getPointsBalance(prisma, spinRow.childId),
  };
}

export async function markRevealed(actor: Actor, spinId: string): Promise<void> {
  const spinRow = await prisma.rewardSpin.findFirst({
    where: { id: spinId, familyId: actor.familyId },
    select: { id: true, childId: true, resultRevealedAt: true },
  });
  if (!spinRow) throw notFound();
  assertSelfChild(spinRow.childId, actor);
  if (spinRow.resultRevealedAt) return;
  await prisma.rewardSpin.update({
    where: { id: spinRow.id },
    data: { resultRevealedAt: new Date() },
  });
}

async function countSpins(
  childId: string,
  wheelId: string,
  from: LocalDate,
  to: LocalDate,
  db: Db = prisma,
): Promise<number> {
  return db.rewardSpin.count({
    where: {
      childId,
      wheelId,
      localDate: { gte: localDateToUtcDate(from), lte: localDateToUtcDate(to) },
    },
  });
}

/** Plain facts, never pressure or near-miss framing (brief §42). */
function ineligibleMessage(reason: string | null): string {
  switch (reason) {
    case 'BELOW_THRESHOLD':
    case 'INSUFFICIENT_POINTS':
      return 'Keep earning points to unlock a spin.';
    case 'DAILY_LIMIT_REACHED':
      return 'Next spin available tomorrow.';
    case 'WEEKLY_LIMIT_REACHED':
      return 'Next spin available next week.';
    case 'COOLING_DOWN':
      return 'The wheel is resting. Try again a bit later.';
    default:
      return 'The wheel is not available right now.';
  }
}
