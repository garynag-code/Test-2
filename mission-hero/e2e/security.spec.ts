import { expect, test } from '@playwright/test';
import { reseed, signInAsChild } from './helpers';

/**
 * The threat model, exercised through the browser (docs/03).
 */

test.beforeEach(() => {
  reseed();
});

test('an anonymous visitor cannot reach either surface', async ({ page }) => {
  await page.goto('/parent');
  await expect(page).toHaveURL(/\/parent\/login/);

  await page.goto('/kids/home');
  await expect(page).toHaveURL(/\/kids$/);
});

test('a child session cannot reach parent administration', async ({ page }) => {
  await signInAsChild(page);

  // The most obvious attempt a curious child would make: type the URL.
  await page.goto('/parent');
  await expect(page).toHaveURL(/\/parent\/login/);
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

  await page.goto('/parent/approvals');
  await expect(page).toHaveURL(/\/parent\/login/);
});

test('the profile picker reveals nothing but nicknames', async ({ page }) => {
  await page.goto('/kids');
  await page.getByLabel('Family code').fill('ADVENTUR');
  await page.getByRole('button', { name: "Let's go!" }).click();

  await expect(page.getByRole('button', { name: 'Josh' })).toBeVisible();

  const html = await page.content();
  // No hashes, no emails, no dates of birth in the markup.
  expect(html).not.toContain('$2a$');
  expect(html).not.toContain('@adventure.family');
});

test('an unknown family code is refused', async ({ page }) => {
  await page.goto('/kids');
  await page.getByLabel('Family code').fill('ZZZZZZZZ');
  await page.getByRole('button', { name: "Let's go!" }).click();

  // Next.js renders its own empty route announcer with role=alert, so match the
  // message itself rather than the role.
  await expect(page.getByText("We couldn't find that family code.")).toBeVisible();
});

test('security headers are set on the child surface', async ({ page }) => {
  const response = await page.goto('/kids');
  const headers = response?.headers() ?? {};

  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['content-security-policy']).toContain("object-src 'none'");
});
