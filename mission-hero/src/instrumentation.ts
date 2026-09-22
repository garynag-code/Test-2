/**
 * Runs once, in the Node runtime, when the server starts.
 *
 * Validating the environment here means a misconfigured deployment says so in
 * the startup log rather than at the first request — and, unlike middleware,
 * this sees the real environment. Middleware runs in the Edge runtime, where
 * Next bakes environment values into the bundle at build time, so a check
 * living only there would report whatever the build machine had.
 */
export async function register(): Promise<void> {
  const { getEnv } = await import('@/lib/env');
  getEnv();
}
