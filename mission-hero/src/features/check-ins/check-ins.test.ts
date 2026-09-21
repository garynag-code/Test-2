import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db/prisma';
import * as checkIns from '@/features/check-ins/service';
import * as ledger from '@/features/ledger/service';
import { createFamilyFixture, type FamilyFixture } from '@/test/factories';

/** Daily check-in (brief §14, BR-25 … BR-27). */

let fixture: FamilyFixture;

beforeEach(async () => {
  fixture = await createFamilyFixture();
});

describe('daily check-in (BR-25)', () => {
  it('awards the family\'s configured XP once', async () => {
    const result = await checkIns.checkIn(fixture.childActor, {
      localDate: '2026-09-21',
      mood: '🙂',
      goalText: 'Finish my project',
      gratitudeText: 'My sister helped me',
    });

    expect(result.created).toBe(true);
    expect(result.xpAwarded).toBe(5);
    expect(await ledger.getXpBalance(prisma, fixture.childId)).toBe(5);
  });

  it('rewards only once no matter how often the app is reopened', async () => {
    await checkIns.checkIn(fixture.childActor, { localDate: '2026-09-21' });

    for (let i = 0; i < 5; i += 1) {
      const repeat = await checkIns.checkIn(fixture.childActor, { localDate: '2026-09-21' });
      expect(repeat.created).toBe(false);
      expect(repeat.xpAwarded).toBe(0);
    }

    expect(await ledger.getXpBalance(prisma, fixture.childId)).toBe(5);
    expect(await prisma.dailyCheckIn.count({ where: { childId: fixture.childId } })).toBe(1);
    expect(
      await prisma.xpTransaction.count({
        where: { childId: fixture.childId, sourceType: 'DAILY_CHECK_IN' },
      }),
    ).toBe(1);
  });

  it('holds even when two check-ins arrive at the same moment', async () => {
    await Promise.allSettled([
      checkIns.checkIn(fixture.childActor, { localDate: '2026-09-21' }),
      checkIns.checkIn(fixture.childActor, { localDate: '2026-09-21' }),
    ]);

    expect(await prisma.dailyCheckIn.count({ where: { childId: fixture.childId } })).toBe(1);
    expect(await ledger.getXpBalance(prisma, fixture.childId)).toBe(5);
  });

  it('rewards again on the next calendar day', async () => {
    await checkIns.checkIn(fixture.childActor, { localDate: '2026-09-21' });
    const next = await checkIns.checkIn(fixture.childActor, { localDate: '2026-09-22' });

    expect(next.created).toBe(true);
    expect(await ledger.getXpBalance(prisma, fixture.childId)).toBe(10);
  });

  it('advances the check-in streak once per day (BR-27)', async () => {
    await checkIns.checkIn(fixture.childActor, { localDate: '2026-09-21' });
    await checkIns.checkIn(fixture.childActor, { localDate: '2026-09-21' });
    const third = await checkIns.checkIn(fixture.childActor, { localDate: '2026-09-22' });

    expect(third.streakDays).toBe(2);

    const streak = await prisma.streak.findFirstOrThrow({
      where: { childId: fixture.childId, kind: 'DAILY_CHECK_IN' },
    });
    expect(streak.currentCount).toBe(2);
  });

  it('celebrates the three-day milestone exactly once', async () => {
    const days = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'];
    const milestones = [];
    for (const day of days) {
      const result = await checkIns.checkIn(fixture.childActor, { localDate: day });
      milestones.push(result.streakMilestone);
    }
    expect(milestones).toEqual([null, null, 3, null]);
  });

  it('keeps children independent', async () => {
    await checkIns.checkIn(fixture.childActor, { localDate: '2026-09-21' });
    const other = await checkIns.checkIn(fixture.secondChildActor, { localDate: '2026-09-21' });

    expect(other.created).toBe(true);
    expect(await ledger.getXpBalance(prisma, fixture.secondChildId)).toBe(5);
  });

  it('a parent cannot check in on a child\'s behalf', async () => {
    await expect(
      checkIns.checkIn(fixture.parentActor, { localDate: '2026-09-21' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
