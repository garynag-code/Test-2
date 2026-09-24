'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { deleteTaskAction } from '@/features/tasks/actions';

/**
 * Retiring a mission, with the confirm step inline rather than in a dialog.
 *
 * Two taps, and the second one says what it does. A mission may have months
 * of a child's history behind it, so this is not a thing to do by brushing
 * past a button.
 */
export function DeleteTaskButton({ taskId, title }: { taskId: string; title: string }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        Remove
      </Button>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted">Remove “{title}”?</span>
      <Button
        type="button"
        variant="danger"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await deleteTaskAction(taskId);
            if (result?.error) setError(result.error);
          })
        }
      >
        {pending ? 'Removing…' : 'Yes, remove'}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
        Keep it
      </Button>
      {error ? (
        <span role="alert" className="text-sm font-semibold text-star">
          {error}
        </span>
      ) : null}
    </span>
  );
}
