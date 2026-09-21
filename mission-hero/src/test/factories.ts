import { prisma } from '@/server/db/prisma';
import { hashPassword, hashPin } from '@/server/auth/passwords';
import { generateFamilyCode } from '@/server/auth/family-code';
import type { ChildActor, ParentActor } from '@/server/auth/actor';
import { seedFamilyDefaults } from '@/features/families/defaults';
import { localDateToUtcDate, type LocalDate } from '@/domain/dates';

/**
 * Test factories. One call gives a realistic family so the tests read as
 * behaviour rather than as setup.
 */

let counter = 0;
const unique = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter += 1)}`;

export interface FamilyFixture {
  familyId: string;
  parentUserId: string;
  parentActor: ParentActor;
  childId: string;
  childActor: ChildActor;
  secondChildId: string;
  secondChildActor: ChildActor;
  timezone: string;
}

export async function createFamilyFixture(
  options: { timezone?: string; childPin?: string } = {},
): Promise<FamilyFixture> {
  const timezone = options.timezone ?? 'Africa/Johannesburg';

  const family = await prisma.family.create({
    data: { name: unique('Family'), timezone, familyCode: generateFamilyCode() },
  });
  await seedFamilyDefaults(prisma, family.id);

  const user = await prisma.user.create({
    data: {
      email: `${unique('parent')}@example.com`,
      passwordHash: await hashPassword('correct-horse-battery'),
      displayName: 'Alex Parent',
    },
  });
  await prisma.familyMember.create({
    data: { familyId: family.id, userId: user.id, role: 'OWNER', joinedAt: new Date() },
  });
  await prisma.parentProfile.create({
    data: { familyId: family.id, userId: user.id, displayName: 'Mom' },
  });

  const child = await prisma.childProfile.create({
    data: {
      familyId: family.id,
      nickname: 'Josh',
      ageBracket: 'AGE_9_11',
      ...(options.childPin
        ? { pinHash: await hashPin(options.childPin), pinRequired: true }
        : {}),
      setting: { create: {} },
    },
  });
  const secondChild = await prisma.childProfile.create({
    data: { familyId: family.id, nickname: 'Sarah', ageBracket: 'AGE_6_8', setting: { create: {} } },
  });

  return {
    familyId: family.id,
    parentUserId: user.id,
    parentActor: {
      type: 'parent',
      userId: user.id,
      familyId: family.id,
      role: 'OWNER',
      authenticatedAt: new Date(),
    },
    childId: child.id,
    childActor: { type: 'child', childId: child.id, familyId: family.id },
    secondChildId: secondChild.id,
    secondChildActor: { type: 'child', childId: secondChild.id, familyId: family.id },
    timezone,
  };
}

export interface TaskFixtureOptions {
  title?: string;
  xpValue?: number;
  rewardPointsValue?: number;
  characterStarValue?: number;
  traitKey?: string;
  approvalRequired?: boolean;
  streakEligible?: boolean;
  evidenceType?: 'NONE' | 'PHOTO' | 'NOTE' | 'VOICE' | 'PARENT_CONFIRM';
  startDate?: LocalDate;
  categoryKey?: string;
}

export async function createTaskFixture(
  fixture: FamilyFixture,
  childIds: string[],
  options: TaskFixtureOptions = {},
) {
  const traitId = options.traitKey
    ? (
        await prisma.characterTrait.findUniqueOrThrow({
          where: { familyId_key: { familyId: fixture.familyId, key: options.traitKey } },
          select: { id: true },
        })
      ).id
    : null;

  const categoryId = options.categoryKey
    ? (
        await prisma.taskCategory.findUniqueOrThrow({
          where: { familyId_key: { familyId: fixture.familyId, key: options.categoryKey } },
          select: { id: true },
        })
      ).id
    : null;

  return prisma.task.create({
    data: {
      familyId: fixture.familyId,
      title: options.title ?? 'Read for 20 Minutes',
      iconKey: 'book',
      categoryId,
      xpValue: options.xpValue ?? 10,
      rewardPointsValue: options.rewardPointsValue ?? 5,
      characterTraitId: traitId,
      characterStarValue: options.characterStarValue ?? 0,
      evidenceType: options.evidenceType ?? 'NONE',
      approvalRequired: options.approvalRequired ?? true,
      streakEligible: options.streakEligible ?? true,
      createdByUserId: fixture.parentUserId,
      schedule: {
        create: {
          frequency: 'DAILY',
          startDate: localDateToUtcDate(options.startDate ?? '2026-01-01'),
        },
      },
      assignments: { createMany: { data: childIds.map((childId) => ({ childId })) } },
    },
    include: { schedule: true },
  });
}

/** Creates the occurrence a child would tap DONE on. */
export async function createOccurrence(
  fixture: FamilyFixture,
  taskId: string,
  childId: string,
  date: LocalDate,
) {
  return prisma.taskOccurrence.create({
    data: {
      taskId,
      childId,
      familyId: fixture.familyId,
      occurrenceDate: localDateToUtcDate(date),
    },
  });
}

export async function traitId(familyId: string, key: string): Promise<string> {
  const trait = await prisma.characterTrait.findUniqueOrThrow({
    where: { familyId_key: { familyId, key } },
    select: { id: true },
  });
  return trait.id;
}

/** Credits points directly so a test can set up a spendable balance. */
export async function givePoints(
  familyId: string,
  childId: string,
  amount: number,
  key = unique('seed'),
): Promise<void> {
  await prisma.rewardPointsTransaction.create({
    data: {
      childId,
      familyId,
      amount,
      sourceType: 'MANUAL_ADJUSTMENT',
      idempotencyKey: `points:test:${key}`,
      reason: 'Test setup',
      description: 'Test setup',
    },
  });
}
