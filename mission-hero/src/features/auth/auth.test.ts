import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db/prisma';
import type { AppError } from '@/server/errors';
import * as families from '@/features/families/service';
import * as children from '@/features/children/service';
import * as tasks from '@/features/tasks/service';
import { childToken, deviceToken, parentToken } from '@/server/auth/tokens';
import { isValidFamilyCodeShape, normaliseFamilyCode } from '@/server/auth/family-code';
import { PIN_MAX_ATTEMPTS } from '@/domain/constants';
import { createFamilyFixture, type FamilyFixture } from '@/test/factories';

/** Authentication, tenancy and the child PIN (docs/03). */

let fixture: FamilyFixture;

beforeEach(async () => {
  fixture = await createFamilyFixture();
});

describe('registration', () => {
  it('creates a playable family in one transaction', async () => {
    const { user, family } = await families.registerParent({
      email: 'New.Parent@Example.com',
      password: 'a-long-enough-password',
      displayName: 'New Parent',
      familyName: 'The Test Family',
      timezone: 'Africa/Johannesburg',
      parentNickname: 'Dad',
    });

    // Email is normalised so "New.Parent@Example.com" cannot become a second account.
    expect(user.email).toBe('new.parent@example.com');

    const member = await prisma.familyMember.findFirstOrThrow({
      where: { familyId: family.id, userId: user.id },
    });
    expect(member.role).toBe('OWNER');

    // Defaults are cloned in, so the family is immediately usable.
    expect(await prisma.characterTrait.count({ where: { familyId: family.id } })).toBeGreaterThan(
      10,
    );
    expect(await prisma.level.count({ where: { familyId: family.id } })).toBe(10);
    expect(await prisma.achievement.count({ where: { familyId: family.id } })).toBeGreaterThan(5);
    expect(await prisma.characterBadge.count({ where: { familyId: family.id } })).toBeGreaterThan(
      40,
    );
    expect(
      await prisma.familySetting.findUnique({ where: { familyId: family.id } }),
    ).not.toBeNull();
  });

  it('never stores a password in the clear', async () => {
    const { user } = await families.registerParent({
      email: 'clear@example.com',
      password: 'super-secret-password',
      displayName: 'P',
      familyName: 'F',
      timezone: 'UTC',
    });
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.passwordHash).not.toContain('super-secret-password');
    expect(stored.passwordHash.startsWith('$2')).toBe(true);
  });

  it('refuses a duplicate email', async () => {
    await families.registerParent({
      email: 'dupe@example.com',
      password: 'a-long-enough-password',
      displayName: 'P',
      familyName: 'F',
      timezone: 'UTC',
    });
    await expect(
      families.registerParent({
        email: 'dupe@example.com',
        password: 'a-long-enough-password',
        displayName: 'P',
        familyName: 'F2',
        timezone: 'UTC',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('gives each family a unique code', async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      const { family } = await families.registerParent({
        email: `code-${i}@example.com`,
        password: 'a-long-enough-password',
        displayName: 'P',
        familyName: `F${i}`,
        timezone: 'UTC',
      });
      expect(isValidFamilyCodeShape(family.familyCode)).toBe(true);
      codes.add(family.familyCode);
    }
    expect(codes.size).toBe(5);
  });
});

describe('login', () => {
  it('accepts the right password', async () => {
    await families.registerParent({
      email: 'login@example.com',
      password: 'a-long-enough-password',
      displayName: 'Login Parent',
      familyName: 'F',
      timezone: 'UTC',
    });

    const result = await families.loginParent('login@example.com', 'a-long-enough-password');
    expect(result.displayName).toBe('Login Parent');
    expect(result.familyId).toBeTruthy();
  });

  it('gives the same answer for a wrong password and an unknown account', async () => {
    await families.registerParent({
      email: 'known@example.com',
      password: 'a-long-enough-password',
      displayName: 'P',
      familyName: 'F',
      timezone: 'UTC',
    });

    const capture = async (email: string): Promise<AppError> => {
      try {
        await families.loginParent(email, 'not-the-password');
        throw new Error('login should not have succeeded');
      } catch (error) {
        return error as AppError;
      }
    };

    const wrongPassword = await capture('known@example.com');
    const unknownAccount = await capture('nobody@example.com');

    expect(wrongPassword.code).toBe('NOT_FOUND');
    expect(unknownAccount.code).toBe('NOT_FOUND');
    // Identical wording: the response must not reveal which accounts exist.
    expect(wrongPassword.message).toBe(unknownAccount.message);
  });
});

describe('session tokens (docs/03 §8)', () => {
  it('a child token is rejected by the parent verifier', async () => {
    const token = await childToken.sign(fixture.childId, fixture.familyId);
    expect(await parentToken.verify(token)).toBeNull();
    expect(await childToken.verify(token)).not.toBeNull();
  });

  it('a parent token is rejected by the child verifier', async () => {
    const token = await parentToken.sign(fixture.parentUserId, fixture.familyId);
    expect(await childToken.verify(token)).toBeNull();
  });

  it('a device token confers no session at all', async () => {
    const token = await deviceToken.sign(fixture.familyId);
    expect(await parentToken.verify(token)).toBeNull();
    expect(await childToken.verify(token)).toBeNull();
    expect((await deviceToken.verify(token))?.fam).toBe(fixture.familyId);
  });

  it('rejects a tampered token', async () => {
    const token = await parentToken.sign(fixture.parentUserId, fixture.familyId);
    const tampered = `${token.slice(0, -4)}AAAA`;
    expect(await parentToken.verify(tampered)).toBeNull();
    expect(await parentToken.verify('not.a.token')).toBeNull();
  });
});

describe('family codes', () => {
  it('accepts what a child actually types', async () => {
    expect(normaliseFamilyCode('advent-ur')).toBe('ADVENTUR');
    expect(normaliseFamilyCode(' adv ent ur ')).toBe('ADVENTUR');
  });

  it('finds a family by code, case and spacing insensitive', async () => {
    const family = await prisma.family.findUniqueOrThrow({ where: { id: fixture.familyId } });
    const found = await families.findFamilyByCode(family.familyCode.toLowerCase());
    expect(found?.id).toBe(family.id);
  });

  it('returns nothing for an unknown code', async () => {
    expect(await families.findFamilyByCode('ZZZZZZZZ')).toBeNull();
    expect(await families.findFamilyByCode('')).toBeNull();
  });
});

describe('child profile picker (docs/03 §5)', () => {
  it('exposes nothing beyond a nickname and an avatar', async () => {
    const profiles = await children.listProfilesForDevice(fixture.familyId);
    expect(profiles.length).toBeGreaterThan(0);

    for (const profile of profiles) {
      expect(Object.keys(profile).sort()).toEqual(
        ['avatarKey', 'id', 'nickname', 'pinRequired', 'themeKey'].sort(),
      );
      expect(JSON.stringify(profile)).not.toContain('$2');
    }
  });
});

describe('child PIN (docs/03 §5)', () => {
  it('accepts the right PIN and clears the attempt counter', async () => {
    const withPin = await createFamilyFixture({ childPin: '1234' });
    await children.verifyChildPin(withPin.familyId, withPin.childId, '0000');

    const result = await children.verifyChildPin(withPin.familyId, withPin.childId, '1234');
    expect(result.ok).toBe(true);

    const child = await prisma.childProfile.findUniqueOrThrow({ where: { id: withPin.childId } });
    expect(child.pinFailedAttempts).toBe(0);
  });

  it('locks out after five wrong attempts, even if the sixth is correct', async () => {
    const withPin = await createFamilyFixture({ childPin: '1234' });

    for (let i = 0; i < PIN_MAX_ATTEMPTS; i += 1) {
      const attempt = await children.verifyChildPin(withPin.familyId, withPin.childId, '0000');
      expect(attempt.ok).toBe(false);
    }

    const correct = await children.verifyChildPin(withPin.familyId, withPin.childId, '1234');
    expect(correct.ok).toBe(false);
    expect(correct.lockedUntil).toBeInstanceOf(Date);
  });

  it('keeps the lockout on the row, so clearing cookies does not help', async () => {
    const withPin = await createFamilyFixture({ childPin: '1234' });
    for (let i = 0; i < PIN_MAX_ATTEMPTS; i += 1) {
      await children.verifyChildPin(withPin.familyId, withPin.childId, '0000');
    }

    const child = await prisma.childProfile.findUniqueOrThrow({ where: { id: withPin.childId } });
    expect(child.pinLockedUntil).not.toBeNull();
    expect(child.pinLockedUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it('refuses a child from another family without revealing anything', async () => {
    const other = await createFamilyFixture({ childPin: '1234' });
    const result = await children.verifyChildPin(fixture.familyId, other.childId, '1234');
    expect(result.ok).toBe(false);
    expect(result.childId).toBeUndefined();
  });
});

describe('tenant isolation (BR-56, BR-57)', () => {
  it('a parent sees only their own children', async () => {
    const other = await createFamilyFixture();
    const list = await children.listChildren(fixture.parentActor);

    expect(list.map((c) => c.id)).toContain(fixture.childId);
    expect(list.map((c) => c.id)).not.toContain(other.childId);
  });

  it("a parent cannot create a task for another family's child", async () => {
    const other = await createFamilyFixture();

    await expect(
      tasks.createTask(fixture.parentActor, {
        title: 'Sneaky task',
        iconKey: 'target',
        colorKey: 'brand',
        xpValue: 10,
        rewardPointsValue: 0,
        characterStarValue: 0,
        difficulty: 'STANDARD',
        evidenceType: 'NONE',
        approvalRequired: true,
        streakEligible: true,
        isFamilyTask: false,
        childIds: [other.childId],
        schedule: { frequency: 'DAILY', interval: 1, weekdays: [], startDate: '2026-09-01' },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(await prisma.task.count({ where: { familyId: fixture.familyId } })).toBe(0);
  });

  it("a child cannot read another child's summary", async () => {
    await expect(
      children.getSummary(fixture.childActor, {
        childId: fixture.secondChildId,
        today: '2026-09-21',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a parent can read any child in their own family', async () => {
    const summary = await children.getSummary(fixture.parentActor, {
      childId: fixture.secondChildId,
      today: '2026-09-21',
    });
    expect(summary.nickname).toBe('Sarah');
  });

  it('a parent cannot read a child in another family', async () => {
    const other = await createFamilyFixture();
    await expect(
      children.getSummary(fixture.parentActor, { childId: other.childId, today: '2026-09-21' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('child privacy (brief §40)', () => {
  it("has nowhere to store a child's email, phone or full date of birth", async () => {
    const child = await prisma.childProfile.findUniqueOrThrow({ where: { id: fixture.childId } });
    const columns = Object.keys(child);

    expect(columns).not.toContain('email');
    expect(columns).not.toContain('phone');
    expect(columns).not.toContain('dateOfBirth');
    expect(columns).toContain('nickname');
    // Month and year at most, and both optional.
    expect(columns).toContain('birthMonth');
    expect(columns).toContain('birthYear');
  });

  it('defaults media uploads to off', async () => {
    const setting = await prisma.familySetting.findUniqueOrThrow({
      where: { familyId: fixture.familyId },
    });
    expect(setting.mediaUploadsEnabled).toBe(false);
    expect(setting.photoEvidenceEnabled).toBe(false);
    expect(setting.voiceNotesEnabled).toBe(false);
  });
});
