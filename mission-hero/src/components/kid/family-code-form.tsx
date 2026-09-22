'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { bindDeviceAction } from '@/features/auth/actions';
import { FAMILY_CODE_LENGTH } from '@/domain/constants';

export function FamilyCodeForm() {
  const [state, action] = useActionState(bindDeviceAction, undefined);
  const router = useRouter();

  /*
   * Refreshes explicitly once the device is bound.
   *
   * The action sets a cookie and relies on this page re-rendering to swap the
   * form for the profile picker. Asking for the refresh here rather than
   * leaving it to the action's own revalidation makes that deterministic —
   * the cookie is in the jar by the time the request goes out.
   */
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state?.ok, router]);

  return (
    <form action={action} className="mt-6 space-y-4">
      <label
        htmlFor="familyCode"
        className="block text-sm font-bold uppercase tracking-wide text-white/80"
      >
        Family code
      </label>
      <input
        id="familyCode"
        name="familyCode"
        inputMode="text"
        autoCapitalize="characters"
        autoComplete="off"
        maxLength={FAMILY_CODE_LENGTH + 4}
        required
        className="mh-tap w-full rounded-xl2 border-4 border-white/40 bg-white/15 px-4 text-center font-mono text-3xl font-black tracking-[0.25em] text-white placeholder:text-white/50"
        placeholder="ABCD1234"
      />
      {state?.error ? (
        <p role="alert" className="rounded-xl2 bg-white/20 px-4 py-3 font-semibold">
          {state.error}
        </p>
      ) : null}
      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mh-tap w-full rounded-full bg-white px-6 text-lg font-extrabold text-brand shadow-pop disabled:opacity-60"
    >
      {pending ? 'Checking…' : "Let's go!"}
    </button>
  );
}
