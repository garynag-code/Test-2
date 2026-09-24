/**
 * What is actually running.
 *
 * The values are stamped in at build time by next.config.ts, because at
 * runtime there is no repository to ask — the deployed thing is a compiled
 * bundle. Knowing the commit answers the question that comes up every time
 * something is pushed: is the fix live yet, or am I looking at the old build?
 */
export interface AppVersion {
  /** From package.json. */
  version: string;
  /** Full commit SHA, or 'unknown' when built outside a repository. */
  commit: string;
  /** The first seven characters, which is what people actually read. */
  shortCommit: string;
  /** ISO timestamp of the build. */
  builtAt: string;
}

export function appVersion(): AppVersion {
  const commit = process.env.NEXT_PUBLIC_APP_COMMIT || 'unknown';
  return {
    version: process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0',
    commit,
    shortCommit: commit === 'unknown' ? 'unknown' : commit.slice(0, 7),
    builtAt: process.env.NEXT_PUBLIC_APP_BUILT_AT || 'unknown',
  };
}

/** One line for a footer: "v0.1.0 · c556a9c". */
export function versionLabel(): string {
  const { version, shortCommit } = appVersion();
  return shortCommit === 'unknown' ? `v${version}` : `v${version} · ${shortCommit}`;
}
