import { expect, test } from '@playwright/test';
import { reseed, signInAsChild } from './helpers';

/**
 * Vertical Slice 3, end to end (§49): the wheel is locked below the threshold,
 * the spin outcome is decided by the server, and the animation replays that
 * stored result rather than deciding anything.
 */

test.beforeEach(() => {
  reseed();
});

test('the wheel is locked until the points threshold is reached', async ({ page }) => {
  // Sarah starts with 45 points; the seeded wheel needs 100.
  await signInAsChild(page, 'Sarah');
  await page.goto('/kids/wheel');

  await expect(page.getByText('Keep earning points to unlock a spin.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'SPIN!' })).toBeDisabled();
  await expect(page.getByText('55 more points to unlock a spin.')).toBeVisible();
});

test('a spin lands on the server-chosen reward and persists it', async ({ page }) => {
  // Josh starts with 120 points, above the 100 threshold.
  await signInAsChild(page);
  await page.goto('/kids/wheel');

  await expect(page.getByText('YOU UNLOCKED A SPIN!')).toBeVisible();
  const spinButton = page.getByRole('button', { name: 'SPIN!' });
  await expect(spinButton).toBeEnabled();
  await spinButton.click();

  const result = page.getByRole('status');
  await expect(result).toBeVisible({ timeout: 15_000 });
  await expect(result).toContainText('You won');
  const wonText = await result.innerText();

  // 100 points were deducted in the same transaction as the spin.
  await expect(result).toContainText('100 points spent');

  // Reloading shows the committed state: the 100 points really left the ledger,
  // so the wheel is locked again and the result was not re-rolled.
  await page.reload();
  await expect(page.getByText('80 more points to unlock a spin.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'SPIN!' })).toBeDisabled();

  // The reward the child saw came from one of the wheel's real segments.
  const labels = await page.locator('ol li span:nth-child(2)').allInnerTexts();
  expect(labels.some((label) => wonText.includes(label.trim()))).toBe(true);
});
