import { expect, test } from '@playwright/test';
import { reseed, signInAsChild, signInAsParent } from './helpers';

/**
 * Sprint 5 — learning and discovery: reciting from memory, bonus challenges,
 * and a parent creating both.
 */

test.beforeEach(() => {
  reseed();
});

test('a child recites from memory and a parent checks it', async ({ browser }) => {
  const childContext = await browser.newContext();
  const parentContext = await browser.newContext();
  const child = await childContext.newPage();
  const parent = await parentContext.newPage();

  await signInAsChild(child);
  await child.goto('/kids/memory');

  const card = child.locator('li', { hasText: 'Philippians 4:13' }).first();
  await expect(card).toBeVisible();
  // The text is readable until the child chooses to recite.
  await expect(card).toContainText('I can do all things through Christ');

  await card.getByRole('button', { name: 'READY TO RECITE' }).click();
  // Once reciting, the original is gone from the card.
  await expect(card).not.toContainText('I can do all things through Christ who strengthens me.');

  await card
    .getByLabel('Type it from memory')
    .fill('I can do all things through Christ who strengthens me.');
  await card.getByRole('button', { name: 'SEND IT!' }).click();
  await expect(card).toContainText('Waiting for a grown-up');

  await signInAsParent(parent);
  await parent.goto('/parent/approvals?tab=memory');

  const row = parent.locator('li', { hasText: 'Philippians 4:13' }).first();
  await expect(row).toContainText('They typed:');
  await expect(row).toContainText('The original:');
  await row.getByRole('button', { name: 'They got it' }).click();
  await expect(parent.locator('li', { hasText: 'Philippians 4:13' })).toHaveCount(0);

  await child.reload();
  await expect(
    child.locator('li', { hasText: 'Philippians 4:13' }).first().getByText('Mastered'),
  ).toBeVisible();

  await childContext.close();
  await parentContext.close();
});

test('a nearly-there recitation can be tried again', async ({ browser }) => {
  const childContext = await browser.newContext();
  const parentContext = await browser.newContext();
  const child = await childContext.newPage();
  const parent = await parentContext.newPage();

  await signInAsChild(child);
  await child.goto('/kids/memory');

  const card = child.locator('li', { hasText: 'Our family saying' }).first();
  await card.getByRole('button', { name: 'READY TO RECITE' }).click();
  await card.getByLabel('Type it from memory').fill('We finish what we, um, begin?');
  await card.getByRole('button', { name: 'SEND IT!' }).click();

  await signInAsParent(parent);
  await parent.goto('/parent/approvals?tab=memory');
  await parent
    .locator('li', { hasText: 'Our family saying' })
    .first()
    .getByRole('button', { name: 'Nearly there' })
    .click();
  await expect(parent.locator('li', { hasText: 'Our family saying' })).toHaveCount(0);

  // Nothing awarded, and the challenge is open again with encouraging copy.
  await child.reload();
  const retry = child.locator('li', { hasText: 'Our family saying' }).first();
  await expect(retry).toContainText('Have another practice');
  await expect(retry.getByRole('button', { name: 'READY TO RECITE' })).toBeVisible();

  await childContext.close();
  await parentContext.close();
});

test('a bonus challenge is open to take on without being found', async ({ browser }) => {
  const childContext = await browser.newContext();
  const parentContext = await browser.newContext();
  const child = await childContext.newPage();
  const parent = await parentContext.newPage();

  await signInAsChild(child);
  await child.goto('/kids/quests');

  const quest = child.locator('li', { hasText: 'Read 10 Extra Pages' }).first();
  await expect(quest).toBeVisible();
  await expect(quest).toContainText('Bonus challenge');
  await expect(quest).toContainText('+20 XP');

  await quest.getByRole('button', { name: 'I DID IT!' }).click();
  await quest.getByLabel('What did you do?').fill('I read three extra chapters.');
  await quest.getByRole('button', { name: 'SEND IT!' }).click();
  await expect(quest).toContainText('Waiting for a grown-up');

  await signInAsParent(parent);
  await parent.goto('/parent/approvals?tab=quests');

  const row = parent.locator('li', { hasText: 'Read 10 Extra Pages' }).first();
  await expect(row).toContainText('Bonus challenge');
  await expect(row).toContainText('I read three extra chapters.');
  await row.getByRole('button', { name: 'Approve' }).click();
  await expect(parent.locator('li', { hasText: 'Read 10 Extra Pages' })).toHaveCount(0);

  await child.reload();
  await expect(quest).toContainText('Complete');

  await childContext.close();
  await parentContext.close();
});

test('a parent creates a memory challenge and a bonus challenge', async ({ page }) => {
  await signInAsParent(page);
  await page.goto('/parent/learning');

  await page.getByLabel('Name it').first().fill('Our new saying');
  await page.getByLabel('Kind').selectOption('FAMILY_SAYING');
  await page.getByLabel('The words to learn').fill('We look after each other.');
  await page.getByRole('checkbox', { name: 'Josh' }).check({ force: true });
  await page.getByRole('button', { name: 'Add challenge' }).click();
  await expect(page.getByText('Challenge added.')).toBeVisible();

  // A bonus challenge hides no object, so the hidden-object picker is absent.
  await page.getByRole('radio', { name: /Bonus challenge/ }).check({ force: true });
  await expect(page.getByLabel('Hidden as')).toHaveCount(0);

  await page.getByLabel('Name it').last().fill('Help with the washing');
  await page.getByLabel('What should they do?').fill('Help hang the washing out.');
  await page.getByRole('button', { name: 'Add quest' }).click();
  await expect(page.getByText('Quest added.')).toBeVisible();

  // Josh sees both straight away.
  await signInAsChild(page);
  await page.goto('/kids/memory');
  await expect(page.getByText('Our new saying')).toBeVisible();

  await page.goto('/kids/quests');
  await expect(page.getByText('Help with the washing')).toBeVisible();
});
