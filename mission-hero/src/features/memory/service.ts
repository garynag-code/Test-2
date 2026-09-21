import { z } from 'zod';
import { prisma } from '@/server/db/prisma';
import { conflict, notFound } from '@/server/errors';
import { assertCanApprove, assertSelfChild } from '@/server/auth/guards';
import type { Actor } from '@/server/auth/actor';
import { type LocalDate, localDateToUtcDate } from '@/domain/dates';
import { ledgerKeys } from '@/domain/idempotency';
import * as ledger from '@/features/ledger/service';
import * as streaks from '@/features/streaks/service';
import * as achievements from '@/features/achievements/service';
import * as audit from '@/features/audit/service';
import * as notifications from '@/features/notifications/service';

/**
 * Memory challenges (brief §15, BR-49/BR-50).
 *
 * The platform holds no opinion about *what* a family wants learned by heart —
 * a Bible verse, a family saying, a times table and an affirmation are the same
 * kind of row. A challenge pays out at most once per child, ever, enforced by a
 * partial unique index on approved submissions.
 */

export const createChallengeSchema = z.object({
  title: z.string().trim().min(1).max(120),
  category: z
    .enum([
      'BIBLE_VERSE',
      'QUOTE',
      'AFFIRMATION',
      'FAMILY_SAYING',
      'SLOGAN',
      'VOCABULARY',
      'SCHOOL_FACT',
      'CUSTOM',
    ])
    .default('CUSTOM'),
  reference: z.string().trim().max(120).optional(),
  bodyText: z.string().trim().min(1).max(2000),
  xpValue: z.number().int().min(0).max(500).default(10),
  rewardPointsValue: z.number().int().min(0).max(500).default(0),
  verificationType: z.enum(['TYPED', 'PARENT_CONFIRM', 'VOICE']).default('TYPED'),
  childIds: z.array(z.string().uuid()).min(1),
});

export const reciteSchema = z.object({
  challengeId: z.string().uuid(),
  recitedText: z.string().trim().max(2000).optional(),
});

export async function createChallenge(actor: Actor, input: z.input<typeof createChallengeSchema>) {
  if (actor.type !== 'parent') throw notFound();
  const parsed = createChallengeSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    const children = await tx.childProfile.findMany({
      where: { id: { in: parsed.childIds }, familyId: actor.familyId, deletedAt: null },
      select: { id: true },
    });
    if (children.length !== parsed.childIds.length) throw notFound();

    const challenge = await tx.memoryChallenge.create({
      data: {
        familyId: actor.familyId,
        title: parsed.title,
        category: parsed.category,
        reference: parsed.reference ?? null,
        bodyText: parsed.bodyText,
        xpValue: parsed.xpValue,
        rewardPointsValue: parsed.rewardPointsValue,
        verificationType: parsed.verificationType,
        assignments: { createMany: { data: children.map((c) => ({ childId: c.id })) } },
      },
    });

    await audit.record(tx, {
      actor,
      action: 'MEMORY_CHALLENGE_CREATED',
      entityType: 'MemoryChallenge',
      entityId: challenge.id,
      after: { title: challenge.title, xpValue: challenge.xpValue },
    });

    return challenge;
  });
}

export async function listForChild(actor: Actor, childId: string) {
  assertSelfChild(childId, actor);

  const challenges = await prisma.memoryChallenge.findMany({
    where: {
      familyId: actor.familyId,
      active: true,
      deletedAt: null,
      assignments: { some: { childId } },
    },
    include: {
      submissions: {
        where: { childId },
        orderBy: { submittedAt: 'desc' },
        take: 1,
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return challenges.map((challenge) => ({
    id: challenge.id,
    title: challenge.title,
    category: challenge.category,
    reference: challenge.reference,
    bodyText: challenge.bodyText,
    xpValue: challenge.xpValue,
    rewardPointsValue: challenge.rewardPointsValue,
    verificationType: challenge.verificationType,
    status: challenge.submissions[0]?.status ?? null,
  }));
}

/** Awards nothing: the typed recitation is stored for the parent to compare. */
export async function recite(actor: Actor, input: z.infer<typeof reciteSchema>) {
  if (actor.type !== 'child') throw notFound();
  const parsed = reciteSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    const challenge = await tx.memoryChallenge.findFirst({
      where: {
        id: parsed.challengeId,
        familyId: actor.familyId,
        active: true,
        deletedAt: null,
        assignments: { some: { childId: actor.childId } },
      },
    });
    if (!challenge) throw notFound('That memory challenge was not found.');

    const alreadyApproved = await tx.memorySubmission.findFirst({
      where: { challengeId: challenge.id, childId: actor.childId, status: 'APPROVED' },
    });
    if (alreadyApproved) throw conflict('You have already mastered this one!');

    // A previous attempt that is still waiting is replaced rather than stacked,
    // so a parent never sees the same recitation twice in their queue.
    await tx.memorySubmission.deleteMany({
      where: { challengeId: challenge.id, childId: actor.childId, status: 'PENDING' },
    });

    const submission = await tx.memorySubmission.create({
      data: {
        challengeId: challenge.id,
        childId: actor.childId,
        familyId: actor.familyId,
        recitedText: parsed.recitedText ?? null,
        status: 'PENDING',
      },
    });

    await notifications.notifyParents(tx, {
      familyId: actor.familyId,
      kind: 'MEMORY_SUBMITTED',
      title: `A memory challenge is ready to check`,
      body: challenge.title,
      deepLink: '/parent/approvals?tab=memory',
      payload: { submissionId: submission.id },
    });

    await audit.record(tx, {
      actor,
      action: 'MEMORY_SUBMITTED',
      entityType: 'MemorySubmission',
      entityId: submission.id,
      after: { challengeId: challenge.id },
    });

    return submission;
  });
}

/** BR-49: a challenge pays out at most once per child, ever. */
export async function approve(
  actor: Actor,
  input: { submissionId: string; encouragementMessage?: string },
) {
  assertCanApprove(actor);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "MemorySubmission" WHERE id = ${input.submissionId} FOR UPDATE`;

    const submission = await tx.memorySubmission.findFirst({
      where: { id: input.submissionId, familyId: actor.familyId },
      include: { challenge: true, approval: true },
    });
    if (!submission) throw notFound();
    if (submission.status !== 'PENDING' || submission.approval) return submission;

    // BR-49: checked before the write, because the partial unique index would
    // otherwise abort this transaction rather than let us return gracefully.
    const alreadyApproved = await tx.memorySubmission.findFirst({
      where: {
        challengeId: submission.challengeId,
        childId: submission.childId,
        status: 'APPROVED',
      },
      select: { id: true },
    });
    if (alreadyApproved) return submission;

    await tx.memorySubmission.update({
      where: { id: submission.id },
      data: { status: 'APPROVED' },
    });

    const key = ledgerKeys.memorySubmission(submission.id);
    const awardedByUserId = actor.type === 'parent' ? actor.userId : null;

    if (submission.challenge.xpValue > 0) {
      await ledger.awardXp(tx, {
        familyId: submission.familyId,
        childId: submission.childId,
        amount: submission.challenge.xpValue,
        sourceType: 'MEMORY_SUBMISSION',
        sourceId: submission.id,
        idempotencyKey: `xp:${key}`,
        awardedByUserId,
        description: `Learned by heart: ${submission.challenge.title}`,
      });
    }
    if (submission.challenge.rewardPointsValue > 0) {
      await ledger.awardPoints(tx, {
        familyId: submission.familyId,
        childId: submission.childId,
        amount: submission.challenge.rewardPointsValue,
        sourceType: 'MEMORY_SUBMISSION',
        sourceId: submission.id,
        idempotencyKey: `points:${key}`,
        awardedByUserId,
        description: `Learned by heart: ${submission.challenge.title}`,
      });
    }

    await tx.memoryApproval.create({
      data: {
        submissionId: submission.id,
        parentUserId: awardedByUserId,
        decision: 'APPROVE',
        encouragementMessage: input.encouragementMessage ?? null,
        xpAwarded: submission.challenge.xpValue,
        pointsAwarded: submission.challenge.rewardPointsValue,
      },
    });

    await streaks.recordActivity(tx, {
      childId: submission.childId,
      familyId: submission.familyId,
      kind: 'MEMORY',
      date: submission.submittedAt.toISOString().slice(0, 10) as LocalDate,
    });

    await achievements.evaluateForChild(tx, {
      childId: submission.childId,
      familyId: submission.familyId,
    });

    await notifications.notifyChild(tx, {
      familyId: submission.familyId,
      childId: submission.childId,
      kind: 'MEMORY_APPROVED',
      title: 'Learned by heart!',
      body: `+${submission.challenge.xpValue} XP`,
      deepLink: '/kids/memory',
    });

    await audit.record(tx, {
      actor,
      action: 'MEMORY_APPROVED',
      entityType: 'MemorySubmission',
      entityId: submission.id,
      before: { status: 'PENDING' },
      after: { status: 'APPROVED', xp: submission.challenge.xpValue },
      familyId: submission.familyId,
    });

    return submission;
  });
}

/**
 * "Not quite yet" — awards nothing, and the child may recite again.
 *
 * The submission is marked REJECTED rather than deleted, so the history shows
 * the attempt; the partial unique index only constrains approved rows, which
 * is what leaves a retry possible.
 */
export async function decline(actor: Actor, input: { submissionId: string; message?: string }) {
  assertCanApprove(actor);

  return prisma.$transaction(async (tx) => {
    const submission = await tx.memorySubmission.findFirst({
      where: { id: input.submissionId, familyId: actor.familyId },
      include: { challenge: { select: { title: true } } },
    });
    if (!submission) throw notFound();
    if (submission.status !== 'PENDING') return submission;

    await tx.memorySubmission.update({
      where: { id: submission.id },
      data: { status: 'REJECTED' },
    });

    await tx.memoryApproval.create({
      data: {
        submissionId: submission.id,
        parentUserId: actor.type === 'parent' ? actor.userId : null,
        decision: 'REQUEST_REDO',
        encouragementMessage: input.message ?? null,
        xpAwarded: 0,
        pointsAwarded: 0,
      },
    });

    await notifications.notifyChild(tx, {
      familyId: submission.familyId,
      childId: submission.childId,
      kind: 'ENCOURAGEMENT',
      title: submission.challenge.title,
      body: input.message ?? 'Nearly! Give it one more practice and try again.',
      deepLink: '/kids/memory',
    });

    await audit.record(tx, {
      actor,
      action: 'MEMORY_REJECTED',
      entityType: 'MemorySubmission',
      entityId: submission.id,
      before: { status: 'PENDING' },
      after: { status: 'REJECTED', xp: 0 },
      familyId: submission.familyId,
    });

    return submission;
  });
}

export async function listPending(actor: Actor) {
  if (actor.type !== 'parent') throw notFound();
  return prisma.memorySubmission.findMany({
    where: { familyId: actor.familyId, status: 'PENDING' },
    orderBy: { submittedAt: 'asc' },
    include: { challenge: true, child: { select: { nickname: true, avatarKey: true } } },
  });
}

export function localDateOf(date: Date): LocalDate {
  return date.toISOString().slice(0, 10) as LocalDate;
}

export { localDateToUtcDate };
