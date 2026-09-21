import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db/prisma';
import * as ledger from '@/features/ledger/service';
import { createFamilyFixture, givePoints, traitId, type FamilyFixture } from '@/test/factories';

/**
 * The ledger invariants (BR-2 … BR-7). These are the promises the product makes
 * about a child's numbers, so they are tested against the real database where
 * the CHECK constraints live.
 */

let fixture: FamilyFixture;

beforeEach(async () => {
  fixture = await createFamilyFixture();
});

const base = (fx: FamilyFixture) => ({
  familyId: fx.familyId,
  childId: fx.childId,
  sourceType: 'MANUAL_ADJUSTMENT' as const,
  reason: 'Test',
  description: 'Test',
});

describe('balances are derived, never stored (ADR-002)', () => {
  it('sums the ledger', async () => {
    await ledger.awardXp(prisma, { ...base(fixture), amount: 10, idempotencyKey: 'a' });
    await ledger.awardXp(prisma, { ...base(fixture), amount: 15, idempotencyKey: 'b' });

    expect(await ledger.getXpBalance(prisma, fixture.childId)).toBe(25);
  });

  it('reports zero for a child with no history', async () => {
    expect(await ledger.getBalances(prisma, fixture.childId)).toEqual({
      lifetimeXp: 0,
      rewardPoints: 0,
      characterStars: 0,
    });
  });

  it('keeps children independent', async () => {
    await ledger.awardXp(prisma, { ...base(fixture), amount: 50, idempotencyKey: 'a' });
    expect(await ledger.getXpBalance(prisma, fixture.secondChildId)).toBe(0);
  });
});

describe('idempotency (BR-6)', () => {
  it('a repeated key is a no-op that returns the original row', async () => {
    const first = await ledger.awardXp(prisma, {
      ...base(fixture),
      amount: 10,
      idempotencyKey: 'dup',
    });
    const second = await ledger.awardXp(prisma, {
      ...base(fixture),
      amount: 10,
      idempotencyKey: 'dup',
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.transactionId).toBe(first.transactionId);
    expect(await ledger.getXpBalance(prisma, fixture.childId)).toBe(10);
  });

  it('scopes keys per child, so two children can share a source', async () => {
    await ledger.awardXp(prisma, { ...base(fixture), amount: 10, idempotencyKey: 'shared' });
    await ledger.awardXp(prisma, {
      ...base(fixture),
      childId: fixture.secondChildId,
      amount: 10,
      idempotencyKey: 'shared',
    });

    expect(await ledger.getXpBalance(prisma, fixture.childId)).toBe(10);
    expect(await ledger.getXpBalance(prisma, fixture.secondChildId)).toBe(10);
  });

  it('a duplicate inside a transaction does not abort that transaction', async () => {
    // Regression: catching a raised unique violation is not enough, because a
    // failed INSERT aborts the whole Postgres transaction (SQLSTATE 25P02).
    // The duplicate must be absorbed by ON CONFLICT DO NOTHING so the work
    // after it still commits.
    const result = await prisma.$transaction(async (tx) => {
      await ledger.awardXp(tx, { ...base(fixture), amount: 10, idempotencyKey: 'in-tx' });
      const duplicate = await ledger.awardXp(tx, {
        ...base(fixture),
        amount: 10,
        idempotencyKey: 'in-tx',
      });
      // This read only succeeds if the transaction is still alive.
      const balance = await ledger.getXpBalance(tx, fixture.childId);
      await ledger.awardPoints(tx, { ...base(fixture), amount: 7, idempotencyKey: 'after-dup' });
      return { duplicate, balance };
    });

    expect(result.duplicate.created).toBe(false);
    expect(result.balance).toBe(10);
    expect(await ledger.getXpBalance(prisma, fixture.childId)).toBe(10);
    expect(await ledger.getPointsBalance(prisma, fixture.childId)).toBe(7);
  });

  it('holds under concurrency', async () => {
    await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        ledger.awardXp(prisma, { ...base(fixture), amount: 10, idempotencyKey: 'race' }),
      ),
    );
    expect(await ledger.getXpBalance(prisma, fixture.childId)).toBe(10);
    expect(await prisma.xpTransaction.count({ where: { childId: fixture.childId } })).toBe(1);
  });
});

describe('XP can never decrease (BR-3)', () => {
  it('rejects a non-positive award in the service', async () => {
    await expect(
      ledger.awardXp(prisma, { ...base(fixture), amount: -5, idempotencyKey: 'neg' }),
    ).rejects.toThrow(/positive/);
    await expect(
      ledger.awardXp(prisma, { ...base(fixture), amount: 0, idempotencyKey: 'zero' }),
    ).rejects.toThrow(/positive/);
  });

  it('is enforced by the database even if the service is bypassed', async () => {
    await expect(
      prisma.xpTransaction.create({
        data: {
          childId: fixture.childId,
          familyId: fixture.familyId,
          amount: -100,
          sourceType: 'MANUAL_ADJUSTMENT',
          idempotencyKey: 'bypass',
          reason: 'Trying to take XP away',
          description: 'Trying to take XP away',
        },
      }),
    ).rejects.toThrow();
  });

  it('stays monotonic across a long mix of awards and spends', async () => {
    let previous = 0;
    for (let i = 0; i < 12; i += 1) {
      await ledger.awardXp(prisma, { ...base(fixture), amount: 5, idempotencyKey: `xp-${i}` });
      await ledger.awardPoints(prisma, { ...base(fixture), amount: 20, idempotencyKey: `p-${i}` });
      if (i % 3 === 0) {
        await ledger.spendPoints(prisma, {
          ...base(fixture),
          amount: 15,
          sourceType: 'REWARD_REDEMPTION',
          reason: null,
          idempotencyKey: `s-${i}`,
        });
      }
      const xp = await ledger.getXpBalance(prisma, fixture.childId);
      expect(xp).toBeGreaterThanOrEqual(previous);
      previous = xp;
    }
    expect(previous).toBe(60);
  });
});

describe('Character Stars are never spendable (BR-5, ADR-004)', () => {
  it('has no debit path in the service', () => {
    expect('spendStars' in ledger).toBe(false);
  });

  it('is enforced by the database', async () => {
    const kindnessId = await traitId(fixture.familyId, 'kindness');
    await expect(
      prisma.characterStarTransaction.create({
        data: {
          childId: fixture.childId,
          familyId: fixture.familyId,
          traitId: kindnessId,
          amount: -1,
          sourceType: 'MANUAL_ADJUSTMENT',
          idempotencyKey: 'spend-star',
          reason: 'Trying to take a star away',
          description: 'Trying to take a star away',
        },
      }),
    ).rejects.toThrow();
  });
});

describe('Reward Points are spendable but never negative (BR-4)', () => {
  it('writes a debit as a single negative row', async () => {
    await givePoints(fixture.familyId, fixture.childId, 100, 'seed');
    await ledger.spendPoints(prisma, {
      ...base(fixture),
      sourceType: 'REWARD_REDEMPTION',
      reason: null,
      amount: 30,
      idempotencyKey: 'spend',
    });

    const debit = await prisma.rewardPointsTransaction.findFirstOrThrow({
      where: { sourceType: 'REWARD_REDEMPTION' },
    });
    expect(debit.amount).toBe(-30);
    expect(await ledger.getPointsBalance(prisma, fixture.childId)).toBe(70);
  });

  it('refuses to overspend and writes nothing', async () => {
    await givePoints(fixture.familyId, fixture.childId, 20, 'seed');

    await expect(
      ledger.spendPoints(prisma, {
        ...base(fixture),
        sourceType: 'REWARD_REDEMPTION',
        reason: null,
        amount: 50,
        idempotencyKey: 'over',
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_POINTS' });

    expect(await ledger.getPointsBalance(prisma, fixture.childId)).toBe(20);
  });

  it('two concurrent spends cannot both succeed on one balance', async () => {
    await givePoints(fixture.familyId, fixture.childId, 100, 'seed');

    const results = await Promise.allSettled([
      prisma.$transaction((tx) =>
        ledger.spendPoints(tx, {
          ...base(fixture),
          sourceType: 'REWARD_REDEMPTION',
          reason: null,
          amount: 80,
          idempotencyKey: 'a',
        }),
      ),
      prisma.$transaction((tx) =>
        ledger.spendPoints(tx, {
          ...base(fixture),
          sourceType: 'REWARD_REDEMPTION',
          reason: null,
          amount: 80,
          idempotencyKey: 'b',
        }),
      ),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await ledger.getPointsBalance(prisma, fixture.childId)).toBe(20);
  });
});

describe('manual adjustments must say why (BR-7)', () => {
  it('is enforced by the database', async () => {
    await expect(
      prisma.rewardPointsTransaction.create({
        data: {
          childId: fixture.childId,
          familyId: fixture.familyId,
          amount: 100,
          sourceType: 'MANUAL_ADJUSTMENT',
          idempotencyKey: 'no-reason',
          description: 'No reason given',
        },
      }),
    ).rejects.toThrow();
  });
});

describe('stars by trait', () => {
  it('groups totals per trait', async () => {
    const kindnessId = await traitId(fixture.familyId, 'kindness');
    const honestyId = await traitId(fixture.familyId, 'honesty');

    await ledger.awardStars(prisma, {
      ...base(fixture),
      traitId: kindnessId,
      amount: 2,
      idempotencyKey: 'k1',
    });
    await ledger.awardStars(prisma, {
      ...base(fixture),
      traitId: kindnessId,
      amount: 1,
      idempotencyKey: 'k2',
    });
    await ledger.awardStars(prisma, {
      ...base(fixture),
      traitId: honestyId,
      amount: 4,
      idempotencyKey: 'h1',
    });

    const totals = await ledger.getStarsByTrait(prisma, fixture.childId);
    expect(totals).toContainEqual({ traitId: kindnessId, total: 3 });
    expect(totals).toContainEqual({ traitId: honestyId, total: 4 });
    expect(await ledger.getStarBalance(prisma, fixture.childId)).toBe(7);
  });
});
