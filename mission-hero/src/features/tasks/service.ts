import type { Prisma } from '@prisma/client';
import { prisma, type Db } from '@/server/db/prisma';
import { notFound, validation } from '@/server/errors';
import { assertChildInFamily, assertSelfChild } from '@/server/auth/guards';
import type { Actor } from '@/server/auth/actor';
import {
  type LocalDate,
  endOfWeek,
  localDateToUtcDate,
  startOfWeek,
  toLocalDate,
  utcDateToLocalDate,
} from '@/domain/dates';
import { expandSchedule, type ScheduleSpec } from '@/domain/recurrence';
import { PENDING, REDO } from '@/domain/copy';
import * as audit from '@/features/audit/service';
import * as notifications from '@/features/notifications/service';
import * as repo from './repo';
import { createTaskSchema, type CreateTaskInput, type SubmitCompletionInput } from './schemas';
import type { MissionCard, MissionState, WeeklyProgress } from './types';

/**
 * Task lifecycle: create → materialise occurrences → child submits.
 *
 * Approval lives in `features/approvals` because it is the value-moving half
 * and deserves to be read on its own.
 */

export async function createTask(actor: Actor, input: CreateTaskInput) {
  if (actor.type !== 'parent') throw notFound();
  const parsed = createTaskSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    // Children are verified to belong to the actor's family before anything is
    // written — a forged child id must not create an assignment (BR-55).
    const children = await tx.childProfile.findMany({
      where: { id: { in: parsed.childIds }, familyId: actor.familyId, deletedAt: null },
      select: { id: true },
    });
    if (children.length !== parsed.childIds.length)
      throw notFound('One of those heroes was not found.');

    if (parsed.characterTraitId) {
      const trait = await tx.characterTrait.findFirst({
        where: { id: parsed.characterTraitId, familyId: actor.familyId },
        select: { id: true },
      });
      if (!trait) throw notFound('That character trait was not found.');
    }

    const categoryId = parsed.categoryKey
      ? ((
          await tx.taskCategory.findUnique({
            where: { familyId_key: { familyId: actor.familyId, key: parsed.categoryKey } },
            select: { id: true },
          })
        )?.id ?? null)
      : null;

    const task = await tx.task.create({
      data: {
        familyId: actor.familyId,
        title: parsed.title,
        description: parsed.description ?? null,
        categoryId,
        iconKey: parsed.iconKey,
        colorKey: parsed.colorKey,
        xpValue: parsed.xpValue,
        rewardPointsValue: parsed.rewardPointsValue,
        characterTraitId: parsed.characterTraitId ?? null,
        characterStarValue: parsed.characterStarValue,
        difficulty: parsed.difficulty,
        evidenceType: parsed.evidenceType,
        approvalRequired: parsed.approvalRequired,
        streakEligible: parsed.streakEligible,
        isFamilyTask: parsed.isFamilyTask,
        notes: parsed.notes ?? null,
        createdByUserId: actor.userId,
        schedule: {
          create: {
            frequency: parsed.schedule.frequency,
            interval: parsed.schedule.interval,
            weekdays: parsed.schedule.weekdays,
            monthDay: parsed.schedule.monthDay ?? null,
            month: parsed.schedule.month ?? null,
            startDate: localDateToUtcDate(parsed.schedule.startDate as LocalDate),
            endDate: parsed.schedule.endDate
              ? localDateToUtcDate(parsed.schedule.endDate as LocalDate)
              : null,
            dueTime: parsed.schedule.dueTime ?? null,
          },
        },
        assignments: { createMany: { data: children.map((child) => ({ childId: child.id })) } },
      },
      include: { schedule: true, assignments: true },
    });

    await audit.record(tx, {
      actor,
      action: 'TASK_CREATED',
      entityType: 'Task',
      entityId: task.id,
      after: {
        title: task.title,
        xpValue: task.xpValue,
        rewardPointsValue: task.rewardPointsValue,
      },
    });

    return task;
  });
}

/**
 * Materialises the occurrences due for a child on a date (BR-23).
 *
 * Idempotent: the unique index on `(taskId, childId, occurrenceDate)` means
 * calling this on every page load creates each occurrence exactly once.
 */
export async function ensureOccurrences(
  db: Db,
  params: { childId: string; familyId: string; date: LocalDate },
): Promise<void> {
  const tasks = await repo.listActiveTasksForChild(db, params.childId, params.familyId);
  if (tasks.length === 0) return;

  const due = tasks.filter((task) => {
    if (!task.schedule) return false;
    const spec: ScheduleSpec = {
      frequency: task.schedule.frequency,
      interval: task.schedule.interval,
      weekdays: task.schedule.weekdays,
      monthDay: task.schedule.monthDay,
      month: task.schedule.month,
      startDate: utcDateToLocalDate(task.schedule.startDate),
      endDate: task.schedule.endDate ? utcDateToLocalDate(task.schedule.endDate) : null,
    };
    return expandSchedule(spec, params.date, params.date).length === 1;
  });
  if (due.length === 0) return;

  const occurrenceDate = localDateToUtcDate(params.date);
  await db.taskOccurrence.createMany({
    data: due.map((task) => ({
      taskId: task.id,
      childId: params.childId,
      familyId: params.familyId,
      occurrenceDate,
      dueAt: task.schedule?.dueTime
        ? new Date(`${params.date}T${task.schedule.dueTime}:00.000Z`)
        : null,
    })),
    skipDuplicates: true,
  });
}

/** Today's mission cards for the child surface. */
export async function getMissionsForDate(
  actor: Actor,
  params: { childId: string; date: LocalDate },
): Promise<MissionCard[]> {
  assertSelfChild(params.childId, actor);
  const child = await prisma.childProfile.findFirst({
    where: { id: params.childId, deletedAt: null },
    select: { familyId: true },
  });
  if (!child) throw notFound();
  assertChildInFamily(child.familyId, actor);

  await ensureOccurrences(prisma, {
    childId: params.childId,
    familyId: child.familyId,
    date: params.date,
  });

  const occurrences = await repo.listOccurrencesForDate(prisma, params.childId, params.date);

  return occurrences.map((occurrence) => {
    const latest = occurrence.completions[0];
    const approval = latest?.approvals[0];
    return {
      occurrenceId: occurrence.id,
      taskId: occurrence.taskId,
      title: occurrence.task.title,
      description: occurrence.task.description,
      iconKey: occurrence.task.iconKey,
      colorKey: occurrence.task.colorKey,
      xpValue: occurrence.task.xpValue,
      rewardPointsValue: occurrence.task.rewardPointsValue,
      characterStarValue: occurrence.task.characterStarValue,
      traitLabel: occurrence.task.trait?.label ?? null,
      difficulty: occurrence.task.difficulty,
      evidenceType: occurrence.task.evidenceType,
      dueAt: occurrence.dueAt,
      state: missionStateOf(occurrence.status),
      parentMessage: approval?.encouragementMessage ?? approval?.question ?? null,
    } satisfies MissionCard;
  });
}

function missionStateOf(status: string): MissionState {
  switch (status) {
    case 'SUBMITTED':
      return 'WAITING';
    case 'APPROVED':
      return 'DONE';
    case 'REJECTED':
      return 'REDO';
    case 'MISSED':
      return 'MISSED';
    default:
      return 'OPEN';
  }
}

/**
 * A child claims a mission (BR-10): this writes a PENDING completion and awards
 * nothing at all. Value moves only when a parent approves.
 */
export async function submitCompletion(actor: Actor, input: SubmitCompletionInput) {
  if (actor.type !== 'child') throw notFound();

  return prisma.$transaction(async (tx) => {
    const occurrence = await repo.findOccurrenceForFamily(tx, input.occurrenceId, actor.familyId);
    if (!occurrence) throw notFound('That mission was not found.');
    assertSelfChild(occurrence.childId, actor);

    if (occurrence.status === 'SUBMITTED' || occurrence.status === 'APPROVED') {
      // Double-tap on DONE! — return the existing claim rather than erroring.
      const existing = await tx.taskCompletion.findFirst({
        where: { occurrenceId: occurrence.id, status: { in: ['PENDING', 'APPROVED'] } },
      });
      if (existing) return { completion: existing, created: false };
    }

    // BR-16: evidence is only demanded when the task asks for it.
    const needsText =
      occurrence.task.evidenceType === 'NOTE' || occurrence.task.evidenceType === 'PHOTO';
    if (needsText && !input.evidenceText && !input.note) {
      throw validation('Add a quick note about what you did.');
    }

    const completion = await tx.taskCompletion.create({
      data: {
        occurrenceId: occurrence.id,
        taskId: occurrence.taskId,
        childId: occurrence.childId,
        familyId: occurrence.familyId,
        status: 'PENDING',
        childNote: input.note ?? null,
      },
    });

    if (input.evidenceText) {
      await tx.taskEvidence.create({
        data: {
          completionId: completion.id,
          familyId: occurrence.familyId,
          type: 'NOTE',
          textBody: input.evidenceText,
        },
      });
    }

    await tx.taskOccurrence.update({
      where: { id: occurrence.id },
      data: { status: 'SUBMITTED' },
    });

    await notifications.notifyParents(tx, {
      familyId: occurrence.familyId,
      kind: 'TASK_SUBMITTED',
      title: `${occurrence.child.nickname} completed ${occurrence.task.title}`,
      body: 'Tap to approve.',
      deepLink: '/parent/approvals',
      payload: { completionId: completion.id },
    });

    await audit.record(tx, {
      actor,
      action: 'COMPLETION_SUBMITTED',
      entityType: 'TaskCompletion',
      entityId: completion.id,
      after: { taskId: occurrence.taskId, status: 'PENDING' },
    });

    return { completion, created: true };
  });
}

/** Weekly quest progress for the child dashboard (brief §25). */
export async function getWeeklyProgress(
  actor: Actor,
  params: { childId: string; today: LocalDate; target: number },
): Promise<WeeklyProgress> {
  assertSelfChild(params.childId, actor);
  const from = startOfWeek(params.today);
  const to = endOfWeek(params.today);

  const [occurrences, xp, points, stars] = await Promise.all([
    repo.listOccurrencesInRange(prisma, params.childId, from, to),
    sumSince(prisma.xpTransaction, params.childId, from),
    sumSince(prisma.rewardPointsTransaction, params.childId, from),
    sumSince(prisma.characterStarTransaction, params.childId, from),
  ]);

  return {
    completed: occurrences.filter((o) => o.status === 'APPROVED').length,
    target: Math.max(params.target, occurrences.length),
    xpThisWeek: xp,
    pointsThisWeek: points,
    starsThisWeek: stars,
  };
}

type Aggregatable = {
  aggregate: (args: {
    where: { childId: string; createdAt: { gte: Date }; amount?: Prisma.IntFilter };
    _sum: { amount: true };
  }) => Promise<{ _sum: { amount: number | null } }>;
};

/** Only credits count toward "earned this week"; a redemption is not a loss. */
async function sumSince(model: Aggregatable, childId: string, from: LocalDate): Promise<number> {
  const result = await model.aggregate({
    where: { childId, createdAt: { gte: localDateToUtcDate(from) }, amount: { gt: 0 } },
    _sum: { amount: true },
  });
  return result._sum.amount ?? 0;
}

export function localDateForFamily(timezone: string, at: Date = new Date()): LocalDate {
  return toLocalDate(at, timezone);
}

export const redoMessage = REDO.tryAgain;
export const pendingMessage = PENDING.waitingFor;
