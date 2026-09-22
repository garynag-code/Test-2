import { execSync } from 'node:child_process';
import { expect, type Locator, type Page } from '@playwright/test';

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
 * Best-effort and cheap; `clickWhenHydrated` is the one that actually
 * guarantees safety before an interaction.
 */
export async function waitForInteractive(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => undefined);
}

/**
 * Clicks a control only once React has attached to it.
 *
 * Forms driven by `useActionState` do not progressively enhance without a
 * `permalink`: before hydration their submit is an ordinary POST that carries
 * no action reference, so the server re-renders the same page and the click
 * appears to do nothing. Playwright's actionability checks cover
 * visible/stable/enabled but say nothing about hydration, and the harness is
 * fast enough to land in that window regularly. A person is not.
 */
export async function clickWhenHydrated(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();

  // Best-effort: React's internal keys are the clearest evidence that this
  // element is wired up, but they are an implementation detail. If they never
  // appear, settle briefly and click anyway rather than failing on the probe.
  await locator
    .evaluate(
      (element) =>
        new Promise<void>((resolve, reject) => {
          const startedAt = Date.now();
          const attached = () => Object.keys(element).some((key) => key.startsWith('__react'));
          const tick = () => {
            if (attached()) return resolve();
            if (Date.now() - startedAt > 5_000) return reject(new Error('no react keys'));
            requestAnimationFrame(tick);
          };
          tick();
        }),
    )
    .catch(async () => {
      await locator.page().waitForTimeout(500);
    });

  await locator.click();
}

export async function signInAsParent(page: Page): Promise<void> {
  await page.goto('/parent/login');
  await expect(page.getByLabel('Email')).toBeVisible();
  await page.getByLabel('Email').fill(SEED.parentEmail);
  await page.getByLabel('Password').fill(SEED.parentPassword);
  await clickWhenHydrated(page.getByRole('button', { name: 'Sign in' }));
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

  if (await codeField.isVisible()) {
    await codeField.fill(SEED.familyCode);
    await clickWhenHydrated(page.getByRole('button', { name: "Let's go!" }));
    await expect(profile).toBeVisible();
  }

  await clickWhenHydrated(profile);
  await expect(page.getByRole('heading', { name: new RegExp(`Hey ${nickname}`) })).toBeVisible();
}
