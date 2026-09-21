import { randomBytes } from 'node:crypto';
import { prisma } from '@/server/db/prisma';
import { conflict, notFound } from '@/server/errors';
import { hashPassword } from '@/server/auth/passwords';
import type { Actor } from '@/server/auth/actor';
import * as audit from '@/features/audit/service';

/**
 * Inviting a second adult (brief §29, Sprint 7).
 *
 * The invite carries a random single-use token and an expiry. Accepting it is
 * the only way to gain a membership, and the token is consumed in the same
 * transaction that creates it, so a link cannot be redeemed twice.
 */

const INVITE_TTL_DAYS = 14;

export async function inviteParent(
  actor: Actor,
  input: { email: string; role?: 'PARENT' | 'GUARDIAN' },
) {
  // Only the owner may widen who can administer a family.
  if (actor.type !== 'parent' || actor.role !== 'OWNER') throw notFound();

  const email = input.email.trim().toLowerCase();

  const alreadyMember = await prisma.familyMember.findFirst({
    where: { familyId: actor.familyId, status: 'ACTIVE', user: { email } },
    select: { id: true },
  });
  if (alreadyMember) throw conflict('They are already part of this family.');

  const token = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

  return prisma.$transaction(async (tx) => {
    // Re-inviting replaces the previous link rather than stacking invitations.
    const invite = await tx.familyInvite.upsert({
      where: { familyId_email: { familyId: actor.familyId, email } },
      create: {
        familyId: actor.familyId,
        email,
        role: input.role ?? 'PARENT',
        token,
        invitedByUserId: actor.userId,
        expiresAt,
      },
      update: {
        token,
        role: input.role ?? 'PARENT',
        expiresAt,
        acceptedAt: null,
        revokedAt: null,
        invitedByUserId: actor.userId,
      },
    });

    await audit.record(tx, {
      actor,
      action: 'PARENT_INVITED',
      entityType: 'FamilyInvite',
      entityId: invite.id,
      after: { email, role: invite.role },
    });

    return invite;
  });
}

export async function listInvites(actor: Actor) {
  if (actor.type !== 'parent') throw notFound();
  return prisma.familyInvite.findMany({
    where: { familyId: actor.familyId, acceptedAt: null, revokedAt: null },
    orderBy: { createdAt: 'desc' },
  });
}

export async function revokeInvite(actor: Actor, inviteId: string) {
  if (actor.type !== 'parent' || actor.role !== 'OWNER') throw notFound();

  const invite = await prisma.familyInvite.findFirst({
    where: { id: inviteId, familyId: actor.familyId },
    select: { id: true },
  });
  if (!invite) throw notFound();

  await prisma.familyInvite.update({
    where: { id: invite.id },
    data: { revokedAt: new Date() },
  });
}

export async function findValidInvite(token: string) {
  if (!token) return null;
  const invite = await prisma.familyInvite.findUnique({
    where: { token },
    include: { family: { select: { id: true, name: true } } },
  });
  if (!invite) return null;
  if (invite.acceptedAt || invite.revokedAt) return null;
  if (invite.expiresAt < new Date()) return null;
  return invite;
}

export interface AcceptInviteInput {
  token: string;
  password: string;
  displayName: string;
  parentNickname?: string;
}

/**
 * Accepting creates the adult's account (or attaches an existing one) and their
 * membership, and consumes the token — all in one transaction.
 */
export async function acceptInvite(input: AcceptInviteInput) {
  const invite = await findValidInvite(input.token);
  if (!invite) throw notFound('That invitation is no longer valid.');

  const existing = await prisma.user.findUnique({
    where: { email: invite.email },
    select: { id: true },
  });
  const passwordHash = existing ? null : await hashPassword(input.password);

  return prisma.$transaction(async (tx) => {
    // Re-read inside the transaction so two clicks cannot both consume it.
    const fresh = await tx.familyInvite.findUnique({ where: { id: invite.id } });
    if (!fresh || fresh.acceptedAt || fresh.revokedAt || fresh.expiresAt < new Date()) {
      throw notFound('That invitation is no longer valid.');
    }

    const user = existing
      ? await tx.user.findUniqueOrThrow({ where: { id: existing.id } })
      : await tx.user.create({
          data: {
            email: invite.email,
            passwordHash: passwordHash!,
            displayName: input.displayName.trim(),
          },
        });

    await tx.familyMember.upsert({
      where: { familyId_userId: { familyId: invite.familyId, userId: user.id } },
      create: {
        familyId: invite.familyId,
        userId: user.id,
        role: invite.role,
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
      update: { status: 'ACTIVE', joinedAt: new Date(), role: invite.role },
    });

    await tx.parentProfile.upsert({
      where: { familyId_userId: { familyId: invite.familyId, userId: user.id } },
      create: {
        familyId: invite.familyId,
        userId: user.id,
        displayName: input.parentNickname?.trim() || input.displayName.trim(),
      },
      update: {},
    });

    await tx.familyInvite.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date() },
    });

    await audit.record(tx, {
      actor: { type: 'system', familyId: invite.familyId },
      action: 'PARENT_INVITED',
      entityType: 'FamilyMember',
      entityId: user.id,
      after: { email: invite.email, accepted: true },
    });

    return { userId: user.id, familyId: invite.familyId };
  });
}
