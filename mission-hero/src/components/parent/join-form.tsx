'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { acceptInviteAction } from '@/features/families/actions';

export function JoinForm({ token }: { token: string }) {
  const [state, action] = useActionState(acceptInviteAction, undefined);

  return (
    <form action={action} className="mt-8 space-y-4">
      <input type="hidden" name="token" value={token} />

      <div className="space-y-1">
        <label htmlFor="displayName" className="block text-sm font-bold text-ink">
          Your name
        </label>
        <input
          id="displayName"
          name="displayName"
          required
          autoComplete="name"
          maxLength={60}
          className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="parentNickname" className="block text-sm font-bold text-ink">
          What the kids call you
        </label>
        <input
          id="parentNickname"
          name="parentNickname"
          placeholder="Dad"
          maxLength={30}
          className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="password" className="block text-sm font-bold text-ink">
          Choose a password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="new-password"
          aria-describedby="password-hint"
          className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
        />
        <p id="password-hint" className="text-xs text-muted">
          At least 10 characters. If you already have an account, sign in with it instead.
        </p>
      </div>

      {state?.error ? (
        <p
          role="alert"
          className="rounded-xl2 bg-star/10 px-4 py-3 text-sm font-semibold text-star"
        >
          {state.error}
        </p>
      ) : null}

      <Submit />
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="block" disabled={pending}>
      {pending ? 'Joining…' : 'Join the family'}
    </Button>
  );
}
