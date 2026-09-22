import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The boot-time guard against a production deployment that serves plain http.
 *
 * Session cookies are `Secure` in production, and a browser silently discards
 * one sent over http — the sign-in form posts, the cookie is set, the browser
 * drops it, and the parent lands back on the login page with nothing to read.
 * Verified by hand against a production build on a local network: the browser
 * kept zero cookies.
 */

const BASE = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db?schema=public',
  AUTH_SECRET: 'a-secret-that-is-at-least-thirty-two-characters',
};

/** getEnv caches, so each case needs a fresh module. */
async function loadEnv(overrides: Record<string, string>) {
  vi.resetModules();
  for (const [key, value] of Object.entries({ ...BASE, ...overrides })) {
    vi.stubEnv(key, value);
  }
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const { getEnv } = await import('./env');
  getEnv();
  return warn;
}

beforeEach(() => {
  vi.stubEnv('MEDIA_UPLOADS_ENABLED', 'false');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('the http-in-production warning', () => {
  it('warns when a production deployment is served over plain http', async () => {
    const warn = await loadEnv({ NODE_ENV: 'production', APP_URL: 'http://192.168.1.50:3000' });

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain('sign-in will fail');
  });

  it('stays quiet behind HTTPS', async () => {
    const warn = await loadEnv({ NODE_ENV: 'production', APP_URL: 'https://missionhero.example' });

    expect(warn).not.toHaveBeenCalled();
  });

  it.each(['http://localhost:3000', 'http://127.0.0.1:3000'])(
    'stays quiet on %s, which browsers treat as a secure context',
    async (APP_URL) => {
      const warn = await loadEnv({ NODE_ENV: 'production', APP_URL });

      expect(warn).not.toHaveBeenCalled();
    },
  );

  it('stays quiet in development, where the cookies are not Secure at all', async () => {
    const warn = await loadEnv({ NODE_ENV: 'development', APP_URL: 'http://192.168.1.50:3000' });

    expect(warn).not.toHaveBeenCalled();
  });
});
