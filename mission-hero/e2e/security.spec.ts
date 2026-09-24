import { expect, test } from '@playwright/test';
import { reseed, signInAsChild, waitForInteractive } from './helpers';

/**
 * The threat model, exercised through the browser (docs/03).
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
  await waitForInteractive(page);
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
  await waitForInteractive(page);
  await page.getByLabel('Family code').fill('ZZZZZZZZ');
  await page.getByRole('button', { name: "Let's go!" }).click();

  // Next.js renders its own empty route announcer with role=alert, so match the
  // message itself rather than the role.
  await expect(page.getByText(/doesn't match any family/)).toBeVisible();
});

test('typing the family name instead of the code says so', async ({ page }) => {
  // What people actually do: "family code" reads like it could be a name, and
  // "we couldn't find that" leaves them retyping the same wrong thing.
  await page.goto('/kids');
  await waitForInteractive(page);
  await page.getByLabel('Family code').fill('The Adventure Family');
  await page.getByRole('button', { name: "Let's go!" }).click();

  await expect(page.getByText(/not your family's name/)).toBeVisible();
});

test('security headers are set on the child surface', async ({ page }) => {
  const response = await page.goto('/kids');
  const headers = response?.headers() ?? {};

  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['content-security-policy']).toContain("object-src 'none'");
});

test("the strict CSP does not block the app's own JavaScript", async ({ page }) => {
  // Regression: Next takes the nonce from the *request* CSP header. Set it only
  // on the response and 'strict-dynamic' makes the browser ignore 'self', so
  // every script is blocked — the site still renders and server actions still
  // work, which is exactly why this is easy to ship without noticing.
  const refusals: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) {
      refusals.push(message.text().slice(0, 160));
    }
  });

  const response = await page.goto('/kids');
  await expect(page.getByLabel('Family code')).toBeVisible();

  expect(response?.headers()['content-security-policy']).toMatch(/nonce-[a-f0-9]{32}/);
  expect(refusals).toEqual([]);
  // Next only emits a nonce attribute when it read one from the request.
  expect(await page.locator('script[nonce]').count()).toBeGreaterThan(0);
});
