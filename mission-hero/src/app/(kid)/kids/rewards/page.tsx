import { requireChild } from '@/server/auth/guards';
import { EmptyState } from '@/components/ui/card';
import { EMPTY_STATES } from '@/domain/copy';
import { formatNumber } from '@/lib/utils';
import * as rewardsService from '@/features/rewards/service';
import * as ledger from '@/features/ledger/service';
import { prisma } from '@/server/db/prisma';
import { RewardList } from '@/components/kid/reward-list';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Rewards' };

export default async function RewardsPage() {
  const actor = await requireChild();
  const [rewards, balance] = await Promise.all([
    rewardsService.listRewardsForChild(actor, actor.childId),
    ledger.getPointsBalance(prisma, actor.childId),
  ]);

  return (
    <div className="pb-24">
      <header className="mh-gradient px-5 pb-8 pt-8 text-white">
        <div className="mx-auto max-w-md">
          <h1 className="text-3xl font-black">Rewards</h1>
          <p className="mt-1 text-lg font-bold text-white/90">
            <span aria-hidden>⭐</span> {formatNumber(balance)} points to spend
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-md px-5 py-6">
        {rewards.length === 0 ? (
          <EmptyState icon="🎁" title={EMPTY_STATES.noRewardsYet} />
        ) : (
          <RewardList rewards={rewards} />
        )}
      </div>
    </div>
  );
}
