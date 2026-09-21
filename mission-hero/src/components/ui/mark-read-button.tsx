'use client';

import { useTransition } from 'react';
import { cn } from '@/lib/utils';

export function MarkReadButton({
  action,
  onDark = false,
}: {
  action: () => Promise<void>;
  onDark?: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => action())}
      className={cn(
        'mh-tap-sm shrink-0 rounded-full px-4 text-sm font-bold disabled:opacity-60',
        onDark
          ? 'border-2 border-white/50 text-white'
          : 'border-2 border-border bg-card text-muted',
      )}
    >
      {pending ? 'Marking…' : 'Mark all read'}
    </button>
  );
}
