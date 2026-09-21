'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { createChallengeAction } from '@/features/memory/actions';

const CATEGORIES = [
  { value: 'BIBLE_VERSE', label: 'Bible verse' },
  { value: 'QUOTE', label: 'Quote' },
  { value: 'AFFIRMATION', label: 'Affirmation' },
  { value: 'FAMILY_SAYING', label: 'Family saying' },
  { value: 'SLOGAN', label: 'Slogan' },
  { value: 'VOCABULARY', label: 'Vocabulary' },
  { value: 'SCHOOL_FACT', label: 'School fact' },
  { value: 'CUSTOM', label: 'Something else' },
];

export function AddChallengeForm({
  childOptions,
}: {
  childOptions: Array<{ id: string; nickname: string }>;
}) {
  const [state, action] = useActionState(createChallengeAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state?.ok]);

  return (
    <form ref={formRef} action={action} className="space-y-4">
      <div className="space-y-1">
        <label htmlFor="title" className="block text-sm font-bold text-ink">
          Name it
        </label>
        <input
          id="title"
          name="title"
          required
          maxLength={120}
          placeholder="Philippians 4:13"
          className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label htmlFor="category" className="block text-sm font-bold text-ink">
            Kind
          </label>
          <select
            id="category"
            name="category"
            defaultValue="CUSTOM"
            className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
          >
            {CATEGORIES.map((category) => (
              <option key={category.value} value={category.value}>
                {category.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="reference" className="block text-sm font-bold text-ink">
            Reference
          </label>
          <input
            id="reference"
            name="reference"
            maxLength={120}
            placeholder="Optional"
            className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
          />
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor="bodyText" className="block text-sm font-bold text-ink">
          The words to learn
        </label>
        <textarea
          id="bodyText"
          name="bodyText"
          required
          rows={3}
          maxLength={2000}
          placeholder="I can do all things through Christ who strengthens me."
          className="w-full rounded-xl2 border-2 border-border bg-card p-3 text-base"
        />
      </div>

      <fieldset className="space-y-1">
        <legend className="text-sm font-bold text-ink">Who&apos;s learning it?</legend>
        <div className="flex flex-wrap gap-2">
          {childOptions.map((child) => (
            <label
              key={child.id}
              className="mh-tap-sm flex cursor-pointer items-center gap-2 rounded-full border-2 border-border px-4 text-sm font-bold has-[:checked]:border-brand has-[:checked]:bg-brand-soft"
            >
              <input type="checkbox" name="childIds" value={child.id} className="sr-only" />
              {child.nickname}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label htmlFor="xpValue" className="block text-sm font-bold text-ink">
            XP
          </label>
          <input
            id="xpValue"
            name="xpValue"
            type="number"
            min={0}
            defaultValue={10}
            className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="rewardPointsValue" className="block text-sm font-bold text-ink">
            Reward points
          </label>
          <input
            id="rewardPointsValue"
            name="rewardPointsValue"
            type="number"
            min={0}
            defaultValue={5}
            className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
          />
        </div>
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
          Challenge added.
        </p>
      ) : null}

      <Submit label="Add challenge" />
    </form>
  );
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="block" disabled={pending}>
      {pending ? 'Adding…' : label}
    </Button>
  );
}
