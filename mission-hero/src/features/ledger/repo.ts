import type { Db } from '@/server/db/prisma';
import type { Balances, TraitStarTotal } from './types';

/**
 * Balances are always derived from the ledger (ADR-002). There is no balance
 * column anywhere in the schema, so there is nothing that can drift.
 */

export async function xpBalance(db: Db, childId: string): Promise<number> {
  const result = await db.xpTransaction.aggregate({ where: { childId }, _sum: { amount: true } });
  return result._sum.amount ?? 0;
}

export async function pointsBalance(db: Db, childId: string): Promise<number> {
  const result = await db.rewardPointsTransaction.aggregate({
    where: { childId },
    _sum: { amount: true },
  });
  return result._sum.amount ?? 0;
}

export async function starBalance(db: Db, childId: string): Promise<number> {
  const result = await db.characterStarTransaction.aggregate({
    where: { childId },
    _sum: { amount: true },
  });
  return result._sum.amount ?? 0;
}

export async function balances(db: Db, childId: string): Promise<Balances> {
  const [lifetimeXp, rewardPoints, characterStars] = await Promise.all([
    xpBalance(db, childId),
    pointsBalance(db, childId),
    starBalance(db, childId),
  ]);
  return { lifetimeXp, rewardPoints, characterStars };
}

export async function starsByTrait(db: Db, childId: string): Promise<TraitStarTotal[]> {
  const rows = await db.characterStarTransaction.groupBy({
    by: ['traitId'],
    where: { childId },
    _sum: { amount: true },
  });
  return rows.map((row) => ({ traitId: row.traitId, total: row._sum.amount ?? 0 }));
}

export async function starsForTrait(db: Db, childId: string, traitId: string): Promise<number> {
  const result = await db.characterStarTransaction.aggregate({
    where: { childId, traitId },
    _sum: { amount: true },
  });
  return result._sum.amount ?? 0;
}

/**
 * Locks the child's points rows for the duration of the transaction.
 *
 * Postgres has nothing to lock for a row that does not exist yet, so this also
 * takes an advisory lock keyed on the child: two concurrent debits for a child
 * with no prior ledger rows still serialise (docs/03 §8).
 */
export async function lockChildPoints(db: Db, childId: string): Promise<number> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`points:${childId}`}))`;
  return pointsBalance(db, childId);
}
