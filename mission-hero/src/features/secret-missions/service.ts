import { z } from 'zod';
import { prisma } from '@/server/db/prisma';
import { notFound } from '@/server/errors';
import { assertCanApprove, assertSelfChild } from '@/server/auth/guards';
import type { Actor } from '@/server/auth/actor';
import { type LocalDate, localDateToUtcDate } from '@/domain/dates';
import { ledgerKeys } from '@/domain/idempotency';
import { isHiddenObjectAvailable, placeHiddenObject } from '@/domain/hidden-objects';
import { CELEBRATION } from '@/domain/copy';
import * as ledger from '@/features/ledger/service';
import * as achievements from '@/features/achievements/service';
import * as collectibles from '@/features/collectibles/service';
import * as audit from '@/features/audit/service';
import * as notifications from '@/features/notifications/service';

/**
 * Secret missions and hidden objects (brief §16/§17, BR-51 … BR-54).
 *
 * Discovery itself awards nothing — completing the revealed mission does. The
 * object's position is a deterministic function of (child, day), so refreshing
 * the page cannot conjure a new one: an anti-farming measure, and more
 * importantly an anti-compulsion one.
 */

export const createMissionSchema = z.object({
  title: z.string().trim().min(1).max(120),
  instructions: z.string().trim().min(1).max(1000),
  rarity: z.enum(['COMMON', 'RARE', 'EPIC', 'LEGENDARY']).default('COMMON'),
  /** false makes this a bonus challenge: listed openly, no hunting required. */
  requiresDiscovery: z.boolean().default(true),
  xpValue: z.number().int().min(0).max(500).default(20),
  rewardPointsValue: z.number().int().min(0).max(500).default(0),
  characterTraitId: z.string().uuid().optional(),
  starValue: z.number().int().min(0).max(5).default(0),
  grantsWheelSpin: z.boolean().default(false),
  hiddenObjectKey: z.string().trim().max(40).default('chest'),
});

export async function createMission(actor: Actor, input: z.input<typeof createMissionSchema>) {
  if (actor.type !== 'parent') throw notFound();
  const parsed = createMissionSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    const mission = await tx.secretMission.create({
      data: {
        familyId: actor.familyId,
        ...parsed,
        characterTraitId: parsed.characterTraitId ?? null,
      },
    });
    await audit.record(tx, {
      actor,
      action: 'SECRET_MISSION_CREATED',
      entityType: 'SecretMission',
      entityId: mission.id,
      after: { title: mission.title, rarity: mission.rarity },
    });
    return mission;
  });
}

export interface HiddenObjectHint {
  surface: string;
  offset: number;
  objectKey: string;
  missionId: string;
}

/**
 * Where (and whether) today's hidden object sits for this child. Returns null
 * once every available mission has already been discovered.
 */
export async function getHiddenObject(
  actor: Actor,
  params: { childId: string; today: LocalDate },
): Promise<HiddenObjectHint | null> {
  assertSelfChild(params.childId, actor);

  const setting = await prisma.familySetting.findUnique({ where: { familyId: actor.familyId } });
  if (!setting?.hiddenObjectsEnabled || !setting.secretMissionsEnabled) return null;
  if (!isHiddenObjectAvailable(params.childId, params.today)) return null;

  const date = localDateToUtcDate(params.today);
  const candidates = await prisma.secretMission.findMany({
    where: {
      familyId: actor.familyId,
      active: true,
      deletedAt: null,
      requiresDiscovery: true,
      discoveries: { none: { childId: params.childId } },
      AND: [
        { OR: [{ availableFrom: null }, { availableFrom: { lte: date } }] },
        { OR: [{ availableTo: null }, { availableTo: { gte: date } }] },
      ],
    },
    orderBy: { createdAt: 'asc' },
  });
  if (candidates.length === 0) return null;

  const placement = placeHiddenObject(params.childId, params.today);
  // The same seed picks the mission, so the hint is stable for the day.
  const index = Math.abs(hashCode(`${params.childId}:${params.today}`)) % candidates.length;
  const mission = candidates[index]!;

  return {
    surface: placement.surface,
    offset: placement.offset,
    objectKey: mission.hiddenObjectKey || placement.objectKey,
    missionId: mission.id,
  };
}

/** BR-53: discovery reveals the mission and awards nothing. */
export async function discover(actor: Actor, input: { missionId: string; surfaceKey: string }) {
  if (actor.type !== 'child') throw notFound();

  const mission = await prisma.secretMission.findFirst({
    where: { id: input.missionId, familyId: actor.familyId, active: true, deletedAt: null },
  });
  if (!mission) throw notFound();

  // Already found? Show the same mission rather than an error (BR-52).
  await prisma.secretMissionDiscovery.createMany({
    data: [
      {
        missionId: mission.id,
        childId: actor.childId,
        familyId: actor.familyId,
        hiddenObjectKey: mission.hiddenObjectKey,
        surfaceKey: input.surfaceKey,
      },
    ],
    skipDuplicates: true,
  });

  await audit.record(prisma, {
    actor,
    action: 'SECRET_MISSION_DISCOVERED',
    entityType: 'SecretMission',
    entityId: mission.id,
    after: { surfaceKey: input.surfaceKey },
  });

  return { headline: CELEBRATION.secretFound, mission };
}

export interface QuestCard {
  missionId: string;
  title: string;
  instructions: string;
  rarity: string;
  xpValue: number;
  rewardPointsValue: number;
  traitLabel: string | null;
  starValue: number;
  /** A found secret mission, or an openly-listed bonus challenge. */
  kind: 'SECRET' | 'BONUS';
  discoveredAt: Date | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'QUESTION_ASKED' | null;
}

/**
 * Everything a child can work on right now: secret missions they have found,
 * plus bonus challenges, which need no finding.
 */
export async function listQuestsForChild(actor: Actor, childId: string): Promise<QuestCard[]> {
  assertSelfChild(childId, actor);

  const [discoveries, bonus, submissions] = await Promise.all([
    prisma.secretMissionDiscovery.findMany({
      where: { childId, familyId: actor.familyId },
      include: { mission: { include: { trait: { select: { label: true } } } } },
      orderBy: { discoveredAt: 'desc' },
    }),
    prisma.secretMission.findMany({
      where: {
        familyId: actor.familyId,
        requiresDiscovery: false,
        active: true,
        deletedAt: null,
      },
      include: { trait: { select: { label: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.secretMissionSubmission.findMany({
      where: { childId },
      select: { missionId: true, status: true },
    }),
  ]);

  const statusByMission = new Map(submissions.map((s) => [s.missionId, s.status]));

  const fromDiscoveries: QuestCard[] = discoveries.map((discovery) => ({
    missionId: discovery.missionId,
    title: discovery.mission.title,
    instructions: discovery.mission.instructions,
    rarity: discovery.mission.rarity,
    xpValue: discovery.mission.xpValue,
    rewardPointsValue: discovery.mission.rewardPointsValue,
    traitLabel: discovery.mission.trait?.label ?? null,
    starValue: discovery.mission.starValue,
    kind: 'SECRET',
    discoveredAt: discovery.discoveredAt,
    status: statusByMission.get(discovery.missionId) ?? null,
  }));

  const fromBonus: QuestCard[] = bonus.map((mission) => ({
    missionId: mission.id,
    title: mission.title,
    instructions: mission.instructions,
    rarity: mission.rarity,
    xpValue: mission.xpValue,
    rewardPointsValue: mission.rewardPointsValue,
    traitLabel: mission.trait?.label ?? null,
    starValue: mission.starValue,
    kind: 'BONUS',
    discoveredAt: null,
    status: statusByMission.get(mission.id) ?? null,
  }));

  // Anything still to do comes first; finished quests sink to the bottom.
  return [...fromDiscoveries, ...fromBonus].sort((a, b) => {
    const aDone = a.status === 'APPROVED' ? 1 : 0;
    const bDone = b.status === 'APPROVED' ? 1 : 0;
    return aDone - bDone;
  });
}

export async function submit(actor: Actor, input: { missionId: string; note?: string }) {
  if (actor.type !== 'child') throw notFound();

  return prisma.$transaction(async (tx) => {
    const mission = await tx.secretMission.findFirst({
      where: { id: input.missionId, familyId: actor.familyId, active: true, deletedAt: null },
    });
    if (!mission) throw notFound();

    // A *secret* mission that has not been found cannot be claimed; a bonus
    // challenge is open to everyone, so it needs no discovery row.
    if (mission.requiresDiscovery) {
      const discovery = await tx.secretMissionDiscovery.findUnique({
        where: { childId_missionId: { childId: actor.childId, missionId: input.missionId } },
        select: { id: true },
      });
      if (!discovery) throw notFound();
    }

    const submission = await tx.secretMissionSubmission.upsert({
      where: { childId_missionId: { childId: actor.childId, missionId: input.missionId } },
      create: {
        missionId: input.missionId,
        childId: actor.childId,
        familyId: actor.familyId,
        childNote: input.note ?? null,
        status: 'PENDING',
      },
      update: {},
    });

    await notifications.notifyParents(tx, {
      familyId: actor.familyId,
      kind: 'SECRET_MISSION_FOUND',
      title: mission.requiresDiscovery
        ? 'A secret mission is ready to check'
        : 'A bonus challenge is ready to check',
      body: mission.title,
      deepLink: '/parent/approvals?tab=quests',
      payload: { submissionId: submission.id },
    });

    return submission;
  });
}

export async function approve(actor: Actor, input: { submissionId: string }) {
  assertCanApprove(actor);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "SecretMissionSubmission" WHERE id = ${input.submissionId} FOR UPDATE`;

    const submission = await tx.secretMissionSubmission.findFirst({
      where: { id: input.submissionId, familyId: actor.familyId },
      include: { mission: true },
    });
    if (!submission) throw notFound();
    if (submission.status !== 'PENDING') return submission;

    const { mission } = submission;
    const key = ledgerKeys.secretMission(submission.id);
    const awardedByUserId = actor.type === 'parent' ? actor.userId : null;

    await tx.secretMissionSubmission.update({
      where: { id: submission.id },
      data: { status: 'APPROVED', resolvedAt: new Date(), parentUserId: awardedByUserId },
    });

    // The enum distinguishes the two so a child's history reads truthfully.
    const sourceType = mission.requiresDiscovery ? 'SECRET_MISSION' : 'BONUS_CHALLENGE';

    if (mission.xpValue > 0) {
      await ledger.awardXp(tx, {
        familyId: submission.familyId,
        childId: submission.childId,
        amount: mission.xpValue,
        sourceType,
        sourceId: submission.id,
        idempotencyKey: `xp:${key}`,
        awardedByUserId,
        description: `Secret mission: ${mission.title}`,
      });
    }
    if (mission.rewardPointsValue > 0) {
      await ledger.awardPoints(tx, {
        familyId: submission.familyId,
        childId: submission.childId,
        amount: mission.rewardPointsValue,
        sourceType,
        sourceId: submission.id,
        idempotencyKey: `points:${key}`,
        awardedByUserId,
        description: `Secret mission: ${mission.title}`,
      });
    }
    if (mission.starValue > 0 && mission.characterTraitId) {
      await ledger.awardStars(tx, {
        familyId: submission.familyId,
        childId: submission.childId,
        traitId: mission.characterTraitId,
        amount: mission.starValue,
        sourceType,
        sourceId: submission.id,
        idempotencyKey: `star:${key}`,
        awardedByUserId,
        description: `Secret mission: ${mission.title}`,
      });
    }

    await achievements.evaluateForChild(tx, {
      childId: submission.childId,
      familyId: submission.familyId,
    });
    await collectibles.evaluateForChild(tx, {
      childId: submission.childId,
      familyId: submission.familyId,
    });

    await notifications.notifyChild(tx, {
      familyId: submission.familyId,
      childId: submission.childId,
      kind: 'SECRET_MISSION_FOUND',
      title: mission.requiresDiscovery ? 'Secret mission complete!' : 'Bonus challenge complete!',
      body: `+${mission.xpValue} XP`,
      deepLink: '/kids/home',
    });

    await audit.record(tx, {
      actor,
      action: 'SECRET_MISSION_APPROVED',
      entityType: 'SecretMissionSubmission',
      entityId: submission.id,
      after: { xp: mission.xpValue, points: mission.rewardPointsValue },
      familyId: submission.familyId,
    });

    return submission;
  });
}

function hashCode(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (Math.imul(31, hash) + input.charCodeAt(i)) | 0;
  }
  return hash;
}

export async function listPendingQuests(actor: Actor) {
  if (actor.type !== 'parent') throw notFound();

  const submissions = await prisma.secretMissionSubmission.findMany({
    where: { familyId: actor.familyId, status: 'PENDING' },
    orderBy: { submittedAt: 'asc' },
    include: {
      mission: { include: { trait: { select: { label: true } } } },
      child: { select: { nickname: true, avatarKey: true } },
    },
  });

  return submissions.map((submission) => ({
    submissionId: submission.id,
    childNickname: submission.child.nickname,
    title: submission.mission.title,
    instructions: submission.mission.instructions,
    childNote: submission.childNote,
    submittedAt: submission.submittedAt,
    xpValue: submission.mission.xpValue,
    rewardPointsValue: submission.mission.rewardPointsValue,
    traitLabel: submission.mission.trait?.label ?? null,
    starValue: submission.mission.starValue,
    kind: submission.mission.requiresDiscovery ? ('SECRET' as const) : ('BONUS' as const),
  }));
}

/** Awards nothing and reopens the quest so the child can have another go. */
export async function declineQuest(
  actor: Actor,
  input: { submissionId: string; message?: string },
) {
  assertCanApprove(actor);

  return prisma.$transaction(async (tx) => {
    const submission = await tx.secretMissionSubmission.findFirst({
      where: { id: input.submissionId, familyId: actor.familyId },
      include: { mission: { select: { title: true } } },
    });
    if (!submission) throw notFound();
    if (submission.status !== 'PENDING') return submission;

    // Deleted rather than marked rejected: the unique (childId, missionId)
    // constraint would otherwise block a second attempt at the same quest.
    await tx.secretMissionSubmission.delete({ where: { id: submission.id } });

    await notifications.notifyChild(tx, {
      familyId: submission.familyId,
      childId: submission.childId,
      kind: 'ENCOURAGEMENT',
      title: submission.mission.title,
      body: input.message ?? 'Have another go at this one when you can.',
      deepLink: '/kids/quests',
    });

    await audit.record(tx, {
      actor,
      action: 'SECRET_MISSION_APPROVED',
      entityType: 'SecretMissionSubmission',
      entityId: submission.id,
      before: { status: 'PENDING' },
      after: { status: 'REOPENED', xp: 0, points: 0 },
      reason: input.message ?? null,
      familyId: submission.familyId,
    });

    return submission;
  });
}
