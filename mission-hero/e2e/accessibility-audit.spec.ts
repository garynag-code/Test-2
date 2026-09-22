import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { reseed, signInAsChild, signInAsParent } from './helpers';

/**
 * Accessibility audits (docs/08 §6): axe over every route the product has.
 *
 * Kept apart from the interaction checks because auditing a whole surface is a
 * dozen page loads plus an axe pass on each, which is a different shape of
 * test and a different time budget.
 */

test.describe.configure({ timeout: 180_000 });

test.beforeAll(() => {
  reseed();
});

async function auditPage(page: Page, url: string) {
  await page.goto(url);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const serious = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );

  expect(
    serious.map((violation) => `${violation.id} on ${violation.nodes.length} node(s)`),
    `Accessibility violations on ${url}`,
  ).toEqual([]);
}

test('the public pages are accessible', async ({ page }) => {
  for (const url of ['/', '/parent/login', '/parent/register', '/kids']) {
    await auditPage(page, url);
  }
});

test('the child surface is accessible', async ({ page }) => {
  await signInAsChild(page);
  for (const url of [
    '/kids/home',
    '/kids/character',
    '/kids/memory',
    '/kids/quests',
    '/kids/wheel',
    '/kids/rewards',
    '/kids/map',
    '/kids/me',
    '/kids/news',
    '/kids/check-in',
  ]) {
    await auditPage(page, url);
  }
});

test('the parent surface is accessible', async ({ page }) => {
  await signInAsParent(page);
  for (const url of [
    '/parent',
    '/parent/approvals',
    '/parent/tasks',
    '/parent/rewards',
    '/parent/learning',
    '/parent/children',
    '/parent/progress',
    '/parent/settings',
    '/parent/audit',
    '/parent/notifications',
  ]) {
    await auditPage(page, url);
  }
});
