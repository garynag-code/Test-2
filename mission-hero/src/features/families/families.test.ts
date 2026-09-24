import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db/prisma';
import * as invites from '@/features/families/invites';
import * as settings from '@/features/families/settings';
import * as familyData from '@/features/families/data';
import * as families from '@/features/families/service';
import { verifyPin } from '@/server/auth/passwords';
import { createFamilyFixture, createTaskFixture, type FamilyFixture } from '@/test/factories';

/** Parent depth: invites, settings, export and deletion (Sprint 7). */

let fixture: FamilyFixture;

beforeEach(async () => {
  fixture = await createFamilyFixture();
});

describe('inviting a second adult', () => {
  it('creates a single-use token with an expiry', async () => {
    const invite = await invites.inviteParent(fixture.parentActor, { email: 'Dad@Example.com' });

    expect(invite.email).toBe('dad@example.com');
    expect(invite.token).toHaveLength(32);
    expect(invite.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(invite.acceptedAt).toBeNull();
  });

  it('accepting creates the account, the membership and the profile', async () => {
    const invite = await invites.inviteParent(fixture.parentActor, { email: 'dad@example.com' });

    const result = await invites.acceptInvite({
      token: invite.token,
      password: 'a-long-enough-password',
      displayName: 'Chris',
      parentNickname: 'Dad',
    });

    expect(result.familyId).toBe(fixture.familyId);

    const member = await prisma.familyMember.findFirstOrThrow({
      where: { familyId: fixture.familyId, userId: result.userId },
    });
    expect(member.status).toBe('ACTIVE');
    expect(member.role).toBe('PARENT');

    const profile = await prisma.parentProfile.findFirstOrThrow({
      where: { familyId: fixture.familyId, userId: result.userId },
    });
    expect(profile.displayName).toBe('Dad');
  });

  it('a token can only be used once', async () => {
    const invite = await invites.inviteParent(fixture.parentActor, { email: 'dad@example.com' });
    await invites.acceptInvite({
      token: invite.token,
      password: 'a-long-enough-password',
      displayName: 'Chris',
    });

    await expect(
      invites.acceptInvite({
        token: invite.token,
        password: 'another-long-password',
        displayName: 'Someone Else',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(await prisma.familyMember.count({ where: { familyId: fixture.familyId } })).toBe(2);
  });

  it('two people clicking the same link at once produce one membership', async () => {
    const invite = await invites.inviteParent(fixture.parentActor, { email: 'dad@example.com' });

    const results = await Promise.allSettled([
      invites.acceptInvite({
        token: invite.token,
        password: 'a-long-enough-password',
        displayName: 'Chris',
      }),
      invites.acceptInvite({
        token: invite.token,
        password: 'a-long-enough-password',
        displayName: 'Chris',
      }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    expect(await prisma.familyMember.count({ where: { familyId: fixture.familyId } })).toBe(2);
  });

  it('an expired token is refused', async () => {
    const invite = await invites.inviteParent(fixture.parentActor, { email: 'dad@example.com' });
    await prisma.familyInvite.update({
      where: { id: invite.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect(await invites.findValidInvite(invite.token)).toBeNull();
  });

  it('a revoked token is refused', async () => {
    const invite = await invites.inviteParent(fixture.parentActor, { email: 'dad@example.com' });
    await invites.revokeInvite(fixture.parentActor, invite.id);

    expect(await invites.findValidInvite(invite.token)).toBeNull();
  });

  it('re-inviting replaces the previous link rather than stacking them', async () => {
    const first = await invites.inviteParent(fixture.parentActor, { email: 'dad@example.com' });
    const second = await invites.inviteParent(fixture.parentActor, { email: 'dad@example.com' });

    expect(second.token).not.toBe(first.token);
    expect(await invites.findValidInvite(first.token)).toBeNull();
    expect(await invites.findValidInvite(second.token)).not.toBeNull();
    expect(await prisma.familyInvite.count({ where: { familyId: fixture.familyId } })).toBe(1);
  });

  it('refuses to invite someone already in the family', async () => {
    const existing = await prisma.user.findUniqueOrThrow({ where: { id: fixture.parentUserId } });
    await expect(
      invites.inviteParent(fixture.parentActor, { email: existing.email }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('only the owner may invite', async () => {
    const notOwner = { ...fixture.parentActor, role: 'PARENT' as const };
    await expect(
      invites.inviteParent(notOwner, { email: 'dad@example.com' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a child cannot invite anyone', async () => {
    await expect(
      invites.inviteParent(fixture.childActor, { email: 'dad@example.com' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it("a parent cannot revoke another family's invite", async () => {
    const other = await createFamilyFixture();
    const invite = await invites.inviteParent(other.parentActor, { email: 'dad@example.com' });

    await expect(invites.revokeInvite(fixture.parentActor, invite.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('an unknown token reveals nothing', async () => {
    expect(await invites.findValidInvite('not-a-real-token')).toBeNull();
    expect(await invites.findValidInvite('')).toBeNull();
  });
});

describe('family settings', () => {
  const base = {
    mediaUploadsEnabled: false,
    photoEvidenceEnabled: false,
    voiceNotesEnabled: false,
    wheelEnabled: true,
    secretMissionsEnabled: true,
    hiddenObjectsEnabled: true,
    soundEnabled: true,
    characterVerificationRequired: true,
    characterXpPerStar: 5,
    checkInXp: 5,
    checkInPoints: 0,
    weeklyGoalTarget: 25,
    parentGateTimeoutMinutes: 30,
  };

  it('saves changes and audits them with before and after', async () => {
    await settings.updateFamilySettings(fixture.parentActor, { ...base, checkInXp: 12 });

    const saved = await prisma.familySetting.findUniqueOrThrow({
      where: { familyId: fixture.familyId },
    });
    expect(saved.checkInXp).toBe(12);

    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'FAMILY_SETTINGS_CHANGED' },
    });
    expect(entry.beforeValue).toMatchObject({ checkInXp: 5 });
    expect(entry.afterValue).toMatchObject({ checkInXp: 12 });
  });

  it('cannot leave photo or voice on while media uploads are off', async () => {
    await settings.updateFamilySettings(fixture.parentActor, {
      ...base,
      mediaUploadsEnabled: false,
      photoEvidenceEnabled: true,
      voiceNotesEnabled: true,
    });

    const saved = await prisma.familySetting.findUniqueOrThrow({
      where: { familyId: fixture.familyId },
    });
    // A parent who switches media off must not be told one thing and given another.
    expect(saved.photoEvidenceEnabled).toBe(false);
    expect(saved.voiceNotesEnabled).toBe(false);
  });

  it('a child cannot change family settings', async () => {
    await expect(settings.updateFamilySettings(fixture.childActor, base)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('child settings', () => {
  it('sets a PIN, and clearing it also lifts a lockout', async () => {
    await settings.setChildPin(fixture.parentActor, { childId: fixture.childId, pin: '4821' });

    let child = await prisma.childProfile.findUniqueOrThrow({ where: { id: fixture.childId } });
    expect(child.pinRequired).toBe(true);
    expect(await verifyPin('4821', child.pinHash)).toBe(true);

    await prisma.childProfile.update({
      where: { id: fixture.childId },
      data: { pinFailedAttempts: 4, pinLockedUntil: new Date(Date.now() + 60_000) },
    });

    await settings.setChildPin(fixture.parentActor, { childId: fixture.childId, pin: null });

    child = await prisma.childProfile.findUniqueOrThrow({ where: { id: fixture.childId } });
    expect(child.pinRequired).toBe(false);
    expect(child.pinHash).toBeNull();
    expect(child.pinLockedUntil).toBeNull();
    expect(child.pinFailedAttempts).toBe(0);
  });

  it('changes the avatar, which used to be fixed at creation', async () => {
    const before = await prisma.childProfile.findUniqueOrThrow({
      where: { id: fixture.childId },
      select: { nickname: true, themeKey: true },
    });

    await settings.updateChildSettings(fixture.parentActor, {
      childId: fixture.childId,
      nickname: before.nickname,
      avatarKey: 'hero-19',
      themeKey: before.themeKey,
      reducedMotion: false,
      characterAutoApprove: false,
      dailyTaskTarget: 4,
      notificationsEnabled: true,
      soundEnabled: true,
    });

    const after = await prisma.childProfile.findUniqueOrThrow({
      where: { id: fixture.childId },
      select: { avatarKey: true },
    });
    expect(after.avatarKey).toBe('hero-19');
  });

  it('refuses a malformed PIN', async () => {
    await expect(
      settings.setChildPin(fixture.parentActor, { childId: fixture.childId, pin: '12' }),
    ).rejects.toThrow();
  });

  it("a parent cannot set a PIN on another family's child", async () => {
    const other = await createFamilyFixture();
    await expect(
      settings.setChildPin(fixture.parentActor, { childId: other.childId, pin: '1234' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('archiving hides a child without destroying anything', async () => {
    await createTaskFixture(fixture, [fixture.childId]);
    await settings.setChildStatus(fixture.parentActor, {
      childId: fixture.childId,
      status: 'ARCHIVED',
    });

    const child = await prisma.childProfile.findUniqueOrThrow({ where: { id: fixture.childId } });
    expect(child.status).toBe('ARCHIVED');
    expect(child.deletedAt).toBeNull();
    expect(await prisma.taskAssignment.count({ where: { childId: fixture.childId } })).toBe(1);
  });
});

describe('choosing the family code', () => {
  it('replaces the generated code with a memorable one', async () => {
    await settings.updateFamilyCode(fixture.parentActor, { familyCode: 'nagels' });

    const family = await prisma.family.findUniqueOrThrow({
      where: { id: fixture.familyId },
      select: { familyCode: true },
    });
    // Stored the way a child will type it, however it was entered.
    expect(family.familyCode).toBe('NAGELS');
  });

  it('accepts what the child sign-in accepts', async () => {
    await settings.updateFamilyCode(fixture.parentActor, { familyCode: 'MILL-ERS' });

    const found = await families.findFamilyByCode('millers');
    expect(found?.id).toBe(fixture.familyId);
  });

  it('refuses one too short to be useful', async () => {
    await expect(
      settings.updateFamilyCode(fixture.parentActor, { familyCode: 'AB' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('refuses a code another family already has', async () => {
    await prisma.family.create({
      data: { name: 'The Other Family', timezone: 'Africa/Johannesburg', familyCode: 'TAKENONE' },
    });

    await expect(
      settings.updateFamilyCode(fixture.parentActor, { familyCode: 'takenone' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('only the owner may change it', async () => {
    await expect(
      settings.updateFamilyCode(fixture.childActor, { familyCode: 'KIDSRULE' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('a grown-up renaming themselves', () => {
  it('changes their own display name and audits it', async () => {
    await settings.updateDisplayName(fixture.parentActor, { displayName: 'Gogo Nomsa' });

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: fixture.parentActor.userId },
      select: { displayName: true },
    });
    expect(user.displayName).toBe('Gogo Nomsa');

    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'PARENT_PROFILE_UPDATED' },
    });
    expect(entry.afterValue).toMatchObject({ displayName: 'Gogo Nomsa' });
  });

  it('refuses an empty name', async () => {
    await expect(
      settings.updateDisplayName(fixture.parentActor, { displayName: '   ' }),
    ).rejects.toThrow();
  });

  it('a child cannot rename a grown-up', async () => {
    await expect(
      settings.updateDisplayName(fixture.childActor, { displayName: 'Boss' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('data export (brief §40)', () => {
  it("includes the family's own data and no password hashes", async () => {
    const data = await familyData.exportFamily(fixture.parentActor);
    const serialised = JSON.stringify(data);

    expect(data.children.map((child) => child.nickname)).toContain('Josh');
    expect(data.grownUps).toHaveLength(1);
    expect(serialised).not.toContain('passwordHash');
    expect(serialised).not.toContain('pinHash');
    expect(serialised).not.toMatch(/\$2[aby]\$/);
  });

  it('never reaches another family', async () => {
    const other = await createFamilyFixture();
    const data = await familyData.exportFamily(fixture.parentActor);

    expect(JSON.stringify(data)).not.toContain(other.childId);
    expect(data.children).toHaveLength(2);
  });

  it('a child cannot export', async () => {
    await expect(familyData.exportFamily(fixture.childActor)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('family deletion (brief §40)', () => {
  it("needs the owner's password and the exact family name", async () => {
    const family = await prisma.family.findUniqueOrThrow({ where: { id: fixture.familyId } });

    await expect(
      familyData.deleteFamily(fixture.parentActor, {
        password: 'wrong-password',
        confirmation: family.name,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await expect(
      familyData.deleteFamily(fixture.parentActor, {
        password: 'correct-horse-battery',
        confirmation: 'not the family name',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // Nothing was destroyed by the failed attempts.
    expect(await prisma.family.count({ where: { id: fixture.familyId } })).toBe(1);
  });

  it('erases the family and every child row when confirmed', async () => {
    const family = await prisma.family.findUniqueOrThrow({ where: { id: fixture.familyId } });
    const other = await createFamilyFixture();

    await familyData.deleteFamily(fixture.parentActor, {
      password: 'correct-horse-battery',
      confirmation: family.name,
    });

    expect(await prisma.family.count({ where: { id: fixture.familyId } })).toBe(0);
    expect(await prisma.childProfile.count({ where: { familyId: fixture.familyId } })).toBe(0);
    expect(await prisma.user.count({ where: { id: fixture.parentUserId } })).toBe(0);

    // Another family is untouched.
    expect(await prisma.family.count({ where: { id: other.familyId } })).toBe(1);
    expect(await prisma.childProfile.count({ where: { familyId: other.familyId } })).toBe(2);
  });

  it('only the owner may delete', async () => {
    const family = await prisma.family.findUniqueOrThrow({ where: { id: fixture.familyId } });
    const notOwner = { ...fixture.parentActor, role: 'PARENT' as const };

    await expect(
      familyData.deleteFamily(notOwner, {
        password: 'correct-horse-battery',
        confirmation: family.name,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
