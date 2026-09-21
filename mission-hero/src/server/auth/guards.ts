import 'server-only';
import { prisma } from '@/server/db/prisma';
import { notFound, unauthenticated } from '@/server/errors';
import type { Actor, ChildActor, ParentActor } from './actor';
import { readChildClaims, readParentClaims } from './session';

/**
 * Guards (docs/03 §2).
 *
 * Every entry point calls one of these first. `familyId` is taken from the
 * verified session claim and re-checked against a live membership row, so a
 * revoked parent loses access immediately rather than at cookie expiry.
 */

export async function getParentActor(): Promise<ParentActor | null> {
  const claims = await readParentClaims();
  if (!claims) return null;

  const membership = await prisma.familyMember.findFirst({
    where: {
      userId: claims.userId,
      familyId: claims.familyId,
      status: 'ACTIVE',
      user: { status: 'ACTIVE', deletedAt: null },
    },
    select: { role: true },
  });
  if (!membership) return null;

  return {
    type: 'parent',
    userId: claims.userId,
    familyId: claims.familyId,
    role: membership.role,
    authenticatedAt: claims.issuedAt,
  };
}

export async function requireParent(): Promise<ParentActor> {
  const actor = await getParentActor();
  if (!actor) throw unauthenticated('Please sign in to continue.');
  return actor;
}

/** The Parent Gate: sensitive screens need a recent full authentication. */
export async function requireFreshParent(maxAgeMinutes = 30): Promise<ParentActor> {
  const actor = await requireParent();
  const ageMinutes = (Date.now() - actor.authenticatedAt.getTime()) / 60_000;
  if (ageMinutes > maxAgeMinutes) {
    throw unauthenticated('Please confirm your password to continue.');
  }
  return actor;
}

export async function requireOwner(): Promise<ParentActor> {
  const actor = await requireParent();
  if (actor.role !== 'OWNER') throw notFound();
  return actor;
}

export async function getChildActor(): Promise<ChildActor | null> {
  const claims = await readChildClaims();
  if (!claims) return null;

  const child = await prisma.childProfile.findFirst({
    where: { id: claims.childId, familyId: claims.familyId, status: 'ACTIVE', deletedAt: null },
    select: { id: true },
  });
  if (!child) return null;

  return { type: 'child', childId: claims.childId, familyId: claims.familyId };
}

export async function requireChild(): Promise<ChildActor> {
  const actor = await getChildActor();
  if (!actor) throw unauthenticated('Pick your profile to keep going.');
  return actor;
}

/**
 * A child row belongs to the actor's family.
 *
 * Throws NOT_FOUND rather than FORBIDDEN on purpose (BR-58) — a 403 would
 * confirm that the id exists.
 */
export function assertChildInFamily(childFamilyId: string, actor: Actor): void {
  if (childFamilyId !== actor.familyId) throw notFound();
}

/** A child actor may only ever act for themselves (BR-57). */
export function assertSelfChild(childId: string, actor: Actor): void {
  if (actor.type === 'child' && actor.childId !== childId) throw notFound();
}

/** Only a parent (or the system, for opt-in auto-approval) may adjudicate. */
export function assertCanApprove(actor: Actor): void {
  if (actor.type !== 'parent' && actor.type !== 'system') throw notFound();
}
