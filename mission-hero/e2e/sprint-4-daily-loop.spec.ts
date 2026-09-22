import { expect, test } from '@playwright/test';
import { reseed, signInAsChild, signInAsParent } from './helpers';

/**
 * Sprint 4 — the daily loop in one piece: check in, spend points, and a parent
 * setting the family up from an empty start.
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

test('a child checks in once a day and cannot farm it', async ({ page }) => {
  await signInAsChild(page);

  // The prompt appears on the home page while today's check-in is outstanding.
  const prompt = page.getByRole('link', { name: /Daily check-in/ });
  await expect(prompt).toBeVisible();
  await prompt.click();

  await expect(page.getByRole('heading', { name: 'Daily Check-In' })).toBeVisible();
  await page.getByRole('button', { name: 'Good' }).click();
  await page.getByLabel('What are you going to crush today?').fill('Finish my reading.');
  await page.getByLabel('What are you thankful for?').fill('Sarah helped me.');
  await page.getByRole('button', { name: /CHECK IN/ }).click();

  await expect(page.getByText("You've checked in today!")).toBeVisible();
  await expect(page.getByText('+5 XP')).toBeVisible();

  // Reopening shows the recap, not a second chance at the XP.
  await page.reload();
  await expect(page.getByText("You've checked in today!")).toBeVisible();
  await expect(page.getByRole('button', { name: /CHECK IN/ })).toHaveCount(0);

  // And the home prompt is gone for the rest of the day.
  await page.goto('/kids/home');
  await expect(page.getByRole('link', { name: /Daily check-in/ })).toHaveCount(0);
});

test('a child spends points and a parent returns them by declining', async ({ browser }) => {
  const childContext = await browser.newContext();
  const parentContext = await browser.newContext();
  const child = await childContext.newPage();
  const parent = await parentContext.newPage();

  await signInAsChild(child);
  await child.goto('/kids/rewards');

  // Josh starts with 120 points; ice cream costs 60.
  await expect(child.getByText('120 points to spend')).toBeVisible();
  const iceCream = child.locator('li', { hasText: 'Ice cream' }).first();
  await iceCream.getByRole('button', { name: 'Redeem' }).click();
  await iceCream.getByRole('button', { name: 'Yes please' }).click();

  await expect(child.getByText('Sent! A grown-up will sort this out.')).toBeVisible();
  await child.reload();
  await expect(child.getByText('60 points to spend')).toBeVisible();

  await signInAsParent(parent);
  await parent.goto('/parent/rewards');

  const request = parent.locator('li', { hasText: 'Josh wants Ice cream' }).first();
  await expect(request).toBeVisible();
  await request.getByRole('button', { name: 'Not this time' }).click();
  // Wait for the decision to land before looking at the other context.
  await expect(parent.locator('li', { hasText: 'Josh wants Ice cream' })).toHaveCount(0);

  // Declining returns every point (BR-43).
  await child.reload();
  await expect(child.getByText('120 points to spend')).toBeVisible();

  await childContext.close();
  await parentContext.close();
});

test('a parent sets up a new hero and a mission from scratch', async ({ page }) => {
  await signInAsParent(page);

  await page.goto('/parent/children');
  await page.getByLabel('What should we call them?').fill('Ben');
  await page.getByLabel('Age').selectOption('AGE_6_8');
  await page.getByRole('button', { name: 'Add hero' }).click();
  // The durable outcome, not the flash message: Ben is in the list.
  await expect(page.locator('li', { hasText: 'Ben' })).toBeVisible();

  await page.goto('/parent/tasks');
  await page.getByLabel('Mission name').fill('Water the plants');
  // Click the label: the checkbox itself is visually hidden inside it.
  await page.locator('label', { hasText: 'Ben' }).first().click();
  await expect(page.getByRole('checkbox', { name: 'Ben' })).toBeChecked();
  await page.getByLabel('XP', { exact: true }).fill('15');
  await page.getByLabel('Reward points').fill('5');
  await page.getByRole('button', { name: 'Create mission' }).click();

  await expect(page.locator('li', { hasText: 'Water the plants' })).toBeVisible();

  // And the new hero sees it, with the value the parent set.
  await signInAsChild(page, 'Ben');
  const mission = page.locator('li', { hasText: 'Water the plants' }).first();
  await expect(mission).toBeVisible();
  await expect(mission).toContainText('+15 XP');
  await expect(mission).toContainText('+5 points');
});

test('notifications reach both inboxes and clear independently', async ({ browser }) => {
  const childContext = await browser.newContext();
  const parentContext = await browser.newContext();
  const child = await childContext.newPage();
  const parent = await parentContext.newPage();

  await signInAsChild(child);
  await child
    .locator('li', { hasText: 'Make your bed' })
    .first()
    .getByRole('button', { name: 'DONE!' })
    .click();
  await expect(child.getByText('Waiting').first()).toBeVisible();

  await signInAsParent(parent);
  await parent.goto('/parent/notifications');
  await expect(parent.getByText('Josh completed Make your bed')).toBeVisible();

  await parent.getByRole('button', { name: 'Mark all read' }).click();
  await expect(parent.getByText('All caught up')).toBeVisible();

  // The child's own inbox is untouched by the parent clearing theirs.
  await parent.goto('/parent/approvals');
  await parent
    .locator('li', { hasText: 'Make your bed' })
    .first()
    .getByRole('button', { name: 'Approve', exact: true })
    .click();
  await parent.getByRole('button', { name: 'Approve & award' }).click();
  await expect(parent.locator('li', { hasText: 'Make your bed' })).toHaveCount(0);

  await child.goto('/kids/news');
  await expect(child.getByText('Make your bed approved!')).toBeVisible();
  // Not an exact count: earlier tests in this file also send Josh news.
  await expect(child.getByText(/\d+ new/).first()).toBeVisible();

  await childContext.close();
  await parentContext.close();
});
