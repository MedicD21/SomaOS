import { expect, test } from '@playwright/test';
import { createAccount, sql } from './db';
import { expectAccessible, login, loginAdmin } from './helpers';

const TZ = 'America/New_York';
const DAY = 86_400_000;

/** The calendar month containing "today + 35 days" (department zone), so lead times never interfere. */
function targetMonth(): { first: string; last: string; dayAfterLast: string } {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  const t = new Date(Date.parse(`${today}T00:00:00Z`) + 35 * DAY);
  const first = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { first: iso(first), last: iso(last), dayAfterLast: iso(new Date(last.getTime() + DAY)) };
}

async function makeOfficer(email: string, unitId: string, tenantId: string): Promise<void> {
  const userId = await createAccount(email);
  let [role] = await sql<{ id: string }[]>`select id from roles where tenant_id = ${tenantId} and key = 'leave_officer'`;
  if (!role) {
    [role] = await sql<{ id: string }[]>`insert into roles (tenant_id, key, label) values (${tenantId}, 'leave_officer', 'Leave officer') returning id`;
    await sql`insert into role_permissions (tenant_id, role_id, permission) values (${tenantId}, ${role!.id}, 'leave.approve')`;
  }
  await sql`insert into memberships (tenant_id, user_id, status) values (${tenantId}, ${userId}, 'active')`;
  const [m] = await sql<{ id: string }[]>`insert into members (tenant_id, user_id, first_name, last_name, employment_type)
    values (${tenantId}, ${userId}, 'Olive', ${email.split('@')[0]!}, 'career_full_time') returning id`;
  await sql`insert into role_grants (tenant_id, member_id, role_id, scope_kind, scope_org_unit_id)
            values (${tenantId}, ${m!.id}, ${role!.id}, 'org_unit', ${unitId})`;
  await sql`update profiles set active_tenant_id = ${tenantId} where user_id = ${userId}`;
}

test('request, approve within scope, balance and roster effects, cancel, shortfall, phone layout', async ({ page }) => {
  const month = targetMonth();
  const [t] = await sql<{ id: string }[]>`select id from tenants where slug = 'demo-fire-rescue'`;
  const tenantId = t!.id;

  // 1. An admin generates the month's roster.
  await loginAdmin(page);
  await page.goto('/roster');
  const gen = page.getByRole('form', { name: 'Generate schedule' });
  await gen.getByLabel('From').fill(month.first);
  await gen.getByLabel('To').fill(month.dayAfterLast);
  await gen.getByRole('button', { name: 'Generate' }).click();
  await expect(gen.getByRole('status')).toContainText(/Generated \d+ shifts/);

  // 2. Find Riley's first two regular shift dates and the station they work at.
  const shifts = await sql<{ d: string }[]>`
    select (lower(a.during) at time zone ${TZ})::date::text as d
    from shift_assignments a join members m on m.id = a.member_id join auth.users u on u.id = m.user_id
    where u.email = 'member@soma.local' and m.tenant_id = ${tenantId} and a.type <> 'kelly' and a.status = 'scheduled'
      and (lower(a.during) at time zone ${TZ})::date between ${month.first}::date and ${month.last}::date
    order by lower(a.during)`;
  expect(shifts.length).toBeGreaterThan(4);
  const [d1, d2] = [shifts[0]!.d, shifts[1]!.d];
  const [unit] = await sql<{ id: string }[]>`
    select s.org_unit_id as id from standing_seats ss join seats s on s.id = ss.seat_id
    join members m on m.id = ss.member_id join auth.users u on u.id = m.user_id
    where u.email = 'member@soma.local' and m.tenant_id = ${tenantId}`;
  const [typeRow] = await sql<{ id: string }[]>`select id from org_unit_types where tenant_id = ${tenantId} and key = 'station'`;
  const [elsewhere] = await sql<{ id: string }[]>`
    insert into org_units (tenant_id, type_id, name) values (${tenantId}, ${typeRow!.id}, 'Leave Test Elsewhere') returning id`;
  await makeOfficer('officer-in@soma.local', unit!.id, tenantId);
  await makeOfficer('officer-out@soma.local', elsewhere!.id, tenantId);

  // 3. The member sees balances and asks for two shifts.
  await page.context().clearCookies();
  await login(page, 'member@soma.local');
  await expect(page).toHaveURL('/');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'My leave' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('My leave');
  const balances = page.getByRole('list', { name: 'Leave balances' });
  await expect(balances.getByRole('listitem').filter({ hasText: 'Vacation' })).toContainText('120');
  await expectAccessible(page);

  const form = page.getByRole('form', { name: 'Request leave' });
  await form.getByLabel('Leave type').selectOption({ label: 'Vacation' });
  await form.getByLabel('First day').fill(d1);
  await form.getByLabel('Last day').fill(d2);
  await form.getByLabel('Reason').fill('Family trip');
  await form.getByRole('button', { name: 'Request leave' }).click();
  await expect(form.getByRole('status')).toContainText('Requested');
  const requests = page.getByRole('list', { name: 'My leave requests' });
  const mine = requests.getByRole('listitem').first();
  await expect(mine).toContainText('Pending');
  await expect(mine).toContainText('Vacation');
  const hoursText = (await mine.textContent()) ?? '';
  const hours = Number(/(\d+(?:\.\d+)?) h/.exec(hoursText)![1]);
  expect(hours).toBeGreaterThanOrEqual(24);

  // 4. An officer outside the member's station sees nothing; the one inside can approve.
  await page.context().clearCookies();
  await login(page, 'officer-out@soma.local');
  await expect(page).toHaveURL('/');
  await page.goto('/leave/approvals');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Leave approvals');
  await expect(page.getByText('No requests are waiting for you.')).toBeVisible();

  await page.context().clearCookies();
  await login(page, 'officer-in@soma.local');
  await expect(page).toHaveURL('/');
  await page.goto('/leave/approvals');
  const pending = page.getByRole('list', { name: 'Requests waiting for approval' });
  const item = pending.getByRole('listitem').filter({ hasText: 'Riley' });
  await expect(item).toContainText('Vacation');
  await expectAccessible(page);
  await item.getByRole('button', { name: /^Approve/ }).click();
  await expect(page.getByText('No requests are waiting for you.')).toBeVisible();

  // 5. Balance debited, shifts freed.
  const [bal] = await sql<{ h: number }[]>`
    select coalesce(sum(l.hours), 0)::float8 as h from leave_ledger l join members m on m.id = l.member_id
    join auth.users u on u.id = m.user_id join leave_banks b on b.id = l.bank_id
    where u.email = 'member@soma.local' and b.key = 'vacation' and m.tenant_id = ${tenantId}`;
  expect(bal!.h).toBe(120 - hours);
  const freed = await sql`select 1 from shift_assignments where tenant_id = ${tenantId} and status = 'cancelled' and cancelled_reason = 'Leave: Vacation'`;
  expect(freed.length).toBeGreaterThan(0);

  // 6. The member cancels; everything comes back.
  await page.context().clearCookies();
  await login(page, 'member@soma.local');
  await expect(page).toHaveURL('/');
  await page.goto('/leave');
  await expect(requests.getByRole('listitem').first()).toContainText('Approved');
  await requests.getByRole('listitem').first().getByRole('button', { name: /^Cancel/ }).click();
  await expect(requests.getByRole('listitem').first()).toContainText('Cancelled');
  await expect(balances.getByRole('listitem').filter({ hasText: 'Vacation' })).toContainText('120');
  const stillFreed = await sql`select 1 from shift_assignments where tenant_id = ${tenantId} and cancelled_reason = 'Leave: Vacation'`;
  expect(stillFreed).toHaveLength(0);

  // 7. A request beyond the balance is refused with a clear message.
  const whole = page.getByRole('form', { name: 'Request leave' });
  await whole.getByLabel('Leave type').selectOption({ label: 'Vacation' });
  await whole.getByLabel('First day').fill(month.first);
  await whole.getByLabel('Last day').fill(month.last);
  await whole.getByRole('button', { name: 'Request leave' }).click();
  await expect(whole.getByRole('alert')).toContainText(/Insufficient balance: 120 h available, \d+ h needed/);

  // 8. Phone layout stays inside the screen even with wide text.
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/leave', '/leave/approvals']) {
    await page.goto(path);
    await page.addStyleTag({ content: 'body, body * { letter-spacing: 0.06em !important; }' });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(0);
  }
});
