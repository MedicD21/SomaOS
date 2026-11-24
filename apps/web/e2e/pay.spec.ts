import { expect, test } from '@playwright/test';
import { sql } from './db';
import { expectAccessible, login, loginAdmin } from './helpers';

const RULES = {
  payPeriod: { kind: 'fixed_days', days: 28, anchor: '2026-01-01' },
  workPeriod: { days: 28, anchor: '2026-01-01', threshold: 96, multiplier: 1.5, code: 'ot' },
  overtimeCombination: 'highest',
  assignments: {
    regular: { code: 'reg', multiplier: 1 },
    overtime: { code: 'ot', multiplier: 1.5 },
    trade: { code: 'reg', multiplier: 1 },
    holdover: { code: 'hold', multiplier: 1.5 },
    callback: { code: 'call', multiplier: 1.5, minimumHours: 2 },
    acting: { code: 'act', multiplier: 1 },
    training: { code: 'reg', multiplier: 1 },
    detail: { code: 'reg', multiplier: 1 },
  },
  compTime: { mode: 'never', multiplier: 1.5, bankKey: 'comp_time' },
};

function usd(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

test('admin sets up pay, previews a pay period, exports it, and members cannot see any of it', async ({ page }) => {
  await loginAdmin(page);

  // 1. A roster for January 2026 (the work period the rules below use).
  await page.goto('/roster');
  const gen = page.getByRole('form', { name: 'Generate schedule' });
  await gen.getByLabel('From').fill('2026-01-01');
  await gen.getByLabel('To').fill('2026-01-29');
  await gen.getByRole('button', { name: 'Generate' }).click();
  await expect(gen.getByRole('status')).toContainText(/Generated \d+ shifts/);

  // 2. Pay admin: codes, rates, rules.
  await page.goto('/admin/pay');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pay');
  await expectAccessible(page);

  const codeForm = page.getByRole('form', { name: 'Add pay code' });
  await codeForm.getByLabel('Label').fill('Hazard pay');
  await codeForm.getByLabel('Kind').selectOption({ label: 'Premium' });
  await codeForm.getByLabel('Multiplier').fill('1.25');
  await codeForm.getByLabel('Export code').fill('HAZ');
  await codeForm.getByRole('button', { name: 'Add pay code' }).click();
  await expect(codeForm.getByRole('status')).toHaveText('Added Hazard pay');
  await expect(page.getByRole('list', { name: 'Pay codes' })).toContainText('Hazard pay');

  const rate = page.getByRole('form', { name: 'Set hourly rate' });
  await rate.getByLabel('Member').selectOption({ label: 'Medic, Riley' });
  await rate.getByLabel('Hourly rate').fill('40');
  await rate.getByLabel('Effective from').fill('2026-02-01');
  await rate.getByRole('button', { name: 'Save rate' }).click();
  await expect(rate.getByRole('status')).toHaveText('Saved $40.00/h from 2026-02-01');
  await rate.getByLabel('Effective from').fill('2026-01-01');
  await rate.getByRole('button', { name: 'Save rate' }).click();
  await expect(rate.getByRole('alert')).toContainText('after');

  await expect(page.getByTestId('rules-status-default')).toContainText('Draft v1');
  const editor = page.getByRole('form', { name: 'Edit pay rules for All members' });
  await editor.getByLabel('Rules (JSON)').fill('{ "workPeriod": ');
  await editor.getByRole('button', { name: 'Save draft' }).click();
  await expect(editor.getByRole('alert')).toContainText('not valid JSON');
  await editor.getByLabel('Rules (JSON)').fill(JSON.stringify(RULES, null, 2));
  await editor.getByRole('button', { name: 'Save draft' }).click();
  await expect(editor.getByRole('status')).toContainText('Saved draft v1');
  const approve = page.getByRole('form', { name: 'Approve pay rules for All members v1' });
  await approve.getByLabel('Takes effect on').fill('2026-01-01');
  await approve.getByRole('button', { name: 'Approve rules' }).click();
  await expect(page.getByTestId('rules-status-default')).toContainText('Approved v1 from 2026-01-01');

  // 3. The preview matches the numbers worked out from the roster itself.
  const [n] = await sql<{ n: number }[]>`
    select count(*)::int as n from shift_assignments a join members m on m.id = a.member_id join auth.users u on u.id = m.user_id
    where u.email = 'member@soma.local' and a.status = 'scheduled' and a.type <> 'kelly'
      and m.tenant_id = (select id from tenants where slug = 'demo-fire-rescue')
      and lower(a.during) >= '2026-01-01'::timestamptz - interval '1 day' and lower(a.during) < '2026-01-30'::timestamptz`;
  const hours = 24 * n!.n;
  const ot = Math.max(0, hours - 96);
  const total = (hours - ot) * 31.25 + ot * 31.25 * 1.5;
  expect(ot).toBeGreaterThan(0);

  await page.goto('/pay?start=2026-01-01');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pay period');
  const list = page.getByRole('list', { name: 'Pay by member' });
  const riley = list.getByRole('listitem').filter({ hasText: 'Medic, Riley' });
  await expect(riley).toContainText(`${hours} h`);
  await expect(riley).toContainText(usd(total));
  await riley.getByText('Show lines').click();
  await expect(riley).toContainText(`${ot} h`);
  await expect(riley).toContainText('above the 96 h threshold');
  await expectAccessible(page);

  // 4. CSV export carries the same lines with export codes.
  const csv = await page.request.get('/pay/export?start=2026-01-01');
  expect(csv.status()).toBe(200);
  expect(csv.headers()['content-type']).toContain('text/csv');
  const body = await csv.text();
  expect(body.split('\r\n')[0]).toBe('Member,Employee number,Pay code,Export code,Hours,Rate,Amount,Notes');
  expect(body).toContain(`"Medic, Riley",,ot,OT,${ot},31.25,${(ot * 31.25 * 1.5).toFixed(2)},`);

  // 5. A group without approved rules is reported, not guessed.
  await page.goto('/admin/pay');
  const group = page.getByRole('form', { name: 'Add employee group' });
  await group.getByLabel('Label').fill('Part time');
  await group.getByRole('button', { name: 'Add group' }).click();
  await expect(group.getByRole('status')).toHaveText('Added Part time');
  const assign = page.getByRole('form', { name: 'Assign employee group' });
  await assign.getByLabel('Member').selectOption({ label: 'Medic, Riley' });
  await assign.getByLabel('Group').selectOption({ label: 'Part time' });
  await assign.getByRole('button', { name: 'Assign group' }).click();
  await expect(assign.getByRole('status')).toContainText('Assigned');
  await page.goto('/pay?start=2026-01-01');
  await expect(list.getByRole('listitem').filter({ hasText: 'Medic, Riley' })).toContainText('No approved pay rules for group "part_time"');
  await page.goto('/admin/pay');
  await assign.getByLabel('Member').selectOption({ label: 'Medic, Riley' });
  await assign.getByLabel('Group').selectOption({ label: '— Default group —' });
  await assign.getByRole('button', { name: 'Assign group' }).click();
  await expect(assign.getByRole('status')).toContainText('Assigned');

  // 6. Phone layout.
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/pay?start=2026-01-01', '/admin/pay']) {
    await page.goto(path);
    await page.addStyleTag({ content: 'body, body * { letter-spacing: 0.06em !important; }' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), path).toBeLessThanOrEqual(0);
  }
});

test('members cannot see pay periods, rates or the export', async ({ page }) => {
  await sql`update profiles set active_tenant_id = (select id from tenants where slug = 'demo-fire-rescue')
            where user_id = (select id from auth.users where email = 'member@soma.local')`;
  await login(page, 'member@soma.local');
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Pay' })).toHaveCount(0);
  for (const path of ['/pay', '/admin/pay']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: 'Not allowed' })).toBeVisible();
  }
  expect((await page.request.get('/pay/export?start=2026-01-01')).status()).toBe(403);
});
