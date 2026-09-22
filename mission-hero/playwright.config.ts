import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 3100);
const baseURL = `http://127.0.0.1:${PORT}`;

/**
 * Some CI images ship a Chromium build that does not match the version
 * Playwright would download. `PLAYWRIGHT_CHROMIUM_PATH` (or the conventional
 * /opt/pw-browsers location) lets the suite use it instead of failing on a
 * missing browser.
 */
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const launchOptions = existsSync(chromiumPath) ? { executablePath: chromiumPath } : {};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 90_000,
  /*
   * Twenty seconds, not ten. Every assertion here is waiting on a real
   * round trip through Next, Prisma and PostgreSQL on one shared server, and
   * a seed that rebuilds a whole family runs between files. Ten seconds is a
   * tight budget for that on a modest CI box, and the failures it produces
   * look like broken features rather than a slow machine.
   */
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    // Phones are the primary target (brief §52).
    ...devices['Pixel 7'],
    launchOptions,
  },
  webServer: {
    command: `npm run build && npx next start -p ${PORT}`,
    url: baseURL,
    /*
     * Always start a fresh server, even locally.
     *
     * `next start` reads the build from disk once, at boot. Reusing a
     * long-lived server means a rebuilt .next is silently ignored, so a fix
     * looks like it did not work and the next hour goes into chasing a bug
     * that is no longer there. The extra build per run is worth not doing
     * that again.
     */
    reuseExistingServer: false,
    // Server logs are worth having when a run fails: without this Playwright
    // discards them, and a server-side error reads as "nothing happened".
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 240_000,
  },
});
