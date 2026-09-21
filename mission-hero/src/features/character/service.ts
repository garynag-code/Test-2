import { prisma, type Db } from '@/server/db/prisma';
import { notFound, validation } from '@/server/errors';
import { assertCanApprove, assertSelfChild } from '@/server/auth/guards';
import type { Actor } from '@/server/auth/actor';
import { CHARACTER_SUBMISSIONS_PER_DAY } from '@/domain/constants';
import { type LocalDate, localDateToUtcDate } from '@/domain/dates';
import { ledgerKeys } from '@/domain/idempotency';
import { badgeProgress, tiersUnlockedBy, type BadgeTier } from '@/domain/badges';
import { CHARACTER } from '@/domain/copy';
import * as ledger from '@/features/ledger/service';
import * as streaks from '@/features/streaks/service';
import * as achievements from '@/features/achievements/service';
import * as audit from '@/features/audit/service';
import * as notifications from '@/features/notifications/service';
import {
  confirmCharacterSchema,
  createTraitSchema,
  declineCharacterSchema,
  submitCharacterSchema,
  type ConfirmCharacterInput,
  type CreateTraitInput,
  type DeclineCharacterInput,
  type SubmitCharacterInput,
} from './schemas';
import type { CharacterCelebration, PendingCharacterSubmission, TraitCard, TraitTotal } from './types';

/**
 * Vertical Slice 2 (brief §48): "Who I was today".
 *
 * The rule that gives this feature its integrity: tapping a trait card awards
 * nothing (BR-28). A star exists only because a parent looked at what their
 * child wrote and confirmed it.
 */

export async function listTraits(actor: Actor): Promise<TraitCard[]> {
  const traits = await prisma.characterTrait.findMany({
    where: { familyId: actor.familyId, active: true, deletedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
  });
  return traits.map((trait) => ({
    id: trait.id,
    key: trait.key,
    label: trait.label,
    emoji: trait.emoji,
    promptText: trait.promptText,
    colorKey: trait.colorKey,
    description: trait.description,
  }));
}

export async function createTrait(actor: Actor, input: CreateTraitInput) {
  if (actor.type !== 'parent') throw notFound();
  const parsed = createTraitSchema.parse(input);
  const key = parsed.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  return prisma.$transaction(async (tx) => {
    const count = await tx.characterTrait.count({ where: { familyId: actor.familyId } });
    const trait = await tx.characterTrait.create({
      data: {
        familyId: actor.familyId,
        key,
        label: parsed.label,
        emoji: parsed.emoji,
        promptText: parsed.promptText,
        description: parsed.description ?? null,
        colorKey: parsed.colorKey,
        sortOrder: count,
      },
    });

    // A custom trait gets the same badge ladder as the defaults.
    await tx.characterBadge.createMany({
      data: (['BRONZE', 'SILVER', 'GOLD', 'DIAMOND'] as const).map((tier) => ({
        familyId: actor.familyId,
        traitId: trait.id,
        name: `${parsed.label} Hero`,
        tier,
        threshold: thresholdOf(tier),
        description: `${thresholdOf(tier)} confirmed ${parsed.label.toLowerCase()} moments.`,
      })),
      skipDuplicates: true,
    });

    await audit.record(tx, {
      actor,
      action: 'CHARACTER_TRAIT_CREATED',
      entityType: 'CharacterTrait',
      entityId: trait.id,
      after: { label: trait.label },
    });

    return trait;
  });
}

function thresholdOf(tier: BadgeTier): number {
  return { BRONZE: 5, SILVER: 15, GOLD: 30, DIAMOND: 75 }[tier];
}

/**
 * The child's claim. Writes a PENDING row and nothing else — no star, no XP,
 * no badge progress (BR-28).
 */
export async function submitCharacterMoment(
  actor: Actor,
  input: SubmitCharacterInput & { localDate: LocalDate },
) {
  if (actor.type !== 'child') throw notFound();
  const parsed = submitCharacterSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    const trait = await tx.characterTrait.findFirst({
      where: { id: parsed.traitId, familyId: actor.familyId, active: true, deletedAt: null },
    });
    if (!trait) throw notFound('That trait was not found.');

    // BR-32: a gentle cap, worded as a nudge rather than a scolding.
    const todayCount = await tx.characterSubmission.count({
      where: { childId: actor.childId, localDate: localDateToUtcDate(input.localDate) },
    });
    if (todayCount >= CHARACTER_SUBMISSIONS_PER_DAY) {
      throw validation("That's a lot of great moments today! Save some for tomorrow.");
    }

    const child = await tx.childProfile.findUniqueOrThrow({
      where: { id: actor.childId },
      select: { nickname: true },
    });

    const submission = await tx.characterSubmission.create({
      data: {
        childId: actor.childId,
        familyId: actor.familyId,
        traitId: trait.id,
        localDate: localDateToUtcDate(input.localDate),
        story: parsed.story,
        mood: parsed.mood ?? null,
        status: 'PENDING',
      },
    });

    await notifications.notifyParents(tx, {
      familyId: actor.familyId,
      kind: 'CHARACTER_SUBMITTED',
      title: `${child.nickname} says they showed ${trait.label.toLowerCase()} today.`,
      body: parsed.story.slice(0, 120),
      deepLink: '/parent/approvals?tab=character',
      payload: { submissionId: submission.id },
    });

    await audit.record(tx, {
      actor,
      action: 'CHARACTER_SUBMITTED',
      entityType: 'CharacterSubmission',
      entityId: submission.id,
      after: { traitId: trait.id, status: 'PENDING' },
    });

    return submission;
  });
}

/**
 * Parent confirmation: awards exactly one star for the trait (BR-29), plus XP
 * if the family enabled it — two separate ledger rows with two separate keys.
 */
export async function confirmCharacterMoment(
  actor: Actor,
  input: ConfirmCharacterInput,
): Promise<CharacterCelebration> {
  assertCanApprove(actor);
  const parsed = confirmCharacterSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "CharacterSubmission" WHERE id = ${parsed.submissionId} FOR UPDATE`;

    const submission = await tx.characterSubmission.findFirst({
      where: { id: parsed.submissionId, familyId: actor.familyId },
      include: { trait: true, child: { select: { id: true, nickname: true } }, approval: true },
    });
    if (!submission) throw notFound('That moment was not found.');

    // BR-30: a second confirmation replays the first rather than paying again.
    if (submission.status !== 'PENDING' || submission.approval) {
      return buildCelebration(tx, submission.childId, submission.traitId, {
        starsAwarded: submission.approval?.starsAwarded ?? 0,
        xpAwarded: submission.approval?.xpAwarded ?? 0,
        encouragement: submission.approval?.encouragementMessage ?? null,
        parentUserId: submission.approval?.parentUserId ?? null,
        familyId: submission.familyId,
        badgesUnlocked: [],
      });
    }

    const setting = await tx.familySetting.findUnique({ where: { familyId: submission.familyId } });
    const xpPerStar = setting?.characterXpPerStar ?? 0;
    const awardedByUserId = actor.type === 'parent' ? actor.userId : null;
    const key = ledgerKeys.characterApproval(submission.id);

    await tx.characterSubmission.update({
      where: { id: submission.id },
      data: { status: 'APPROVED' },
    });

    await ledger.awardStars(tx, {
      familyId: submission.familyId,
      childId: submission.childId,
      traitId: submission.traitId,
      // Exactly one. A bigger gesture is a separate, audited bonus.
      amount: 1,
      sourceType: 'CHARACTER_APPROVAL',
      sourceId: submission.id,
      idempotencyKey: `star:${key}`,
      awardedByUserId,
      description: `${submission.trait.label}: ${submission.story.slice(0, 60)}`,
    });

    if (xpPerStar > 0) {
      await ledger.awardXp(tx, {
        familyId: submission.familyId,
        childId: submission.childId,
        amount: xpPerStar,
        sourceType: 'CHARACTER_APPROVAL',
        sourceId: submission.id,
        idempotencyKey: `xp:${key}`,
        awardedByUserId,
        description: `${submission.trait.label} moment`,
      });
    }

    await tx.characterApproval.create({
      data: {
        submissionId: submission.id,
        parentUserId: awardedByUserId,
        decision: 'APPROVE',
        encouragementMessage: parsed.encouragementMessage ?? null,
        starsAwarded: 1,
        xpAwarded: xpPerStar,
      },
    });

    const badgesUnlocked = await evaluateBadges(tx, submission.childId, submission.traitId);

    await streaks.recordActivity(tx, {
      childId: submission.childId,
      familyId: submission.familyId,
      kind: 'CHARACTER',
      date: submission.localDate.toISOString().slice(0, 10) as LocalDate,
    });

    await achievements.evaluateForChild(tx, {
      childId: submission.childId,
      familyId: submission.familyId,
    });

    const total = await ledger.getStarsForTrait(tx, submission.childId, submission.traitId);

    await notifications.notifyChild(tx, {
      familyId: submission.familyId,
      childId: submission.childId,
      kind: 'CHARACTER_CONFIRMED',
      title: `${submission.trait.label} Power +1!`,
      body: parsed.encouragementMessage ?? `That's ${total} now. Keep going!`,
      deepLink: '/kids/me',
    });

    await audit.record(tx, {
      actor,
      action: 'CHARACTER_APPROVED',
      entityType: 'CharacterSubmission',
      entityId: submission.id,
      before: { status: 'PENDING' },
      after: { status: 'APPROVED', stars: 1, xp: xpPerStar },
      familyId: submission.familyId,
    });

    return buildCelebration(tx, submission.childId, submission.traitId, {
      starsAwarded: 1,
      xpAwarded: xpPerStar,
      encouragement: parsed.encouragementMessage ?? null,
      parentUserId: awardedByUserId,
      familyId: submission.familyId,
      badgesUnlocked,
    });
  });
}

/**
 * "Let's talk about this one." Awards nothing and, deliberately, is never
 * described to the child as a rejection.
 */
export async function declineCharacterMoment(actor: Actor, input: DeclineCharacterInput) {
  assertCanApprove(actor);
  const parsed = declineCharacterSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    const submission = await tx.characterSubmission.findFirst({
      where: { id: parsed.submissionId, familyId: actor.familyId },
      include: { trait: true },
    });
    if (!submission) throw notFound('That moment was not found.');
    if (submission.status !== 'PENDING') return submission;

    await tx.characterSubmission.update({
      where: { id: submission.id },
      data: { status: parsed.decision === 'ASK_QUESTION' ? 'QUESTION_ASKED' : 'REJECTED' },
    });

    await tx.characterApproval.create({
      data: {
        submissionId: submission.id,
        parentUserId: actor.type === 'parent' ? actor.userId : null,
        decision: parsed.decision,
        question: parsed.decision === 'ASK_QUESTION' ? parsed.message ?? null : null,
        encouragementMessage: parsed.decision === 'REJECT' ? parsed.message ?? null : null,
        starsAwarded: 0,
        xpAwarded: 0,
      },
    });

    await notifications.notifyChild(tx, {
      familyId: submission.familyId,
      childId: submission.childId,
      kind: 'ENCOURAGEMENT',
      title: submission.trait.label,
      body: parsed.message ?? CHARACTER.growThisOne,
      deepLink: '/kids/character',
    });

    await audit.record(tx, {
      actor,
      action: 'CHARACTER_REJECTED',
      entityType: 'CharacterSubmission',
      entityId: submission.id,
      before: { status: 'PENDING' },
      after: { status: parsed.decision, stars: 0 },
      familyId: submission.familyId,
    });

    return submission;
  });
}

export async function listPendingSubmissions(actor: Actor): Promise<PendingCharacterSubmission[]> {
  if (actor.type !== 'parent') throw notFound();

  const submissions = await prisma.characterSubmission.findMany({
    where: { familyId: actor.familyId, status: 'PENDING' },
    orderBy: { submittedAt: 'asc' },
    include: {
      trait: true,
      child: { select: { id: true, nickname: true, avatarKey: true } },
    },
  });

  return Promise.all(
    submissions.map(async (submission) => {
      const total = await ledger.getStarsForTrait(prisma, submission.childId, submission.traitId);
      const progress = badgeProgress(total);
      const nextBadge = progress.nextTier
        ? await prisma.characterBadge.findFirst({
            where: { familyId: actor.familyId, traitId: submission.traitId, tier: progress.nextTier },
            select: { name: true, tier: true },
          })
        : null;

      return {
        submissionId: submission.id,
        childId: submission.child.id,
        childNickname: submission.child.nickname,
        childAvatarKey: submission.child.avatarKey,
        traitLabel: submission.trait.label,
        traitEmoji: submission.trait.emoji,
        story: submission.story,
        submittedAt: submission.submittedAt,
        currentTotal: total,
        nextBadgeName: nextBadge ? `${nextBadge.name} (${titleCase(nextBadge.tier)})` : null,
        remainingForNextBadge: progress.remaining,
      };
    }),
  );
}

/** The child's character profile (brief §8) — growth framing throughout. */
export async function getCharacterProfile(
  actor: Actor,
  childId: string,
): Promise<TraitTotal[]> {
  assertSelfChild(childId, actor);

  const [traits, totals] = await Promise.all([
    prisma.characterTrait.findMany({
      where: { familyId: actor.familyId, active: true, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }],
    }),
    ledger.getStarsByTrait(prisma, childId),
  ]);

  const totalById = new Map(totals.map((t) => [t.traitId, t.total]));

  return traits
    .map((trait) => {
      const total = totalById.get(trait.id) ?? 0;
      const progress = badgeProgress(total);
      return {
        traitId: trait.id,
        key: trait.key,
        label: trait.label,
        emoji: trait.emoji,
        colorKey: trait.colorKey,
        total,
        currentTier: progress.currentTier,
        nextTier: progress.nextTier,
        remaining: progress.remaining,
        message: growthMessage(total, progress.remaining, trait.label),
      } satisfies TraitTotal;
    })
    .sort((a, b) => b.total - a.total);
}

/** BR-34: no marks, no deficiencies — only an invitation to grow. */
function growthMessage(total: number, remaining: number, label: string): string {
  if (total === 0) return CHARACTER.growThisOne;
  if (remaining === 0) return CHARACTER.buildingSomething;
  return CHARACTER.momentsToBadge(remaining, label);
}

async function evaluateBadges(
  db: Db,
  childId: string,
  traitId: string,
): Promise<Array<{ name: string; tier: string }>> {
  const total = await ledger.getStarsForTrait(db, childId, traitId);

  const badges = await db.characterBadge.findMany({
    where: { traitId, active: true },
    orderBy: { threshold: 'asc' },
  });
  if (badges.length === 0) return [];

  const existing = await db.characterBadgeProgress.findMany({
    where: { childId, badgeId: { in: badges.map((b) => b.id) } },
  });
  const byBadgeId = new Map(existing.map((row) => [row.badgeId, row]));
  const alreadyUnlocked = badges
    .filter((badge) => byBadgeId.get(badge.id)?.unlockedAt)
    .map((badge) => badge.tier);

  const newlyUnlocked = tiersUnlockedBy(total, alreadyUnlocked);
  const unlocked: Array<{ name: string; tier: string }> = [];

  for (const badge of badges) {
    const isNew = newlyUnlocked.includes(badge.tier);
    await db.characterBadgeProgress.upsert({
      where: { childId_badgeId: { childId, badgeId: badge.id } },
      create: {
        childId,
        badgeId: badge.id,
        currentCount: total,
        unlockedAt: total >= badge.threshold ? new Date() : null,
      },
      update: {
        currentCount: total,
        ...(isNew ? { unlockedAt: new Date() } : {}),
      },
    });
    if (isNew) unlocked.push({ name: badge.name, tier: badge.tier });
  }

  return unlocked;
}

async function buildCelebration(
  db: Db,
  childId: string,
  traitId: string,
  params: {
    starsAwarded: number;
    xpAwarded: number;
    encouragement: string | null;
    parentUserId: string | null;
    familyId: string;
    badgesUnlocked: Array<{ name: string; tier: string }>;
  },
): Promise<CharacterCelebration> {
  const [trait, total, streak] = await Promise.all([
    db.characterTrait.findUniqueOrThrow({ where: { id: traitId } }),
    ledger.getStarsForTrait(db, childId, traitId),
    db.streak.findUnique({
      where: { childId_kind_key: { childId, kind: 'CHARACTER', key: '' } },
      select: { currentCount: true },
    }),
  ]);

  const parentName = params.parentUserId
    ? (
        await db.parentProfile.findUnique({
          where: { familyId_userId: { familyId: params.familyId, userId: params.parentUserId } },
          select: { displayName: true },
        })
      )?.displayName ?? null
    : null;

  const nextBadge = await db.characterBadge.findFirst({
    where: { traitId, threshold: { gt: total } },
    orderBy: { threshold: 'asc' },
  });

  return {
    traitLabel: trait.label,
    traitEmoji: trait.emoji,
    starsAwarded: params.starsAwarded,
    xpAwarded: params.xpAwarded,
    newTotal: total,
    headline: `${trait.label} Power +${params.starsAwarded}!`,
    message: nextBadge
      ? CHARACTER.becomingHero(nextBadge.name)
      : CHARACTER.buildingSomething,
    encouragement: params.encouragement,
    parentName,
    badgesUnlocked: params.badgesUnlocked,
    streakDays: streak?.currentCount ?? 0,
  };
}

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}
