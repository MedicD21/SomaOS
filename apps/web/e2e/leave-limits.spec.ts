import { expect, test, type Page } from '@playwright/test';
import { createAccount, sql } from './db';
import { expectAccessible, login, loginAdmin } from './helpers';

const TZ = 'America/New_York';

async function addPerson(email: string, first: string, last: string, tenantId: string, perms: string[]): Promise<string> {
  const userId = await createAccount(email);
  const roleKey = `lim_${email.split('@')[0]}`;
  const [role] = await sql<{ id: string }[]>`insert into roles (tenant_id, key, label) values (${tenantId}, ${roleKey}, ${roleKey}) returning id`;
  for (const p of perms) await sql`insert into role_permissions (tenant_id, role_id, permission) values (${tenantId}, ${role!.id}, ${p})`;
  await sql`insert into memberships (tenant_id, user_id, status) values (${tenantId}, ${userId}, 'active')`;
  const [m] = await sql<{ id: string }[]>`insert into members (tenant_id, user_id, first_name, last_name, employment_type)
    values (${tenantId}, ${userId}, ${first}, ${last}, 'career_full_time') returning id`;
  await sql`insert into role_grants (tenant_id, member_id, role_id, scope_kind) values (${tenantId}, ${m!.id}, ${role!.id}, 'department')`;
  await sql`update profiles set active_tenant_id = ${tenantId} where user_id = ${userId}`;
  return m!.id;
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await login(page, email);
  await expect(page).toHaveURL('/');
}

test('admin sets a leave limit; approvals show it, a plain approver is stopped, a manager overrides with a reason', async ({ page }) => {
  test.setTimeout(120_000);
  const [t] = await sql<{ id: string }[]>`select id from tenants where slug = 'demo-fire-rescue'`;
  const tenantId = t!.id;
  await sql`update profiles set active_tenant_id = ${tenantId} where user_id = (select id from auth.users where email = 'member@soma.local')`;

  // 1. Admin adds a department-wide limit of 1 through the page.
  await loginAdmin(page);
  await page.goto('/admin/leave');
  await expectAccessible(page);
  const form = page.getByRole('form', { name: 'Add leave limit' });
  await form.getByLabel('Label').fill('E2E cap');
  await form.getByLabel('Most members on leave at once').fill('1');
  await form.getByRole('button', { name: 'Add limit' }).click();
  await expect(page.getByRole('list', { name: 'Leave limits' })).toContainText('E2E cap');
  await expect(page.getByRole('list', { name: 'Leave limits' })).toContainText('at most 1');
  await form.getByLabel('Label').fill('Bad cap');
  await form.getByLabel('Most members on leave at once').fill('-2');
  await form.getByRole('button', { name: 'Add limit' }).click();
  await expect(form.getByText('Use 0 or more')).toBeVisible();

  // 2. Setup: Sam is already on approved leave on D; Riley and Tess ask for D too (both have shifts that day).
  const [riley] = await sql<{ id: string }[]>`select m.id from members m join auth.users u on u.id = m.user_id where u.email = 'member@soma.local' and m.tenant_id = ${tenantId}`;
  const [home] = await sql<{ seat_id: string; org_unit_id: string }[]>`
    select ss.seat_id, s.org_unit_id from standing_seats ss join seats s on s.id = ss.seat_id where ss.member_id = ${riley!.id}`;
  const sam = await addPerson('lim-sam@soma.local', 'Sam', 'Away', tenantId, ['leave.request']);
  const tess = await addPerson('lim-tess@soma.local', 'Tess', 'Next', tenantId, ['leave.request']);
  await addPerson('lim-officer@soma.local', 'Olive', 'Officer', tenantId, ['leave.approve', 'leave.view']);
  await addPerson('lim-manager@soma.local', 'Mia', 'Manager', tenantId, ['leave.approve', 'leave.view', 'leave.manage']);
  const [d] = await sql<{ d: string }[]>`select ((now() at time zone ${TZ})::date + 50)::text as d`;
  const [bank] = await sql<{ id: string }[]>`select id from leave_banks where tenant_id = ${tenantId} and key = 'vacation'`;
  const [vac] = await sql<{ id: string }[]>`select id from leave_types where tenant_id = ${tenantId} and key = 'vacation'`;
  await sql`delete from shift_assignments where member_id = ${riley!.id} and lower(during) > now()`;
  for (const m of [riley!.id, sam, tess]) {
    if (m !== riley!.id) {
      await sql`insert into member_assignments (tenant_id, member_id, org_unit_id, effective) values (${tenantId}, ${m}, ${home!.org_unit_id}, '[2020-01-01,)')`;
      await sql`insert into leave_ledger (tenant_id, member_id, bank_id, kind, hours, effective_date) values (${tenantId}, ${m}, ${bank!.id}, 'earn', 100, current_date)`;
    }
    const [seat] = m === riley!.id
      ? [{ id: home!.seat_id }]
      : await sql<{ id: string }[]>`insert into seats (tenant_id, org_unit_id, label) values (${tenantId}, ${home!.org_unit_id}, ${'Limit seat ' + m.slice(0, 4)}) returning id`;
    await sql`insert into shift_assignments (tenant_id, member_id, seat_id, during, type, source)
              values (${tenantId}, ${m}, ${seat!.id},
                tstzrange((${d!.d}::date + time '07:00') at time zone ${TZ}, ((${d!.d}::date + 1) + time '07:00') at time zone ${TZ}), 'regular', 'manual')`;
  }
  await sql`insert into leave_requests (tenant_id, member_id, leave_type_id, start_date, end_date, hours, status)
            values (${tenantId}, ${sam}, ${vac!.id}, ${d!.d}::date, ${d!.d}::date, 24, 'approved')`;
  await sql`insert into leave_requests (tenant_id, member_id, leave_type_id, start_date, end_date, hours, status)
            values (${tenantId}, ${riley!.id}, ${vac!.id}, ${d!.d}::date, ${d!.d}::date, 24, 'pending')`;

  // 3. A plain approver sees the limit, has no override field, and is stopped.
  await signIn(page, 'lim-officer@soma.local');
  await page.goto('/leave/approvals');
  const list = page.getByRole('list', { name: 'Requests waiting for approval' });
  const item = list.getByRole('listitem').filter({ hasText: 'Riley' }).first();
  await expect(item).toContainText('Over a leave limit');
  await expect(item).toContainText('E2E cap: 1 of 1 already on leave');
  await expect(item).toContainText('A leave manager must approve this request anyway');
  await expect(item.getByLabel('Limit override reason')).toHaveCount(0);
  await expectAccessible(page);
  await item.getByRole('button', { name: /^Approve/ }).click();
  await expect(item.getByRole('alert')).toContainText('Leave limit');

  // 4. A leave manager gets the override field; no reason is refused, a reason approves.
  await signIn(page, 'lim-manager@soma.local');
  await page.goto('/leave/approvals');
  const mine = page.getByRole('list', { name: 'Requests waiting for approval' }).getByRole('listitem').filter({ hasText: 'Riley' }).first();
  await mine.getByRole('button', { name: /^Approve/ }).click();
  await expect(mine.getByRole('alert')).toContainText('Leave limit');
  await mine.getByLabel('Limit override reason').fill('Coverage arranged with Tess');
  await mine.getByRole('button', { name: /^Approve/ }).click();
  await expect(page.getByText('No requests are waiting for you.')).toBeVisible();
  const [row] = await sql<{ status: string; decision_note: string }[]>`
    select status, decision_note from leave_requests where member_id = ${riley!.id} and start_date = ${d!.d}::date`;
  expect(row).toMatchObject({ status: 'approved' });
  expect(row!.decision_note).toContain('Limit override: Coverage arranged with Tess');

  // 5. Archiving the limit lifts it: Tess is approved by the plain approver.
  await sql`update leave_limits set archived_at = now() where label = 'E2E cap' and tenant_id = ${tenantId}`;
  await sql`insert into leave_requests (tenant_id, member_id, leave_type_id, start_date, end_date, hours, status)
            values (${tenantId}, ${tess}, ${vac!.id}, ${d!.d}::date, ${d!.d}::date, 24, 'pending')`;
  await signIn(page, 'lim-officer@soma.local');
  await page.goto('/leave/approvals');
  const tessItem = page.getByRole('list', { name: 'Requests waiting for approval' }).getByRole('listitem').filter({ hasText: 'Tess' }).first();
  await expect(tessItem).not.toContainText('leave limit');
  await tessItem.getByRole('button', { name: /^Approve/ }).click();
  await expect(page.getByText('No requests are waiting for you.')).toBeVisible();

  // Leave the demo member's balance and roster as other specs expect them (Riley's approved leave debited 24 h).
  await sql`delete from leave_ledger where request_id in (select id from leave_requests where member_id in (${riley!.id}, ${sam}, ${tess}) and start_date = ${d!.d}::date)`;
  await sql`delete from shift_assignments where leave_request_id in (select id from leave_requests where member_id in (${riley!.id}, ${sam}, ${tess}) and start_date = ${d!.d}::date)`;
  await sql`delete from leave_requests where member_id in (${riley!.id}, ${sam}, ${tess}) and start_date = ${d!.d}::date`;

  // 6. Phone layout.
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'lim-manager@soma.local');
  for (const path of ['/leave/approvals', '/admin/leave']) {
    await page.goto(path);
    await page.addStyleTag({ content: 'body, body * { letter-spacing: 0.06em !important; }' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), path).toBeLessThanOrEqual(0);
  }
});
