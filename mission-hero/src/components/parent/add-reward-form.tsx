'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { createRewardAction } from '@/features/rewards/actions';

const TYPES = [
  { value: 'EXPERIENCE', label: 'Experience' },
  { value: 'FOOD', label: 'Treat' },
  { value: 'SCREEN_TIME', label: 'Screen time' },
  { value: 'PRIVILEGE', label: 'Privilege' },
  { value: 'POCKET_MONEY', label: 'Pocket money' },
  { value: 'PARENT_TIME', label: 'Time with you' },
  { value: 'PHYSICAL', label: 'Something physical' },
  { value: 'CUSTOM', label: 'Something else' },
];

export function AddRewardForm() {
  const [state, action] = useActionState(createRewardAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state?.ok]);

  return (
    <form ref={formRef} action={action} className="space-y-4">
      <div className="space-y-1">
        <label htmlFor="name" className="block text-sm font-bold text-ink">
          Reward
        </label>
        <input
          id="name"
          name="name"
          required
          maxLength={80}
          placeholder="Choose the movie"
          className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label htmlFor="type" className="block text-sm font-bold text-ink">
            Kind
          </label>
          <select
            id="type"
            name="type"
            defaultValue="EXPERIENCE"
            className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
          >
            {TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="pointsCost" className="block text-sm font-bold text-ink">
            Points
          </label>
          <input
            id="pointsCost"
            name="pointsCost"
            type="number"
            min={0}
            defaultValue={50}
            className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
          />
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor="inventoryQuantity" className="block text-sm font-bold text-ink">
          How many available?
        </label>
        <input
          id="inventoryQuantity"
          name="inventoryQuantity"
          type="number"
          min={0}
          placeholder="Leave empty for unlimited"
          aria-describedby="inventory-hint"
          className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
        />
        <p id="inventory-hint" className="text-xs text-muted">
          Empty means unlimited.
        </p>
      </div>

      <label className="mh-tap-sm flex items-center gap-3 rounded-xl2 border-2 border-border px-4">
        <input
          type="checkbox"
          name="requiresParentApproval"
          defaultChecked
          className="h-5 w-5 accent-[rgb(var(--mh-brand))]"
        />
        <span className="text-sm font-bold text-ink">Ask me before this is handed over</span>
      </label>

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
          Reward added.
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
      {pending ? 'Adding…' : 'Add reward'}
    </Button>
  );
}
