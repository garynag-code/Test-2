'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { resolveRedemptionAction } from '@/features/rewards/actions';

interface Redemption {
  id: string;
  rewardName: string;
  childNickname: string;
  pointsSpent: number;
  requestedAgo: string;
}

export function RedemptionRow({ redemption }: { redemption: Redemption }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const resolve = (approve: boolean, note?: string) => {
    setError(null);
    startTransition(async () => {
      const result = await resolveRedemptionAction(redemption.id, approve, note);
      if (result?.error) setError(result.error);
    });
  };

  return (
    <li>
      <Card className="space-y-3">
        <div>
          <p className="font-extrabold text-ink">
            {redemption.childNickname} wants {redemption.rewardName}
          </p>
          <p className="text-sm text-muted">
            {redemption.pointsSpent} points · {redemption.requestedAgo}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={pending} onClick={() => resolve(true)}>
            {pending ? 'Saving…' : 'Give it'}
          </Button>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => resolve(false, 'Maybe another time — your points are back.')}
          >
            Not this time
          </Button>
        </div>
        <p className="text-xs text-muted">Saying no returns all {redemption.pointsSpent} points.</p>

        {error ? (
          <p role="alert" className="text-sm font-semibold text-star">
            {error}
          </p>
        ) : null}
      </Card>
    </li>
  );
}
