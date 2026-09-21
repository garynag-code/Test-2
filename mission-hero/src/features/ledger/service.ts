import type { Prisma } from '@prisma/client';
import type { Db } from '@/server/db/prisma';
import { insufficientPoints } from '@/server/errors';
import * as repo from './repo';
import type { AwardRequest, AwardResult, Balances } from './types';

/**
 * The only writer of the three ledgers (BR-1, BR-2).
 *
 * Every function here must be called with a transaction client so the award
 * commits atomically with whatever caused it. Idempotency is handled by the
 * unique index on `(childId, idempotencyKey)`: a duplicate is caught, the
 * original row is returned, and the caller sees a no-op rather than an error
 * (BR-6). That is what makes a double-tapped Approve button harmless.
 */

type Writer = 'xpTransaction' | 'rewardPointsTransaction' | 'characterStarTransaction';

async function write(
  db: Db,
  model: Writer,
  request: AwardRequest & { traitId?: string },
): Promise<AwardResult> {
  const data = {
    childId: request.childId,
    familyId: request.familyId,
    amount: request.amount,
    sourceType: request.sourceType,
    sourceId: request.sourceId ?? null,
    idempotencyKey: request.idempotencyKey,
    awardedByUserId: request.awardedByUserId ?? null,
    reason: request.reason ?? null,
    description: request.description,
    ...(request.traitId ? { traitId: request.traitId } : {}),
  } as Prisma.XpTransactionUncheckedCreateInput;

  // `createMany` with skipDuplicates compiles to ON CONFLICT DO NOTHING, which
  // is the only form of "insert or ignore" that leaves an enclosing
  // transaction usable. A plain create that raises a unique violation aborts
  // the whole Postgres transaction (SQLSTATE 25P02), so the duplicate could not
  // be handled from inside the very transaction that needs to survive it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- one code path for three structurally identical ledgers
  const delegate = db[model] as any;
  const { count } = await delegate.createMany({ data: [data], skipDuplicates: true });

  const row = await delegate.findUnique({
    where: {
      childId_idempotencyKey: {
        childId: request.childId,
        idempotencyKey: request.idempotencyKey,
      },
    },
    select: { id: true, amount: true },
  });
  if (!row) throw new Error(`Ledger write vanished for key ${request.idempotencyKey}`);

  return { created: count === 1, transactionId: row.id, amount: row.amount };
}

/** XP. Refuses a non-positive amount before the database has to (BR-3). */
export async function awardXp(db: Db, request: AwardRequest): Promise<AwardResult> {
  if (request.amount <= 0) {
    throw new Error(`XP awards must be positive, got ${request.amount} (BR-3)`);
  }
  return write(db, 'xpTransaction', request);
}

/** Reward Points credit. */
export async function awardPoints(db: Db, request: AwardRequest): Promise<AwardResult> {
  if (request.amount <= 0) {
    throw new Error(`Point awards must be positive, got ${request.amount}`);
  }
  return write(db, 'rewardPointsTransaction', request);
}

/**
 * Reward Points debit. `amount` is the positive number of points to spend.
 *
 * The balance is re-read under an advisory lock inside the caller's transaction,
 * so two concurrent spends cannot both see the same balance (BR-4).
 */
export async function spendPoints(
  db: Db,
  request: Omit<AwardRequest, 'amount'> & { amount: number },
): Promise<AwardResult> {
  if (request.amount <= 0) {
    throw new Error(`Point debits must be given as a positive amount, got ${request.amount}`);
  }
  const balance = await repo.lockChildPoints(db, request.childId);
  if (balance < request.amount) throw insufficientPoints(request.amount, balance);
  return write(db, 'rewardPointsTransaction', { ...request, amount: -request.amount });
}

/**
 * Character Stars. There is deliberately no `spendStars` (BR-5, ADR-004) —
 * stars are recognition, not currency.
 */
export async function awardStars(
  db: Db,
  request: AwardRequest & { traitId: string },
): Promise<AwardResult> {
  if (request.amount <= 0) {
    throw new Error(`Star awards must be positive, got ${request.amount} (BR-5)`);
  }
  return write(db, 'characterStarTransaction', request);
}

export const getBalances = (db: Db, childId: string): Promise<Balances> => repo.balances(db, childId);
export const getXpBalance = repo.xpBalance;
export const getPointsBalance = repo.pointsBalance;
export const getStarBalance = repo.starBalance;
export const getStarsByTrait = repo.starsByTrait;
export const getStarsForTrait = repo.starsForTrait;
