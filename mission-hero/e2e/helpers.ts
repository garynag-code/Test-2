import { execSync } from 'node:child_process';
import type { Page } from '@playwright/test';

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

export async function signInAsParent(page: Page): Promise<void> {
  await page.goto('/parent/login');
  await page.getByLabel('Email').fill(SEED.parentEmail);
  await page.getByLabel('Password').fill(SEED.parentPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/parent');
}

export async function signInAsChild(page: Page, nickname = SEED.childNickname): Promise<void> {
  await page.goto('/kids');

  const codeField = page.getByLabel('Family code');
  if (await codeField.isVisible().catch(() => false)) {
    await codeField.fill(SEED.familyCode);
    await page.getByRole('button', { name: "Let's go!" }).click();
  }

  await page.getByRole('button', { name: nickname }).click();
  await page.waitForURL('**/kids/home');
}
