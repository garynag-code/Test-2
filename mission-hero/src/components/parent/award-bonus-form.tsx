'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { awardBonusAction } from '@/features/families/actions';

/**
 * A manual award is deliberately separate from approval, and it requires a
 * reason — which is what makes it auditable (BR-7).
 */
export function AwardBonusForm({
  childId,
  childNickname,
  traits,
}: {
  childId: string;
  childNickname: string;
  traits: Array<{ id: string; label: string }>;
}) {
  const [state, action] = useActionState(awardBonusAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state?.ok]);

  return (
    <form ref={formRef} action={action} className="space-y-4">
      <input type="hidden" name="childId" value={childId} />

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label htmlFor="bonus-xp" className="block text-sm font-bold text-ink">
            XP
          </label>
          <input
            id="bonus-xp"
            name="xp"
            type="number"
            min={0}
            max={500}
            defaultValue={0}
            className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="bonus-points" className="block text-sm font-bold text-ink">
            Reward points
          </label>
          <input
            id="bonus-points"
            name="points"
            type="number"
            min={-500}
            max={500}
            defaultValue={0}
            aria-describedby="bonus-points-hint"
            className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
          />
          <p id="bonus-points-hint" className="text-xs text-muted">
            Points may be negative. XP and stars never are.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label htmlFor="bonus-trait" className="block text-sm font-bold text-ink">
            Character star for
          </label>
          <select
            id="bonus-trait"
            name="traitId"
            defaultValue=""
            className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
          >
            <option value="">None</option>
            {traits.map((trait) => (
              <option key={trait.id} value={trait.id}>
                {trait.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="bonus-stars" className="block text-sm font-bold text-ink">
            Stars
          </label>
          <input
            id="bonus-stars"
            name="stars"
            type="number"
            min={0}
            max={10}
            defaultValue={1}
            className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
          />
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor="bonus-reason" className="block text-sm font-bold text-ink">
          Why?
        </label>
        <input
          id="bonus-reason"
          name="reason"
          required
          minLength={3}
          maxLength={280}
          placeholder="Helped a neighbour carry shopping"
          aria-describedby="bonus-reason-hint"
          className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
        />
        <p id="bonus-reason-hint" className="text-xs text-muted">
          Recorded in the audit log so you can account for it later.
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
      {state?.ok ? (
        <p
          role="status"
          className="rounded-xl2 bg-success/10 px-4 py-3 text-sm font-semibold text-success"
        >
          Awarded to {childNickname}.
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
      {pending ? 'Awarding…' : 'Award bonus'}
    </Button>
  );
}
