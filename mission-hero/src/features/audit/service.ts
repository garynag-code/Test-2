import type { AuditAction, Prisma } from '@prisma/client';
import type { Db } from '@/server/db/prisma';
import { auditActor, type Actor } from '@/server/auth/actor';

/**
 * Append-only audit trail (BR-59, brief §36).
 *
 * There is intentionally no update or delete function here. A disputed balance
 * must be reconstructable from these rows plus the ledgers.
 */

export interface AuditInput {
  actor: Actor;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  familyId?: string;
}

export async function record(db: Db, input: AuditInput): Promise<void> {
  const { actorType, actorUserId, actorChildId } = auditActor(input.actor);
  await db.auditLog.create({
    data: {
      familyId: input.familyId ?? input.actor.familyId,
      actorType,
      actorUserId,
      actorChildId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      beforeValue: toJson(input.before),
      afterValue: toJson(input.after),
      reason: input.reason ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
}

export async function listForFamily(
  db: Db,
  familyId: string,
  options: { take?: number; skip?: number; action?: AuditAction } = {},
) {
  return db.auditLog.findMany({
    where: { familyId, ...(options.action ? { action: options.action } : {}) },
    orderBy: { createdAt: 'desc' },
    take: options.take ?? 50,
    skip: options.skip ?? 0,
    include: {
      user: { select: { displayName: true } },
      child: { select: { nickname: true } },
    },
  });
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
