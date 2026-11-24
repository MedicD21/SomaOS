import { expect, test } from '@playwright/test';
import { sql } from './db';
import { expectAccessible, loginAdmin } from './helpers';

test('upload, list and download a member attachment; reject disallowed types', async ({ page }) => {
  const [m] = await sql`select m.id from members m join auth.users u on u.id = m.user_id where u.email = 'member@soma.local'
                        and m.tenant_id = (select id from tenants where slug = 'demo-fire-rescue')`;
  await loginAdmin(page);
  await page.goto(`/admin/members/${m!.id}`);
  const upload = page.getByRole('form', { name: 'Upload file' });
  const pdf = Buffer.from('%PDF-1.4\n% SomaOS test\n');
  await upload.getByLabel('File').setInputFiles({ name: 'fit-test 2026.pdf', mimeType: 'application/pdf', buffer: pdf });
  await upload.getByRole('button', { name: 'Upload' }).click();
  await expect(upload.getByRole('status')).toHaveText('Uploaded fit-test 2026.pdf');
  const link = page.getByRole('link', { name: 'fit-test 2026.pdf' });
  await expect(link).toBeVisible();
  await expectAccessible(page);

  const res = await page.request.get((await link.getAttribute('href'))!);
  expect(res.status()).toBe(200);
  expect(Buffer.from(await res.body()).toString()).toContain('SomaOS test');

  await upload.getByLabel('File').setInputFiles({ name: 'tool.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ') });
  await upload.getByRole('button', { name: 'Upload' }).click();
  await expect(upload.getByRole('alert')).toHaveText('File type not allowed');
});
