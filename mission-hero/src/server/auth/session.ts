import 'server-only';
import { cookies } from 'next/headers';
import {
  CHILD_SESSION_HOURS,
  COOKIE_CHILD_SESSION,
  COOKIE_DEVICE,
  COOKIE_PARENT_SESSION,
  DEVICE_BINDING_DAYS,
  PARENT_SESSION_DAYS,
} from '@/domain/constants';
import { childToken, deviceToken, parentToken } from './tokens';

/**
 * Cookie plumbing. Kept separate from the guards so the guards can be tested
 * against a supplied Actor without a request context.
 */

const secure = process.env.NODE_ENV === 'production';

const baseCookie = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure,
  path: '/',
};

export async function startParentSession(userId: string, familyId: string): Promise<void> {
  const token = await parentToken.sign(userId, familyId);
  (await cookies()).set(COOKIE_PARENT_SESSION, token, {
    ...baseCookie,
    maxAge: PARENT_SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function endParentSession(): Promise<void> {
  (await cookies()).delete(COOKIE_PARENT_SESSION);
}

export async function startChildSession(childId: string, familyId: string): Promise<void> {
  const token = await childToken.sign(childId, familyId);
  (await cookies()).set(COOKIE_CHILD_SESSION, token, {
    ...baseCookie,
    maxAge: CHILD_SESSION_HOURS * 60 * 60,
  });
}

export async function endChildSession(): Promise<void> {
  (await cookies()).delete(COOKIE_CHILD_SESSION);
}

export async function bindDeviceToFamily(familyId: string): Promise<void> {
  const token = await deviceToken.sign(familyId);
  (await cookies()).set(COOKIE_DEVICE, token, {
    ...baseCookie,
    maxAge: DEVICE_BINDING_DAYS * 24 * 60 * 60,
  });
}

export async function unbindDevice(): Promise<void> {
  (await cookies()).delete(COOKIE_DEVICE);
}

export async function readParentClaims(): Promise<{
  userId: string;
  familyId: string;
  issuedAt: Date;
} | null> {
  const token = (await cookies()).get(COOKIE_PARENT_SESSION)?.value;
  if (!token) return null;
  const claims = await parentToken.verify(token);
  if (!claims) return null;
  return { userId: claims.sub, familyId: claims.fam, issuedAt: new Date(claims.iat * 1000) };
}

export async function readChildClaims(): Promise<{ childId: string; familyId: string } | null> {
  const token = (await cookies()).get(COOKIE_CHILD_SESSION)?.value;
  if (!token) return null;
  const claims = await childToken.verify(token);
  if (!claims) return null;
  return { childId: claims.sub, familyId: claims.fam };
}

export async function readBoundFamilyId(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE_DEVICE)?.value;
  if (!token) return null;
  const claims = await deviceToken.verify(token);
  return claims?.fam ?? null;
}
