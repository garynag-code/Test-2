import type { Db } from '@/server/db/prisma';
import { type LocalDate, localDateToUtcDate } from '@/domain/dates';

/**
 * Task data access.
 *
 * Every finder is scoped by familyId in the same query — a row that belongs to
 * another family simply does not come back, which is what turns an IDOR attempt
 * into a 404 (docs/03 §3).
 */

export function findTaskForFamily(db: Db, taskId: string, familyId: string) {
  return db.task.findFirst({
    where: { id: taskId, familyId, deletedAt: null },
    include: { schedule: true, assignments: true },
  });
}

export function listActiveTasksForChild(db: Db, childId: string, familyId: string) {
  return db.task.findMany({
    where: {
      familyId,
      active: true,
      deletedAt: null,
      assignments: { some: { childId, active: true } },
    },
    include: { schedule: true, trait: { select: { id: true, label: true } } },
    orderBy: { createdAt: 'asc' },
  });
}

export function findOccurrenceForFamily(db: Db, occurrenceId: string, familyId: string) {
  return db.taskOccurrence.findFirst({
    where: { id: occurrenceId, familyId },
    include: {
      task: { include: { trait: { select: { id: true, label: true } } } },
      child: { select: { id: true, familyId: true, nickname: true } },
    },
  });
}

export function listOccurrencesForDate(db: Db, childId: string, date: LocalDate) {
  return db.taskOccurrence.findMany({
    // Ordered by when the task was created, so a child's list does not
    // reshuffle between page loads.
    orderBy: [{ task: { createdAt: 'asc' } }, { id: 'asc' }],
    where: { childId, occurrenceDate: localDateToUtcDate(date) },
    include: {
      task: { include: { trait: { select: { id: true, label: true } } } },
      completions: {
        orderBy: { submittedAt: 'desc' },
        take: 1,
        include: { approvals: { orderBy: { decidedAt: 'desc' }, take: 1 } },
      },
    },
  });
}

export function listOccurrencesInRange(db: Db, childId: string, from: LocalDate, to: LocalDate) {
  return db.taskOccurrence.findMany({
    where: {
      childId,
      occurrenceDate: { gte: localDateToUtcDate(from), lte: localDateToUtcDate(to) },
    },
    select: { id: true, status: true, occurrenceDate: true },
  });
}

/**
 * Locks the completion row for the transaction. `FOR UPDATE` here is what stops
 * two parents approving the same claim at the same moment (docs/03 §8).
 */
export async function lockCompletion(db: Db, completionId: string): Promise<void> {
  await db.$executeRaw`SELECT id FROM "TaskCompletion" WHERE id = ${completionId} FOR UPDATE`;
}

export function findCompletionForFamily(db: Db, completionId: string, familyId: string) {
  return db.taskCompletion.findFirst({
    where: { id: completionId, familyId },
    include: {
      task: { include: { trait: { select: { id: true, label: true, key: true } } } },
      child: { select: { id: true, familyId: true, nickname: true } },
      occurrence: true,
    },
  });
}

export function listPendingForFamily(db: Db, familyId: string) {
  return db.taskCompletion.findMany({
    where: { familyId, status: 'PENDING' },
    orderBy: { submittedAt: 'asc' },
    include: {
      task: { include: { trait: { select: { label: true } } } },
      child: { select: { id: true, nickname: true, avatarKey: true } },
      evidence: { take: 1, orderBy: { uploadedAt: 'desc' } },
    },
  });
}

export function countPendingForFamily(db: Db, familyId: string): Promise<number> {
  return db.taskCompletion.count({ where: { familyId, status: 'PENDING' } });
}
