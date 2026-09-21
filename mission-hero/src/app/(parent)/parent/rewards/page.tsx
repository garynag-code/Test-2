import { requireParent } from '@/server/auth/guards';
import { prisma } from '@/server/db/prisma';
import { Card, CardTitle, EmptyState } from '@/components/ui/card';
import { relativeTime } from '@/lib/utils';
import * as rewards from '@/features/rewards/service';
import { AddRewardForm } from '@/components/parent/add-reward-form';
import { RedemptionRow } from '@/components/parent/redemption-row';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Rewards' };

export default async function ParentRewardsPage() {
  const actor = await requireParent();

  const [pending, catalogue] = await Promise.all([
    rewards.listPendingRedemptions(actor),
    prisma.reward.findMany({
      where: { familyId: actor.familyId, deletedAt: null },
      orderBy: { pointsCost: 'asc' },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-ink">Rewards</h1>
        <p className="text-sm text-muted">
          Points are taken when a child asks, and given straight back if you say no.
        </p>
      </div>

      <section aria-labelledby="waiting" className="space-y-3">
        <CardTitle>
          <span id="waiting">
            {pending.length > 0 ? `${pending.length} waiting for you` : 'Nothing waiting'}
          </span>
        </CardTitle>
        {pending.length === 0 ? (
          <EmptyState icon="🎁" title="No reward requests right now." />
        ) : (
          <ul className="space-y-3">
            {pending.map((redemption) => (
              <RedemptionRow
                key={redemption.id}
                redemption={{
                  id: redemption.id,
                  rewardName: redemption.reward.name,
                  childNickname: redemption.child.nickname,
                  pointsSpent: redemption.pointsSpent,
                  requestedAgo: relativeTime(redemption.requestedAt),
                }}
              />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="catalogue" className="space-y-3">
        <CardTitle>
          <span id="catalogue">Reward store</span>
        </CardTitle>
        {catalogue.length === 0 ? (
          <EmptyState icon="🏷️" title="No rewards yet" hint="Add your first one below." />
        ) : (
          <ul className="space-y-2">
            {catalogue.map((reward) => (
              <li key={reward.id}>
                <Card className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-extrabold text-ink">{reward.name}</p>
                    <p className="text-sm text-muted">
                      {reward.inventoryQuantity === null
                        ? 'Unlimited'
                        : `${reward.inventoryQuantity} left`}
                      {reward.requiresParentApproval ? ' · you approve' : ' · automatic'}
                    </p>
                  </div>
                  <p className="shrink-0 font-bold text-points">{reward.pointsCost} pts</p>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="add-reward" className="space-y-3">
        <CardTitle>
          <span id="add-reward">Add a reward</span>
        </CardTitle>
        <Card>
          <AddRewardForm />
        </Card>
      </section>
    </div>
  );
}
