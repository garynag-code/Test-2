import type { NotificationKind } from '@prisma/client';
import type { Db } from '@/server/db/prisma';

/**
 * In-app notification inbox (brief §41).
 *
 * Deliberately a database table rather than a push channel for the MVP: no
 * third-party service sees a child's activity, and the parent controls delivery
 * entirely. Push is a Phase 2 concern layered on top of these rows.
 */

interface BaseInput {
  familyId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  deepLink?: string;
  payload?: Record<string, unknown>;
}

export async function notifyChild(
  db: Db,
  input: BaseInput & { childId: string },
): Promise<void> {
  await db.notification.create({
    data: {
      familyId: input.familyId,
      recipientType: 'CHILD',
      recipientChildId: input.childId,
      kind: input.kind,
      title: input.title,
      body: input.body,
      deepLink: input.deepLink ?? null,
      payload: (input.payload ?? {}) as object,
    },
  });
}

/** Every active parent in the family hears about a submission. */
export async function notifyParents(db: Db, input: BaseInput): Promise<void> {
  const members = await db.familyMember.findMany({
    where: { familyId: input.familyId, status: 'ACTIVE' },
    select: { userId: true },
  });
  if (members.length === 0) return;

  await db.notification.createMany({
    data: members.map((member) => ({
      familyId: input.familyId,
      recipientType: 'PARENT' as const,
      recipientUserId: member.userId,
      kind: input.kind,
      title: input.title,
      body: input.body,
      deepLink: input.deepLink ?? null,
      payload: (input.payload ?? {}) as object,
    })),
  });
}

export async function listForParent(db: Db, userId: string, take = 30) {
  return db.notification.findMany({
    where: { recipientUserId: userId },
    orderBy: { createdAt: 'desc' },
    take,
  });
}

export async function listForChild(db: Db, childId: string, take = 30) {
  return db.notification.findMany({
    where: { recipientChildId: childId },
    orderBy: { createdAt: 'desc' },
    take,
  });
}

export async function unreadCountForParent(db: Db, userId: string): Promise<number> {
  return db.notification.count({ where: { recipientUserId: userId, readAt: null } });
}

export async function unreadCountForChild(db: Db, childId: string): Promise<number> {
  return db.notification.count({ where: { recipientChildId: childId, readAt: null } });
}

/** Scoped by recipient so one family member cannot mark another's inbox read. */
export async function markAllReadForParent(db: Db, userId: string): Promise<void> {
  await db.notification.updateMany({
    where: { recipientUserId: userId, readAt: null },
    data: { readAt: new Date() },
  });
}

export async function markAllReadForChild(db: Db, childId: string): Promise<void> {
  await db.notification.updateMany({
    where: { recipientChildId: childId, readAt: null },
    data: { readAt: new Date() },
  });
}
