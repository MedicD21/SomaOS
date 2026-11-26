import { expect, test, type Page } from '@playwright/test';
import { createAccount, sql } from './db';
import { expectAccessible, login } from './helpers';

async function makeUser(email: string, tenantId: string, perms: string[], scope: 'department' | 'org_unit', unitId: string | null): Promise<string> {
  const userId = await createAccount(email);
  const key = `cs_${email.split('@')[0]}`;
  const [role] = await sql<{ id: string }[]>`insert into roles (tenant_id, key, label) values (${tenantId}, ${key}, ${key}) returning id`;
  for (const p of perms) await sql`insert into role_permissions (tenant_id, role_id, permission) values (${tenantId}, ${role!.id}, ${p})`;
  await sql`insert into memberships (tenant_id, user_id, status) values (${tenantId}, ${userId}, 'active')`;
  const [m] = await sql<{ id: string }[]>`insert into members (tenant_id, user_id, first_name, last_name, employment_type)
    values (${tenantId}, ${userId}, 'Cs', ${email.split('@')[0]!}, 'career_full_time') returning id`;
  await sql`insert into role_grants (tenant_id, member_id, role_id, scope_kind, scope_org_unit_id) values (${tenantId}, ${m!.id}, ${role!.id}, ${scope}, ${unitId})`;
  await sql`update profiles set active_tenant_id = ${tenantId} where user_id = ${userId}`;
  return m!.id;
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await login(page, email);
  await expect(page).toHaveURL('/');
}

test('custody: scope, witnessed transfer and waste, blind count, discrepancy, recall, expiry, audit and phone layout', async ({ page }) => {
  test.setTimeout(300_000);
  const [t] = await sql<{ id: string }[]>`select id from tenants where slug = 'demo-fire-rescue'`;
  const tenantId = t!.id;
  await sql`update tenant_settings set enabled_modules = (select array_agg(distinct x) from unnest(enabled_modules || array['custody']) x) where tenant_id = ${tenantId}`;
  const [typeRow] = await sql<{ id: string }[]>`select id from org_unit_types where tenant_id = ${tenantId} and key = 'station'`;
  const [unitA] = await sql<{ id: string }[]>`insert into org_units (tenant_id, type_id, name) values (${tenantId}, ${typeRow!.id}, 'Cs Station A') returning id`;
  const [unitB] = await sql<{ id: string }[]>`insert into org_units (tenant_id, type_id, name) values (${tenantId}, ${typeRow!.id}, 'Cs Station B') returning id`;
  const recA = await makeUser('cs-rec-a@soma.local', tenantId, ['custody.record'], 'org_unit', unitA!.id);
  await makeUser('cs-wit-a@soma.local', tenantId, ['custody.witness'], 'org_unit', unitA!.id);
  await makeUser('cs-rec-b@soma.local', tenantId, ['custody.record'], 'org_unit', unitB!.id);
  await makeUser('cs-mgr@soma.local', tenantId, ['custody.manage'], 'department', null);
  await makeUser('cs-aud@soma.local', tenantId, ['custody.audit'], 'department', null);

  const [item] = await sql<{ id: string }[]>`insert into cs_items (tenant_id, name, schedule, unit) values (${tenantId}, 'E2E Morphine 10 mg/mL', 'II', 'mL') returning id`;
  const [lotA] = await sql<{ id: string }[]>`insert into cs_lots (tenant_id, item_id, lot_no, expires_on) values (${tenantId}, ${item!.id}, 'E2E-A', current_date + 20) returning id`;
  await sql`insert into cs_lots (tenant_id, item_id, lot_no, expires_on) values (${tenantId}, ${item!.id}, 'E2E-B', current_date + 400)`;
  const loc = async (name: string, kind: string, unit: string) =>
    (await sql<{ id: string }[]>`insert into cs_locations (tenant_id, name, kind, org_unit_id) values (${tenantId}, ${name}, ${kind}, ${unit}) returning id`)[0]!.id;
  const vault = await loc('E2E Vault A', 'vault', unitA!.id);
  const boxA = await loc('E2E Box A', 'drug_box', unitA!.id);
  const boxB = await loc('E2E Box B', 'drug_box', unitB!.id);
  await sql`insert into cs_ledger (tenant_id, location_id, lot_id, delta, type, performed_by, reason) values (${tenantId}, ${vault}, ${lotA!.id}, 10, 'receive', ${recA}, 'seed')`;
  const pick = async (page: Page, form: ReturnType<Page['getByRole']>, label: string, text: string | RegExp) => {
    const opt = form.getByLabel(label).locator('option', { hasText: text }).first();
    await form.getByLabel(label).selectOption(await opt.getAttribute('value') as string);
  };

  // 1. Record officer at Station A: sees only Station A, receives and administers; a transfer into a drug box needs a witness.
  await signIn(page, 'cs-rec-a@soma.local');
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Custody' })).toBeVisible();
  await page.goto(`/custody?location=${vault}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Custody');
  await expect(page.getByRole('note').first()).toContainText('Test mode');
  await expect(page.locator('#cs-location option')).toHaveCount(2);        // Vault A and Box A, never Station B
  await expectAccessible(page);
  const stockList = page.getByRole('list', { name: 'Stock held' });
  await expect(stockList).toContainText('10');

  const receive = page.getByRole('form', { name: 'Receive stock' });
  await pick(page, receive, 'Lot', 'E2E-A');
  await receive.getByLabel('Quantity').fill('5');
  await receive.getByRole('button', { name: 'Receive' }).click();
  await expect(stockList).toContainText('15');

  const administer = page.getByRole('form', { name: 'Record administered' });
  await pick(page, administer, 'Lot', 'E2E-A');
  await administer.getByLabel('Quantity given').fill('2');
  await administer.getByLabel('Incident or run number').fill('x');
  await administer.getByRole('button', { name: 'Record administered' }).click();
  await expect(administer.getByText(/at least 3 characters/)).toBeVisible();
  await administer.getByLabel('Incident or run number').fill('Run 2026-114');
  await administer.getByRole('button', { name: 'Record administered' }).click();
  await expect(stockList).toContainText('13');

  const transfer = page.getByRole('form', { name: 'Transfer stock' });
  await pick(page, transfer, 'To', 'E2E Box A');
  await pick(page, transfer, 'Lot', 'E2E-A');
  await transfer.getByLabel('Quantity').fill('4');
  await transfer.getByRole('button', { name: 'Transfer stock' }).click();
  await expect(transfer.getByRole('alert')).toContainText('A witness is required');
  await pick(page, transfer, 'Witness (if needed)', 'cs-wit-a');
  await transfer.getByRole('button', { name: 'Transfer stock' }).click();
  await expect(transfer.getByRole('status')).toContainText('Witness requested');

  // 2. The requester cannot confirm their own request; the witness can; then the requester completes it.
  await page.goto('/custody/witness');
  await expectAccessible(page);
  const mine = page.getByRole('list', { name: 'My requests' });
  await expect(mine).toContainText('Waiting for the witness');
  await expect(page.getByRole('form', { name: /^Complete / })).toHaveCount(0);
  await expect(page.getByRole('form', { name: /^Confirm / })).toHaveCount(0);

  await signIn(page, 'cs-wit-a@soma.local');
  await page.goto('/custody/witness');
  await expect(page.getByRole('list', { name: 'Requests to witness' })).toContainText('Transfer 4 of E2E Morphine 10 mg/mL lot E2E-A');
  await page.getByRole('form', { name: /^Confirm / }).getByRole('button', { name: 'Confirm I witnessed this' }).click();
  await expect(page.getByText('Nothing is waiting for you.')).toBeVisible();

  await signIn(page, 'cs-rec-a@soma.local');
  await page.goto('/custody/witness');
  await expect(mine).toContainText('Confirmed: ready to complete');
  await page.getByRole('form', { name: /^Complete / }).getByRole('button', { name: 'Complete' }).click();
  await expect(mine).toContainText('Completed');
  const moved = await sql<{ witnessed_by: string | null; location_id: string }[]>`select witnessed_by, location_id from cs_ledger where tenant_id = ${tenantId} and transfer_id is not null`;
  expect(moved).toHaveLength(2);
  expect(moved.every((r) => r.witnessed_by !== null)).toBe(true);

  // 3. A witnessed waste at the box.
  await page.goto(`/custody?location=${boxA}`);
  await expect(page.getByRole('list', { name: 'Stock held' })).toContainText('4');
  const waste = page.getByRole('form', { name: 'Waste' });
  await pick(page, waste, 'Lot', 'E2E-A');
  await waste.getByLabel('Quantity wasted').fill('1');
  await waste.getByLabel('Reason').fill('Dropped vial');
  await pick(page, waste, 'Witness', 'cs-wit-a');
  await waste.getByRole('button', { name: 'Ask a witness' }).click();
  await expect(waste.getByRole('status')).toContainText('Witness requested');
  await signIn(page, 'cs-wit-a@soma.local');
  await page.goto('/custody/witness');
  await page.getByRole('form', { name: /^Confirm / }).getByRole('button', { name: 'Confirm I witnessed this' }).click();
  await expect(page.getByText('Nothing is waiting for you.')).toBeVisible();
  await signIn(page, 'cs-rec-a@soma.local');
  await page.goto('/custody/witness');
  await page.getByRole('form', { name: /^Complete / }).getByRole('button', { name: 'Complete' }).click();
  await expect(mine.getByRole('listitem').first()).toContainText('Completed');
  const [wasted] = await sql<{ performed_by: string; witnessed_by: string }[]>`select performed_by, witnessed_by from cs_ledger where tenant_id = ${tenantId} and type = 'waste'`;
  expect(wasted!.performed_by).toBe(recA);
  expect(wasted!.witnessed_by).not.toBe(recA);

  // 4. A blind count (one short): the page never shows what is expected.
  await page.goto(`/custody/counts?location=${boxA}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Counts');
  await expect(page.locator('main')).not.toContainText(/expected|on hand/i);
  await expectAccessible(page);
  const count = page.getByRole('form', { name: 'Count' });
  await count.getByLabel(/^Counted:/).fill('2');
  await pick(page, count, 'Witness', 'cs-wit-a');
  await count.getByRole('button', { name: 'Ask a witness to confirm the count' }).click();
  await expect(count.getByRole('status')).toContainText('Witness requested');
  await signIn(page, 'cs-wit-a@soma.local');
  await page.goto('/custody/witness');
  await page.getByRole('form', { name: /^Confirm / }).getByRole('button', { name: 'Confirm I witnessed this' }).click();
  await expect(page.getByText('Nothing is waiting for you.')).toBeVisible();
  await signIn(page, 'cs-rec-a@soma.local');
  await page.goto('/custody/witness');
  await page.getByRole('form', { name: /^Complete / }).getByRole('button', { name: 'Complete' }).click();
  await expect(mine.getByRole('listitem').first()).toContainText('Completed');
  const [disc] = await sql<{ id: string; expected: string; counted: string; status: string }[]>`select id, expected, counted, status from cs_discrepancies where tenant_id = ${tenantId}`;
  expect([Number(disc!.expected), Number(disc!.counted), disc!.status]).toEqual([3, 2, 'open']);

  // 5. The counter sees the discrepancy but cannot act on it; a custody manager resolves it with a witnessed adjustment.
  await page.goto('/custody/discrepancies');
  await expectAccessible(page);
  const list = page.getByRole('list', { name: 'Discrepancies' });
  await expect(list).toContainText('Quantity differs at E2E Box A');
  await expect(list).toContainText('expected 3, counted 2');
  await expect(page.getByRole('form', { name: /^Resolve / })).toHaveCount(0);

  await signIn(page, 'cs-mgr@soma.local');
  await page.goto(`/custody?location=${boxA}`);
  await expect(page.getByRole('form', { name: 'Record administered' })).toHaveCount(0);    // manage does not include record
  await page.goto('/custody/discrepancies');
  await page.getByRole('form', { name: /^Investigate / }).getByLabel('What are you looking into?').fill('Checking the run reports');
  await page.getByRole('form', { name: /^Investigate / }).getByRole('button', { name: 'Add investigation note' }).click();
  await expect(list).toContainText('Checking the run reports');
  const resolve = page.getByRole('form', { name: /^Resolve / });
  await resolve.getByLabel('How was it resolved?').fill('Vial confirmed broken; waste form on file');
  await resolve.getByLabel(/^Adjust the balance by/).fill('-1');
  await pick(page, resolve, 'Witness (if needed)', 'cs-wit-a');
  await resolve.getByRole('button', { name: 'Resolve' }).click();
  await expect(resolve.getByRole('status')).toContainText('Witness requested');
  await signIn(page, 'cs-wit-a@soma.local');
  await page.goto('/custody/witness');
  await page.getByRole('form', { name: /^Confirm / }).getByRole('button', { name: 'Confirm I witnessed this' }).click();
  await expect(page.getByText('Nothing is waiting for you.')).toBeVisible();
  await signIn(page, 'cs-mgr@soma.local');
  await page.goto('/custody/witness');
  await page.getByRole('form', { name: /^Complete / }).getByRole('button', { name: 'Complete' }).click();
  await expect(page.getByRole('list', { name: 'My requests' }).getByRole('listitem').first()).toContainText('Completed');
  const [after] = await sql<{ status: string }[]>`select status from cs_discrepancies where id = ${disc!.id}`;
  expect(after!.status).toBe('resolved');
  const [bal] = await sql<{ s: string }[]>`select sum(delta) as s from cs_ledger where location_id = ${boxA}`;
  expect(Number(bal!.s)).toBe(2);

  // 6. A recall takes the lot out of use; expiry and recall lists show it.
  await page.goto('/admin/custody');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Custody');
  await expectAccessible(page);
  const lotItem = page.getByRole('list', { name: 'Lots' }).getByRole('listitem').filter({ hasText: 'E2E-A' });
  await lotItem.getByText('Recall this lot').click();
  await lotItem.getByLabel('Recall details').fill('Manufacturer recall 2026-11');
  await lotItem.getByRole('button', { name: 'Flag as recalled' }).click();
  await expect(lotItem).toContainText('Recalled');
  await signIn(page, 'cs-rec-a@soma.local');
  await page.goto('/custody/expiry?days=30');
  await expectAccessible(page);
  await expect(page.getByRole('list', { name: 'Expiring lots' })).toContainText('E2E-A');
  await expect(page.getByRole('list', { name: 'Recalled lots' })).toContainText('E2E-A');
  await page.goto(`/custody?location=${vault}`);
  await expect(page.getByRole('form', { name: 'Receive stock' }).getByLabel('Lot').locator('option', { hasText: 'E2E-A' })).toHaveCount(0);

  // 7. The auditor reads everything and can act on nothing; the other station sees none of Station A.
  await signIn(page, 'cs-aud@soma.local');
  await page.goto(`/custody?location=${vault}`);
  await expect(page.locator('#cs-location option')).toHaveCount(3);
  await expect(page.getByRole('form', { name: 'Receive stock' })).toHaveCount(0);
  await page.goto(`/custody/${boxA}`);
  await expect(page.getByRole('status').filter({ hasText: 'The record chain verifies' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Custody record' })).toContainText('Wasted 1');
  await expectAccessible(page);

  await signIn(page, 'cs-rec-b@soma.local');
  await page.goto('/custody');
  await expect(page.locator('#cs-location option')).toHaveCount(1);
  await page.goto(`/custody/${boxA}`);
  await expect(page.getByText(/could not be found|404/i).first()).toBeVisible();
  void boxB;

  // 8. Phone layout.
  await signIn(page, 'cs-rec-a@soma.local');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of [`/custody?location=${boxA}`, '/custody/witness', `/custody/counts?location=${boxA}`, '/custody/discrepancies', '/custody/expiry']) {
    await page.goto(path);
    await page.addStyleTag({ content: 'body, body * { letter-spacing: 0.06em !important; }' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), path).toBeLessThanOrEqual(0);
  }
});
