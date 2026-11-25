import { expect, test, type Page } from '@playwright/test';
import { createAccount, sql } from './db';
import { expectAccessible, login } from './helpers';

async function addPerson(email: string, first: string, last: string, tenantId: string, perms: string[], scope: 'department' | 'org_unit' = 'department', unitId: string | null = null): Promise<string> {
  const userId = await createAccount(email);
  const roleKey = `trade_${email.split('@')[0]}`;
  const [role] = await sql<{ id: string }[]>`insert into roles (tenant_id, key, label) values (${tenantId}, ${roleKey}, ${roleKey}) returning id`;
  for (const p of perms) await sql`insert into role_permissions (tenant_id, role_id, permission) values (${tenantId}, ${role!.id}, ${p})`;
  await sql`insert into memberships (tenant_id, user_id, status) values (${tenantId}, ${userId}, 'active')`;
  const [m] = await sql<{ id: string }[]>`insert into members (tenant_id, user_id, first_name, last_name, employment_type)
    values (${tenantId}, ${userId}, ${first}, ${last}, 'career_full_time') returning id`;
  await sql`insert into role_grants (tenant_id, member_id, role_id, scope_kind, scope_org_unit_id)
            values (${tenantId}, ${m!.id}, ${role!.id}, ${scope}, ${unitId})`;
  await sql`update profiles set active_tenant_id = ${tenantId} where user_id = ${userId}`;
  return m!.id;
}

async function shift(tenantId: string, member: string, seat: string, days: number): Promise<string> {
  const [r] = await sql<{ id: string }[]>`
    insert into shift_assignments (tenant_id, member_id, seat_id, during, type, source)
    values (${tenantId}, ${member}, ${seat}, tstzrange(now() + make_interval(days => ${days}), now() + make_interval(days => ${days}, hours => 24)), 'regular', 'manual')
    returning id`;
  return r!.id;
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await login(page, email);
  await expect(page).toHaveURL('/');
}

test('propose, accept, officer scope, qualification block and override, swap, decline, phone layout', async ({ page }) => {
  test.setTimeout(180_000);
  const SLOW = { timeout: 30_000 };
  const [t] = await sql<{ id: string }[]>`select id from tenants where slug = 'demo-fire-rescue'`;
  const tenantId = t!.id;
  await sql`update profiles set active_tenant_id = ${tenantId} where user_id = (select id from auth.users where email = 'member@soma.local')`;

  const [riley] = await sql<{ id: string }[]>`select m.id from members m join auth.users u on u.id = m.user_id where u.email = 'member@soma.local' and m.tenant_id = ${tenantId}`;
  const [home] = await sql<{ seat_id: string; org_unit_id: string }[]>`
    select ss.seat_id, s.org_unit_id from standing_seats ss join seats s on s.id = ss.seat_id where ss.member_id = ${riley!.id}`;
  const [typeRow] = await sql<{ id: string }[]>`select id from org_unit_types where tenant_id = ${tenantId} and key = 'station'`;
  const [unitB] = await sql<{ id: string }[]>`insert into org_units (tenant_id, type_id, name) values (${tenantId}, ${typeRow!.id}, 'Trade Station B') returning id`;
  const [seatB] = await sql<{ id: string }[]>`insert into seats (tenant_id, org_unit_id, label) values (${tenantId}, ${unitB!.id}, 'Trade Seat B') returning id`;

  const sam = await addPerson('sam-trader@soma.local', 'Sam', 'Trader', tenantId, ['scheduling.roster.view', 'scheduling.trade.request']);
  await addPerson('trade-home@soma.local', 'Hana', 'Home', tenantId, ['scheduling.roster.edit'], 'org_unit', home!.org_unit_id);
  await addPerson('trade-both@soma.local', 'Bo', 'Both', tenantId, ['scheduling.roster.edit']);
  await addPerson('trade-ovr@soma.local', 'Ora', 'Override', tenantId, ['scheduling.roster.edit', 'scheduling.qualification.override']);

  // Seat B needs a credential Riley does not hold and Sam does.
  const [cred] = await sql<{ id: string }[]>`insert into credential_types (tenant_id, key, label, validity) values (${tenantId}, 'trade_cert', 'Trade Cert', ${sql.json({ kind: 'fixed', months: 60 })}) returning id`;
  await sql`insert into seat_requirements (tenant_id, seat_id, group_no, credential_type_id) values (${tenantId}, ${seatB!.id}, 1, ${cred!.id})`;
  await sql`insert into member_credentials (tenant_id, member_id, type_id, issued_on, expires_on) values (${tenantId}, ${sam}, ${cred!.id}, current_date - 30, current_date + 900)`;

  // Other specs generate rosters; clear Riley's upcoming shifts so a swap cannot collide with a generated one.
  await sql`delete from shift_assignments where member_id = ${riley!.id} and lower(during) > now()`;
  const rileyShift = await shift(tenantId, riley!.id, home!.seat_id, 10);
  const samShift = await shift(tenantId, sam, seatB!.id, 12);

  // 1. Riley proposes a trade.
  await signIn(page, 'member@soma.local');
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Shift trades' })).toBeVisible();
  await page.goto('/trades');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Shift trades');
  const propose = page.getByRole('form', { name: 'Propose a trade' });
  await propose.getByLabel('Your shift').selectOption(rileyShift);
  await propose.getByLabel('Their shift').selectOption(samShift);
  await propose.getByLabel('Note (optional)').fill('Family event');
  await propose.getByRole('button', { name: 'Propose trade' }).click();
  const pending = page.getByRole('list', { name: 'Your pending trades' });
  await expect(pending.getByRole('listitem')).toContainText('Waiting for the other member', SLOW);
  await expectAccessible(page);

  // 2. Sam sees the offer and accepts.
  await signIn(page, 'sam-trader@soma.local');
  await page.goto('/trades');
  const offers = page.getByRole('list', { name: 'Trade offers to you' });
  await expect(offers.getByRole('listitem')).toContainText('Family event', SLOW);
  await offers.getByRole('form', { name: /^Accept trade/ }).getByRole('button', { name: 'Accept' }).click();
  await expect(page.getByRole('list', { name: 'Your pending trades' }).getByRole('listitem')).toContainText('Waiting for an officer', SLOW);

  // 3. An officer for Riley's station only cannot decide; nothing is waiting for them.
  await signIn(page, 'trade-home@soma.local');
  await page.goto('/trades');
  await expect(page.getByText('No trades are waiting for you.')).toBeVisible();

  // 4. An officer covering both stations sees the qualification block; approval needs an override.
  await signIn(page, 'trade-both@soma.local');
  await page.goto('/trades');
  const queue = page.getByRole('list', { name: 'Trades to approve' });
  const item = queue.locator(':scope > li');
  await expect(item).toContainText('Qualification blocks');
  await expect(item).toContainText('Riley Medic in Trade Seat B');
  await expectAccessible(page);
  const approve = queue.getByRole('form', { name: /^Approve/ });
  await approve.getByRole('button', { name: 'Approve trade' }).click();
  await expect(approve.getByRole('alert')).toContainText('This trade is blocked');
  await approve.getByLabel('Override reason').fill('Short staffed that day');
  await approve.getByRole('button', { name: 'Approve trade' }).click();
  await expect(approve.getByRole('alert')).toContainText('overriding needs qualification override');
  expect((await sql<{ member_id: string }[]>`select member_id from shift_assignments where id = ${rileyShift}`)[0]!.member_id).toBe(riley!.id);

  // 5. An officer who may override approves; the two shifts swap.
  await signIn(page, 'trade-ovr@soma.local');
  await page.goto('/trades');
  const queue2 = page.getByRole('list', { name: 'Trades to approve' });
  const approve2 = queue2.getByRole('form', { name: /^Approve/ });
  await approve2.getByLabel('Override reason').fill('Short staffed that day');
  await approve2.getByRole('button', { name: 'Approve trade' }).click();
  await expect(page.getByText('No trades are waiting for you.')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Recent trades' }).getByRole('listitem')).toContainText('Approved');
  const swapped = await sql<{ id: string; member_id: string; type: string }[]>`select id, member_id, type from shift_assignments where id in (${rileyShift}, ${samShift})`;
  expect(swapped.find((s) => s.id === rileyShift)).toMatchObject({ member_id: sam, type: 'trade' });
  expect(swapped.find((s) => s.id === samShift)).toMatchObject({ member_id: riley!.id, type: 'trade' });

  // 6. Declined and withdrawn trades.
  const mine2 = await shift(tenantId, riley!.id, home!.seat_id, 20);
  const theirs2 = await shift(tenantId, sam, seatB!.id, 22);
  await signIn(page, 'member@soma.local');
  await page.goto('/trades');
  const again = page.getByRole('form', { name: 'Propose a trade' });
  await again.getByLabel('Your shift').selectOption(mine2);
  await again.getByLabel('Their shift').selectOption(theirs2);
  await again.getByRole('button', { name: 'Propose trade' }).click();
  await expect(page.getByRole('list', { name: 'Your pending trades' })).toBeVisible(SLOW);
  await signIn(page, 'sam-trader@soma.local');
  await page.goto('/trades');
  await page.getByRole('list', { name: 'Trade offers to you' }).getByRole('form', { name: /^Decline trade/ }).getByRole('button', { name: 'Decline' }).click();
  await expect(page.getByRole('list', { name: 'Recent trades' }).getByRole('listitem').first()).toContainText('Declined', SLOW);

  // 7. Phone layout.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/trades');
  await page.addStyleTag({ content: 'body, body * { letter-spacing: 0.06em !important; }' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
