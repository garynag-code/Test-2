'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { createQuestAction } from '@/features/secret-missions/actions';

const HIDDEN_OBJECTS = ['chest', 'star', 'key', 'gem', 'rocket', 'scroll', 'egg', 'bolt', 'shield'];

export function AddQuestForm({ traits }: { traits: Array<{ id: string; label: string }> }) {
  const [state, action] = useActionState(createQuestAction, undefined);
  const [kind, setKind] = useState<'SECRET' | 'BONUS'>('SECRET');
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      setKind('SECRET');
    }
  }, [state?.ok]);

  return (
    <form ref={formRef} action={action} className="space-y-4">
      <fieldset className="space-y-1">
        <legend className="text-sm font-bold text-ink">What kind?</legend>
        <div className="flex gap-2">
          {(
            [
              {
                value: 'SECRET',
                label: '🗝️ Secret mission',
                hint: 'Hidden — they have to find it',
              },
              { value: 'BONUS', label: '⭐ Bonus challenge', hint: 'Listed openly' },
            ] as const
          ).map((option) => (
            <label
              key={option.value}
              className="flex flex-1 cursor-pointer flex-col gap-1 rounded-xl2 border-2 border-border p-3 has-[:checked]:border-brand has-[:checked]:bg-brand-soft"
            >
              <input
                type="radio"
                name="kind"
                value={option.value}
                checked={kind === option.value}
                onChange={() => setKind(option.value)}
                className="sr-only"
              />
              <span className="text-sm font-bold text-ink">{option.label}</span>
              <span className="text-xs text-muted">{option.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="space-y-1">
        <label htmlFor="quest-title" className="block text-sm font-bold text-ink">
          Name it
        </label>
        <input
          id="quest-title"
          name="title"
          required
          maxLength={120}
          placeholder="Secret Kindness Mission"
          className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="instructions" className="block text-sm font-bold text-ink">
          What should they do?
        </label>
        <textarea
          id="instructions"
          name="instructions"
          required
          rows={2}
          maxLength={1000}
          placeholder="Do something helpful without being asked."
          className="w-full rounded-xl2 border-2 border-border bg-card p-3 text-base"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label htmlFor="rarity" className="block text-sm font-bold text-ink">
            Rarity
          </label>
          <select
            id="rarity"
            name="rarity"
            defaultValue="COMMON"
            aria-describedby="rarity-hint"
            className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
          >
            <option value="COMMON">Common</option>
            <option value="RARE">Rare</option>
            <option value="EPIC">Epic</option>
            <option value="LEGENDARY">Legendary</option>
          </select>
          <p id="rarity-hint" className="text-xs text-muted">
            Changes how it looks. Nothing is ever bought.
          </p>
        </div>
        {kind === 'SECRET' ? (
          <div className="space-y-1">
            <label htmlFor="hiddenObjectKey" className="block text-sm font-bold text-ink">
              Hidden as
            </label>
            <select
              id="hiddenObjectKey"
              name="hiddenObjectKey"
              defaultValue="chest"
              className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base capitalize"
            >
              {HIDDEN_OBJECTS.map((object) => (
                <option key={object} value={object}>
                  {object}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label htmlFor="quest-xp" className="block text-sm font-bold text-ink">
            XP
          </label>
          <input
            id="quest-xp"
            name="xpValue"
            type="number"
            min={0}
            defaultValue={20}
            className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="quest-points" className="block text-sm font-bold text-ink">
            Reward points
          </label>
          <input
            id="quest-points"
            name="rewardPointsValue"
            type="number"
            min={0}
            defaultValue={10}
            className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
          />
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor="quest-trait" className="block text-sm font-bold text-ink">
          Also builds a character trait
        </label>
        <select
          id="quest-trait"
          name="characterTraitId"
          defaultValue=""
          aria-describedby="quest-trait-hint"
          className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
        >
          <option value="">None</option>
          {traits.map((trait) => (
            <option key={trait.id} value={trait.id}>
              {trait.label}
            </option>
          ))}
        </select>
        <p id="quest-trait-hint" className="text-xs text-muted">
          Adds one Character Star when you approve it.
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
          Quest added.
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
      {pending ? 'Adding…' : 'Add quest'}
    </Button>
  );
}
