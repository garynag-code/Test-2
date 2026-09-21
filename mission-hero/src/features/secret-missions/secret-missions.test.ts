import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db/prisma';
import * as missions from '@/features/secret-missions/service';
import * as ledger from '@/features/ledger/service';
import { createFamilyFixture, type FamilyFixture } from '@/test/factories';

/** Secret missions and hidden objects (brief §16/§17, BR-51 … BR-54). */

const TODAY = '2026-09-21';

let fixture: FamilyFixture;

beforeEach(async () => {
  fixture = await createFamilyFixture();
});

async function createMission(overrides: { xpValue?: number; rewardPointsValue?: number } = {}) {
  return missions.createMission(fixture.parentActor, {
    title: 'Secret Kindness Mission',
    instructions: 'Do something helpful without being asked.',
    rarity: 'RARE',
    xpValue: overrides.xpValue ?? 20,
    rewardPointsValue: overrides.rewardPointsValue ?? 10,
    starValue: 0,
    grantsWheelSpin: false,
    hiddenObjectKey: 'chest',
  });
}

describe('hidden objects (BR-51)', () => {
  it('places the object in the same spot all day, so refreshing achieves nothing', async () => {
    await createMission();

    const first = await missions.getHiddenObject(fixture.childActor, {
      childId: fixture.childId,
      today: TODAY,
    });
    for (let i = 0; i < 5; i += 1) {
      const again = await missions.getHiddenObject(fixture.childActor, {
        childId: fixture.childId,
        today: TODAY,
      });
      expect(again).toEqual(first);
    }
  });

  it('offers nothing once every mission has been found', async () => {
    const mission = await createMission();
    await missions.discover(fixture.childActor, { missionId: mission.id, surfaceKey: 'home-stats' });

    const hint = await missions.getHiddenObject(fixture.childActor, {
      childId: fixture.childId,
      today: TODAY,
    });
    expect(hint).toBeNull();
  });

  it('respects the family switch', async () => {
    await createMission();
    await prisma.familySetting.update({
      where: { familyId: fixture.familyId },
      data: { hiddenObjectsEnabled: false },
    });

    expect(
      await missions.getHiddenObject(fixture.childActor, { childId: fixture.childId, today: TODAY }),
    ).toBeNull();
  });

  it('will not reveal another child\'s hunt (BR-57)', async () => {
    await createMission();
    await expect(
      missions.getHiddenObject(fixture.childActor, {
        childId: fixture.secondChildId,
        today: TODAY,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('discovery (BR-52, BR-53)', () => {
  it('awards nothing — finding is not completing', async () => {
    const mission = await createMission();
    const result = await missions.discover(fixture.childActor, {
      missionId: mission.id,
      surfaceKey: 'home-missions',
    });

    expect(result.headline).toBe('SECRET MISSION FOUND!');
    expect(await ledger.getBalances(prisma, fixture.childId)).toEqual({
      lifetimeXp: 0,
      rewardPoints: 0,
      characterStars: 0,
    });
  });

  it('is recorded once per child per mission', async () => {
    const mission = await createMission();
    await missions.discover(fixture.childActor, { missionId: mission.id, surfaceKey: 'a' });
    await missions.discover(fixture.childActor, { missionId: mission.id, surfaceKey: 'b' });

    expect(await prisma.secretMissionDiscovery.count()).toBe(1);
  });

  it('cannot be claimed before it is found', async () => {
    const mission = await createMission();
    await expect(
      missions.submit(fixture.childActor, { missionId: mission.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('completion (BR-53)', () => {
  it('awards XP and points on parent approval', async () => {
    const mission = await createMission({ xpValue: 20, rewardPointsValue: 10 });
    await missions.discover(fixture.childActor, { missionId: mission.id, surfaceKey: 'home-stats' });
    const submission = await missions.submit(fixture.childActor, {
      missionId: mission.id,
      note: 'I tidied the lounge.',
    });

    await missions.approve(fixture.parentActor, { submissionId: submission.id });

    const xp = await prisma.xpTransaction.findMany({ where: { sourceType: 'SECRET_MISSION' } });
    expect(xp).toHaveLength(1);
    expect(xp[0]!.amount).toBe(20);
    expect(await ledger.getPointsBalance(prisma, fixture.childId)).toBe(10);
  });

  it('does not pay twice', async () => {
    const mission = await createMission();
    await missions.discover(fixture.childActor, { missionId: mission.id, surfaceKey: 'x' });
    const submission = await missions.submit(fixture.childActor, { missionId: mission.id });

    await missions.approve(fixture.parentActor, { submissionId: submission.id });
    await missions.approve(fixture.parentActor, { submissionId: submission.id });

    expect(await prisma.xpTransaction.count({ where: { sourceType: 'SECRET_MISSION' } })).toBe(1);
  });

  it('a child cannot approve their own mission', async () => {
    const mission = await createMission();
    await missions.discover(fixture.childActor, { missionId: mission.id, surfaceKey: 'x' });
    const submission = await missions.submit(fixture.childActor, { missionId: mission.id });

    await expect(
      missions.approve(fixture.childActor, { submissionId: submission.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await prisma.xpTransaction.count()).toBe(0);
  });

  it('a child cannot discover another family\'s mission', async () => {
    const other = await createFamilyFixture();
    const mission = await missions.createMission(other.parentActor, {
      title: 'Other family mission',
      instructions: 'Do a thing.',
      rarity: 'COMMON',
      xpValue: 10,
      rewardPointsValue: 0,
      starValue: 0,
      grantsWheelSpin: false,
      hiddenObjectKey: 'gem',
    });

    await expect(
      missions.discover(fixture.childActor, { missionId: mission.id, surfaceKey: 'x' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
