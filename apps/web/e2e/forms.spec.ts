import { expect, test, type Page } from '@playwright/test';
import { createAccount, sql } from './db';
import { expectAccessible, login, loginAdmin } from './helpers';

const SLOW = { timeout: 30_000 };

async function addOfficer(email: string, first: string, last: string, tenantId: string, unitId: string): Promise<void> {
  const userId = await createAccount(email);
  const key = `forms_${email.split('@')[0]}`;
  const [role] = await sql<{ id: string }[]>`insert into roles (tenant_id, key, label) values (${tenantId}, ${key}, ${key}) returning id`;
  await sql`insert into role_permissions (tenant_id, role_id, permission) values (${tenantId}, ${role!.id}, 'forms.approve')`;
  await sql`insert into memberships (tenant_id, user_id, status) values (${tenantId}, ${userId}, 'active')`;
  const [m] = await sql<{ id: string }[]>`insert into members (tenant_id, user_id, first_name, last_name, employment_type)
    values (${tenantId}, ${userId}, ${first}, ${last}, 'career_full_time') returning id`;
  await sql`insert into role_grants (tenant_id, member_id, role_id, scope_kind, scope_org_unit_id) values (${tenantId}, ${m!.id}, ${role!.id}, 'org_unit', ${unitId})`;
  await sql`update profiles set active_tenant_id = ${tenantId} where user_id = ${userId}`;
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await login(page, email);
  await expect(page).toHaveURL('/');
}

async function draw(page: Page): Promise<void> {
  const canvas = page.getByRole('img', { name: /Signature drawing area/ });
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + 40);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + 30 + i * 20, box.y + 40 + (i % 2 ? 30 : -10));
  await page.mouse.up();
}

test('fill, sign (typed and drawn), approve, return and correct, verify; officers outside the station see nothing; form builder', async ({ page }) => {
  test.setTimeout(240_000);
  const [t] = await sql<{ id: string }[]>`select id from tenants where slug = 'demo-fire-rescue'`;
  const tenantId = t!.id;
  await sql`update profiles set active_tenant_id = ${tenantId} where user_id = (select id from auth.users where email = 'member@soma.local')`;
  const [home] = await sql<{ org_unit_id: string }[]>`
    select s.org_unit_id from standing_seats ss join seats s on s.id = ss.seat_id join members m on m.id = ss.member_id
    join auth.users u on u.id = m.user_id where u.email = 'member@soma.local' and m.tenant_id = ${tenantId}`;
  const [typeRow] = await sql<{ id: string }[]>`select id from org_unit_types where tenant_id = ${tenantId} and key = 'station'`;
  const [elsewhere] = await sql<{ id: string }[]>`insert into org_units (tenant_id, type_id, name) values (${tenantId}, ${typeRow!.id}, 'Forms Test Elsewhere') returning id`;
  await addOfficer('forms-in@soma.local', 'Ida', 'Inside', tenantId, home!.org_unit_id);
  await addOfficer('forms-out@soma.local', 'Otto', 'Outside', tenantId, elsewhere!.id);

  // 1. Riley fills in the injury report; a follow-up question appears when "injured" is Yes; signs by typing.
  await signIn(page, 'member@soma.local');
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Forms' })).toBeVisible();
  await page.goto('/forms');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Forms');
  await expectAccessible(page);
  await page.getByRole('link', { name: 'Incident / Injury Report' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Incident / Injury Report');
  const form = page.getByRole('form', { name: 'Fill in Incident / Injury Report' });
  await expect(form.getByLabel(/Who was injured and how/)).toHaveCount(0);
  await form.getByLabel('Date of incident (required)').fill('2026-11-02');
  await form.getByLabel('Location (required)').fill('Station 1 apparatus bay');
  await form.getByLabel('What happened (required)').fill('Slipped on a wet floor');
  const injured = form.getByRole('group', { name: 'Was anyone injured? (required)' });
  await injured.getByLabel('Yes').check();
  await form.getByLabel(/Who was injured and how/).fill('Twisted ankle');
  await form.getByRole('group', { name: 'Supervisor notified? (required)' }).getByLabel('Yes').check();
  await expectAccessible(page);
  await form.getByRole('button', { name: 'Submit' }).click();
  await expect(form.getByRole('alert')).toContainText('Type your full name');     // signing is required
  await form.getByLabel('Type your full name to sign').fill('Riley Medic');
  await form.getByRole('button', { name: 'Submit' }).click();
  await expect(form.getByRole('status')).toHaveText('Submitted.', SLOW);

  // 2. A second form signed by drawing.
  await page.goto('/forms/vehicle_damage_report');
  const vform = page.getByRole('form', { name: 'Fill in Vehicle Damage Report' });
  await vform.getByLabel('Date of incident (required)').fill('2026-11-03');
  await vform.getByLabel('Vehicle or unit (required)').fill('Engine 1');
  await vform.getByLabel('Driver (required)').fill('Riley Medic');
  await vform.getByLabel('Location (required)').fill('Main St');
  await vform.getByLabel('Description of the damage (required)').fill('Scraped the mirror on a gate');
  await vform.getByRole('group', { name: 'Another vehicle involved? (required)' }).getByLabel('No').check();
  await vform.getByRole('group', { name: 'Police report filed? (required)' }).getByLabel('No').check();
  await vform.getByLabel('Draw').check();
  await draw(page);
  await expectAccessible(page);
  await vform.getByRole('button', { name: 'Submit' }).click();
  await expect(vform.getByRole('status')).toHaveText('Submitted.', SLOW);

  await page.goto('/forms');
  const mine = page.getByRole('list', { name: 'My submissions' });
  await expect(mine.getByRole('listitem')).toHaveCount(2);
  await expect(mine).toContainText('Incident / Injury Report');

  // 3. An officer outside the station sees nothing waiting.
  await signIn(page, 'forms-out@soma.local');
  await page.goto('/forms');
  await expect(page.getByText('Nothing is waiting for you.')).toBeVisible();

  // 4. The officer at Riley's station returns the injury report and approves the damage report.
  await signIn(page, 'forms-in@soma.local');
  await page.goto('/forms');
  const pending = page.getByRole('list', { name: 'Waiting for approval' });
  await expect(pending.getByRole('listitem')).toHaveCount(2);
  await pending.getByRole('link', { name: 'Incident / Injury Report' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Incident / Injury Report');
  await expect(page.getByText('Twisted ankle')).toBeVisible();
  await expect(page.getByTestId('verify-result')).toContainText('Intact');
  await expectAccessible(page);
  const ret = page.getByRole('form', { name: /^Return Incident/ });
  await ret.getByRole('button', { name: 'Return for correction' }).click();
  await expect(ret.getByText(/at least 5 characters/)).toBeVisible();
  await ret.getByLabel('What needs to be fixed?').fill('Add the unit number');
  await ret.getByRole('button', { name: 'Return for correction' }).click();
  await expect(page.getByRole('list', { name: 'Decisions' })).toContainText('Returned for correction', SLOW);

  await page.goto('/forms');
  await page.getByRole('list', { name: 'Waiting for approval' }).getByRole('link', { name: 'Vehicle Damage Report' }).click();
  await expect(page.getByRole('img', { name: /Drawn signature of Riley Medic/ })).toBeVisible();
  await page.getByRole('form', { name: /^Approve Vehicle/ }).getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('list', { name: 'Decisions' })).toContainText('Approved', SLOW);

  // 5. Riley corrects the returned report; the original is marked as corrected.
  await signIn(page, 'member@soma.local');
  await page.goto('/forms');
  await expect(page.getByRole('list', { name: 'My submissions' })).toContainText('Returned for correction');
  await page.getByRole('list', { name: 'My submissions' }).getByRole('listitem').filter({ hasText: 'Returned for correction' }).getByRole('link').click();
  await expect(page.getByRole('list', { name: 'Decisions' })).toContainText('Add the unit number');
  await page.getByRole('link', { name: 'Correct and resubmit' }).click();
  const fix = page.getByRole('form', { name: 'Fill in Incident / Injury Report' });
  await expect(fix.getByLabel('What happened (required)')).toHaveValue('Slipped on a wet floor');
  await expect(page.getByText('Add the unit number')).toBeVisible();
  await fix.getByLabel('What happened (required)').fill('Slipped on a wet floor in the apparatus bay at Unit 4');
  await fix.getByLabel('Type your full name to sign').fill('Riley Medic');
  await fix.getByRole('button', { name: 'Submit correction' }).click();
  await expect(fix.getByRole('status')).toHaveText('Submitted.', SLOW);
  await page.goto('/forms');
  await expect(page.getByRole('list', { name: 'My submissions' })).toContainText('Corrected by a newer submission');

  // 6. A form manager builds, previews, publishes and the member sees a new form; old versions are kept.
  await page.context().clearCookies();
  await loginAdmin(page);
  await page.goto('/admin/form-definitions');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Form builder');
  await expect(page.getByRole('list', { name: 'Forms' })).toContainText('Incident / Injury Report');
  await page.getByRole('link', { name: 'Create a new form' }).click();
  const builder = page.getByRole('form', { name: 'Save form definition' });
  await builder.getByLabel('Form name').fill('Station Visitor Log');
  await builder.getByRole('button', { name: 'Add a field' }).click();
  await builder.getByLabel('Field 1 label').fill('Visitor name');
  await builder.getByLabel('Required').check();
  await builder.getByRole('button', { name: 'Add a field' }).click();
  await builder.getByLabel('Field 2 label').fill('Purpose of visit');
  await builder.getByLabel('Type').nth(1).selectOption('select');
  await builder.getByLabel('Options').fill('Tour\nDelivery\nInspection');
  await expect(page.getByRole('region', { name: 'Preview' }).getByLabel('Visitor name (required)')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Preview' }).getByLabel('Purpose of visit')).toBeVisible();
  await expectAccessible(page);
  await builder.getByRole('button', { name: 'Save as new draft version' }).click();
  await expect(builder.getByRole('status')).toContainText('Saved draft version 1 of Station Visitor Log', SLOW);
  await page.goto('/admin/form-definitions');
  const entry = page.getByRole('list', { name: 'Forms' }).getByRole('listitem').filter({ hasText: 'Station Visitor Log' }).first();
  await expect(entry).toContainText('Draft');
  await entry.getByRole('form', { name: /^Publish Station Visitor Log/ }).getByRole('button', { name: 'Publish version 1' }).click();
  await expect(entry).toContainText('Published', SLOW);

  await signIn(page, 'member@soma.local');
  await page.goto('/forms');
  await expect(page.getByRole('list', { name: 'Available forms' })).toContainText('Station Visitor Log', SLOW);

  // 7. Phone layout, including the signature pad.
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/forms', '/forms/incident_injury_report', '/forms/vehicle_damage_report']) {
    await page.goto(path);
    if (path.endsWith('vehicle_damage_report')) await page.getByLabel('Draw').check();
    await page.addStyleTag({ content: 'body, body * { letter-spacing: 0.06em !important; }' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), path).toBeLessThanOrEqual(0);
  }
});
