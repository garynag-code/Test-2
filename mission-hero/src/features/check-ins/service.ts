import { z } from 'zod';
import { prisma } from '@/server/db/prisma';
import { notFound } from '@/server/errors';
import type { Actor } from '@/server/auth/actor';
import { type LocalDate, localDateToUtcDate } from '@/domain/dates';
import { ledgerKeys } from '@/domain/idempotency';
import * as ledger from '@/features/ledger/service';
import * as streaks from '@/features/streaks/service';
import * as achievements from '@/features/achievements/service';
import * as audit from '@/features/audit/service';

/**
 * Daily check-in (brief §14, BR-25 … BR-27).
 *
 * The whole defence against farming XP by reopening the app is one unique
 * constraint on `(childId, localDate)`. A second check-in on the same
 * family-local day returns the first one and awards nothing.
 */

export const checkInSchema = z.object({
  mood: z.string().trim().max(24).optional(),
  goalText: z.string().trim().max(200).optional(),
  gratitudeText: z.string().trim().max(200).optional(),
});

export type CheckInInput = z.infer<typeof checkInSchema>;

export interface CheckInResult {
  /** False when today's check-in already existed. */
  created: boolean;
  xpAwarded: number;
  pointsAwarded: number;
  streakDays: number;
  streakMilestone: number | null;
}

export async function checkIn(
  actor: Actor,
  input: CheckInInput & { localDate: LocalDate },
): Promise<CheckInResult> {
  if (actor.type !== 'child') throw notFound();
  const parsed = checkInSchema.parse(input);
  const childId = actor.childId;
  const date = localDateToUtcDate(input.localDate);

  return prisma.$transaction(async (tx) => {
    const setting = await tx.familySetting.findUnique({ where: { familyId: actor.familyId } });
    const xp = setting?.checkInXp ?? 0;
    const points = setting?.checkInPoints ?? 0;

    // Serialises two check-ins arriving at once. Combined with the unique
    // constraint on (childId, localDate) this makes a second check-in on the
    // same family-local day impossible rather than merely unlikely (BR-25).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`checkin:${childId}:${input.localDate}`}))`;

    const { count } = await tx.dailyCheckIn.createMany({
      data: [
        {
          childId,
          familyId: actor.familyId,
          localDate: date,
          mood: parsed.mood ?? null,
          goalText: parsed.goalText ?? null,
          gratitudeText: parsed.gratitudeText ?? null,
          xpAwarded: xp,
          pointsAwarded: points,
        },
      ],
      skipDuplicates: true,
    });

    if (count === 0) {
      // Already checked in today. Nothing else happens.
      const streakDays = await streaks.currentCount(tx, {
        childId,
        kind: 'DAILY_CHECK_IN',
        today: input.localDate,
      });
      return { created: false, xpAwarded: 0, pointsAwarded: 0, streakDays, streakMilestone: null };
    }

    const key = ledgerKeys.dailyCheckIn(input.localDate);
    if (xp > 0) {
      await ledger.awardXp(tx, {
        familyId: actor.familyId,
        childId,
        amount: xp,
        sourceType: 'DAILY_CHECK_IN',
        idempotencyKey: `xp:${key}`,
        description: 'Daily check-in',
      });
    }
    if (points > 0) {
      await ledger.awardPoints(tx, {
        familyId: actor.familyId,
        childId,
        amount: points,
        sourceType: 'DAILY_CHECK_IN',
        idempotencyKey: `points:${key}`,
        description: 'Daily check-in',
      });
    }

    const outcome = await streaks.recordActivity(tx, {
      childId,
      familyId: actor.familyId,
      kind: 'DAILY_CHECK_IN',
      date: input.localDate,
    });

    await achievements.evaluateForChild(tx, { childId, familyId: actor.familyId });

    await audit.record(tx, {
      actor,
      action: 'CHECK_IN_RECORDED',
      entityType: 'DailyCheckIn',
      after: { localDate: input.localDate, xp, points },
    });

    return {
      created: true,
      xpAwarded: xp,
      pointsAwarded: points,
      streakDays: outcome.currentCount,
      streakMilestone: outcome.milestoneReached,
    };
  });
}

export async function getTodaysCheckIn(actor: Actor, params: { childId: string; localDate: LocalDate }) {
  if (actor.type === 'child' && actor.childId !== params.childId) throw notFound();
  return prisma.dailyCheckIn.findUnique({
    where: { childId_localDate: { childId: params.childId, localDate: localDateToUtcDate(params.localDate) } },
  });
}
