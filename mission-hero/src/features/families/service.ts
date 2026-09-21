import { prisma } from '@/server/db/prisma';
import { conflict, notFound } from '@/server/errors';
import { hashPassword, verifyPassword } from '@/server/auth/passwords';
import { generateFamilyCode, normaliseFamilyCode } from '@/server/auth/family-code';
import { systemActor, type Actor } from '@/server/auth/actor';
import * as audit from '@/features/audit/service';
import { seedFamilyDefaults } from './defaults';

/**
 * Registration and family lookup.
 *
 * Registration creates the User, the Family, the OWNER membership, the parent
 * profile and every family default in one transaction — a half-created family
 * would be worse than no family at all.
 */

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
  familyName: string;
  timezone: string;
  parentNickname?: string;
}

export async function registerParent(input: RegisterInput) {
  const email = input.email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) throw conflict('That email address is already registered.');

  const passwordHash = await hashPassword(input.password);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email, passwordHash, displayName: input.displayName.trim() },
    });

    const family = await tx.family.create({
      data: {
        name: input.familyName.trim(),
        timezone: input.timezone,
        familyCode: await uniqueFamilyCode(tx),
      },
    });

    await tx.familyMember.create({
      data: { familyId: family.id, userId: user.id, role: 'OWNER', joinedAt: new Date() },
    });

    await tx.parentProfile.create({
      data: {
        familyId: family.id,
        userId: user.id,
        displayName: input.parentNickname?.trim() || input.displayName.trim(),
      },
    });

    await seedFamilyDefaults(tx, family.id);

    await audit.record(tx, {
      actor: systemActor(family.id),
      action: 'FAMILY_CREATED',
      entityType: 'Family',
      entityId: family.id,
      after: { name: family.name, timezone: family.timezone },
    });

    return { user, family };
  });
}

export interface LoginResult {
  userId: string;
  familyId: string;
  displayName: string;
}

/**
 * Wrong email and wrong password produce the same error, and both still run a
 * bcrypt comparison, so the response does not reveal which accounts exist.
 */
export async function loginParent(email: string, password: string): Promise<LoginResult> {
  const normalised = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email: normalised },
    include: {
      memberships: {
        where: { status: 'ACTIVE' },
        orderBy: { createdAt: 'asc' },
        take: 1,
      },
    },
  });

  const hash = user?.passwordHash ?? '$2a$12$Mq9iRbW2xMt02OKkYnznT.diodEtzpn.pTPrsFa74RHyXKJaYe3ou';
  const ok = await verifyPassword(password, hash);

  const membership = user?.memberships[0];
  if (!user || !ok || user.status !== 'ACTIVE' || user.deletedAt || !membership) {
    throw notFound('That email and password do not match.');
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  return { userId: user.id, familyId: membership.familyId, displayName: user.displayName };
}

export async function findFamilyByCode(code: string) {
  const familyCode = normaliseFamilyCode(code);
  if (!familyCode) return null;
  return prisma.family.findUnique({
    where: { familyCode },
    select: { id: true, name: true, timezone: true },
  });
}

export async function getFamily(actor: Actor) {
  const family = await prisma.family.findUnique({
    where: { id: actor.familyId },
    include: { setting: true },
  });
  if (!family) throw notFound();
  return family;
}

export async function getSettings(actor: Actor) {
  const setting = await prisma.familySetting.findUnique({ where: { familyId: actor.familyId } });
  if (!setting) throw notFound();
  return setting;
}

async function uniqueFamilyCode(db: { family: { findUnique: (args: { where: { familyCode: string }; select: { id: true } }) => Promise<unknown> } }): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = generateFamilyCode();
    const clash = await db.family.findUnique({ where: { familyCode: code }, select: { id: true } });
    if (!clash) return code;
  }
  throw new Error('Could not allocate a unique family code');
}
