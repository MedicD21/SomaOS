import { expect, test } from '@playwright/test';
import { generateSync } from 'otplib';
import { sql } from './db';
import { expectAccessible, login } from './helpers';

test('wrong password shows a generic error', async ({ page }) => {
  await login(page, 'admin@soma.local', 'nope-nope');
  await expect(page.getByRole('alert').filter({ hasText: 'Invalid email or password' })).toBeVisible();
  await expectAccessible(page);
});

test('admin must enroll MFA, then reaches the dashboard', async ({ page }) => {
  await sql`delete from auth.mfa_factors where user_id = (select id from auth.users where email = 'admin@soma.local')`;
  await login(page, 'admin@soma.local');
  await expect(page).toHaveURL(/\/mfa/);
  await expectAccessible(page);
  const secret = (await page.getByTestId('totp-secret').textContent())!.trim();
  await page.getByLabel('6-digit code').fill(generateSync({ secret }));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByTestId('tenant-name')).toHaveText('Demo Fire Rescue');
  await expectAccessible(page);
});

test('non-admin member is not asked for MFA and can switch departments', async ({ page }) => {
  await login(page, 'member@soma.local');
  await expect(page).toHaveURL('/');
  await expect(page.getByTestId('tenant-name')).toHaveText('Demo Fire Rescue');
  await page.getByLabel('Department').selectOption({ label: 'Second County EMS' });
  await page.getByRole('button', { name: 'Switch' }).click();
  await expect(page.getByTestId('tenant-name')).toHaveText('Second County EMS');
});

test('signed-out users are sent to login', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
});
