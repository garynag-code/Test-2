import { requireChild } from '@/server/auth/guards';
import { prisma } from '@/server/db/prisma';
import { toLocalDate } from '@/domain/dates';
import * as checkIns from '@/features/check-ins/service';
import * as streaks from '@/features/streaks/service';
import { CheckInForm } from '@/components/kid/check-in-form';
import { STREAK } from '@/domain/copy';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Daily check-in' };

/** Daily check-in (brief §14). At most one reward per family-local day (BR-25). */
export default async function CheckInPage() {
  const actor = await requireChild();
  const family = await prisma.family.findUniqueOrThrow({
    where: { id: actor.familyId },
    select: { timezone: true, setting: true },
  });
  const today = toLocalDate(new Date(), family.timezone);

  const [existing, streakDays] = await Promise.all([
    checkIns.getTodaysCheckIn(actor, { childId: actor.childId, localDate: today }),
    streaks.currentCount(prisma, { childId: actor.childId, kind: 'DAILY_CHECK_IN', today }),
  ]);

  return (
    <div className="pb-24">
      <header className="mh-gradient px-5 pb-8 pt-8 text-white">
        <div className="mx-auto max-w-md">
          <h1 className="text-3xl font-black">Daily Check-In</h1>
          <p className="mt-1 font-semibold text-white/90">
            {streakDays > 0 ? `🔥 ${STREAK.showingUp(streakDays)}` : STREAK.reset}
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-md px-5 py-6">
        <CheckInForm
          alreadyDone={
            existing
              ? {
                  mood: existing.mood,
                  goalText: existing.goalText,
                  gratitudeText: existing.gratitudeText,
                }
              : null
          }
          xpOnOffer={family.setting?.checkInXp ?? 0}
          pointsOnOffer={family.setting?.checkInPoints ?? 0}
          streakDays={streakDays}
        />
      </div>
    </div>
  );
}
