'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { selectChildAction } from '@/features/auth/actions';
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH } from '@/domain/constants';

interface Profile {
  id: string;
  nickname: string;
  avatarKey: string;
  themeKey: string;
  pinRequired: boolean;
}

const AVATARS: Record<string, string> = {
  'hero-1': '🦸',
  'hero-2': '🧑‍🚀',
  'hero-3': '🦊',
  'hero-4': '🦄',
  'hero-5': '🐲',
  'hero-6': '🤖',
};

export function ProfilePicker({ familyId, profiles }: { familyId: string; profiles: Profile[] }) {
  const [state, action] = useActionState(selectChildAction, undefined);
  const [selected, setSelected] = useState<Profile | null>(null);

  if (profiles.length === 0) {
    return (
      <p className="mt-8 rounded-xl2 bg-white/15 p-5 text-center font-semibold">
        No heroes here yet. Ask a grown-up to add you.
      </p>
    );
  }

  if (selected?.pinRequired) {
    return (
      <form action={action} className="mt-8 space-y-4">
        <input type="hidden" name="familyId" value={familyId} />
        <input type="hidden" name="childId" value={selected.id} />
        <p className="text-center text-6xl" aria-hidden>
          {AVATARS[selected.avatarKey] ?? '🦸'}
        </p>
        <label htmlFor="pin" className="block text-center text-lg font-bold">
          Hi {selected.nickname}! Enter your PIN
        </label>
        <input
          id="pin"
          name="pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          pattern={`\\d{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}`}
          maxLength={PIN_MAX_LENGTH}
          required
          className="mh-tap w-full rounded-xl2 border-4 border-white/40 bg-white/15 px-4 text-center text-4xl font-black tracking-[0.5em] text-white"
        />
        {state?.error ? (
          <p role="alert" className="rounded-xl2 bg-white/20 px-4 py-3 text-center font-semibold">
            {state.error}
          </p>
        ) : null}
        <PinSubmit />
        <button
          type="button"
          onClick={() => setSelected(null)}
          className="mh-tap w-full rounded-full border-2 border-white/40 font-bold"
        >
          ← Someone else
        </button>
      </form>
    );
  }

  return (
    <>
      <ul className="mt-8 grid grid-cols-2 gap-4">
        {profiles.map((profile) => (
          <li key={profile.id}>
            {profile.pinRequired ? (
              <button
                type="button"
                onClick={() => setSelected(profile)}
                className="flex w-full flex-col items-center gap-2 rounded-xl3 bg-white/15 p-5 text-white"
              >
                <span aria-hidden className="text-5xl">
                  {AVATARS[profile.avatarKey] ?? '🦸'}
                </span>
                <span className="text-lg font-extrabold">{profile.nickname}</span>
                <span className="text-xs text-white/70">PIN needed</span>
              </button>
            ) : (
              <form action={action}>
                <input type="hidden" name="familyId" value={familyId} />
                <input type="hidden" name="childId" value={profile.id} />
                <button
                  type="submit"
                  className="flex w-full flex-col items-center gap-2 rounded-xl3 bg-white/15 p-5 text-white active:scale-[0.98]"
                >
                  <span aria-hidden className="text-5xl">
                    {AVATARS[profile.avatarKey] ?? '🦸'}
                  </span>
                  <span className="text-lg font-extrabold">{profile.nickname}</span>
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
      {state?.error ? (
        <p
          role="alert"
          className="mt-4 rounded-xl2 bg-white/20 px-4 py-3 text-center font-semibold"
        >
          {state.error}
        </p>
      ) : null}
    </>
  );
}

function PinSubmit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mh-tap w-full rounded-full bg-white px-6 text-lg font-extrabold text-brand shadow-pop disabled:opacity-60"
    >
      {pending ? 'Checking…' : 'Go!'}
    </button>
  );
}
