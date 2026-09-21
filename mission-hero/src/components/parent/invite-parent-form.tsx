'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { inviteParentAction, revokeInviteAction } from '@/features/families/actions';

interface Invite {
  id: string;
  email: string;
  role: string;
  token: string;
  expiresAt: Date;
}

/**
 * Invites are shown as a link to pass on rather than emailed: Mission Hero
 * sends nothing to a third party in the MVP, which keeps one fewer service in
 * the path of a family's data.
 */
export function InviteParentForm({ invites }: { invites: Invite[] }) {
  const [state, action] = useActionState(inviteParentAction, undefined);
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state?.ok]);

  return (
    <div className="space-y-4">
      <form ref={formRef} action={action} className="space-y-3">
        <div className="space-y-1">
          <label htmlFor="invite-email" className="block text-sm font-bold text-ink">
            Invite another grown-up
          </label>
          <input
            id="invite-email"
            name="email"
            type="email"
            required
            placeholder="them@example.com"
            className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="invite-role" className="block text-sm font-bold text-ink">
            As a
          </label>
          <select
            id="invite-role"
            name="role"
            defaultValue="PARENT"
            className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
          >
            <option value="PARENT">Parent — can do everything except invite others</option>
            <option value="GUARDIAN">Guardian — same day-to-day access</option>
          </select>
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

      {invites.length > 0 ? (
        <div className="space-y-2 border-t border-border pt-4">
          <p className="text-sm font-bold text-ink">Waiting to be accepted</p>
          <ul className="space-y-2">
            {invites.map((invite) => {
              const link = `/join?token=${invite.token}`;
              return (
                <li key={invite.id} className="rounded-xl2 border-2 border-border p-3">
                  <p className="text-sm font-bold text-ink">{invite.email}</p>
                  <p className="text-xs text-muted">
                    Expires {invite.expiresAt.toLocaleDateString('en-ZA')} · one use only
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const url = `${window.location.origin}${link}`;
                        navigator.clipboard?.writeText(url).then(
                          () => setCopied(invite.id),
                          () => setCopied(null),
                        );
                      }}
                    >
                      {copied === invite.id ? 'Copied!' : 'Copy invite link'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => startTransition(() => revokeInviteAction(invite.id))}
                    >
                      Cancel
                    </Button>
                  </div>
                  <p className="mt-2 break-all font-mono text-xs text-muted">{link}</p>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="block" disabled={pending}>
      {pending ? 'Creating…' : 'Create invite link'}
    </Button>
  );
}
