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
  timeout: 60_000,
  expect: { timeout: 10_000 },
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
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
