import { expect, test, type Page } from '@playwright/test';
import { reseed, signInAsChild, signInAsParent } from './helpers';

/**
 * Vertical Slice 1, end to end, exactly as the brief describes it (§47):
 * Josh sees "Read for 20 minutes", taps DONE, a parent approves, and the
 * server-awarded XP and points appear on Josh's dashboard.
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

test('a child completes a mission and a parent approves it', async ({ browser }) => {
  const childContext = await browser.newContext();
  const parentContext = await browser.newContext();
  const child = await childContext.newPage();
  const parent = await parentContext.newPage();

  await signInAsChild(child);

  // Record the starting XP so the assertion is about the change, not a constant.
  const xpBefore = await readStat(child, 'XP');

  const mission = child.locator('li', { hasText: 'Read for 20 minutes' }).first();
  await expect(mission).toBeVisible();
  await mission.getByRole('button', { name: 'DONE!' }).click();

  // Reading is evidence-backed, so a note is asked for before it is claimed.
  await mission.getByLabel('Tell us what you did').fill('I read two chapters of my book.');
  await mission.getByRole('button', { name: 'SEND IT!' }).click();

  await expect(child.getByText('Waiting').first()).toBeVisible();

  // Nothing has been awarded yet (BR-10).
  expect(await readStat(child, 'XP')).toBe(xpBefore);

  await signInAsParent(parent);
  await parent.goto('/parent/approvals');

  const row = parent.locator('li', { hasText: 'Read for 20 minutes' }).first();
  await expect(row).toBeVisible();
  await expect(row).toContainText('I read two chapters');
  await row.getByRole('button', { name: 'Approve', exact: true }).click();
  await row.getByRole('button', { name: 'Proud of your effort.' }).click();
  await row.getByRole('button', { name: 'Approve & award' }).click();

  await expect(parent.locator('li', { hasText: 'Read for 20 minutes' })).toHaveCount(0);

  // The child's totals now reflect exactly what the server awarded.
  await child.reload();
  expect(await readStat(child, 'XP')).toBeGreaterThan(xpBefore);
  await expect(child.getByText('Done').first()).toBeVisible();

  await childContext.close();
  await parentContext.close();
});

test('a redo reopens the mission with invitation language', async ({ browser }) => {
  const childContext = await browser.newContext();
  const parentContext = await browser.newContext();
  const child = await childContext.newPage();
  const parent = await parentContext.newPage();

  await signInAsChild(child);
  const xpBefore = await readStat(child, 'XP');

  const mission = child.locator('li', { hasText: 'Make your bed' }).first();
  await mission.getByRole('button', { name: 'DONE!' }).click();
  await expect(child.getByText('Waiting').first()).toBeVisible();

  await signInAsParent(parent);
  await parent.goto('/parent/approvals');
  await parent
    .locator('li', { hasText: 'Make your bed' })
    .first()
    .getByRole('button', { name: 'Try again' })
    .click();

  await child.reload();
  // Nothing was awarded, and the mission is available again.
  expect(await readStat(child, 'XP')).toBe(xpBefore);
  await expect(
    child
      .locator('li', { hasText: 'Make your bed' })
      .first()
      .getByRole('button', { name: 'DONE!' }),
  ).toBeVisible();

  await childContext.close();
  await parentContext.close();
});

/** Reads one of the three stat chips from the child dashboard. */
async function readStat(page: Page, label: string): Promise<number> {
  const chip = page.locator('div', { hasText: new RegExp(`^${label}$`) }).first();
  const container = chip.locator('xpath=..');
  const text = await container.innerText();
  const match = text.replace(/[^\d]/g, '');
  return Number(match || 0);
}
