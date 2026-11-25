import { expect, test, type Page } from '@playwright/test';
import { createAccount, sql } from './db';
import { expectAccessible, login, loginAdmin } from './helpers';

async function makeOfficer(email: string, unitId: string, tenantId: string, perms: string[]): Promise<void> {
  const userId = await createAccount(email);
  const key = `inv_${email.split('@')[0]}`;
  const [role] = await sql<{ id: string }[]>`insert into roles (tenant_id, key, label) values (${tenantId}, ${key}, ${key}) returning id`;
  for (const p of perms) await sql`insert into role_permissions (tenant_id, role_id, permission) values (${tenantId}, ${role!.id}, ${p})`;
  await sql`insert into memberships (tenant_id, user_id, status) values (${tenantId}, ${userId}, 'active')`;
  const [m] = await sql<{ id: string }[]>`insert into members (tenant_id, user_id, first_name, last_name, employment_type)
    values (${tenantId}, ${userId}, 'Ozzie', ${email.split('@')[0]!}, 'career_full_time') returning id`;
  await sql`insert into role_grants (tenant_id, member_id, role_id, scope_kind, scope_org_unit_id) values (${tenantId}, ${m!.id}, ${role!.id}, 'org_unit', ${unitId})`;
  await sql`update profiles set active_tenant_id = ${tenantId} where user_id = ${userId}`;
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await login(page, email);
  await expect(page).toHaveURL('/');
}

const OFFICER_PERMS = ['inventory.asset.view', 'inventory.asset.event', 'inventory.check.perform', 'inventory.stock.view', 'inventory.stock.use'];

test('assets, rig checks and stock: scope, history, versions, ledger, low stock, a11y and phone layout', async ({ page }) => {
  test.setTimeout(240_000);
  const [t] = await sql<{ id: string }[]>`select id from tenants where slug = 'demo-fire-rescue'`;
  const tenantId = t!.id;
  await sql`update profiles set active_tenant_id = ${tenantId} where user_id = (select id from auth.users where email = 'member@soma.local')`;
  const [typeRow] = await sql<{ id: string }[]>`select id from org_unit_types where tenant_id = ${tenantId} and key = 'station'`;
  const [unitA] = await sql<{ id: string }[]>`insert into org_units (tenant_id, type_id, name) values (${tenantId}, ${typeRow!.id}, 'Inv Station A') returning id`;
  const [unitB] = await sql<{ id: string }[]>`insert into org_units (tenant_id, type_id, name) values (${tenantId}, ${typeRow!.id}, 'Inv Station B') returning id`;
  await makeOfficer('inv-a@soma.local', unitA!.id, tenantId, OFFICER_PERMS);
  await makeOfficer('inv-b@soma.local', unitB!.id, tenantId, OFFICER_PERMS);

  // 1. An admin adds a required asset field, then an asset (the field is enforced).
  await loginAdmin(page);
  await page.goto('/admin/custom-fields?entity=asset');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Custom fields');
  const field = page.getByRole('form', { name: 'Add custom field' });
  await field.getByLabel('Label').fill('Fleet number');
  await field.getByLabel('Required').check();
  await field.getByRole('button', { name: 'Add field' }).click();
  await expect(page.getByRole('table').getByText('fleet_number')).toBeVisible();

  await page.goto('/assets');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Assets');
  const add = page.getByRole('form', { name: 'Add asset' });
  await add.getByLabel('Type').selectOption({ label: 'Apparatus (engine, ambulance, ...)' });
  await add.getByLabel('Name').fill('Engine 7');
  await add.getByLabel('Station').selectOption({ label: 'Inv Station A' });
  await add.getByRole('button', { name: 'Add asset' }).click();
  await expect(add.getByText('Required')).toBeVisible();
  await add.getByLabel('Fleet number').fill('F-107');
  await add.getByRole('button', { name: 'Add asset' }).click();
  const list = page.getByRole('list', { name: 'Assets' });
  await expect(list.getByRole('listitem').filter({ hasText: 'Engine 7' })).toContainText('Inv Station A');
  await expectAccessible(page);
  const assetUrl = await list.getByRole('link', { name: 'Engine 7' }).getAttribute('href');

  // 2. The officer at Station A takes it out of service (a reason is required); the officer at Station B can see it but not change it.
  await signIn(page, 'inv-a@soma.local');
  await page.goto(assetUrl!);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Engine 7');
  const status = page.getByRole('form', { name: 'Change status' });
  await status.getByLabel('New status').selectOption({ label: 'Out of service' });
  await status.getByRole('button', { name: 'Change status' }).click();
  await expect(status.getByText(/at least 5 characters/)).toBeVisible();
  await status.getByLabel('Reason').fill('Pump failed inspection');
  await status.getByRole('button', { name: 'Change status' }).click();
  await expect(page.getByText('Out of service', { exact: false }).first()).toBeVisible();
  const history = page.getByRole('list', { name: 'Asset history' });
  await expect(history.getByRole('listitem').first()).toContainText('In service → Out of service — Pump failed inspection');
  await expectAccessible(page);

  await signIn(page, 'inv-b@soma.local');
  await page.goto(assetUrl!);
  const bStatus = page.getByRole('form', { name: 'Change status' });
  await bStatus.getByLabel('New status').selectOption({ label: 'In service' });
  await bStatus.getByRole('button', { name: 'Change status' }).click();
  await expect(bStatus.getByRole('alert')).toContainText('cannot log events');

  // 3. A member completes the Daily Truck Check with a failed item; it shows on the asset, and editing the checklist keeps the old version.
  await signIn(page, 'member@soma.local');
  await page.goto('/checks');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Checks');
  await page.getByRole('link', { name: 'Start Daily Truck Check' }).click();
  const check = page.getByRole('form', { name: 'Complete Daily Truck Check' });
  await check.getByLabel('Unit being checked').selectOption({ label: 'Engine 7 — Inv Station A' });
  await check.getByRole('button', { name: 'Submit check' }).click();
  await expect(check.getByRole('alert')).toBeVisible();
  for (const label of ['Exterior, tires and lights', 'Fluids (oil, coolant, washer) and fuel', 'Cab, seat belts and mirrors', 'Radios and mobile data terminal',
    'SCBA / air packs present and charged', 'Cardiac monitor and oxygen present', 'Cot and straps', 'Medical bags stocked and sealed']) {
    await check.getByLabel(label).selectOption(label.startsWith('Radios') ? 'fail' : 'pass');
  }
  await expectAccessible(page);
  await check.getByRole('button', { name: 'Submit check' }).click();
  await expect(check.getByRole('status')).toHaveText('Check recorded');
  await page.goto('/checks');
  const recent = page.getByRole('list', { name: 'Recent checks' });
  await expect(recent.locator(':scope > li').first()).toContainText('Engine 7');
  await expect(recent.locator(':scope > li').first()).toContainText('1 failed');
  await expect(recent.locator(':scope > li').first()).toContainText('Radios and mobile data terminal: fail');
  await page.goto(assetUrl!);
  await expect(page.getByRole('list', { name: 'Asset history' }).getByRole('listitem').first()).toContainText('1 item(s) failed');
  // The failed check did not change the status.
  await expect(page.getByText('Out of service').first()).toBeVisible();

  await page.context().clearCookies();
  await loginAdmin(page);
  await page.goto('/admin/checklists');
  await expectAccessible(page);
  const edit = page.getByRole('form', { name: 'Edit Daily Truck Check' });
  const current = await edit.getByLabel('Items').inputValue();
  await edit.getByLabel('Items').fill(`${current}\nWindshield and wipers | pass_fail`);
  await edit.getByRole('button', { name: 'Save as new version' }).click();
  await expect(page.getByRole('heading', { name: 'Daily Truck Check (version 2)' })).toBeVisible();
  await page.goto('/checks');
  await expect(page.getByRole('list', { name: 'Recent checks' }).locator(':scope > li').first()).toContainText('(v1)');

  // 4. Stock: an admin sets up a station location, par and receives; the member uses stock; low stock appears and clears.
  await page.goto('/admin/inventory');
  await expectAccessible(page);
  const loc = page.getByRole('form', { name: 'Add location' });
  await loc.getByLabel('Name').fill('Inv Station A supply');
  await loc.getByLabel('Station (optional)').selectOption({ label: 'Inv Station A' });
  await loc.getByRole('button', { name: 'Add location' }).click();
  await expect(page.getByRole('list', { name: 'Locations' })).toContainText('Inv Station A supply');
  const [loca] = await sql<{ id: string }[]>`select id from stock_locations where tenant_id = ${tenantId} and name = 'Inv Station A supply'`;

  await page.goto(`/inventory?location=${loca!.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Inventory');
  await page.getByRole('form', { name: 'Set par level' }).getByLabel('Item').selectOption({ label: 'Gauze 4x4 (pack)' });
  await page.getByRole('form', { name: 'Set par level' }).getByLabel('Par (target)').fill('12');
  await page.getByRole('form', { name: 'Set par level' }).getByLabel('Critical at or below').fill('2');
  await page.getByRole('form', { name: 'Set par level' }).getByRole('button', { name: 'Set par' }).click();
  await expect(page.getByRole('form', { name: 'Set par level' }).getByRole('status')).toHaveText('Par set to 12');
  const receive = page.getByRole('form', { name: 'Receive stock' });
  await receive.getByLabel('Item').selectOption({ label: 'Gauze 4x4 (pack)' });
  await receive.getByLabel('Quantity').fill('10');
  await receive.getByRole('button', { name: 'Receive stock' }).click();
  await expect(receive.getByRole('status')).toHaveText('Received 10');
  const low = page.getByRole('list', { name: 'Low stock' });
  await expect(low).toContainText('Gauze 4x4 (pack) at Inv Station A supply: 10 of 12 (short 2)');

  await signIn(page, 'member@soma.local');
  await page.goto(`/inventory?location=${loca!.id}`);
  await expectAccessible(page);
  const use = page.getByRole('form', { name: 'Use stock' });
  await use.getByLabel('Item').selectOption({ label: 'Gauze 4x4 (pack)' });
  await use.getByLabel('Quantity').fill('100');
  await use.getByRole('button', { name: 'Use stock' }).click();
  await expect(use.getByRole('alert')).toContainText('Not enough stock');
  await use.getByLabel('Quantity').fill('3');
  await use.getByRole('button', { name: 'Use stock' }).click();
  await expect(page.getByRole('list', { name: 'Stock levels' }).getByRole('listitem').filter({ hasText: 'Gauze 4x4 (pack)' })).toContainText('7 on hand');
  await expect(page.getByRole('list', { name: 'Low stock' })).toContainText('7 of 12 (short 5)');
  await expect(page.getByRole('form', { name: 'Receive stock' })).toHaveCount(0);

  await page.context().clearCookies();
  await loginAdmin(page);
  await page.goto(`/inventory?location=${loca!.id}`);
  const rcv = page.getByRole('form', { name: 'Receive stock' });
  await rcv.getByLabel('Item').selectOption({ label: 'Gauze 4x4 (pack)' });
  await rcv.getByLabel('Quantity').fill('5');
  await rcv.getByRole('button', { name: 'Receive stock' }).click();
  await expect(page.getByText('Nothing is below par.')).toBeVisible();
  const ledger = await sql<{ type: string; delta: number }[]>`select type, delta::float8 as delta from stock_ledger where location_id = ${loca!.id} order by occurred_at`;
  expect(ledger.map((l) => [l.type, l.delta])).toEqual([['receive', 10], ['use', -3], ['receive', 5]]);

  // 5. Phone layout.
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/assets', assetUrl!, '/checks', `/inventory?location=${loca!.id}`]) {
    await page.goto(path);
    await page.addStyleTag({ content: 'body, body * { letter-spacing: 0.06em !important; }' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), path).toBeLessThanOrEqual(0);
  }
});

test('a member without inventory permissions sees no inventory navigation and is refused the pages', async ({ page }) => {
  await sql`update profiles set active_tenant_id = (select id from tenants where slug = 'demo-fire-rescue')
            where user_id = (select id from auth.users where email = 'member@soma.local')`;
  await sql`delete from role_permissions where role_id in (select id from roles where key = 'member') and permission like 'inventory.%'`;
  try {
    await signIn(page, 'member@soma.local');
    const nav = page.getByRole('navigation', { name: 'Main' });
    for (const name of ['Assets', 'Checks', 'Inventory']) await expect(nav.getByRole('link', { name })).toHaveCount(0);
    for (const path of ['/assets', '/checks', '/inventory', '/admin/assets']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: 'Not allowed' })).toBeVisible();
    }
  } finally {
    await sql`insert into role_permissions (tenant_id, role_id, permission)
              select r.tenant_id, r.id, p from roles r, unnest(array['inventory.asset.view','inventory.check.perform','inventory.stock.view','inventory.stock.use']) p
              where r.key = 'member' on conflict do nothing`;
  }
});
