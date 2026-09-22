'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { relativeTime } from '@/lib/utils';
import { approveQuestAction, declineQuestAction } from '@/features/secret-missions/actions';

interface QuestSubmissionView {
  submissionId: string;
  childNickname: string;
  title: string;
  instructions: string;
  childNote: string | null;
  submittedAt: Date;
  xpValue: number;
  rewardPointsValue: number;
  traitLabel: string | null;
  starValue: number;
  kind: 'SECRET' | 'BONUS';
}

export function QuestApprovalRow({ submission }: { submission: QuestSubmissionView }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  /*
   * Hidden as soon as the server accepts the decision. The row is only
   * removed by a revalidation otherwise, which leaves something already
   * resolved on screen and invites a second click on it.
   */
  const [resolved, setResolved] = useState(false);

  const run = (fn: () => Promise<{ error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result?.error) setError(result.error);
      else setResolved(true);
    });
  };

  if (resolved) return null;

  return (
    <li>
      <Card className="space-y-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-muted">
            {submission.kind === 'SECRET' ? '🗝️ Secret mission' : '⭐ Bonus challenge'}
          </p>
          <p className="font-extrabold text-ink">
            {submission.childNickname} · {submission.title}
          </p>
          <p className="text-xs text-muted">{relativeTime(submission.submittedAt)}</p>
        </div>

        <p className="text-sm text-muted">{submission.instructions}</p>
        {submission.childNote ? (
          <p className="rounded-xl2 bg-surface p-3 text-sm text-ink">“{submission.childNote}”</p>
        ) : null}

        <p className="text-xs font-bold text-muted">
          Worth{' '}
          {[
            submission.xpValue > 0 ? `+${submission.xpValue} XP` : null,
            submission.rewardPointsValue > 0 ? `+${submission.rewardPointsValue} points` : null,
            submission.starValue > 0 && submission.traitLabel
              ? `+${submission.starValue} ${submission.traitLabel}`
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={pending}
            onClick={() => run(() => approveQuestAction(submission.submissionId))}
          >
            {pending ? 'Saving…' : 'Approve'}
          </Button>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              run(() =>
                declineQuestAction(
                  submission.submissionId,
                  'Have another go at this one when you can.',
                ),
              )
            }
          >
            Try again
          </Button>
        </div>

        {error ? (
          <p role="alert" className="text-sm font-semibold text-star">
            {error}
          </p>
        ) : null}
      </Card>
    </li>
  );
}
