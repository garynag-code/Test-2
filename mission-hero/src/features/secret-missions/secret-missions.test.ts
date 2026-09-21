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
    await missions.discover(fixture.childActor, {
      missionId: mission.id,
      surfaceKey: 'home-stats',
    });

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
      await missions.getHiddenObject(fixture.childActor, {
        childId: fixture.childId,
        today: TODAY,
      }),
    ).toBeNull();
  });

  it("will not reveal another child's hunt (BR-57)", async () => {
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
    await missions.discover(fixture.childActor, {
      missionId: mission.id,
      surfaceKey: 'home-stats',
    });
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

  it("a child cannot discover another family's mission", async () => {
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

describe('bonus challenges (Sprint 5)', () => {
  async function createBonus(overrides: { xpValue?: number; traitKey?: string } = {}) {
    return missions.createMission(fixture.parentActor, {
      title: 'Read 10 Extra Pages',
      instructions: 'Read ten more pages than usual today.',
      rarity: 'COMMON',
      requiresDiscovery: false,
      xpValue: overrides.xpValue ?? 20,
      rewardPointsValue: 10,
      starValue: 0,
      grantsWheelSpin: false,
      hiddenObjectKey: 'none',
    });
  }

  it('is listed without having to be found', async () => {
    await createBonus();

    const quests = await missions.listQuestsForChild(fixture.childActor, fixture.childId);
    expect(quests).toHaveLength(1);
    expect(quests[0]).toMatchObject({ kind: 'BONUS', title: 'Read 10 Extra Pages', status: null });
    // And no discovery row was needed to get there.
    expect(await prisma.secretMissionDiscovery.count()).toBe(0);
  });

  it('can be claimed straight away, unlike a secret mission', async () => {
    const bonus = await createBonus();
    const submission = await missions.submit(fixture.childActor, {
      missionId: bonus.id,
      note: 'I read three extra chapters.',
    });

    expect(submission.status).toBe('PENDING');
    // Claiming still awards nothing on its own.
    expect(await ledger.getXpBalance(prisma, fixture.childId)).toBe(0);
  });

  it('is never part of the hidden-object hunt', async () => {
    await createBonus();
    const hint = await missions.getHiddenObject(fixture.childActor, {
      childId: fixture.childId,
      today: TODAY,
    });
    expect(hint).toBeNull();
  });

  it('awards under BONUS_CHALLENGE so the history reads truthfully', async () => {
    const bonus = await createBonus({ xpValue: 20 });
    const submission = await missions.submit(fixture.childActor, { missionId: bonus.id });
    await missions.approve(fixture.parentActor, { submissionId: submission.id });

    const xp = await prisma.xpTransaction.findMany({ where: { childId: fixture.childId } });
    expect(xp).toHaveLength(1);
    expect(xp[0]!.sourceType).toBe('BONUS_CHALLENGE');
    expect(xp[0]!.amount).toBe(20);
  });

  it('a secret mission still awards under SECRET_MISSION', async () => {
    const mission = await createMission({ xpValue: 25 });
    await missions.discover(fixture.childActor, {
      missionId: mission.id,
      surfaceKey: 'home-stats',
    });
    const submission = await missions.submit(fixture.childActor, { missionId: mission.id });
    await missions.approve(fixture.parentActor, { submissionId: submission.id });

    const xp = await prisma.xpTransaction.findFirstOrThrow({ where: { childId: fixture.childId } });
    expect(xp.sourceType).toBe('SECRET_MISSION');
  });

  it("a child cannot claim another family's bonus challenge", async () => {
    const other = await createFamilyFixture();
    const bonus = await missions.createMission(other.parentActor, {
      title: 'Their challenge',
      instructions: 'Do a thing.',
      rarity: 'COMMON',
      requiresDiscovery: false,
      xpValue: 10,
      rewardPointsValue: 0,
      starValue: 0,
      grantsWheelSpin: false,
      hiddenObjectKey: 'none',
    });

    await expect(
      missions.submit(fixture.childActor, { missionId: bonus.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('the parent quest queue (Sprint 5)', () => {
  it('lists what is waiting, with what it is worth', async () => {
    const mission = await createMission({ xpValue: 25, rewardPointsValue: 10 });
    await missions.discover(fixture.childActor, { missionId: mission.id, surfaceKey: 'x' });
    await missions.submit(fixture.childActor, { missionId: mission.id, note: 'Done it.' });

    const pending = await missions.listPendingQuests(fixture.parentActor);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      childNickname: 'Josh',
      title: 'Secret Kindness Mission',
      childNote: 'Done it.',
      xpValue: 25,
      kind: 'SECRET',
    });
  });

  it("shows a parent only their own family's queue", async () => {
    const other = await createFamilyFixture();
    const mission = await missions.createMission(other.parentActor, {
      title: 'Theirs',
      instructions: 'Do a thing.',
      rarity: 'COMMON',
      requiresDiscovery: false,
      xpValue: 10,
      rewardPointsValue: 0,
      starValue: 0,
      grantsWheelSpin: false,
      hiddenObjectKey: 'none',
    });
    await missions.submit(other.childActor, { missionId: mission.id });

    expect(await missions.listPendingQuests(fixture.parentActor)).toHaveLength(0);
    expect(await missions.listPendingQuests(other.parentActor)).toHaveLength(1);
  });

  it('a child cannot read the queue', async () => {
    await expect(missions.listPendingQuests(fixture.childActor)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('declining a quest (Sprint 5)', () => {
  it('awards nothing and lets the child try again', async () => {
    const mission = await createMission();
    await missions.discover(fixture.childActor, { missionId: mission.id, surfaceKey: 'x' });
    const submission = await missions.submit(fixture.childActor, { missionId: mission.id });

    await missions.declineQuest(fixture.parentActor, {
      submissionId: submission.id,
      message: 'Have another go at this one.',
    });

    expect(await prisma.xpTransaction.count()).toBe(0);
    expect(await missions.listPendingQuests(fixture.parentActor)).toHaveLength(0);

    // The quest is available again — the unique (child, mission) constraint
    // would block this if the submission had merely been marked rejected.
    const retry = await missions.submit(fixture.childActor, { missionId: mission.id });
    expect(retry.status).toBe('PENDING');

    await missions.approve(fixture.parentActor, { submissionId: retry.id });
    expect(await ledger.getXpBalance(prisma, fixture.childId)).toBe(20);
  });

  it('tells the child, without blaming them', async () => {
    const mission = await createMission();
    await missions.discover(fixture.childActor, { missionId: mission.id, surfaceKey: 'x' });
    const submission = await missions.submit(fixture.childActor, { missionId: mission.id });

    await missions.declineQuest(fixture.parentActor, { submissionId: submission.id });

    const notification = await prisma.notification.findFirstOrThrow({
      where: { recipientChildId: fixture.childId, kind: 'ENCOURAGEMENT' },
    });
    expect(notification.body).toBe('Have another go at this one when you can.');
    expect(notification.body.toLowerCase()).not.toMatch(/fail|wrong|no\b/);
  });

  it('a child cannot decline their own quest', async () => {
    const mission = await createMission();
    await missions.discover(fixture.childActor, { missionId: mission.id, surfaceKey: 'x' });
    const submission = await missions.submit(fixture.childActor, { missionId: mission.id });

    await expect(
      missions.declineQuest(fixture.childActor, { submissionId: submission.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
