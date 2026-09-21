'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { isAppError } from '@/server/errors';
import {
  bindDeviceToFamily,
  endChildSession,
  endParentSession,
  startChildSession,
  startParentSession,
} from '@/server/auth/session';
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH } from '@/domain/constants';
import * as families from '@/features/families/service';
import * as children from '@/features/children/service';

/**
 * Auth server actions.
 *
 * Every action returns `{ error }` rather than throwing, so the forms can
 * render a message; a thrown error would surface as a generic Next.js error
 * page, which is a poor experience for a parent at 7 a.m.
 */

export type ActionState = { error?: string } | undefined;

const registerSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(10, 'Use at least 10 characters'),
  displayName: z.string().trim().min(1, 'Tell us your name').max(60),
  familyName: z.string().trim().min(1, 'Name your family').max(60),
  parentNickname: z.string().trim().max(30).optional(),
  timezone: z.string().trim().min(1).default('Africa/Johannesburg'),
});

export async function registerAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = registerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check those details' };

  try {
    const { user, family } = await families.registerParent(parsed.data);
    await startParentSession(user.id, family.id);
  } catch (error) {
    return { error: isAppError(error) ? error.publicMessage : 'Could not create that account.' };
  }
  redirect('/parent');
}

const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});

export async function loginAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check those details' };

  try {
    const result = await families.loginParent(parsed.data.email, parsed.data.password);
    await startParentSession(result.userId, result.familyId);
  } catch {
    // Same message whichever half was wrong (docs/03 §9).
    return { error: 'That email and password do not match.' };
  }
  redirect('/parent');
}

export async function logoutAction(): Promise<void> {
  await endParentSession();
  redirect('/');
}

export async function childLogoutAction(): Promise<void> {
  await endChildSession();
  redirect('/kids');
}

/** Binds this device to a family. Confers no authority on its own. */
export async function bindDeviceAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const code = String(formData.get('familyCode') ?? '');
  const family = await families.findFamilyByCode(code);
  if (!family) return { error: "We couldn't find that family code." };

  await bindDeviceToFamily(family.id);
  redirect('/kids');
}

const pinSchema = z
  .string()
  .regex(new RegExp(`^\\d{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`), 'Enter your PIN');

export async function selectChildAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const familyId = String(formData.get('familyId') ?? '');
  const childId = String(formData.get('childId') ?? '');
  const pinRaw = formData.get('pin');

  if (!familyId || !childId) return { error: 'Pick your profile to keep going.' };

  // The familyId here comes from the device cookie rendered into the form; the
  // service re-checks that the child really belongs to it.
  const pin = pinRaw === null ? '' : String(pinRaw);
  if (pin && !pinSchema.safeParse(pin).success) return { error: 'Enter your PIN.' };

  const result = await children.verifyChildPin(familyId, childId, pin);

  if (!result.ok) {
    if (result.lockedUntil) {
      return { error: "Let's take a short break and try again in a few minutes." };
    }
    return {
      error:
        result.attemptsRemaining !== undefined
          ? `Not quite. ${result.attemptsRemaining} ${result.attemptsRemaining === 1 ? 'try' : 'tries'} left.`
          : 'Pick your profile to keep going.',
    };
  }

  await startChildSession(result.childId!, result.familyId!);
  redirect('/kids/home');
}
