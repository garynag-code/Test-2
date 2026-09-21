import { expect, test } from '@playwright/test';
import { reseed, signInAsChild, signInAsParent } from './helpers';

/**
 * Vertical Slice 2, end to end (§48): Josh says he was kind, writes what
 * happened, and a parent confirmation turns it into exactly one star.
 */

test.beforeEach(() => {
  reseed();
});

test('a character moment needs a parent before it becomes a star', async ({ browser }) => {
  const childContext = await browser.newContext();
  const parentContext = await browser.newContext();
  const child = await childContext.newPage();
  const parent = await parentContext.newPage();

  await signInAsChild(child);
  await child.goto('/kids/character');

  await expect(child.getByText('What kind of person were you today?')).toBeVisible();
  await child.getByRole('button', { name: /I was kind today/ }).click();

  await expect(child.getByText('Awesome. Tell us what happened.')).toBeVisible();
  await child.getByLabel('Awesome. Tell us what happened.').fill('I helped Sarah clean her room.');
  await child.getByRole('button', { name: 'SEND IT!' }).click();

  await expect(child.getByText('Sent! A grown-up will take a look.')).toBeVisible();

  // Still nothing awarded (BR-28).
  await child.goto('/kids/me');
  await expect(child.getByText('0 stars')).toBeVisible();

  await signInAsParent(parent);
  await parent.goto('/parent/approvals?tab=character');

  const row = parent.locator('li', { hasText: 'showed kindness' }).first();
  await expect(row).toContainText('I helped Sarah clean her room.');
  await row.getByRole('button', { name: /Confirm/ }).click();

  await expect(parent.locator('li', { hasText: 'showed kindness' })).toHaveCount(0);

  // Exactly one star, and the copy is growth-shaped.
  await child.goto('/kids/me');
  await expect(child.getByText('1 stars')).toBeVisible();
  await expect(child.getByText('4 more kindness moments to your next badge.')).toBeVisible();

  await childContext.close();
  await parentContext.close();
});

test('a low trait total is framed as growth, never as a mark', async ({ page }) => {
  await signInAsChild(page);
  await page.goto('/kids/me');

  await expect(page.getByText("Let's grow this one.").first()).toBeVisible();

  const body = (await page.locator('body').innerText()).toLowerCase();
  for (const banned of ['failed', 'you lost', 'bad at', 'poor', 'weak']) {
    expect(body).not.toContain(banned);
  }
});
