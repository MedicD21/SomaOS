import { expect, test } from '@playwright/test';
import { expectAccessible, login, loginAdmin } from './helpers';

test('terminology overrides change labels across the app', async ({ page }) => {
  await loginAdmin(page);
  await page.goto('/admin/settings');
  await expectAccessible(page);
  await page.getByLabel('Shift', { exact: true }).fill('Platoon');
  await page.getByLabel('Shifts (plural)').fill('Platoons');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status')).toHaveText('Settings saved');
  await page.goto('/admin/shifts');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Platoons');
  await expectAccessible(page);
});

test('build and reorganize the org tree', async ({ page }) => {
  await loginAdmin(page);
  await page.goto('/admin/org');

  async function addUnit(name: string, type: string, parent?: string) {
    const form = page.getByRole('form', { name: 'Add org unit' });
    await form.getByLabel('Name').fill(name);
    await form.getByLabel('Type').selectOption({ label: type });
    await form.getByLabel('Parent').selectOption({ label: parent ?? '— None (top level) —' });
    await form.getByRole('button', { name: 'Add unit' }).click();
    await expect(page.locator(`[data-name="${name}"]`)).toBeVisible();
  }

  await addUnit('Battalion 1', 'Battalion');
  await addUnit('Battalion 2', 'Battalion');
  await addUnit('Station 1', 'Station', 'Battalion 1');
  await addUnit('Engine 1', 'Unit', 'Station 1');
  await expect(page.locator('[data-name="Battalion 1"] [data-name="Engine 1"]')).toBeVisible();

  await page.getByText('Edit Station 1').click();
  const edit = page.getByRole('form', { name: 'Edit Station 1' });
  const options = await edit.getByLabel('Parent').locator('option').allTextContents();
  expect(options).not.toContain('Station 1');
  expect(options).not.toContain('Engine 1');
  await edit.getByLabel('Parent').selectOption({ label: 'Battalion 2' });
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('[data-name="Battalion 2"] [data-name="Engine 1"]')).toBeVisible();
  await expectAccessible(page);
});

test('add a rank', async ({ page }) => {
  await loginAdmin(page);
  await page.goto('/admin/ranks');
  const form = page.getByRole('form', { name: 'Add rank' });
  await form.getByLabel('Key').fill('chaplain');
  await form.getByLabel('Label').fill('Chaplain');
  await form.getByLabel('Order').fill('10');
  await form.getByRole('button', { name: 'Add rank' }).click();
  await expect(page.getByRole('cell', { name: 'Chaplain', exact: true })).toBeVisible();
  await expectAccessible(page);
});

test('members without admin permissions cannot open admin pages', async ({ page }) => {
  await login(page, 'member@soma.local');
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('link', { name: 'Admin' })).toHaveCount(0);
  await page.goto('/admin/settings');
  await expect(page.getByRole('heading', { name: 'Not allowed' })).toBeVisible();
});
