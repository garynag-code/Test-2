'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ENCOURAGEMENT_CHIPS } from '@/domain/copy';
import { relativeTime } from '@/lib/utils';
import { approveCompletionAction, rejectCompletionAction } from '@/features/tasks/actions';
import type { PendingApproval } from '@/features/tasks/types';
import { MISSION_ICONS } from '@/components/kid/mission-card';

export function ApprovalRow({ approval }: { approval: PendingApproval }) {
  const [pending, startTransition] = useTransition();
  const [showEncouragement, setShowEncouragement] = useState(false);
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
        <div className="flex items-start gap-3">
          <span aria-hidden className="text-2xl">
            {MISSION_ICONS[approval.iconKey] ?? '🎯'}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-extrabold text-ink">
              {approval.childNickname} · {approval.taskTitle}
            </p>
            <p className="text-xs text-muted">{relativeTime(approval.submittedAt)}</p>
            {approval.evidenceText || approval.childNote ? (
              <p className="mt-2 rounded-xl2 bg-surface p-3 text-sm text-ink">
                “{approval.evidenceText ?? approval.childNote}”
              </p>
            ) : null}
            <p className="mt-2 text-xs font-bold text-muted">
              Worth{' '}
              {[
                approval.xpValue > 0 ? `+${approval.xpValue} XP` : null,
                approval.rewardPointsValue > 0 ? `+${approval.rewardPointsValue} points` : null,
                approval.characterStarValue > 0
                  ? `+${approval.characterStarValue} ${approval.traitLabel ?? 'star'}`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        </div>

        {showEncouragement ? (
          <div className="space-y-2">
            <p className="text-sm font-bold text-ink">Add a word of encouragement?</p>
            <div className="flex flex-wrap gap-2">
              {ENCOURAGEMENT_CHIPS.slice(0, 4).map((chip) => (
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
            <label htmlFor={`msg-${approval.completionId}`} className="sr-only">
              Encouragement message
            </label>
            <input
              id={`msg-${approval.completionId}`}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={280}
              placeholder="Optional"
              className="mh-tap-sm w-full rounded-xl2 border-2 border-border px-3 text-sm"
            />
            <Button
              variant="primary"
              size="block"
              disabled={pending}
              onClick={() =>
                run(() =>
                  approveCompletionAction(approval.completionId, message.trim() || undefined),
                )
              }
            >
              {pending ? 'Awarding…' : 'Approve & award'}
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={pending} onClick={() => setShowEncouragement(true)}>
              Approve
            </Button>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(() =>
                  rejectCompletionAction(
                    approval.completionId,
                    'ASK_QUESTION',
                    'Tell me a bit more about this one?',
                  ),
                )
              }
            >
              Ask about it
            </Button>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(() => rejectCompletionAction(approval.completionId, 'REQUEST_REDO'))
              }
            >
              Try again
            </Button>
          </div>
        )}

        {error ? (
          <p role="alert" className="text-sm font-semibold text-star">
            {error}
          </p>
        ) : null}
      </Card>
    </li>
  );
}
