import { expect, test } from '@playwright/test';
import { sql } from './db';
import { expectAccessible, loginAdmin } from './helpers';

const RULES = {
  payPeriod: { kind: 'fixed_days', days: 14, anchor: '2026-01-01' },
  workPeriod: { days: 28, anchor: '2026-01-01', threshold: 212, multiplier: 1.5, code: 'ot' },
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

test('pay rules: guided form, plain English, JSON toggle, simulate, bypass refused, approve, compare', async ({ page }) => {
  test.setTimeout(150_000);
  const [t] = await sql<{ id: string }[]>`select id from tenants where slug = 'demo-fire-rescue'`;
  // Known start: one approved rule set (212 h threshold) and no draft.
  await sql`delete from config_versions where tenant_id = ${t!.id} and kind = 'pay.rules'`;
  await sql`insert into config_versions (tenant_id, kind, key, version, status, effective, payload)
            values (${t!.id}, 'pay.rules', 'default', 1, 'approved',
                    tstzrange('2025-01-01'::date::timestamp at time zone 'America/New_York', null), ${sql.json(RULES)})`;

  await loginAdmin(page);
  await page.goto('/admin/pay');
  const editor = page.getByRole('form', { name: 'Edit pay rules for All members' });
  await expect(editor.getByLabel(/^Overtime starts after/)).toHaveValue('212');
  const means = editor.getByRole('list', { name: 'What these settings mean' });
  await expect(means).toContainText('Overtime starts after 212 h worked');

  // 1. Editing a field updates the plain-English sentence; an invalid value shows its own error and blocks saving.
  await editor.getByLabel(/^Overtime starts after/).fill('190');
  await expect(means).toContainText('Overtime starts after 190 h worked');
  await editor.getByLabel(/^Overtime multiplier/).fill('9');
  await expect(editor.getByText('Enter a number no larger than 5.')).toBeVisible();
  await expect(editor.getByText('Fix the highlighted settings to see what they mean')).toBeVisible();
  await editor.getByRole('button', { name: 'Save draft' }).click();
  await expect(editor.getByRole('alert').filter({ hasText: 'workPeriod.multiplier' })).toBeVisible();
  await editor.getByLabel(/^Overtime multiplier/).fill('1.5');

  // 2. Advanced JSON shows the same document; an edit there appears in the form.
  await editor.getByRole('button', { name: 'Advanced JSON' }).click();
  const json = editor.getByLabel('Rules (JSON)');
  await expect(json).toHaveValue(/"threshold": 190/);
  await json.fill((await json.inputValue()).replace('"threshold": 190', '"threshold": 188').replace(/\n\}$/, ',\n  "legacyNote": "kept"\n}'));
  await editor.getByRole('button', { name: 'Guided form' }).click();
  await expect(editor.getByLabel(/^Overtime starts after/)).toHaveValue('188');
  await expect(editor.getByText(/not used by the rules: legacyNote/)).toBeVisible();
  await editor.getByLabel(/^Overtime starts after/).fill('190');

  // 3. Save the draft (the unknown key is kept and reported).
  await editor.getByRole('button', { name: 'Save draft' }).click();
  await expect(editor.getByRole('status').filter({ hasText: 'Saved draft v2' })).toContainText('legacyNote');

  // 4. Approval is blocked until this exact draft is simulated; a forced click is refused by the server.
  const approve = page.getByRole('form', { name: 'Approve pay rules for All members v2' });
  const approveButton = approve.getByRole('button', { name: 'Approve rules' });
  await expect(approveButton).toBeDisabled();
  await approve.getByLabel('Takes effect on').fill('2026-01-01');
  await approveButton.evaluate((b) => b.removeAttribute('disabled'));
  await approveButton.click();
  await expect(approve.getByRole('alert')).toHaveText('Simulate this exact draft first.');
  await approve.locator('input[name=simToken]').evaluate((i: HTMLInputElement) => { i.value = 'forged.token'; });
  await approveButton.click();
  await expect(approve.getByRole('alert')).toContainText('not valid');

  // 5. Simulate with made-up shifts: draft against the approved 212 h threshold.
  const sim = page.getByRole('form', { name: 'Simulate pay rules for All members' });
  await sim.getByLabel('Simulate with').selectOption('sample');
  await sim.getByLabel('Hourly rate (optional)').fill('30');
  await sim.getByLabel('How many shifts').first().fill('9');
  await sim.getByLabel('How many shifts').nth(1).fill('0');
  await sim.getByRole('button', { name: 'Simulate draft v2' }).click();
  await expect(sim.getByRole('status')).toContainText('Simulated draft v2');
  const row = page.getByTestId('simulation-result').getByRole('row', { name: /Sample member/ });
  // Nine 24 h shifts = 216 h. Approved: 212 regular + 4 overtime. Draft: 190 regular + 26 overtime.
  await expect(row).toContainText('$6,540.00');
  await expect(row).toContainText('$6,870.00');
  await expect(row).toContainText('+$330.00');
  await expectAccessible(page);

  // 6. Editing after simulating kills the token: the approve button is disabled again.
  await editor.getByLabel(/^Overtime starts after/).fill('191');
  await expect(approveButton).toBeDisabled();
  await editor.getByLabel(/^Overtime starts after/).fill('190');
  await expect(approveButton).toBeEnabled();

  // 7. Approve from a date; the version list and compare view show the change.
  await approve.getByLabel('Takes effect on').fill('2026-01-01');
  await approveButton.click();
  await expect(page.getByTestId('rules-status-default')).toContainText('Approved v2 from 2026-01-01');
  const compare = page.getByRole('region', { name: 'Compare versions of All members' });
  await compare.getByLabel('Compare').selectOption({ label: 'v1 (approved from 2025-01-01)' });
  await expect(compare.getByRole('row', { name: /Overtime starts after/ })).toContainText('212');
  await expect(compare.getByRole('row', { name: /Overtime starts after/ })).toContainText('190');
  await expect(compare.getByRole('list', { name: 'What changed' })).toContainText('Now: Overtime starts after 190 h worked');

  // 8. Phone layout: nothing overflows the page, including the result tables.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin/pay');
  await page.addStyleTag({ content: 'body, body * { letter-spacing: 0.06em !important; }' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

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

test('leave policy: change a tier in the guided form, simulate a member, approve', async ({ page }) => {
  test.setTimeout(120_000);
  // Known start: Vacation has one approved two-tier policy (14 h from 5 years) and no draft.
  const [t] = await sql<{ id: string }[]>`select id from tenants where slug = 'demo-fire-rescue'`;
  await sql`delete from config_versions where tenant_id = ${t!.id} and kind = 'leave.accrual' and key = 'vacation'`;
  await sql`insert into config_versions (tenant_id, kind, key, version, status, effective, payload)
            values (${t!.id}, 'leave.accrual', 'vacation', 1, 'approved',
                    tstzrange('2026-01-01'::date::timestamp at time zone 'America/New_York', null), ${sql.json(POLICY)})`;
  await loginAdmin(page);
  await page.goto('/admin/leave');
  const editor = page.getByRole('form', { name: 'Edit Vacation policy' });
  // Tier 2 earns 14 h today (see the leave admin spec); make it 15.
  await expect(editor.getByRole('list', { name: 'Tiers' }).getByRole('listitem')).toHaveCount(2);
  await editor.getByLabel('Hours earned each period').nth(1).fill('15');
  await expect(editor.getByRole('list', { name: 'What these settings mean' })).toContainText('From 5 years of service: 15 h each period.');
  await editor.getByRole('button', { name: 'Add a tier' }).click();
  await editor.getByRole('button', { name: 'Remove tier 3' }).click();
  await editor.getByRole('button', { name: 'Save draft' }).click();
  await expect(editor.getByRole('status')).toContainText('Saved draft v2');

  const sim = page.getByRole('form', { name: 'Simulate Vacation policy' });
  await sim.getByLabel('Hire date').fill('2019-03-01');
  await sim.getByLabel('Start from').fill('2026-12-01');
  await sim.getByRole('button', { name: 'Simulate draft v2' }).click();
  await expect(sim.getByRole('status')).toContainText('Simulated draft v2');
  const first = page.getByTestId('simulation-result').getByRole('row').nth(1);
  await expect(first).toContainText('14 h');
  await expect(first).toContainText('15 h');
  await expectAccessible(page);

  const approve = page.getByRole('form', { name: 'Approve Vacation policy v2' });
  await approve.getByLabel('Takes effect on').fill('2026-06-01');
  await approve.getByRole('button', { name: 'Approve policy' }).click();
  await expect(page.getByTestId('policy-status-vacation')).toContainText('Approved v2');
  await expect(page.getByTestId('policy-status-vacation')).toContainText('from 2026-06-01');
});
