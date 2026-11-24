import { execSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { sql } from './db';
import { expectAccessible, loginAdmin } from './helpers';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';

async function latestMail(to: string): Promise<{ Text: string } | null> {
  const search = (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)).json()) as { messages: { ID: string }[] };
  const id = search.messages[0]?.ID;
  return id ? ((await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as { Text: string }) : null;
}

test('a brand-new invitee sets a password from the emailed link, accepts, and lands in the department', async ({ page, browser }) => {
  const email = `newhire-${Date.now()}@example.test`;
  const [t] = await sql`select id from tenants where slug = 'demo-fire-rescue'`;
  const [m] = await sql`insert into members (tenant_id, first_name, last_name, employment_type, email)
                        values (${t!.id}, 'Nora', 'Newhire', 'career_full_time', ${email}) returning id`;
  await loginAdmin(page);
  await page.goto(`/admin/members/${m!.id}`);
  await page.getByRole('button', { name: 'Send sign-in invitation' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Invitation queued' })).toBeVisible();
  execSync('pnpm -F @soma/worker run-once', { cwd: '../..', stdio: 'pipe' });

  await expect.poll(async () => (await latestMail(email))?.Text ?? '').toMatch(/verify/);
  const link = /https?:\/\/\S*verify\S*/.exec((await latestMail(email))!.Text)![0].replace(/[)>.,]+$/, '');

  const invitee = await (await browser.newContext()).newPage();
  await invitee.goto(link);
  await expect(invitee).toHaveURL(/\/auth\/welcome/);
  await expect(invitee.getByRole('heading', { level: 1 })).toHaveText('Choose a password');
  await expectAccessible(invitee);

  const form = invitee.getByRole('form', { name: 'Choose a password' });
  await form.getByLabel('Password', { exact: true }).fill('short-1');
  await form.getByLabel('Confirm password').fill('short-1');
  await form.getByRole('button', { name: 'Save password' }).click();
  await expect(form).toContainText('Use at least 12 characters');
  await form.getByLabel('Password', { exact: true }).fill('Correct-Horse-9');
  await form.getByLabel('Confirm password').fill('Different-Horse-9');
  await form.getByRole('button', { name: 'Save password' }).click();
  await expect(form).toContainText('The passwords do not match');
  await form.getByLabel('Confirm password').fill('Correct-Horse-9');
  await form.getByRole('button', { name: 'Save password' }).click();

  await expect(invitee).toHaveURL(/\/invites/);
  await invitee.getByRole('button', { name: 'Accept invitation to Demo Fire Rescue' }).click();
  await expect(invitee).toHaveURL('/');
  await expect(invitee.getByTestId('tenant-name')).toHaveText('Demo Fire Rescue');

  // The chosen password works for a normal sign-in later.
  const again = await (await browser.newContext()).newPage();
  await again.goto('/login');
  await again.getByLabel('Email').fill(email);
  await again.getByLabel('Password').fill('Correct-Horse-9');
  await again.getByRole('button', { name: 'Sign in' }).click();
  await expect(again).toHaveURL('/');
});

test('an expired or already-used link explains itself instead of failing silently', async ({ page }) => {
  await page.goto('/auth/welcome');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('This link is no longer valid');
  await expect(page.getByText('Ask your administrator to send a new invitation.')).toBeVisible();
  await expectAccessible(page);
});
