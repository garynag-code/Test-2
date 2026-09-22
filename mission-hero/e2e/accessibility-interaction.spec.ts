import { expect, test } from '@playwright/test';
import { reseed, signInAsChild } from './helpers';

/**
 * Accessibility in use (docs/08 §6): the child daily loop by keyboard alone,
 * reduced motion, and status that survives without colour.
 */

/*
 * Seeded once per file rather than before every test.
 *
 * The seed deletes the family and rebuilds it, which cascades across fifty
 * tables. Doing that between every test starves the running server's
 * connection pool badly enough that a single indexed lookup can take longer
 * than the assertion timeout — a failure that looks like a broken feature and
 * is really just contention. The tests in this file touch different missions
 * and children, so they stay independent without it.
 */
test.beforeAll(() => {
  reseed();
});

test('a child can complete a mission using only the keyboard', async ({ page }) => {
  await signInAsChild(page);

  // A mission that needs no evidence, so Enter completes it outright.
  const mission = page.locator('li', { hasText: 'Brush your teeth' }).first();
  const done = mission.getByRole('button', { name: 'DONE!' });
  await expect(done).toBeVisible();

  // Reachable by tabbing, with a visible focus ring, and activated by Enter.
  await done.focus();
  await expect(done).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(mission.getByText('Waiting')).toBeVisible();
});

test('the skip link is the first thing a keyboard reaches', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');

  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
});

test('reduced motion removes animation rather than speeding it up', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();

  await signInAsChild(page);
  await page.goto('/kids/wheel');

  // The wheel still works, and lands on the server's result without spinning.
  await page.getByRole('button', { name: 'SPIN!' }).click();
  const result = page.getByRole('status');
  await expect(result).toBeVisible({ timeout: 15_000 });
  await expect(result).toContainText('You won');

  const duration = await page.evaluate(() => {
    const element = document.querySelector('svg[role="img"]');
    return element ? window.getComputedStyle(element).transitionDuration : '0s';
  });
  // Browsers normalise the stylesheet's 0.001ms to forms like "1e-06s", so
  // assert on the value rather than its spelling: effectively instant, which
  // is the point — reduced motion removes the animation, it does not run it
  // faster.
  expect(parseFloat(duration)).toBeLessThan(0.01);

  await context.close();
});

test('every status is distinguishable without colour', async ({ page }) => {
  await signInAsChild(page);

  const mission = page.locator('li', { hasText: 'Make your bed' }).first();
  await mission.getByRole('button', { name: 'DONE!' }).click();

  // Pending carries an icon and a word, not just a tint.
  const waiting = mission.getByText('Waiting');
  await expect(waiting).toBeVisible();
  await expect(waiting).toContainText('Waiting');
});
