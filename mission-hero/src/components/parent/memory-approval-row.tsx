'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { relativeTime } from '@/lib/utils';
import { approveMemoryAction, declineMemoryAction } from '@/features/memory/actions';

interface MemorySubmissionView {
  submissionId: string;
  childNickname: string;
  challengeTitle: string;
  reference: string | null;
  original: string;
  recited: string | null;
  submittedAt: Date;
  xpValue: number;
  rewardPointsValue: number;
}

export function MemoryApprovalRow({ submission }: { submission: MemorySubmissionView }) {
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
          <p className="font-extrabold text-ink">
            {submission.childNickname} · {submission.challengeTitle}
          </p>
          <p className="text-xs text-muted">
            {submission.reference ? `${submission.reference} · ` : ''}
            {relativeTime(submission.submittedAt)}
          </p>
        </div>

        {/* Shown side by side so the parent compares, rather than the app
            auto-grading a child's words (BR-50). */}
        <div className="space-y-2">
          <p className="rounded-xl2 bg-surface p-3 text-sm">
            <span className="font-bold text-ink">They typed:</span>{' '}
            <span className="text-muted">{submission.recited ?? '—'}</span>
          </p>
          <p className="rounded-xl2 bg-brand-soft p-3 text-sm">
            <span className="font-bold text-brand">The original:</span>{' '}
            <span className="text-ink">{submission.original}</span>
          </p>
        </div>

        <p className="text-xs font-bold text-muted">
          Worth +{submission.xpValue} XP
          {submission.rewardPointsValue > 0 ? ` · +${submission.rewardPointsValue} points` : ''}
        </p>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={pending}
            onClick={() =>
              run(() => approveMemoryAction(submission.submissionId, 'Learned by heart!'))
            }
          >
            {pending ? 'Saving…' : 'They got it'}
          </Button>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              run(() =>
                declineMemoryAction(
                  submission.submissionId,
                  'Nearly! Give it one more practice and try again.',
                ),
              )
            }
          >
            Nearly there
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
