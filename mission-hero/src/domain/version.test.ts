import { afterEach, describe, expect, it, vi } from 'vitest';

/** The build stamp shown in Settings and returned by /api/health. */

async function load(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) vi.stubEnv(key, '');
    else vi.stubEnv(key, value);
  }
  return import('./version');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('appVersion', () => {
  it('reports what the build was stamped with', async () => {
    const { appVersion } = await load({
      NEXT_PUBLIC_APP_VERSION: '1.2.3',
      NEXT_PUBLIC_APP_COMMIT: 'c556a9cd57ccb780a9b8d709f3d9b3a42f9d3598',
      NEXT_PUBLIC_APP_BUILT_AT: '2026-09-24T07:13:12.033Z',
    });

    expect(appVersion()).toEqual({
      version: '1.2.3',
      commit: 'c556a9cd57ccb780a9b8d709f3d9b3a42f9d3598',
      shortCommit: 'c556a9c',
      builtAt: '2026-09-24T07:13:12.033Z',
    });
  });

  it('degrades to "unknown" rather than throwing when nothing was stamped', async () => {
    const { appVersion, versionLabel } = await load({
      NEXT_PUBLIC_APP_VERSION: undefined,
      NEXT_PUBLIC_APP_COMMIT: undefined,
      NEXT_PUBLIC_APP_BUILT_AT: undefined,
    });

    expect(appVersion().shortCommit).toBe('unknown');
    // No dangling separator when there is no commit to show.
    expect(versionLabel()).toBe('v0.0.0');
  });
});

describe('versionLabel', () => {
  it('is the one line a footer needs', async () => {
    const { versionLabel } = await load({
      NEXT_PUBLIC_APP_VERSION: '0.1.0',
      NEXT_PUBLIC_APP_COMMIT: 'abcdef1234567890',
      NEXT_PUBLIC_APP_BUILT_AT: '2026-09-24T07:13:12.033Z',
    });

    expect(versionLabel()).toBe('v0.1.0 · abcdef1');
  });
});
