'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { deleteFamilyAction } from '@/features/families/actions';

/**
 * Deliberately awkward: hidden behind a disclosure, and requiring both the
 * owner's password and the family's exact name. Nothing about this is
 * recoverable, so it should be hard to do by accident.
 */
export function DeleteFamilyForm({ familyName }: { familyName: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(deleteFamilyAction, undefined);

  if (!open) {
    return (
      <Button variant="ghost" size="md" onClick={() => setOpen(true)}>
        Delete this family permanently
      </Button>
    );
  }

  return (
    <form action={action} className="space-y-3 rounded-xl2 border-2 border-star/40 bg-star/5 p-4">
      <p className="text-sm font-bold text-ink">This cannot be undone.</p>
      <p className="text-sm text-muted">
        Every child profile, every mission, every star and the whole history will be erased for
        everyone in {familyName}. Download your data first if you want to keep it.
      </p>

      <div className="space-y-1">
        <label htmlFor="delete-confirmation" className="block text-sm font-bold text-ink">
          Type <span className="font-mono">{familyName}</span> to confirm
        </label>
        <input
          id="delete-confirmation"
          name="confirmation"
          required
          autoComplete="off"
          className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="delete-password" className="block text-sm font-bold text-ink">
          Your password
        </label>
        <input
          id="delete-password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
        />
      </div>

      {state?.error ? (
        <p role="alert" className="text-sm font-semibold text-star">
          {state.error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <DeleteButton />
        <Button variant="outline" onClick={() => setOpen(false)}>
          Keep it
        </Button>
      </div>
    </form>
  );
}

function DeleteButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="danger" disabled={pending} className="border-star text-star">
      {pending ? 'Deleting…' : 'Delete everything'}
    </Button>
  );
}
