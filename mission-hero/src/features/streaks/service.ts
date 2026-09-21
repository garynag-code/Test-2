import type { StreakKind } from '@prisma/client';
import type { Db } from '@/server/db/prisma';
import { type LocalDate, localDateToUtcDate, utcDateToLocalDate } from '@/domain/dates';
import { EMPTY_STREAK, effectiveStreakCount, recordStreakActivity, type StreakOutcome } from '@/domain/streaks';

/**
 * Streak persistence (BR-38 … BR-40).
 *
 * The arithmetic itself lives in `src/domain/streaks.ts`; this module only
 * loads, locks and saves. The row is locked for the transaction so two
 * approvals landing at once cannot both increment.
 */

export async function recordActivity(
  db: Db,
  params: { childId: string; familyId: string; kind: StreakKind; key?: string; date: LocalDate },
): Promise<StreakOutcome> {
  const key = params.key ?? '';

  // Serialises concurrent updates for this streak even before the row exists.
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`streak:${params.childId}:${params.kind}:${key}`}))`;

  const existing = await db.streak.findUnique({
    where: { childId_kind_key: { childId: params.childId, kind: params.kind, key } },
  });

  const state = existing
    ? {
        currentCount: existing.currentCount,
        longestCount: existing.longestCount,
        lastActivityDate: existing.lastActivityDate
          ? utcDateToLocalDate(existing.lastActivityDate)
          : null,
        startedDate: existing.startedDate ? utcDateToLocalDate(existing.startedDate) : null,
      }
    : EMPTY_STREAK;

  const outcome = recordStreakActivity(state, params.date);
  if (!outcome.changed) return outcome;

  const data = {
    currentCount: outcome.currentCount,
    longestCount: outcome.longestCount,
    lastActivityDate: outcome.lastActivityDate ? localDateToUtcDate(outcome.lastActivityDate) : null,
    startedDate: outcome.startedDate ? localDateToUtcDate(outcome.startedDate) : null,
  };

  await db.streak.upsert({
    where: { childId_kind_key: { childId: params.childId, kind: params.kind, key } },
    create: { childId: params.childId, familyId: params.familyId, kind: params.kind, key, ...data },
    update: data,
  });

  return outcome;
}

/** The count to display today — a stale streak reads as 0 without a write. */
export async function currentCount(
  db: Db,
  params: { childId: string; kind: StreakKind; key?: string; today: LocalDate },
): Promise<number> {
  const row = await db.streak.findUnique({
    where: { childId_kind_key: { childId: params.childId, kind: params.kind, key: params.key ?? '' } },
  });
  if (!row) return 0;
  return effectiveStreakCount(
    {
      currentCount: row.currentCount,
      longestCount: row.longestCount,
      lastActivityDate: row.lastActivityDate ? utcDateToLocalDate(row.lastActivityDate) : null,
      startedDate: row.startedDate ? utcDateToLocalDate(row.startedDate) : null,
    },
    params.today,
  );
}

export async function listForChild(db: Db, childId: string) {
  return db.streak.findMany({ where: { childId }, orderBy: { currentCount: 'desc' } });
}

export async function longestForChild(db: Db, childId: string): Promise<number> {
  const result = await db.streak.aggregate({ where: { childId }, _max: { longestCount: true } });
  return result._max.longestCount ?? 0;
}
