import 'server-only';

/**
 * Token-bucket rate limiting (docs/03 §9).
 *
 * In-process by design for the MVP: Mission Hero runs as a single instance and
 * the limits exist to stop scripted abuse, not to be a distributed quota. On
 * more than one instance each would hold its own buckets, which multiplies the
 * effective limit by the instance count — so a shared store (Redis) is
 * required before scaling out. That trade-off is stated here rather than
 * discovered later.
 */

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();

/** Old buckets are dropped lazily so the map cannot grow without bound. */
const SWEEP_AFTER_MS = 60 * 60 * 1000;
let lastSweep = Date.now();

export interface RateLimit {
  /** Requests allowed per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export const LIMITS = {
  parentLogin: { limit: 10, windowMs: 15 * 60 * 1000 },
  parentLoginByEmail: { limit: 5, windowMs: 15 * 60 * 1000 },
  register: { limit: 5, windowMs: 60 * 60 * 1000 },
  childPin: { limit: 5, windowMs: 15 * 60 * 1000 },
  /*
   * Generous on purpose: a household binding several devices in one sitting is
   * normal, and the code space (31^8, about 850 billion) makes brute force
   * hopeless regardless — this limit is here to stop a script hammering the
   * endpoint, not to be the defence.
   */
  familyCode: { limit: 40, windowMs: 60 * 60 * 1000 },
  wheelSpin: { limit: 30, windowMs: 60 * 60 * 1000 },
  mutation: { limit: 120, windowMs: 60 * 1000 },
} as const satisfies Record<string, RateLimit>;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export function consume(key: string, limit: RateLimit, now = Date.now()): RateLimitResult {
  sweep(now);

  const bucket = buckets.get(key);
  if (!bucket) {
    buckets.set(key, { tokens: limit.limit - 1, updatedAt: now });
    return { allowed: true, remaining: limit.limit - 1, retryAfterMs: 0 };
  }

  // Refill continuously rather than in steps, so a burst at a window boundary
  // cannot spend two windows' worth of tokens at once.
  const elapsed = now - bucket.updatedAt;
  const refill = (elapsed / limit.windowMs) * limit.limit;
  const tokens = Math.min(limit.limit, bucket.tokens + refill);

  if (tokens < 1) {
    const msPerToken = limit.windowMs / limit.limit;
    bucket.tokens = tokens;
    bucket.updatedAt = now;
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.ceil((1 - tokens) * msPerToken),
    };
  }

  bucket.tokens = tokens - 1;
  bucket.updatedAt = now;
  return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterMs: 0 };
}

/**
 * Whether a caller is currently out of tokens, without spending one.
 *
 * Used with `consume` on the failure path only: throttles on guessable
 * endpoints exist to slow down *wrong* answers, and a family signing in
 * correctly should never be told to wait.
 */
export function isBlocked(key: string, limit: RateLimit, now = Date.now()): boolean {
  const bucket = buckets.get(key);
  if (!bucket) return false;
  const elapsed = now - bucket.updatedAt;
  const refill = (elapsed / limit.windowMs) * limit.limit;
  return Math.min(limit.limit, bucket.tokens + refill) < 1;
}

export function reset(key?: string): void {
  if (key) buckets.delete(key);
  else buckets.clear();
}

function sweep(now: number): void {
  if (now - lastSweep < SWEEP_AFTER_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (now - bucket.updatedAt > SWEEP_AFTER_MS) buckets.delete(key);
  }
}

/**
 * A caller key that does not depend on a header an attacker controls.
 *
 * `x-forwarded-for` is trusted only because the app is expected to sit behind
 * a proxy that sets it; if it is absent the limit falls back to a shared
 * bucket, which is deliberately conservative.
 */
export function callerKey(headers: Headers, scope: string): string {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const real = headers.get('x-real-ip')?.trim();
  return `${scope}:${forwarded || real || 'unknown'}`;
}
