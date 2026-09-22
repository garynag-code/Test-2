import { beforeEach, describe, expect, it } from 'vitest';
import { LIMITS, callerKey, consume, isBlocked, reset } from './rate-limit';

/** Rate limiting (docs/03 §9). Time is passed in, so nothing here sleeps. */

beforeEach(() => reset());

const limit = { limit: 5, windowMs: 60_000 };

describe('consume', () => {
  it('allows up to the limit and then refuses', () => {
    for (let i = 0; i < 5; i += 1) {
      expect(consume('a', limit, 0).allowed).toBe(true);
    }
    expect(consume('a', limit, 0).allowed).toBe(false);
  });

  it('says how long to wait', () => {
    for (let i = 0; i < 5; i += 1) consume('a', limit, 0);
    const blocked = consume('a', limit, 0);

    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(limit.windowMs);
  });

  it('refills gradually rather than in steps', () => {
    for (let i = 0; i < 5; i += 1) consume('a', limit, 0);
    expect(consume('a', limit, 0).allowed).toBe(false);

    // One fifth of the window is one token.
    expect(consume('a', limit, 12_000).allowed).toBe(true);
    expect(consume('a', limit, 12_000).allowed).toBe(false);
  });

  it('cannot be gamed by waiting for a window boundary', () => {
    for (let i = 0; i < 5; i += 1) consume('a', limit, 0);

    // A full window later there are five tokens, not ten.
    let allowed = 0;
    for (let i = 0; i < 20; i += 1) {
      if (consume('a', limit, 60_000).allowed) allowed += 1;
    }
    expect(allowed).toBe(5);
  });

  it('keeps callers separate', () => {
    for (let i = 0; i < 5; i += 1) consume('a', limit, 0);
    expect(consume('a', limit, 0).allowed).toBe(false);
    expect(consume('b', limit, 0).allowed).toBe(true);
  });

  it('never hands out more than the limit after a long idle period', () => {
    consume('a', limit, 0);
    let allowed = 0;
    for (let i = 0; i < 20; i += 1) {
      if (consume('a', limit, 10_000_000).allowed) allowed += 1;
    }
    expect(allowed).toBe(5);
  });
});

describe('isBlocked', () => {
  it('reports the state without spending a token', () => {
    expect(isBlocked('a', limit, 0)).toBe(false);
    // Peeking ten times must not use anything up.
    for (let i = 0; i < 10; i += 1) isBlocked('a', limit, 0);

    let allowed = 0;
    for (let i = 0; i < 10; i += 1) if (consume('a', limit, 0).allowed) allowed += 1;
    expect(allowed).toBe(5);
  });

  it('turns true exactly when the bucket is empty', () => {
    for (let i = 0; i < 5; i += 1) consume('a', limit, 0);
    expect(isBlocked('a', limit, 0)).toBe(true);
    // And false again once enough has refilled.
    expect(isBlocked('a', limit, 12_000)).toBe(false);
  });

  it('lets an unlimited number of correct attempts through', () => {
    // The failure-only pattern: peek, do the work, spend nothing on success.
    for (let i = 0; i < 100; i += 1) {
      expect(isBlocked('honest-user', limit, i * 1000)).toBe(false);
    }
  });
});

describe('the configured limits', () => {
  it('are strict where an attacker would push, and generous where a child would', () => {
    expect(LIMITS.childPin.limit).toBeLessThanOrEqual(5);
    expect(LIMITS.parentLoginByEmail.limit).toBeLessThanOrEqual(5);
    // Well above legitimate use, so only a script trips it.
    expect(LIMITS.wheelSpin.limit).toBeGreaterThanOrEqual(20);
    expect(LIMITS.mutation.limit).toBeGreaterThanOrEqual(60);
  });
});

describe('callerKey', () => {
  it('uses the first forwarded address', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' });
    expect(callerKey(headers, 'login')).toBe('login:203.0.113.7');
  });

  it('falls back to a shared bucket rather than trusting nothing', () => {
    expect(callerKey(new Headers(), 'login')).toBe('login:unknown');
  });

  it('scopes buckets per route', () => {
    const headers = new Headers({ 'x-real-ip': '203.0.113.7' });
    expect(callerKey(headers, 'login')).not.toBe(callerKey(headers, 'pin'));
  });
});
