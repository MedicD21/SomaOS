import { expect, test, type Page } from '@playwright/test';
import { createAccount, sql } from './db';
import { expectAccessible, login, loginAdmin } from './helpers';

const PERIOD = '2026-01-01';
const RULES = {
  payPeriod: { kind: 'fixed_days', days: 28, anchor: '2026-01-01' },
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
  compTime: { mode: 'always', multiplier: 1.5, bankKey: 'comp_time' },
};

async function makeOfficer(email: string, unitId: string, tenantId: string): Promise<void> {
  const userId = await createAccount(email);
  let [role] = await sql<{ id: string }[]>`select id from roles where tenant_id = ${tenantId} and key = 'time_officer'`;
  if (!role) {
    [role] = await sql<{ id: string }[]>`insert into roles (tenant_id, key, label) values (${tenantId}, 'time_officer', 'Time officer') returning id`;
    await sql`insert into role_permissions (tenant_id, role_id, permission) values (${tenantId}, ${role!.id}, 'scheduling.roster.edit')`;
  }
  await sql`insert into memberships (tenant_id, user_id, status) values (${tenantId}, ${userId}, 'active')`;
  const [m] = await sql<{ id: string }[]>`insert into members (tenant_id, user_id, first_name, last_name, employment_type)
    values (${tenantId}, ${userId}, 'Tess', ${email.split('@')[0]!}, 'career_full_time') returning id`;
  await sql`insert into role_grants (tenant_id, member_id, role_id, scope_kind, scope_org_unit_id)
            values (${tenantId}, ${m!.id}, ${role!.id}, 'org_unit', ${unitId})`;
  await sql`update profiles set active_tenant_id = ${tenantId} where user_id = ${userId}`;
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await login(page, email);
  await expect(page).toHaveURL('/');
}

test('officers record time in scope, payroll closes the period, comp is credited, it locks, and reopening reverses', async ({ page }) => {
  const [t] = await sql<{ id: string }[]>`select id from tenants where slug = 'demo-fire-rescue'`;
  const tenantId = t!.id;
  await sql`update profiles set active_tenant_id = ${tenantId} where user_id = (select id from auth.users where email = 'member@soma.local')`;

  // Known starting point: one approved rule set, no shifts in the period, Riley at $31.25/h with 10 regular hours recorded.
  await sql`delete from config_versions where tenant_id = ${tenantId} and kind = 'pay.rules'`;
  await sql`insert into config_versions (tenant_id, kind, key, version, status, effective, payload)
            values (${tenantId}, 'pay.rules', 'default', 1, 'approved',
                    tstzrange('2025-01-01'::date::timestamp at time zone 'America/New_York', null), ${sql.json(RULES)})`;
  await sql`delete from shift_assignments where tenant_id = ${tenantId} and lower(during) < '2026-02-01'::timestamptz and upper(during) > '2025-12-30'::timestamptz`;
  await sql`delete from member_pay_rates where tenant_id = ${tenantId}`;
  const [riley] = await sql<{ id: string }[]>`
    select m.id from members m join auth.users u on u.id = m.user_id where u.email = 'member@soma.local' and m.tenant_id = ${tenantId}`;
  await sql`update members set employee_group_id = null where id = ${riley!.id}`;
  await sql`insert into member_pay_rates (tenant_id, member_id, hourly_rate, effective) values (${tenantId}, ${riley!.id}, 31.25, '[2025-01-01,)')`;
  await sql`insert into time_entries (tenant_id, member_id, work_date, hours, type, reason)
            values (${tenantId}, ${riley!.id}, '2026-01-05', 10, 'regular', 'Seeded regular hours')`;

  const [unit] = await sql<{ id: string }[]>`
    select s.org_unit_id as id from standing_seats ss join seats s on s.id = ss.seat_id
    where ss.member_id = ${riley!.id}`;
  const [typeRow] = await sql<{ id: string }[]>`select id from org_unit_types where tenant_id = ${tenantId} and key = 'station'`;
  const [elsewhere] = await sql<{ id: string }[]>`
    insert into org_units (tenant_id, type_id, name) values (${tenantId}, ${typeRow!.id}, 'Time Test Elsewhere') returning id`;
  await makeOfficer('time-in@soma.local', unit!.id, tenantId);
  await makeOfficer('time-out@soma.local', elsewhere!.id, tenantId);

  // 1. An officer at another station covers nobody here.
  await signIn(page, 'time-out@soma.local');
  await page.goto('/time');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Time');
  await expect(page.getByText('You do not cover any members.')).toBeVisible();

  // 2. The officer at Riley's station records a holdover; they cannot record time for themselves.
  await signIn(page, 'time-in@soma.local');
  await page.goto('/time');
  const form = page.getByRole('form', { name: 'Record time' });
  await expect(form.getByLabel('Member').getByRole('option', { name: /time-in/ })).toHaveCount(0);
  await form.getByLabel('Member').selectOption({ label: 'Medic, Riley' });
  await form.getByLabel('Date worked').fill('2026-01-10');
  await form.getByLabel('Hours').fill('3');
  await form.getByLabel('Type').selectOption({ label: 'Holdover' });
  await form.getByLabel('Reason').fill('Held over for a late call');
  await form.getByRole('button', { name: 'Record time' }).click();
  await expect(form.getByRole('status')).toHaveText('Recorded 3 h on 2026-01-10');
  const entries = page.getByRole('list', { name: 'Time entries' });
  await expect(entries.getByRole('listitem').filter({ hasText: 'Held over for a late call' })).toContainText('Medic, Riley');
  await expectAccessible(page);

  // 3. A plain member has no Time page.
  await signIn(page, 'member@soma.local');
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Time' })).toHaveCount(0);
  await page.goto('/time');
  await expect(page.getByRole('heading', { name: 'Not allowed' })).toBeVisible();

  // 4. Payroll sees the holdover on the period, taken as comp time, and closes it.
  await page.context().clearCookies();
  await loginAdmin(page);
  await page.goto(`/pay?start=${PERIOD}`);
  const list = page.getByRole('list', { name: 'Pay by member' });
  const row = list.getByRole('listitem').filter({ hasText: 'Medic, Riley' });
  await expect(row).toContainText('13 h');
  await expect(row).toContainText('$312.50');
  await row.getByText('Show lines').click();
  await expect(row).toContainText('taken as comp time');
  await expect(row).toContainText('Comp time credited: 4.5 h');
  await expect(page.getByText('It will credit comp time: Medic, Riley 4.5 h.')).toBeVisible();
  await expectAccessible(page);

  const closeForm = page.getByRole('form', { name: 'Close pay period' });
  await closeForm.getByRole('button', { name: 'Close pay period' }).click();
  // The form unmounts once the period is closed; the banner replaces it.
  await expect(page.getByRole('status').filter({ hasText: /^Closed / })).toContainText('cannot be added or voided');

  const credit = await sql<{ kind: string; hours: number; run_key: string }[]>`
    select l.kind, l.hours::float8 as hours, l.run_key from leave_ledger l join leave_banks b on b.id = l.bank_id
    where l.member_id = ${riley!.id} and b.key = 'comp_time' and l.run_key like 'comp%' order by l.id`;
  expect(credit).toHaveLength(1);
  expect(credit[0]).toMatchObject({ kind: 'earn', hours: 4.5 });
  expect(credit[0]!.run_key).toMatch(/^comp:/);

  // 5. The period is locked: the officer cannot add time, and a rate change does not move closed numbers.
  await sql`update member_pay_rates set hourly_rate = 99 where member_id = ${riley!.id}`;
  await page.reload();
  await expect(list.getByRole('listitem').filter({ hasText: 'Medic, Riley' })).toContainText('$312.50');

  await signIn(page, 'time-in@soma.local');
  await page.goto('/time');
  const again = page.getByRole('form', { name: 'Record time' });
  await again.getByLabel('Member').selectOption({ label: 'Medic, Riley' });
  await again.getByLabel('Date worked').fill('2026-01-12');
  await again.getByLabel('Hours').fill('2');
  await again.getByLabel('Reason').fill('Late addition');
  await again.getByRole('button', { name: 'Record time' }).click();
  await expect(again.getByRole('alert')).toHaveText('That pay period is closed');

  // 6. Payroll reopens it: the comp credit is reversed and the numbers are live again (new rate).
  await page.context().clearCookies();
  await loginAdmin(page);
  await page.goto(`/pay?start=${PERIOD}`);
  const reopen = page.getByRole('form', { name: 'Reopen pay period' });
  await reopen.getByLabel('Why is it being reopened?').fill('no');
  await reopen.getByRole('button', { name: 'Reopen pay period' }).click();
  await expect(reopen.getByText(/at least 5 characters/)).toBeVisible();
  await reopen.getByLabel('Why is it being reopened?').fill('Correcting a pay rate');
  await reopen.getByRole('button', { name: 'Reopen pay period' }).click();
  await expect(page.getByRole('form', { name: 'Close pay period' })).toBeVisible();
  await expect(list.getByRole('listitem').filter({ hasText: 'Medic, Riley' })).toContainText('$990.00');

  const after = await sql<{ kind: string; hours: number }[]>`
    select l.kind, l.hours::float8 as hours from leave_ledger l join leave_banks b on b.id = l.bank_id
    where l.member_id = ${riley!.id} and b.key = 'comp_time' and l.run_key like 'comp%' order by l.id`;
  expect(after).toEqual([{ kind: 'earn', hours: 4.5 }, { kind: 'reversal', hours: -4.5 }]);

  // 7. Phone layout.
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of [`/pay?start=${PERIOD}`, '/time']) {
    await page.goto(path);
    await page.addStyleTag({ content: 'body, body * { letter-spacing: 0.06em !important; }' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), path).toBeLessThanOrEqual(0);
  }
});
