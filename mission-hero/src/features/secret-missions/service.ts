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
  xpValue: z.number().int().min(0).max(500).default(20),
  rewardPointsValue: z.number().int().min(0).max(500).default(0),
  characterTraitId: z.string().uuid().optional(),
  starValue: z.number().int().min(0).max(5).default(0),
  grantsWheelSpin: z.boolean().default(false),
  hiddenObjectKey: z.string().trim().max(40).default('chest'),
});

export async function createMission(actor: Actor, input: z.infer<typeof createMissionSchema>) {
  if (actor.type !== 'parent') throw notFound();
  const parsed = createMissionSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    const mission = await tx.secretMission.create({
      data: { familyId: actor.familyId, ...parsed, characterTraitId: parsed.characterTraitId ?? null },
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
  const index =
    Math.abs(hashCode(`${params.childId}:${params.today}`)) % candidates.length;
  const mission = candidates[index]!;

  return {
    surface: placement.surface,
    offset: placement.offset,
    objectKey: mission.hiddenObjectKey || placement.objectKey,
    missionId: mission.id,
  };
}

/** BR-53: discovery reveals the mission and awards nothing. */
export async function discover(
  actor: Actor,
  input: { missionId: string; surfaceKey: string },
) {
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

export async function listDiscovered(actor: Actor, childId: string) {
  assertSelfChild(childId, actor);
  const discoveries = await prisma.secretMissionDiscovery.findMany({
    where: { childId, familyId: actor.familyId },
    include: { mission: true },
    orderBy: { discoveredAt: 'desc' },
  });

  const submissions = await prisma.secretMissionSubmission.findMany({
    where: { childId },
    select: { missionId: true, status: true },
  });
  const statusByMission = new Map(submissions.map((s) => [s.missionId, s.status]));

  return discoveries.map((discovery) => ({
    missionId: discovery.missionId,
    title: discovery.mission.title,
    instructions: discovery.mission.instructions,
    rarity: discovery.mission.rarity,
    xpValue: discovery.mission.xpValue,
    rewardPointsValue: discovery.mission.rewardPointsValue,
    discoveredAt: discovery.discoveredAt,
    status: statusByMission.get(discovery.missionId) ?? null,
  }));
}

export async function submit(actor: Actor, input: { missionId: string; note?: string }) {
  if (actor.type !== 'child') throw notFound();

  return prisma.$transaction(async (tx) => {
    const discovery = await tx.secretMissionDiscovery.findUnique({
      where: { childId_missionId: { childId: actor.childId, missionId: input.missionId } },
      include: { mission: true },
    });
    // A mission that has not been found cannot be claimed.
    if (!discovery || discovery.familyId !== actor.familyId) throw notFound();

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
      title: 'A secret mission is ready to check',
      body: discovery.mission.title,
      deepLink: '/parent/approvals',
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

    if (mission.xpValue > 0) {
      await ledger.awardXp(tx, {
        familyId: submission.familyId,
        childId: submission.childId,
        amount: mission.xpValue,
        sourceType: 'SECRET_MISSION',
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
        sourceType: 'SECRET_MISSION',
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
        sourceType: 'SECRET_MISSION',
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

    await notifications.notifyChild(tx, {
      familyId: submission.familyId,
      childId: submission.childId,
      kind: 'SECRET_MISSION_FOUND',
      title: 'Secret mission complete!',
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
