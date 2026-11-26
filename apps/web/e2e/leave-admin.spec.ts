import { expect, test } from '@playwright/test';
import { sql } from './db';
import { expectAccessible, login, loginAdmin } from './helpers';

const POLICY = {
  period: { kind: 'monthly' },
  tiers: [
    { fromYears: 0, earn: { method: 'per_period', hours: 10 } },
    { fromYears: 5, earn: { method: 'per_period', hours: 14 } },
  ],
  cap: 200,
  waitingPeriodDays: 0,
  prorateFirstPeriod: true,
  fractionByEmploymentType: {},
  negativeAllowed: false,
  carryover: { max: 40, resetOn: '01-01' },
};

test('admin manages leave banks, types, policy versions and balances', async ({ page }) => {
  await loginAdmin(page);
  await page.goto('/admin/leave');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Leave');
  await expectAccessible(page);

  // Banks and types
  const bank = page.getByRole('form', { name: 'Add leave bank' });
  await bank.getByLabel('Label').fill('Personal days');
  await bank.getByRole('button', { name: 'Add bank' }).click();
  await expect(bank.getByRole('status')).toHaveText('Added Personal days');
  await expect(page.getByRole('list', { name: 'Leave banks' })).toContainText('Personal days');

  const type = page.getByRole('form', { name: 'Add leave type' });
  await type.getByLabel('Label').fill('Personal day');
  await type.getByLabel('Draws from').selectOption({ label: 'Personal days' });
  await type.getByLabel('Days of notice').fill('3');
  await type.getByRole('button', { name: 'Add leave type' }).click();
  await expect(type.getByRole('status')).toHaveText('Added Personal day');

  // Policy: starter template values are drafts, invalid JSON is explained, valid JSON saves
  const editor = page.getByRole('form', { name: 'Edit Vacation policy' });
  await expect(page.getByTestId('policy-status-vacation')).toContainText('Draft');
  await editor.getByRole('button', { name: 'Advanced JSON' }).click();
  await editor.getByLabel('Policy (JSON)').fill('{ "period": ');
  await editor.getByRole('button', { name: 'Save draft' }).click();
  await expect(editor.getByRole('alert')).toContainText('not valid JSON');
  await editor.getByLabel('Policy (JSON)').fill(JSON.stringify({ ...POLICY, tiers: [{ fromYears: 0, earn: { method: 'per_period', hours: -3 } }] }));
  await editor.getByRole('button', { name: 'Save draft' }).click();
  await expect(editor.getByRole('alert')).toContainText('tiers.0.earn.hours');
  await editor.getByLabel('Policy (JSON)').fill(JSON.stringify(POLICY, null, 2));
  await editor.getByRole('button', { name: 'Save draft' }).click();
  await expect(editor.getByRole('status')).toContainText('Saved draft v1');

  // Approving needs a simulation of exactly this draft first.
  const approve = page.getByRole('form', { name: 'Approve Vacation policy v1' });
  await expect(approve.getByRole('button', { name: 'Approve policy' })).toBeDisabled();

  // Simulate what a sample member would earn over 12 periods (runs the saved draft, saves nothing).
  const sim = page.getByRole('form', { name: 'Simulate Vacation policy' });
  await sim.getByLabel('Hire date').fill('2019-03-01');
  await sim.getByLabel('Start from').fill('2026-12-01');
  await sim.getByRole('button', { name: 'Simulate draft v1' }).click();
  await expect(sim.getByRole('status')).toContainText('Simulated draft v1');
  const result = page.getByTestId('simulation-result');
  await expect(result.getByRole('table')).toContainText('14 h');
  await expect(result).toContainText('No policy is approved for this bank yet');
  await expect(result.getByRole('row')).toHaveCount(13);
  await expectAccessible(page);

  // Approve from a date
  await expect(approve.getByRole('button', { name: 'Approve policy' })).toBeEnabled();
  await approve.getByLabel('Takes effect on').fill('2026-01-01');
  await approve.getByRole('button', { name: 'Approve policy' }).click();
  // The draft is gone once approved, so the form disappears; the status line shows the result.
  await expect(page.getByTestId('policy-status-vacation')).toContainText('Approved');
  await expect(page.getByTestId('policy-status-vacation')).toContainText('from 2026-01-01');
  await expectAccessible(page);

  // Manual adjustment lands in the member's balance and in the ledger list
  const adj = page.getByRole('form', { name: 'Adjust a balance' });
  await adj.getByLabel('Member').selectOption({ label: 'Medic, Riley' });
  await adj.getByLabel('Bank').selectOption({ label: 'Compensatory time' });
  await adj.getByLabel('Hours').fill('8');
  await adj.getByLabel('Note').fill('ok');
  await adj.getByRole('button', { name: 'Adjust balance' }).click();
  await expect(adj).toContainText('Explain the adjustment');
  await adj.getByLabel('Note').fill('Comp time from the Dec 3 holdover');
  await adj.getByRole('button', { name: 'Adjust balance' }).click();
  await expect(adj.getByRole('status')).toHaveText('Adjusted by +8 h');
  const ledger = page.getByRole('list', { name: 'Recent balance changes' });
  await expect(ledger.getByRole('listitem').first()).toContainText('Comp time from the Dec 3 holdover');
  const [row] = await sql<{ h: number }[]>`
    select coalesce(sum(l.hours), 0)::float8 as h from leave_ledger l join leave_banks b on b.id = l.bank_id
    join members m on m.id = l.member_id join auth.users u on u.id = m.user_id
    where u.email = 'member@soma.local' and b.key = 'comp_time'
      and m.tenant_id = (select id from tenants where slug = 'demo-fire-rescue')`;
  expect(row!.h).toBe(8);

  // Phone layout
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin/leave');
  await page.addStyleTag({ content: 'body, body * { letter-spacing: 0.06em !important; }' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test('members cannot open leave administration', async ({ page }) => {
  await sql`update profiles set active_tenant_id = (select id from tenants where slug = 'demo-fire-rescue')
            where user_id = (select id from auth.users where email = 'member@soma.local')`;
  await login(page, 'member@soma.local');
  await expect(page).toHaveURL('/');
  await page.goto('/admin/leave');
  await expect(page.getByRole('heading', { name: 'Not allowed' })).toBeVisible();
});
