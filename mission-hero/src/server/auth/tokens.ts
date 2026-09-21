import 'server-only';
import { SignJWT, jwtVerify } from 'jose';
import { getEnv } from '@/lib/env';
import { CHILD_SESSION_HOURS, DEVICE_BINDING_DAYS, PARENT_SESSION_DAYS } from '@/domain/constants';

/**
 * Signed session tokens.
 *
 * Parent, child and device tokens carry a distinct `typ` claim and are verified
 * against it, so a child token can never be replayed as a parent one no matter
 * which cookie it is placed in (docs/03 §4).
 */

type TokenType = 'parent' | 'child' | 'device';

interface ParentClaims {
  typ: 'parent';
  sub: string; // userId
  fam: string; // familyId
  iat: number;
}

interface ChildClaims {
  typ: 'child';
  sub: string; // childId
  fam: string;
  iat: number;
}

interface DeviceClaims {
  typ: 'device';
  fam: string;
  iat: number;
}

const encoder = new TextEncoder();
const secret = (): Uint8Array => encoder.encode(getEnv().AUTH_SECRET);

async function sign(payload: Record<string, unknown>, expiresIn: string): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer('mission-hero')
    .setExpirationTime(expiresIn)
    .sign(secret());
}

async function verify<T>(token: string, expected: TokenType): Promise<T | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: 'mission-hero' });
    // The type claim is checked explicitly: a valid signature is not enough.
    if (payload.typ !== expected) return null;
    return payload as T;
  } catch {
    return null;
  }
}

export const parentToken = {
  sign: (userId: string, familyId: string) =>
    sign({ typ: 'parent', sub: userId, fam: familyId }, `${PARENT_SESSION_DAYS}d`),
  verify: (token: string) => verify<ParentClaims>(token, 'parent'),
};

export const childToken = {
  sign: (childId: string, familyId: string) =>
    sign({ typ: 'child', sub: childId, fam: familyId }, `${CHILD_SESSION_HOURS}h`),
  verify: (token: string) => verify<ChildClaims>(token, 'child'),
};

/**
 * Device binding carries a family id and *no* authority: with it alone a device
 * can render a list of nicknames and avatars, nothing more (docs/03 §5).
 */
export const deviceToken = {
  sign: (familyId: string) => sign({ typ: 'device', fam: familyId }, `${DEVICE_BINDING_DAYS}d`),
  verify: (token: string) => verify<DeviceClaims>(token, 'device'),
};
