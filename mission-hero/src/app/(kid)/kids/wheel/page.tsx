import { requireChild } from '@/server/auth/guards';
import { prisma } from '@/server/db/prisma';
import { toLocalDate } from '@/domain/dates';
import { EmptyState } from '@/components/ui/card';
import * as wheelService from '@/features/reward-wheel/service';
import { RewardWheel } from '@/components/kid/reward-wheel';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Reward wheel' };

/** Vertical Slice 3 as the child sees it (brief §49). */
export default async function WheelPage() {
  const actor = await requireChild();
  const family = await prisma.family.findUniqueOrThrow({
    where: { id: actor.familyId },
    select: { timezone: true, setting: true },
  });
  const today = toLocalDate(new Date(), family.timezone);

  const wheel = family.setting?.wheelEnabled
    ? await wheelService.getWheelForChild(actor, { childId: actor.childId, today })
    : null;

  // A spin already paid for but never shown — see BR-68.
  const pendingSpin = wheel ? await wheelService.getPendingSpin(actor, actor.childId) : null;

  return (
    <div className="pb-24">
      <header className="mh-gradient px-5 pb-8 pt-8 text-white">
        <div className="mx-auto max-w-md">
          <h1 className="text-3xl font-black">Reward Wheel</h1>
          <p className="mt-1 font-semibold text-white/90">
            {wheel?.eligible ? 'YOU UNLOCKED A SPIN!' : 'Keep earning points to unlock a spin.'}
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-md px-5 py-6">
        {wheel ? (
          <RewardWheel wheel={wheel} pendingSpin={pendingSpin} />
        ) : (
          <EmptyState
            icon="🎡"
            title="No wheel right now"
            hint="A grown-up can set one up with rewards your family chooses."
          />
        )}
      </div>
    </div>
  );
}
