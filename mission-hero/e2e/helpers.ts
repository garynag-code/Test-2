import { execSync } from 'node:child_process';
import { expect, type Page } from '@playwright/test';

/**
 * The e2e suite drives the real app against a real database, so each spec
 * starts from the seeded Adventure Family rather than fabricating state.
 */

export const SEED = {
  familyCode: 'ADVENTUR',
  parentEmail: 'mom@adventure.family',
  parentPassword: 'MissionHero123!',
  childNickname: 'Josh',
  siblingNickname: 'Sarah',
} as const;

export function reseed(): void {
  execSync('npx tsx prisma/seed.ts', { stdio: 'pipe' });
}

/**
 * Waits until React has taken over the page.
 *
 * Playwright's actionability checks cover visible/stable/enabled, but not
 * hydration: a click dispatched while React is still attaching can be lost
 * between the server-rendered markup and the hydrated handler. A person would
 * never move that fast; the test harness does, every time.
 *
 * Network-idle is the signal here because it is the one that actually
 * correlates — once the chunks have arrived, hydration follows immediately.
 * It is best-effort: a page that never goes idle should not hang the suite.
 */
export async function waitForInteractive(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  // Bounded: a page that never goes fully idle must cost three seconds, not
  // the default thirty, or a slow route eats the whole test budget.
  await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => undefined);
}

export async function signInAsParent(page: Page): Promise<void> {
  await page.goto('/parent/login');
  await expect(page.getByLabel('Email')).toBeVisible();
  await waitForInteractive(page);
  await page.getByLabel('Email').fill(SEED.parentEmail);
  await page.getByLabel('Password').fill(SEED.parentPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
  /*
   * Waits on content, not the URL.
   *
   * `waitForURL` waits for a load event, which a client-side router
   * navigation never fires; `toHaveURL` polls but can match before the
   * destination has rendered. Something only the dashboard renders is the
   * signal that actually means "signed in".
   */
  await expect(page.getByRole('link', { name: 'Mission Hero' })).toBeVisible();
}

export async function signInAsChild(page: Page, nickname = SEED.childNickname): Promise<void> {
  await page.goto('/kids');

  const codeField = page.getByLabel('Family code');
  const profile = page.getByRole('button', { name: nickname, exact: true });

  // `/kids` renders one of two states. Wait for whichever arrived before
  // deciding: isVisible() does not auto-wait, so checking it straight after a
  // navigation silently reports false on a slow render and skips the code step.
  await expect(codeField.or(profile).first()).toBeVisible();
  await waitForInteractive(page);

  if (await codeField.isVisible()) {
    await codeField.fill(SEED.familyCode);
    await page.getByRole('button', { name: "Let's go!" }).click();
    await expect(profile).toBeVisible();
    await waitForInteractive(page);
  }

  await profile.click();
  await expect(page.getByRole('heading', { name: new RegExp(`Hey ${nickname}`) })).toBeVisible();
}
