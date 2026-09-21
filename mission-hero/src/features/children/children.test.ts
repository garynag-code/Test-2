import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db/prisma';
import * as children from '@/features/children/service';
import { verifyPin } from '@/server/auth/passwords';
import { createFamilyFixture, type FamilyFixture } from '@/test/factories';

/** Adding and reading child profiles (Sprint 4 closes the UI gap for this). */

let fixture: FamilyFixture;

beforeEach(async () => {
  fixture = await createFamilyFixture();
});

describe('creating a child', () => {
  it('stores a nickname, avatar and theme', async () => {
    const child = await children.createChild(fixture.parentActor, {
      nickname: 'Ben',
      ageBracket: 'AGE_6_8',
      avatarKey: 'hero-3',
      themeKey: 'jungle',
    });

    expect(child.nickname).toBe('Ben');
    expect(child.themeKey).toBe('jungle');
    expect(child.familyId).toBe(fixture.familyId);
    expect(child.pinRequired).toBe(false);
  });

  it('creates the child settings row so the profile is immediately usable', async () => {
    const child = await children.createChild(fixture.parentActor, {
      nickname: 'Ben',
      ageBracket: 'AGE_9_11',
    });

    expect(await prisma.childSetting.findUnique({ where: { childId: child.id } })).not.toBeNull();
  });

  it('hashes a PIN and never stores it in the clear', async () => {
    const child = await children.createChild(fixture.parentActor, {
      nickname: 'Ben',
      ageBracket: 'AGE_9_11',
      pin: '4821',
    });

    expect(child.pinRequired).toBe(true);
    expect(child.pinHash).not.toBe('4821');
    expect(await verifyPin('4821', child.pinHash)).toBe(true);
    expect(await verifyPin('0000', child.pinHash)).toBe(false);
  });

  it('refuses a PIN that is not 4 to 6 digits', async () => {
    for (const pin of ['123', '1234567', 'abcd', '12a4']) {
      await expect(
        children.createChild(fixture.parentActor, {
          nickname: `Ben-${pin}`,
          ageBracket: 'AGE_9_11',
          pin,
        }),
      ).rejects.toThrow();
    }
  });

  it('refuses an empty nickname', async () => {
    await expect(
      children.createChild(fixture.parentActor, { nickname: '   ', ageBracket: 'AGE_9_11' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('refuses a duplicate nickname inside one family', async () => {
    await expect(
      children.createChild(fixture.parentActor, { nickname: 'Josh', ageBracket: 'AGE_9_11' }),
    ).rejects.toThrow();
  });

  it('allows the same nickname in a different family', async () => {
    const other = await createFamilyFixture();
    const child = await children.createChild(other.parentActor, {
      nickname: 'Josh-2',
      ageBracket: 'AGE_9_11',
    });
    expect(child.nickname).toBe('Josh-2');
  });

  it('a child cannot add another child', async () => {
    await expect(
      children.createChild(fixture.childActor, { nickname: 'Sneaky', ageBracket: 'AGE_9_11' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('writes an audit entry', async () => {
    const child = await children.createChild(fixture.parentActor, {
      nickname: 'Ben',
      ageBracket: 'AGE_6_8',
    });

    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'CHILD_CREATED', entityId: child.id },
    });
    expect(entry.actorUserId).toBe(fixture.parentUserId);
    expect(entry.afterValue).toMatchObject({ nickname: 'Ben' });
  });

  it('stores at most a birth month and year, never a full date (brief §40)', async () => {
    const child = await children.createChild(fixture.parentActor, {
      nickname: 'Ben',
      ageBracket: 'AGE_9_11',
      birthMonth: 4,
      birthYear: 2016,
    });

    expect(child.birthMonth).toBe(4);
    expect(child.birthYear).toBe(2016);
    expect(Object.keys(child)).not.toContain('dateOfBirth');
  });

  it('rejects an impossible birth month at the database level', async () => {
    await expect(
      children.createChild(fixture.parentActor, {
        nickname: 'Ben',
        ageBracket: 'AGE_9_11',
        birthMonth: 13,
        birthYear: 2016,
      }),
    ).rejects.toThrow();
  });
});

describe('listing children', () => {
  it('orders by the parent-chosen order and excludes archived profiles', async () => {
    await children.createChild(fixture.parentActor, { nickname: 'Ben', ageBracket: 'AGE_6_8' });
    await prisma.childProfile.update({
      where: { id: fixture.secondChildId },
      data: { status: 'ARCHIVED' },
    });

    const list = await children.listChildren(fixture.parentActor);
    expect(list.map((c) => c.nickname)).toEqual(['Josh', 'Ben']);
  });
});
