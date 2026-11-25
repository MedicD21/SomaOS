import { expect, test, type Page } from '@playwright/test';
import { createAccount, sql } from './db';
import { expectAccessible, login } from './helpers';

async function addPerson(email: string, first: string, last: string, tenantId: string, perms: string[], scope: 'department' | 'org_unit' = 'department', unitId: string | null = null): Promise<string> {
  const userId = await createAccount(email);
  const roleKey = `os_${email.split('@')[0]}`;
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

async function signIn(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await login(page, email);
  await expect(page).toHaveURL('/');
}

const isoPlus = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

test('post, claim, officer scope, qualification block and override, approval fills the seat, cancel, phone layout', async ({ page }) => {
  test.setTimeout(120_000);
  const [t] = await sql<{ id: string }[]>`select id from tenants where slug = 'demo-fire-rescue'`;
  const tenantId = t!.id;
  await sql`update profiles set active_tenant_id = ${tenantId} where user_id = (select id from auth.users where email = 'member@soma.local')`;

  const [riley] = await sql<{ id: string }[]>`select m.id from members m join auth.users u on u.id = m.user_id where u.email = 'member@soma.local' and m.tenant_id = ${tenantId}`;
  const [home] = await sql<{ org_unit_id: string }[]>`select s.org_unit_id from standing_seats ss join seats s on s.id = ss.seat_id where ss.member_id = ${riley!.id}`;
  const [typeRow] = await sql<{ id: string }[]>`select id from org_unit_types where tenant_id = ${tenantId} and key = 'station'`;
  const [unit] = await sql<{ id: string }[]>`insert into org_units (tenant_id, type_id, name) values (${tenantId}, ${typeRow!.id}, 'Open Station') returning id`;
  const [seat] = await sql<{ id: string }[]>`insert into seats (tenant_id, org_unit_id, label) values (${tenantId}, ${unit!.id}, 'Open Seat') returning id`;

  const sam = await addPerson('os-sam@soma.local', 'Sam', 'Opener', tenantId, ['scheduling.roster.view', 'scheduling.openshift.claim']);
  await addPerson('os-home@soma.local', 'Hana', 'Home', tenantId, ['scheduling.roster.edit'], 'org_unit', unit!.id);
  await addPerson('os-out@soma.local', 'Otto', 'Out', tenantId, ['scheduling.roster.edit'], 'org_unit', home!.org_unit_id);
  await addPerson('os-ovr@soma.local', 'Ora', 'Override', tenantId, ['scheduling.roster.edit', 'scheduling.qualification.override']);

  // The seat needs a credential Riley lacks and Sam holds.
  const [cred] = await sql<{ id: string }[]>`insert into credential_types (tenant_id, key, label, validity) values (${tenantId}, 'open_cert', 'Open Cert', ${sql.json({ kind: 'fixed', months: 60 })}) returning id`;
  await sql`insert into seat_requirements (tenant_id, seat_id, group_no, credential_type_id) values (${tenantId}, ${seat!.id}, 1, ${cred!.id})`;
  await sql`insert into member_credentials (tenant_id, member_id, type_id, issued_on, expires_on) values (${tenantId}, ${sam}, ${cred!.id}, current_date - 30, current_date + 900)`;
  // Other specs generate rosters; clear upcoming shifts for the claimants so nothing overlaps.
  await sql`delete from shift_assignments where member_id in (${riley!.id}, ${sam}) and lower(during) > now()`;

  // 1. The officer for the new station posts an open shift.
  await signIn(page, 'os-home@soma.local');
  await page.goto('/open-shifts');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Open shifts');
  const post = page.getByRole('form', { name: 'Post an open shift' });
  await post.getByLabel('Seat').selectOption(seat!.id);
  await post.getByLabel('Date').fill(isoPlus(20));
  await post.getByLabel('Start time').fill('07:00');
  await post.getByLabel('Hours').fill('24');
  await post.getByLabel('Reason').fill('Short for the holiday weekend');
  await post.getByRole('button', { name: 'Post open shift' }).click();
  const list = page.getByRole('list', { name: 'Open shifts' });
  await expect(list.locator(':scope > li')).toContainText('Open Station · Open Seat');
  await expectAccessible(page);

  // 2. An officer at a different station sees nothing (and has no claim permission).
  await signIn(page, 'os-out@soma.local');
  await page.goto('/open-shifts');
  await expect(page.getByText('There are no open shifts right now.')).toBeVisible();

  // 3. Riley and Sam claim it; Riley sees their own claim.
  await signIn(page, 'member@soma.local');
  await page.goto('/open-shifts');
  const claimRiley = page.getByRole('form', { name: /^Claim / });
  await claimRiley.getByLabel('Note (optional)').fill('Happy to cover');
  await claimRiley.getByRole('button', { name: 'Claim this shift' }).click();
  await expect(page.getByText('You claimed this. Waiting for an officer.')).toBeVisible();
  await expectAccessible(page);
  await signIn(page, 'os-sam@soma.local');
  await page.goto('/open-shifts');
  await page.getByRole('form', { name: /^Claim / }).getByRole('button', { name: 'Claim this shift' }).click();
  await expect(page.getByText('You claimed this. Waiting for an officer.')).toBeVisible();

  // 4. The station officer sees both claims; Riley's is blocked and needs an override they cannot give.
  await signIn(page, 'os-home@soma.local');
  await page.goto('/open-shifts');
  await expect(page.getByRole('listitem').filter({ hasText: 'Medic, Riley' }).first()).toContainText('Qualification blocks');
  const approveRiley = page.getByRole('form', { name: 'Approve Medic, Riley' });
  await approveRiley.getByRole('button', { name: 'Approve Medic, Riley' }).click();
  await expect(approveRiley.getByRole('alert')).toContainText('This claim is blocked');
  await approveRiley.getByLabel('Override reason').fill('Short staffed that day');
  await approveRiley.getByRole('button', { name: 'Approve Medic, Riley' }).click();
  await expect(approveRiley.getByRole('alert')).toContainText('overriding needs qualification override');
  expect(await sql`select 1 from shift_assignments where seat_id = ${seat!.id}`).toHaveLength(0);

  // 5. An officer who may override approves Riley; the seat is filled and Sam's claim is superseded.
  await signIn(page, 'os-ovr@soma.local');
  await page.goto('/open-shifts');
  const ovr = page.getByRole('form', { name: 'Approve Medic, Riley' });
  await ovr.getByLabel('Override reason').fill('Short staffed that day');
  await ovr.getByRole('button', { name: 'Approve Medic, Riley' }).click();
  await expect(page.getByText('There are no open shifts right now.')).toBeVisible();
  const [asg] = await sql<{ member_id: string; type: string; override_reason: string }[]>`select member_id, type, override_reason from shift_assignments where seat_id = ${seat!.id} and status = 'scheduled'`;
  expect(asg).toEqual({ member_id: riley!.id, type: 'overtime', override_reason: 'Short staffed that day' });
  const statuses = await sql<{ status: string }[]>`select status from open_shift_claims where member_id = ${sam}`;
  expect(statuses[0]!.status).toBe('superseded');

  // 6. A second open shift can be posted and cancelled by the station officer.
  await signIn(page, 'os-home@soma.local');
  await page.goto('/open-shifts');
  const again = page.getByRole('form', { name: 'Post an open shift' });
  await again.getByLabel('Seat').selectOption(seat!.id);
  await again.getByLabel('Date').fill(isoPlus(25));
  await again.getByLabel('Reason').fill('Coverage for training day');
  await again.getByRole('button', { name: 'Post open shift' }).click();
  await expect(page.getByRole('list', { name: 'Open shifts' }).locator(':scope > li')).toHaveCount(1);
  const cancel = page.getByRole('form', { name: /^Cancel / });
  await cancel.getByLabel('Why is it cancelled?').fill('Training moved');
  await cancel.getByRole('button', { name: 'Cancel open shift' }).click();
  await expect(page.getByText('There are no open shifts right now.')).toBeVisible();

  // Leave nothing behind that later specs' roster clean-ups would trip over (filled open shifts reference assignments).
  await sql`delete from open_shifts where seat_id = ${seat!.id}`;
  await sql`delete from shift_assignments where seat_id = ${seat!.id}`;

  // 7. Phone layout.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/open-shifts');
  await page.addStyleTag({ content: 'body, body * { letter-spacing: 0.06em !important; }' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
