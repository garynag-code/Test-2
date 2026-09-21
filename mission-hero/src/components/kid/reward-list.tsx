'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { redeemRewardAction } from '@/features/rewards/actions';
import type { RewardCard } from '@/features/rewards/service';

export function RewardList({ rewards }: { rewards: RewardCard[] }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {message ? (
        <p role="status" className="rounded-xl2 bg-success/10 px-4 py-3 font-semibold text-success">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-xl2 bg-star/10 px-4 py-3 font-semibold text-star">
          {error}
        </p>
      ) : null}

      <ul className="space-y-3">
        {rewards.map((reward) => (
          <li key={reward.id} className="rounded-xl2 border-2 border-border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-extrabold text-ink">{reward.name}</p>
                <p className="text-sm font-bold text-points">{reward.pointsCost} points</p>
                {!reward.inStock ? (
                  <p className="text-xs font-semibold text-muted">All gone for now</p>
                ) : !reward.affordable ? (
                  // Framed as a distance to travel, never as a shortfall.
                  <p className="text-xs font-semibold text-muted">
                    {reward.pointsNeeded} more points
                  </p>
                ) : null}
              </div>
              <Button
                variant={reward.affordable && reward.inStock ? 'primary' : 'outline'}
                disabled={!reward.affordable || !reward.inStock || pending}
                onClick={() => setConfirming(confirming === reward.id ? null : reward.id)}
              >
                Redeem
              </Button>
            </div>

            {confirming === reward.id ? (
              <div className="mt-3 rounded-xl2 bg-surface p-3">
                <p className="text-sm text-ink">
                  Spend {reward.pointsCost} points on {reward.name}?
                </p>
                <div className="mt-2 flex gap-2">
                  <Button
                    variant="primary"
                    disabled={pending}
                    onClick={() => {
                      setError(null);
                      setMessage(null);
                      startTransition(async () => {
                        const result = await redeemRewardAction(reward.id);
                        if (result.error) setError(result.error);
                        else {
                          setMessage(
                            result.needsApproval
                              ? 'Sent! A grown-up will sort this out.'
                              : 'Redeemed! Enjoy it.',
                          );
                          setConfirming(null);
                        }
                      });
                    }}
                  >
                    {pending ? 'Sending…' : 'Yes please'}
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirming(null)}>
                    Not yet
                  </Button>
                </div>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
