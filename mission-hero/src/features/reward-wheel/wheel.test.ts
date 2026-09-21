import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db/prisma';
import * as wheel from '@/features/reward-wheel/service';
import * as ledger from '@/features/ledger/service';
import {
  createFamilyFixture,
  createWheelFixture,
  givePoints,
  type FamilyFixture,
} from '@/test/factories';

/**
 * Vertical Slice 3 (brief §49) and the wheel rows of the §46 critical list.
 */

const TODAY = '2026-09-21';

let fixture: FamilyFixture;

beforeEach(async () => {
  fixture = await createFamilyFixture();
});

describe('eligibility (BR-44)', () => {
  it('is locked below the threshold and says how many points are needed', async () => {
    await createWheelFixture(fixture, { pointThreshold: 100 });
    await givePoints(fixture.familyId, fixture.childId, 80);

    const view = await wheel.getWheelForChild(fixture.childActor, {
      childId: fixture.childId,
      today: TODAY,
    });

    expect(view?.eligible).toBe(false);
    expect(view?.reason).toBe('BELOW_THRESHOLD');
    expect(view?.pointsNeeded).toBe(20);
    expect(view?.balance).toBe(80);
  });

  it('unlocks at the threshold', async () => {
    await createWheelFixture(fixture, { pointThreshold: 100 });
    await givePoints(fixture.familyId, fixture.childId, 100);

    const view = await wheel.getWheelForChild(fixture.childActor, {
      childId: fixture.childId,
      today: TODAY,
    });
    expect(view?.eligible).toBe(true);
    expect(view?.pointsNeeded).toBe(0);
  });

  it('refuses a spin below the threshold and writes nothing', async () => {
    const row = await createWheelFixture(fixture, { pointThreshold: 100 });
    await givePoints(fixture.familyId, fixture.childId, 50);

    await expect(
      wheel.spin(fixture.childActor, { wheelId: row.id, today: TODAY }),
    ).rejects.toMatchObject({ code: 'NOT_ELIGIBLE' });

    expect(await prisma.rewardSpin.count()).toBe(0);
    expect(await ledger.getPointsBalance(prisma, fixture.childId)).toBe(50);
  });
});

describe('spinning (BR-45, BR-46, BR-47)', () => {
  it('persists the result before returning it, and deducts the cost', async () => {
    const row = await createWheelFixture(fixture, { pointThreshold: 100, pointsCost: 100 });
    await givePoints(fixture.familyId, fixture.childId, 120);

    const result = await wheel.spin(fixture.childActor, { wheelId: row.id, today: TODAY });

    const persisted = await prisma.rewardSpin.findUniqueOrThrow({ where: { id: result.spinId } });
    expect(persisted.segmentIndex).toBe(result.segmentIndex);
    expect(persisted.wheelItemId).toBeTruthy();
    expect(persisted.pointsSpent).toBe(100);

    expect(await ledger.getPointsBalance(prisma, fixture.childId)).toBe(20);
    expect(result.balanceAfter).toBe(20);
  });

  it('writes the point debit as a single negative ledger row', async () => {
    const row = await createWheelFixture(fixture, { pointsCost: 100 });
    await givePoints(fixture.familyId, fixture.childId, 100);

    await wheel.spin(fixture.childActor, { wheelId: row.id, today: TODAY });

    const debit = await prisma.rewardPointsTransaction.findFirstOrThrow({
      where: { sourceType: 'WHEEL_SPIN' },
    });
    expect(debit.amount).toBe(-100);
  });

  it('does not deduct when the wheel is configured not to', async () => {
    const row = await createWheelFixture(fixture, { pointThreshold: 100, deductPoints: false });
    await givePoints(fixture.familyId, fixture.childId, 100);

    const result = await wheel.spin(fixture.childActor, { wheelId: row.id, today: TODAY });

    expect(result.pointsSpent).toBe(0);
    expect(await ledger.getPointsBalance(prisma, fixture.childId)).toBe(100);
  });

  it('replaying a spin returns the same persisted segment — no re-roll (BR-46)', async () => {
    const row = await createWheelFixture(fixture);
    await givePoints(fixture.familyId, fixture.childId, 100);

    const result = await wheel.spin(fixture.childActor, { wheelId: row.id, today: TODAY });

    for (let i = 0; i < 5; i += 1) {
      const replay = await wheel.getSpin(fixture.childActor, result.spinId);
      expect(replay.segmentIndex).toBe(result.segmentIndex);
      expect(replay.label).toBe(result.label);
    }
    expect(await prisma.rewardSpin.count()).toBe(1);
  });

  it('always lands on a real segment of this wheel', async () => {
    const row = await createWheelFixture(fixture, {
      pointThreshold: 0,
      deductPoints: false,
      spinsPerDay: 0,
      spinsPerWeek: 0,
    });
    const labels = row.items.map((item) => item.label);

    for (let i = 0; i < 12; i += 1) {
      const result = await wheel.spin(fixture.childActor, { wheelId: row.id, today: TODAY });
      expect(labels).toContain(result.label);
      expect(result.segmentIndex).toBeGreaterThanOrEqual(0);
      expect(result.segmentIndex).toBeLessThan(row.items.length);
    }
  });

  it('honours weighting — a zero-probability segment never wins', async () => {
    const row = await createWheelFixture(fixture, {
      pointThreshold: 0,
      deductPoints: false,
      spinsPerDay: 0,
      spinsPerWeek: 0,
      segments: [
        { label: 'Never', weight: 1, maxWinsPerChild: 0 },
        { label: 'Always', weight: 5 },
      ],
    });

    for (let i = 0; i < 15; i += 1) {
      const result = await wheel.spin(fixture.childActor, { wheelId: row.id, today: TODAY });
      expect(result.label).toBe('Always');
    }
    expect(row.items).toHaveLength(2);
  });
});

describe('limits and abuse (BR-44, docs/03 §8)', () => {
  it('enforces one spin per day', async () => {
    const row = await createWheelFixture(fixture, {
      spinsPerDay: 1,
      deductPoints: false,
      pointThreshold: 0,
    });

    await wheel.spin(fixture.childActor, { wheelId: row.id, today: TODAY });
    await expect(
      wheel.spin(fixture.childActor, { wheelId: row.id, today: TODAY }),
    ).rejects.toMatchObject({ code: 'NOT_ELIGIBLE' });

    expect(await prisma.rewardSpin.count()).toBe(1);
  });

  it('two simultaneous spins produce exactly one when the daily limit is one', async () => {
    const row = await createWheelFixture(fixture, {
      spinsPerDay: 1,
      deductPoints: true,
      pointsCost: 100,
      pointThreshold: 100,
    });
    await givePoints(fixture.familyId, fixture.childId, 250);

    await Promise.allSettled([
      wheel.spin(fixture.childActor, { wheelId: row.id, today: TODAY }),
      wheel.spin(fixture.childActor, { wheelId: row.id, today: TODAY }),
    ]);

    expect(await prisma.rewardSpin.count()).toBe(1);
    expect(await ledger.getPointsBalance(prisma, fixture.childId)).toBe(150);
  });

  it('a cooldown states a plain fact rather than pressuring', async () => {
    const row = await createWheelFixture(fixture, {
      spinsPerDay: 0,
      deductPoints: false,
      pointThreshold: 0,
      cooldownMinutes: 60,
    });

    await wheel.spin(fixture.childActor, { wheelId: row.id, today: TODAY });

    await expect(
      wheel.spin(fixture.childActor, { wheelId: row.id, today: TODAY }),
    ).rejects.toMatchObject({
      code: 'NOT_ELIGIBLE',
      publicMessage: 'The wheel is resting. Try again a bit later.',
    });
  });

  it('balance can never go negative through spinning', async () => {
    const row = await createWheelFixture(fixture, {
      pointThreshold: 0,
      pointsCost: 100,
      deductPoints: true,
      spinsPerDay: 0,
      spinsPerWeek: 0,
    });
    await givePoints(fixture.familyId, fixture.childId, 100);

    await wheel.spin(fixture.childActor, { wheelId: row.id, today: TODAY });
    await expect(
      wheel.spin(fixture.childActor, { wheelId: row.id, today: TODAY }),
    ).rejects.toMatchObject({ code: 'NOT_ELIGIBLE' });

    expect(await ledger.getPointsBalance(prisma, fixture.childId)).toBe(0);
  });
});

describe('authorization', () => {
  it("a parent cannot spin on a child's behalf", async () => {
    const row = await createWheelFixture(fixture, { pointThreshold: 0, deductPoints: false });

    await expect(
      wheel.spin(fixture.parentActor, { wheelId: row.id, today: TODAY }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it("a child cannot spin another family's wheel", async () => {
    const other = await createFamilyFixture();
    const row = await createWheelFixture(other, { pointThreshold: 0, deductPoints: false });

    await expect(
      wheel.spin(fixture.childActor, { wheelId: row.id, today: TODAY }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await prisma.rewardSpin.count()).toBe(0);
  });

  it("a child cannot replay another child's spin (BR-57)", async () => {
    const row = await createWheelFixture(fixture, { pointThreshold: 0, deductPoints: false });
    const result = await wheel.spin(fixture.childActor, { wheelId: row.id, today: TODAY });

    await expect(wheel.getSpin(fixture.secondChildActor, result.spinId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('audit (BR-59)', () => {
  it('records the spin with its outcome', async () => {
    const row = await createWheelFixture(fixture, { pointThreshold: 0, deductPoints: false });
    const result = await wheel.spin(fixture.childActor, { wheelId: row.id, today: TODAY });

    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'WHEEL_SPUN', entityId: result.spinId },
    });
    expect(entry.actorType).toBe('CHILD');
    expect(entry.afterValue).toMatchObject({ label: result.label });
  });
});
