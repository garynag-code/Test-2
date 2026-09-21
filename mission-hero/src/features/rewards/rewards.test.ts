import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db/prisma';
import * as rewards from '@/features/rewards/service';
import * as ledger from '@/features/ledger/service';
import {
  createFamilyFixture,
  createRewardFixture,
  givePoints,
  type FamilyFixture,
} from '@/test/factories';

/** Reward store (brief §19, BR-41 … BR-43). */

let fixture: FamilyFixture;

beforeEach(async () => {
  fixture = await createFamilyFixture();
});

describe('redemption (BR-41, BR-42)', () => {
  it('debits the points atomically and records the redemption', async () => {
    const reward = await createRewardFixture(fixture, { pointsCost: 50, requiresParentApproval: false });
    await givePoints(fixture.familyId, fixture.childId, 120);

    const result = await rewards.redeem(fixture.childActor, { rewardId: reward.id });

    expect(result.balanceAfter).toBe(70);
    expect(result.redemption.status).toBe('FULFILLED');
    expect(await ledger.getPointsBalance(prisma, fixture.childId)).toBe(70);

    const debit = await prisma.rewardPointsTransaction.findFirstOrThrow({
      where: { sourceType: 'REWARD_REDEMPTION' },
    });
    expect(debit.amount).toBe(-50);
  });

  it('refuses when the balance is short, and writes nothing', async () => {
    const reward = await createRewardFixture(fixture, { pointsCost: 100 });
    await givePoints(fixture.familyId, fixture.childId, 40);

    await expect(
      rewards.redeem(fixture.childActor, { rewardId: reward.id }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_POINTS' });

    expect(await prisma.rewardRedemption.count()).toBe(0);
    expect(await ledger.getPointsBalance(prisma, fixture.childId)).toBe(40);
  });

  it('decrements inventory and refuses once it is gone', async () => {
    const reward = await createRewardFixture(fixture, {
      pointsCost: 10,
      inventoryQuantity: 1,
      requiresParentApproval: false,
    });
    await givePoints(fixture.familyId, fixture.childId, 100);

    await rewards.redeem(fixture.childActor, { rewardId: reward.id });
    expect(
      (await prisma.reward.findUniqueOrThrow({ where: { id: reward.id } })).inventoryQuantity,
    ).toBe(0);

    await expect(
      rewards.redeem(fixture.childActor, { rewardId: reward.id }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('two children cannot both claim the last one', async () => {
    const reward = await createRewardFixture(fixture, {
      pointsCost: 10,
      inventoryQuantity: 1,
      requiresParentApproval: false,
    });
    await givePoints(fixture.familyId, fixture.childId, 100, 'a');
    await givePoints(fixture.familyId, fixture.secondChildId, 100, 'b');

    const results = await Promise.allSettled([
      rewards.redeem(fixture.childActor, { rewardId: reward.id }),
      rewards.redeem(fixture.secondChildActor, { rewardId: reward.id }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refreshed = await prisma.reward.findUniqueOrThrow({ where: { id: reward.id } });
    expect(refreshed.inventoryQuantity).toBe(0);
    expect(await prisma.rewardRedemption.count()).toBe(1);
  });

  it('a child cannot redeem another family\'s reward', async () => {
    const other = await createFamilyFixture();
    const reward = await createRewardFixture(other, { pointsCost: 0 });

    await expect(
      rewards.redeem(fixture.childActor, { rewardId: reward.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('approval and refund (BR-43)', () => {
  it('debits at request time so a child cannot over-queue', async () => {
    const reward = await createRewardFixture(fixture, { pointsCost: 60, requiresParentApproval: true });
    await givePoints(fixture.familyId, fixture.childId, 100);

    const first = await rewards.redeem(fixture.childActor, { rewardId: reward.id });
    expect(first.redemption.status).toBe('PENDING');
    expect(await ledger.getPointsBalance(prisma, fixture.childId)).toBe(40);

    await expect(
      rewards.redeem(fixture.childActor, { rewardId: reward.id }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_POINTS' });
  });

  it('returns the points when a parent declines', async () => {
    const reward = await createRewardFixture(fixture, { pointsCost: 60, requiresParentApproval: true });
    await givePoints(fixture.familyId, fixture.childId, 100);
    const { redemption } = await rewards.redeem(fixture.childActor, { rewardId: reward.id });

    await rewards.resolveRedemption(fixture.parentActor, {
      redemptionId: redemption.id,
      approve: false,
      note: 'Maybe at the weekend.',
    });

    expect(await ledger.getPointsBalance(prisma, fixture.childId)).toBe(100);
    const refund = await prisma.rewardPointsTransaction.findFirstOrThrow({
      where: { sourceType: 'REDEMPTION_REFUND' },
    });
    expect(refund.amount).toBe(60);
  });

  it('does not refund twice if the parent taps decline twice', async () => {
    const reward = await createRewardFixture(fixture, { pointsCost: 60, requiresParentApproval: true });
    await givePoints(fixture.familyId, fixture.childId, 100);
    const { redemption } = await rewards.redeem(fixture.childActor, { rewardId: reward.id });

    await rewards.resolveRedemption(fixture.parentActor, { redemptionId: redemption.id, approve: false });
    await rewards.resolveRedemption(fixture.parentActor, { redemptionId: redemption.id, approve: false });

    expect(await ledger.getPointsBalance(prisma, fixture.childId)).toBe(100);
    expect(await prisma.rewardPointsTransaction.count({ where: { sourceType: 'REDEMPTION_REFUND' } })).toBe(1);
  });

  it('keeps the points when a parent fulfils the reward', async () => {
    const reward = await createRewardFixture(fixture, { pointsCost: 60, requiresParentApproval: true });
    await givePoints(fixture.familyId, fixture.childId, 100);
    const { redemption } = await rewards.redeem(fixture.childActor, { rewardId: reward.id });

    const resolved = await rewards.resolveRedemption(fixture.parentActor, {
      redemptionId: redemption.id,
      approve: true,
    });

    expect(resolved.status).toBe('FULFILLED');
    expect(await ledger.getPointsBalance(prisma, fixture.childId)).toBe(40);
  });

  it('a parent cannot resolve another family\'s redemption', async () => {
    const other = await createFamilyFixture();
    const reward = await createRewardFixture(other, { pointsCost: 0, requiresParentApproval: true });
    const { redemption } = await rewards.redeem(other.childActor, { rewardId: reward.id });

    await expect(
      rewards.resolveRedemption(fixture.parentActor, { redemptionId: redemption.id, approve: true }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('the store as a child sees it', () => {
  it('marks what is affordable and how far off the rest is', async () => {
    await createRewardFixture(fixture, { name: 'Ice cream', pointsCost: 30 });
    await createRewardFixture(fixture, { name: 'Movie night', pointsCost: 150 });
    await givePoints(fixture.familyId, fixture.childId, 50);

    const cards = await rewards.listRewardsForChild(fixture.childActor, fixture.childId);
    const iceCream = cards.find((c) => c.name === 'Ice cream');
    const movie = cards.find((c) => c.name === 'Movie night');

    expect(iceCream?.affordable).toBe(true);
    expect(movie?.affordable).toBe(false);
    expect(movie?.pointsNeeded).toBe(100);
  });

  it('refuses to list another child\'s store (BR-57)', async () => {
    await expect(
      rewards.listRewardsForChild(fixture.childActor, fixture.secondChildId),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
