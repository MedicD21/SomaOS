import { execSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { sql } from './db';
import { expectAccessible, login, loginAdmin } from './helpers';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';
const runWorker = () => execSync('pnpm -F @soma/worker run-once', { cwd: '../..', stdio: 'pipe' });

async function mailTo(address: string): Promise<{ Subject: string }[]> {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`);
  const body = (await res.json()) as { messages: { Subject: string }[] };
  return body.messages;
}

test('in-app notifications show in the bell and can be marked read', async ({ page }) => {
  // Another spec may have switched this user to a different department.
  await sql`update profiles set active_tenant_id = (select id from tenants where slug = 'demo-fire-rescue')
            where user_id = (select id from auth.users where email = 'member@soma.local')`;
  await sql`select app.notify(m.id, 'test', 'Overtime posted for Station 1', 'B shift needs a medic', '/')
            from members m join auth.users u on u.id = m.user_id where u.email = 'member@soma.local'
            and m.tenant_id = (select id from tenants where slug = 'demo-fire-rescue')`;
  await login(page, 'member@soma.local');
  await expect(page.getByRole('link', { name: /Notifications \(1 unread\)/ })).toBeVisible();
  await page.getByRole('link', { name: /Notifications/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Notifications');
  await expect(page.getByText('Overtime posted for Station 1')).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Mark read: Overtime posted for Station 1' }).click();
  await expect(page.getByRole('link', { name: 'Notifications (0 unread)' })).toBeVisible();

  runWorker();
  await expect.poll(async () => (await mailTo('member@soma.local')).map((m) => m.Subject)).toContain('Overtime posted for Station 1');
});

test('admin invites a member by email', async ({ page }) => {
  const email = `invitee-${Date.now()}@example.test`;
  const [t] = await sql`select id from tenants where slug = 'demo-fire-rescue'`;
  const [m] = await sql`insert into members (tenant_id, first_name, last_name, employment_type, email)
                        values (${t!.id}, 'Casey', 'Newhire', 'career_full_time', ${email}) returning id`;
  await loginAdmin(page);
  await page.goto(`/admin/members/${m!.id}`);
  await page.getByRole('button', { name: 'Send sign-in invitation' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Invitation queued' })).toBeVisible();
  runWorker();
  await expect.poll(async () => (await mailTo(email)).length).toBeGreaterThan(0);
  const [ms] = await sql`select ms.status from memberships ms join auth.users u on u.id = ms.user_id where u.email = ${email}`;
  expect(ms!.status).toBe('invited');
});
