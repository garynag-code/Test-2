import { prisma } from '@/server/db/prisma';
import { notFound } from '@/server/errors';
import { verifyPassword } from '@/server/auth/passwords';
import type { Actor } from '@/server/auth/actor';
import * as audit from '@/features/audit/service';

/**
 * Data export and family deletion (brief §40, Sprint 8).
 *
 * A family's data is theirs: they can take all of it, and they can destroy all
 * of it. Neither operation is reachable without a fresh password check.
 */

export async function exportFamily(actor: Actor) {
  if (actor.type !== 'parent') throw notFound();

  const family = await prisma.family.findUniqueOrThrow({
    where: { id: actor.familyId },
    include: {
      setting: true,
      members: { include: { user: { select: { email: true, displayName: true } } } },
      parentProfiles: true,
      children: { include: { setting: true } },
      tasks: { include: { schedule: true, assignments: true } },
      traits: true,
      rewards: true,
      wheels: { include: { items: true } },
      memoryChallenges: { include: { assignments: true } },
      secretMissions: true,
      achievements: true,
      levels: true,
      collectibles: true,
      avatarItems: true,
    },
  });

  const childIds = family.children.map((child) => child.id);

  const [
    xp,
    points,
    stars,
    completions,
    characterMoments,
    checkIns,
    redemptions,
    spins,
    streaks,
    auditLog,
  ] = await Promise.all([
    prisma.xpTransaction.findMany({ where: { childId: { in: childIds } } }),
    prisma.rewardPointsTransaction.findMany({ where: { childId: { in: childIds } } }),
    prisma.characterStarTransaction.findMany({ where: { childId: { in: childIds } } }),
    prisma.taskCompletion.findMany({
      where: { childId: { in: childIds } },
      include: { approvals: true, evidence: true },
    }),
    prisma.characterSubmission.findMany({
      where: { childId: { in: childIds } },
      include: { approval: true },
    }),
    prisma.dailyCheckIn.findMany({ where: { childId: { in: childIds } } }),
    prisma.rewardRedemption.findMany({ where: { childId: { in: childIds } } }),
    prisma.rewardSpin.findMany({ where: { childId: { in: childIds } } }),
    prisma.streak.findMany({ where: { childId: { in: childIds } } }),
    prisma.auditLog.findMany({
      where: { familyId: actor.familyId },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    notice:
      'This is everything Mission Hero holds about your family. Child profiles carry a nickname only — no email address, phone number or date of birth is stored.',
    family: {
      name: family.name,
      timezone: family.timezone,
      familyCode: family.familyCode,
      createdAt: family.createdAt,
      setting: family.setting,
    },
    // Password hashes are deliberately absent.
    grownUps: family.members.map((member) => ({
      email: member.user.email,
      displayName: member.user.displayName,
      role: member.role,
      joinedAt: member.joinedAt,
    })),
    parentProfiles: family.parentProfiles,
    children: family.children.map((child) => ({
      nickname: child.nickname,
      ageBracket: child.ageBracket,
      birthMonth: child.birthMonth,
      birthYear: child.birthYear,
      themeKey: child.themeKey,
      status: child.status,
      createdAt: child.createdAt,
      setting: child.setting,
    })),
    configuration: {
      tasks: family.tasks,
      traits: family.traits,
      rewards: family.rewards,
      wheels: family.wheels,
      memoryChallenges: family.memoryChallenges,
      secretMissions: family.secretMissions,
      achievements: family.achievements,
      levels: family.levels,
      collectibles: family.collectibles,
      avatarItems: family.avatarItems,
    },
    ledgers: { xp, rewardPoints: points, characterStars: stars },
    activity: { completions, characterMoments, checkIns, redemptions, spins, streaks },
    auditLog,
  };
}

/**
 * Permanently deletes a family and everything in it.
 *
 * Guarded by the owner's password and by typing the family's name, because
 * this cannot be undone: every cascade in the schema fires and no child row
 * survives.
 */
export async function deleteFamily(
  actor: Actor,
  input: { password: string; confirmation: string },
) {
  if (actor.type !== 'parent' || actor.role !== 'OWNER') throw notFound();

  const [user, family] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: actor.userId },
      select: { passwordHash: true },
    }),
    prisma.family.findUniqueOrThrow({
      where: { id: actor.familyId },
      select: { id: true, name: true },
    }),
  ]);

  const passwordOk = await verifyPassword(input.password, user.passwordHash);
  if (!passwordOk) throw notFound('That password does not match.');
  if (input.confirmation.trim() !== family.name) {
    throw notFound('Type the family name exactly to confirm.');
  }

  // Recorded before the cascade removes the family's audit rows with it.
  await audit.record(prisma, {
    actor,
    action: 'FAMILY_SETTINGS_CHANGED',
    entityType: 'Family',
    entityId: family.id,
    before: { name: family.name },
    after: { deleted: true },
    reason: 'Family deleted by owner',
  });

  await prisma.family.delete({ where: { id: family.id } });

  // Adults who belong to no other family go too, so nothing is left behind.
  await prisma.user.deleteMany({ where: { memberships: { none: {} } } });

  return { deleted: true, name: family.name };
}
