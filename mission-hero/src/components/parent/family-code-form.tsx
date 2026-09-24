'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { updateFamilyCodeAction } from '@/features/families/actions';
import { FAMILY_CODE_MAX_LENGTH, FAMILY_CODE_MIN_LENGTH } from '@/domain/constants';

/**
 * The code children type to reach this family.
 *
 * The app picks one at registration so a family can start immediately, but it
 * is unmemorable by design, and this is the thing a child types on a shared
 * tablet every morning. Owners can put their own name on it.
 */
export function FamilyCodeForm({ familyCode }: { familyCode: string }) {
  const [state, action] = useActionState(updateFamilyCodeAction, undefined);

  return (
    <form action={action} className="space-y-2">
      <label htmlFor="familyCode" className="block text-sm font-bold text-ink">
        Family code
      </label>
      <input
        id="familyCode"
        name="familyCode"
        defaultValue={familyCode}
        minLength={FAMILY_CODE_MIN_LENGTH}
        maxLength={FAMILY_CODE_MAX_LENGTH}
        autoCapitalize="characters"
        autoComplete="off"
        required
        className="mh-tap-sm w-full rounded-xl2 border-2 border-border bg-card px-4 text-center font-mono text-xl font-black tracking-[0.2em] text-ink"
      />
      <p className="text-sm text-muted">
        What your children type to reach this family — {FAMILY_CODE_MIN_LENGTH} to{' '}
        {FAMILY_CODE_MAX_LENGTH} letters and numbers. Changing it does not sign anybody out, but the
        old code stops working.
      </p>
      <SaveButton />
      {state?.error ? (
        <p role="alert" className="text-sm font-semibold text-star">
          {state.error}
        </p>
      ) : null}
      {state?.ok ? (
        <p role="status" className="text-sm font-semibold text-success">
          Saved.
        </p>
      ) : null}
    </form>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="solid" disabled={pending}>
      {pending ? 'Saving…' : 'Save code'}
    </Button>
  );
}
