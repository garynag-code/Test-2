'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { LIMITS, callerKey, consume, isBlocked } from '@/server/rate-limit';
import { isAppError } from '@/server/errors';
import {
  bindDeviceToFamily,
  endChildSession,
  endParentSession,
  startChildSession,
  startParentSession,
} from '@/server/auth/session';
import { FAMILY_CODE_LENGTH, PIN_MAX_LENGTH, PIN_MIN_LENGTH } from '@/domain/constants';
import { isValidFamilyCodeShape } from '@/server/auth/family-code';
import * as families from '@/features/families/service';
import * as children from '@/features/children/service';

/**
 * Auth server actions.
 *
 * Every action returns `{ error }` rather than throwing, so the forms can
 * render a message; a thrown error would surface as a generic Next.js error
 * page, which is a poor experience for a parent at 7 a.m.
 */

export type ActionState = { error?: string; ok?: boolean } | undefined;

/**
 * Rate limiting on the paths an attacker would actually push: sign-in,
 * registration, PIN entry and family-code redemption (docs/03 §9).
 *
 * Only *failed* attempts spend a token. A family signing in correctly, or
 * binding several devices in one sitting, is not what these limits are for.
 */
async function callerBucket(scope: string): Promise<string> {
  return callerKey(await headers(), scope);
}

const TOO_MANY = 'Too many tries just now. Give it a few minutes.';

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
  const ipBucket = await callerBucket('login');
  if (isBlocked(ipBucket, LIMITS.parentLogin)) return { error: TOO_MANY };

  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check those details' };

  // Also limited per email, so an attacker cannot spread guesses across many
  // addresses — and, because only failures count, cannot lock a real user out
  // of their own account by guessing at it from elsewhere.
  const emailBucket = `login-email:${parsed.data.email.trim().toLowerCase()}`;
  if (isBlocked(emailBucket, LIMITS.parentLoginByEmail)) return { error: TOO_MANY };

  try {
    const result = await families.loginParent(parsed.data.email, parsed.data.password);
    await startParentSession(result.userId, result.familyId);
  } catch {
    consume(ipBucket, LIMITS.parentLogin);
    consume(emailBucket, LIMITS.parentLoginByEmail);
    // Same message whichever half was wrong (docs/03 §9).
    return { error: 'That email and password do not match.' };
  }
  redirect('/parent');
}

export async function logoutAction(): Promise<void> {
  await endParentSession();
  revalidatePath('/', 'layout');
  redirect('/');
}

export async function childLogoutAction(): Promise<void> {
  await endChildSession();
  revalidatePath('/kids', 'layout');
  redirect('/kids');
}

/**
 * Binds this device to a family. Confers no authority on its own.
 *
 * The two failures are told apart deliberately. "We couldn't find that code"
 * is no help to someone who typed their family's *name* — which is what
 * people do, because "family code" sounds like it could be one. Saying so
 * costs nothing: a wrong-shaped code proves nothing about which families
 * exist, so there is no guessing advantage to hand out here.
 */
export async function bindDeviceAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const code = String(formData.get('familyCode') ?? '');

  if (!isValidFamilyCodeShape(code)) {
    return {
      error: `A family code is ${FAMILY_CODE_LENGTH} letters and numbers, like ADVENTUR — not your family's name. A grown-up can find yours in Mission Hero under Children.`,
    };
  }

  const family = await families.findFamilyByCode(code);
  if (!family) {
    return {
      error:
        "That code doesn't match any family. Check it with a grown-up — they'll find it under Children.",
    };
  }

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

  // Only guess-limited when a PIN was actually submitted, and only a wrong
  // one costs a token. Limiting every profile tap would lock a family out of a
  // shared tablet after five switches, which is not an attack — it is Tuesday.
  const pinBucket = `pin:${childId}`;
  if (pin && isBlocked(pinBucket, LIMITS.childPin)) {
    return { error: "Let's take a short break and try again in a few minutes." };
  }

  const result = await children.verifyChildPin(familyId, childId, pin);

  if (!result.ok) {
    if (pin) consume(pinBucket, LIMITS.childPin);
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

  /*
   * Deliberately no redirect, for the same reason as the device bind above.
   *
   * Setting a cookie and redirecting in one action response races: the client
   * router can issue the navigation before the browser has committed the
   * Set-Cookie, and `/kids/home` then sees no session and bounces straight
   * back to the picker. Returning lets Next re-render `/kids`, whose server
   * component already redirects to the home page once a child session exists —
   * a redirect decided during render, after the cookie is unambiguously there.
   */
  revalidatePath('/kids', 'layout');
  return { ok: true };
}
