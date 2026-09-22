'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ENCOURAGEMENT_CHIPS } from '@/domain/copy';
import { relativeTime } from '@/lib/utils';
import { confirmCharacterAction, declineCharacterAction } from '@/features/character/actions';
import type { PendingCharacterSubmission } from '@/features/character/types';

export function CharacterApprovalRow({ submission }: { submission: PendingCharacterSubmission }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState('');
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
            <span aria-hidden>{submission.traitEmoji}</span> {submission.childNickname} says they
            showed {submission.traitLabel.toLowerCase()}
          </p>
          <p className="text-xs text-muted">{relativeTime(submission.submittedAt)}</p>
        </div>

        <p className="rounded-xl2 bg-surface p-3 text-ink">“{submission.story}”</p>

        <p className="text-xs font-semibold text-muted">
          {submission.childNickname}&apos;s {submission.traitLabel.toLowerCase()}:{' '}
          {submission.currentTotal} → {submission.currentTotal + 1}
          {submission.nextBadgeName
            ? ` · ${submission.remainingForNextBadge} more to ${submission.nextBadgeName}`
            : ''}
        </p>

        <div className="flex flex-wrap gap-2">
          {ENCOURAGEMENT_CHIPS.slice(0, 3).map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => setMessage(chip)}
              className="rounded-full border-2 border-border px-3 py-2 text-xs font-semibold text-muted"
            >
              {chip}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={pending}
            onClick={() =>
              run(() =>
                confirmCharacterAction(submission.submissionId, message.trim() || undefined),
              )
            }
          >
            {pending ? 'Confirming…' : 'Confirm ⭐ +1'}
          </Button>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              run(() =>
                declineCharacterAction(
                  submission.submissionId,
                  "Let's talk about this one together.",
                ),
              )
            }
          >
            Ask about it
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
