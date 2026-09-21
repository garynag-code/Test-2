'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { createChildAction } from '@/features/children/actions';

const AVATARS = [
  { key: 'hero-1', emoji: '🦸' },
  { key: 'hero-2', emoji: '🧑‍🚀' },
  { key: 'hero-3', emoji: '🦊' },
  { key: 'hero-4', emoji: '🦄' },
  { key: 'hero-5', emoji: '🐲' },
  { key: 'hero-6', emoji: '🤖' },
];

const THEMES = [
  'space',
  'jungle',
  'superhero',
  'underwater',
  'sports',
  'fantasy',
  'racing',
  'robots',
  'dinosaurs',
];

export function AddChildForm() {
  const [state, action] = useActionState(createChildAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the form after a success so a second child can be added straight away.
  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state?.ok]);

  return (
    <form ref={formRef} action={action} className="space-y-4">
      <div className="space-y-1">
        <label htmlFor="nickname" className="block text-sm font-bold text-ink">
          What should we call them?
        </label>
        <input
          id="nickname"
          name="nickname"
          required
          maxLength={30}
          placeholder="Josh"
          className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="ageBracket" className="block text-sm font-bold text-ink">
          Age
        </label>
        <select
          id="ageBracket"
          name="ageBracket"
          defaultValue="AGE_9_11"
          className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
        >
          <option value="AGE_6_8">6 – 8</option>
          <option value="AGE_9_11">9 – 11</option>
          <option value="AGE_12_14">12 – 14</option>
        </select>
      </div>

      <fieldset className="space-y-1">
        <legend className="text-sm font-bold text-ink">Avatar</legend>
        <div className="flex flex-wrap gap-2">
          {AVATARS.map((avatar, index) => (
            <label
              key={avatar.key}
              className="mh-tap-sm flex cursor-pointer items-center justify-center rounded-xl2 border-2 border-border px-3 text-2xl has-[:checked]:border-brand has-[:checked]:bg-brand-soft"
            >
              <input
                type="radio"
                name="avatarKey"
                value={avatar.key}
                defaultChecked={index === 0}
                className="sr-only"
              />
              <span aria-hidden>{avatar.emoji}</span>
              <span className="sr-only">{avatar.key}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="space-y-1">
        <label htmlFor="themeKey" className="block text-sm font-bold text-ink">
          Theme
        </label>
        <select
          id="themeKey"
          name="themeKey"
          defaultValue="space"
          className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base capitalize"
        >
          {THEMES.map((theme) => (
            <option key={theme} value={theme}>
              {theme}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label htmlFor="pin" className="block text-sm font-bold text-ink">
          PIN (optional)
        </label>
        <input
          id="pin"
          name="pin"
          inputMode="numeric"
          maxLength={6}
          placeholder="4–6 digits"
          aria-describedby="pin-hint"
          className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-base"
        />
        <p id="pin-hint" className="text-xs text-muted">
          Only needed if siblings share a device. You can change it later.
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
          Added. They can sign in with your family code.
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
      {pending ? 'Adding…' : 'Add hero'}
    </Button>
  );
}
