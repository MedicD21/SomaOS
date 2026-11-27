import { expect, test, type Page } from '@playwright/test';
import { createAccount, sql } from './db';
import { expectAccessible, login } from './helpers';

// Uses dates ~300 days out and its own unit type so other specs' rosters and the demo units are not involved.
const isoPlus = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const D1 = isoPlus(300);
const D2 = isoPlus(301);
const D3 = isoPlus(302);

async function addPerson(email: string, first: string, last: string, tenantId: string, perms: string[]): Promise<string> {
  const userId = await createAccount(email);
  const roleKey = `md_${email.split('@')[0]!.replace(/\W/g, '_')}`;
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

test('staffing flags, TT suggestion, mandate list edit, reorder, mandate and rotation', async ({ page }) => {
  test.setTimeout(150_000);
  const [t] = await sql<{ id: string }[]>`select id from tenants where slug = 'demo-fire-rescue'`;
  const tenantId = t!.id;
  await sql`update profiles set active_tenant_id = ${tenantId} where user_id = (select id from auth.users where email = 'member@soma.local')`;

  // Two ambulances of a dedicated unit type, three seats each.
  const [type] = await sql<{ id: string }[]>`
    insert into org_unit_types (tenant_id, key, label, sort) values (${tenantId}, 'e2e_ambulance', 'E2E ambulance', 99)
    on conflict (tenant_id, key) do update set label = excluded.label returning id`;
  const unit = async (name: string) =>
    (await sql<{ id: string }[]>`insert into org_units (tenant_id, type_id, name) values (${tenantId}, ${type!.id}, ${name}) returning id`)[0]!.id;
  const seat = async (unitId: string, label: string, sort: number) =>
    (await sql<{ id: string }[]>`insert into seats (tenant_id, org_unit_id, label, sort) values (${tenantId}, ${unitId}, ${label}, ${sort}) returning id`)[0]!.id;
  const unitA = await unit('Mandate Medic A');
  const unitB = await unit('Mandate Medic B');
  const seatsA = [await seat(unitA, 'Seat 1', 1), await seat(unitA, 'Seat 2', 2), await seat(unitA, 'Seat 3', 3)];
  const seatsB = [await seat(unitB, 'Seat 1', 1), await seat(unitB, 'Seat 2', 2), await seat(unitB, 'Seat 3', 3)];

  const [para] = await sql<{ id: string }[]>`select id from credential_types where tenant_id = ${tenantId} and key = 'paramedic'`;
  const [emt] = await sql<{ id: string }[]>`select id from credential_types where tenant_id = ${tenantId} and key = 'emt'`;
  const member = async (first: string, last: string, credType: string) => {
    const [m] = await sql<{ id: string }[]>`insert into members (tenant_id, first_name, last_name, employment_type)
      values (${tenantId}, ${first}, ${last}, 'career_full_time') returning id`;
    await sql`insert into member_credentials (tenant_id, member_id, type_id, issued_on, expires_on)
              values (${tenantId}, ${m!.id}, ${credType}, current_date - 30, current_date + 900)`;
    return m!.id;
  };
  const p1 = await member('Pia', 'Onduty', para!.id);
  const p2 = await member('Pat', 'Onduty', para!.id);
  const p3 = await member('Poe', 'Onduty', para!.id);
  const p4 = await member('Pax', 'Onduty', para!.id);
  const e1 = await member('Eli', 'Onduty', emt!.id);
  const ann = await member('Ann', 'Alpha', para!.id);
  const ben = await member('Ben', 'Beta', para!.id);
  const cy = await member('Cy', 'Gamma', emt!.id);

  // Same crews on D1 and D2: A has 3 ALS, B has 1 ALS + 1 EMT and a vacant seat.
  for (const d of [D1, D2]) {
    const crew: [string, string][] = [[p1, seatsA[0]!], [p2, seatsA[1]!], [p3, seatsA[2]!], [p4, seatsB[0]!], [e1, seatsB[1]!]];
    for (const [m, s] of crew) {
      await sql`insert into shift_assignments (tenant_id, member_id, seat_id, during, type, source)
                values (${tenantId}, ${m}, ${s}, tstzrange((${d}::date + time '11:00') at time zone 'UTC', (${d}::date + 1 + time '11:00') at time zone 'UTC'), 'regular', 'manual')`;
    }
  }

  // Approved rules for one day each: D1 needs 4 ALS (met, so a TT is suggested), D2 needs 5 (one short, so mandate).
  const rules = (min: number) => ({
    groups: [{ key: 'als', label: 'ALS', credentialKeys: ['paramedic', 'aemt'] }],
    departmentMinimums: [{ group: 'als', min }],
    unitRules: [{ group: 'als', unitTypeKey: 'e2e_ambulance', min: 2 }],
  });
  for (const [d, min] of [[D1, 4], [D2, 5]] as const) {
    await sql`insert into config_versions (tenant_id, kind, key, version, status, effective, payload, approved_at)
              select ${tenantId}, 'staffing.rules', 'default',
                     (select coalesce(max(version), 0) + 1 from config_versions where tenant_id = ${tenantId} and kind = 'staffing.rules'),
                     'approved',
                     tstzrange((${d}::date)::timestamp at time zone tz.timezone, (${d}::date + 1)::timestamp at time zone tz.timezone),
                     ${sql.json(rules(min))}, now()
              from tenants tz where tz.id = ${tenantId}`;
  }

  await addPerson('md-cap@soma.local', 'Cass', 'Captain', tenantId, ['scheduling.roster.view', 'scheduling.roster.edit', 'scheduling.mandate.manage']);

  // 1. Roster on D1: department met, Medic B flagged, TT from A to B suggested.
  await signIn(page, 'md-cap@soma.local');
  await page.goto(`/roster?date=${D1}`);
  const banner = page.getByRole('region', { name: 'Minimum staffing' });
  await expect(banner.getByTestId('dept-als')).toHaveText('4/4');
  await expect(banner).toContainText('Mandate Medic B has 1 ALS; at least 2 required');
  await expect(page.getByTestId('tt-suggestions')).toContainText('from Mandate Medic A to Mandate Medic B');
  await expect(page.getByRole('region', { name: 'Mandate Medic B' }).getByTestId('unit-als')).toHaveText('1/2');

  // 2. Roster on D2: one short, no TT, pointer to the mandate list.
  await page.goto(`/roster?date=${D2}`);
  await expect(banner.getByTestId('dept-als')).toHaveText('4/5');
  await expect(page.getByTestId('tt-suggestions')).toHaveCount(0);
  await expect(banner.getByRole('link', { name: 'mandate list' })).toBeVisible();

  // 3. Create a list and add four members.
  await page.goto(`/mandate?date=${D2}`);
  const create = page.getByRole('form', { name: 'Create a mandate list' });
  await create.getByLabel('List name').fill(`E2E ALS ${Date.now()}`);
  await create.getByRole('button', { name: 'Create list' }).click();
  await expect(page).toHaveURL(/list=/);
  const listId = new URL(page.url()).searchParams.get('list')!;
  await page.goto(`/mandate?list=${listId}&date=${D2}`);
  for (const id of [p1, ann, ben, cy]) {
    const add = page.getByRole('form', { name: 'Add a member to the list' });
    await add.getByLabel('Member').selectOption(id);
    await add.getByRole('button', { name: 'Add to bottom' }).click();
    await expect(add.getByLabel('Member').locator(`option[value="${id}"]`)).toHaveCount(0);
  }
  const rows = page.getByRole('list', { name: 'Mandate order' }).getByTestId('mandate-row');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('Already working');
  await expect(rows.nth(1)).toContainText('Next up');
  await expect(rows.nth(3)).toContainText('Not qualified');
  await expect(page.getByRole('status').filter({ hasText: 'Next up: Alpha, Ann.' })).toBeVisible();
  await expectAccessible(page);

  // 4. Exempt Ann: Ben becomes next up.
  await rows.nth(1).getByText('Change Alpha, Ann').click();
  const exempt = page.getByRole('form', { name: 'Exempt Alpha, Ann' });
  await exempt.getByLabel('Exemption reason').fill('Light duty until cleared');
  await exempt.getByRole('button', { name: 'Exempt' }).click();
  await expect(rows.nth(1)).toContainText('Light duty until cleared');
  await expect(rows.nth(2)).toContainText('Next up');

  // 5. Move Ben above Ann with the buttons and save with a reason.
  await page.getByRole('button', { name: 'Move Beta, Ben up' }).click();
  const save = page.getByRole('form', { name: 'Save the new order' });
  await save.getByLabel('Why is the order changing?').fill('Seniority order for 2027');
  await save.getByRole('button', { name: 'Save order' }).click();
  await expect(rows.nth(1)).toContainText('Beta, Ben');
  await expect(rows.nth(1)).toContainText('Next up');

  // 6. Mandate the next member up into Medic B's vacant seat; Ben rotates to the bottom.
  const mandate = page.getByRole('form', { name: 'Mandate a member' });
  await expect(mandate.getByLabel('Member')).toHaveValue(ben);
  await mandate.getByLabel('Vacant seat').selectOption(seatsB[2]!);
  await mandate.getByLabel('Date').fill(D2);
  await mandate.getByLabel('Start time').fill('06:00');
  await mandate.getByLabel('Hours').fill('24');
  await mandate.getByLabel('Note (optional)').fill('Department at 4 of 5 ALS');
  await mandate.getByRole('button', { name: 'Mandate' }).click();
  await expect(rows.nth(3)).toContainText('Beta, Ben');
  await expect(rows.nth(3)).toContainText('Already working');
  const history = page.getByRole('table');
  await expect(history).toContainText('Mandated');
  await expect(history).toContainText('Seniority order for 2027');
  await expect(history).toContainText('Light duty until cleared');
  const [asg] = await sql<{ type: string }[]>`
    select type from shift_assignments where member_id = ${ben} and seat_id = ${seatsB[2]!} and status = 'scheduled'`;
  expect(asg?.type).toBe('overtime');

  // 7. A member with roster view sees the list read-only.
  await signIn(page, 'member@soma.local');
  await page.goto(`/mandate?list=${listId}&date=${D2}`);
  await expect(page.getByRole('list', { name: 'Mandate order' }).getByTestId('mandate-row')).toHaveCount(4);
  await expect(page.getByRole('button', { name: /^Move / })).toHaveCount(0);
  await expect(page.getByRole('form', { name: 'Mandate a member' })).toHaveCount(0);

  // Phone layout.
  await page.setViewportSize({ width: 390, height: 844 });
  await expectAccessible(page);

  // Tidy up rows another spec could count (far-future dates, own unit type).
  await sql`update shift_assignments set status = 'cancelled', cancelled_reason = 'e2e cleanup'
            where seat_id = any (${[...seatsA, ...seatsB]}::uuid[]) and lower(during) >= (${D1}::date)::timestamp at time zone 'UTC'
              and lower(during) < (${D3}::date + 1)::timestamp at time zone 'UTC'`;
});
