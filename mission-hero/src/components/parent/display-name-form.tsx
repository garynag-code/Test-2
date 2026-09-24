'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { updateDisplayNameAction } from '@/features/families/actions';

/**
 * A grown-up's own name, which a child sees on every approval.
 *
 * Chosen at registration and, until now, fixed for good.
 */
export function DisplayNameForm({ displayName }: { displayName: string }) {
  const [state, action] = useActionState(updateDisplayNameAction, undefined);

  return (
    <form action={action} className="space-y-2">
      <label htmlFor="displayName" className="block text-sm font-bold text-ink">
        Your name
      </label>
      <input
        id="displayName"
        name="displayName"
        defaultValue={displayName}
        maxLength={60}
        required
        className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
      />
      <p className="text-sm text-muted">
        This is what your children see when you approve something.
      </p>
      <SaveButton />
      {state?.error ? (
        <p role="alert" className="text-sm font-semibold text-star">
          {state.error}
        </p>
      ) : null}
      {state?.ok ? (
        <p role="status" className="text-sm font-semibold text-success">
          Saved.
        </p>
      ) : null}
    </form>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="solid" disabled={pending}>
      {pending ? 'Saving…' : 'Save name'}
    </Button>
  );
}
