import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

export async function expectAccessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious, JSON.stringify(serious.map((v) => [v.id, v.nodes.map((n) => n.target)]), null, 2)).toEqual([]);
}

export async function login(page: Page, email: string, password = 'somadev123!'): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** Signs in the seeded admin, re-enrolling TOTP from scratch so tests are order-independent. */
export async function loginAdmin(page: Page): Promise<void> {
  const { sql } = await import('./db');
  await sql`delete from auth.mfa_factors where user_id = (select id from auth.users where email = 'admin@soma.local')`;
  await login(page, 'admin@soma.local');
  await expect(page).toHaveURL(/\/mfa/);
  const secret = (await page.getByTestId('totp-secret').textContent())!.trim();
  const { generateSync } = await import('otplib');
  await page.getByLabel('6-digit code').fill(generateSync({ secret }));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL('/');
}
