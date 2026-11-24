import { expect, test } from '@playwright/test';
import { sql } from './db';
import { expectAccessible, loginAdmin } from './helpers';

test.beforeAll(async () => {
  const [t] = await sql<{ id: string }[]>`select id from tenants where slug = 'demo-fire-rescue'`;
  const types = await sql<{ id: string; key: string }[]>`select id, key from org_unit_types where tenant_id = ${t!.id}`;
  const typeId = (k: string) => types.find((x) => x.key === k)!.id;
  const [bat] = await sql<{ id: string }[]>`
    insert into org_units (tenant_id, type_id, name) values (${t!.id}, ${typeId('battalion')}, 'People Battalion') returning id`;
  await sql`insert into org_units (tenant_id, type_id, parent_id, name) values (${t!.id}, ${typeId('station')}, ${bat!.id}, 'People Station')`;
});

test('members, custom fields, roles, scoped grants, access check and audit', async ({ page }) => {
  await loginAdmin(page);

  // Custom field
  await page.goto('/admin/custom-fields');
  await expectAccessible(page);
  const cf = page.getByRole('form', { name: 'Add custom field' });
  await cf.getByLabel('Label').fill('Badge Number');
  await cf.getByLabel('Type').selectOption({ label: 'Text' });
  await cf.getByLabel('Required').check();
  await cf.getByRole('button', { name: 'Add field' }).click();
  await expect(page.getByRole('cell', { name: 'Badge Number', exact: true })).toBeVisible();

  // Member — custom field is required
  await page.goto('/admin/members');
  await expectAccessible(page);
  const add = page.getByRole('form', { name: 'Add member' });
  await add.getByLabel('First name').fill('Jordan');
  await add.getByLabel('Last name').fill('Lee');
  await add.getByLabel('Employment type').selectOption({ label: 'Career full-time' });
  await add.getByRole('button', { name: 'Add member' }).click();
  await expect(add.getByText('Required')).toBeVisible();
  await add.getByLabel('Badge Number').fill('B-77');
  await add.getByRole('button', { name: 'Add member' }).click();
  await expect(page.getByRole('link', { name: 'Lee, Jordan' })).toBeVisible();

  // Assignment
  await page.getByRole('link', { name: 'Lee, Jordan' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lee, Jordan');
  const asg = page.getByRole('form', { name: 'Add assignment' });
  await asg.getByLabel('Org unit').selectOption({ label: 'People Station' });
  await asg.getByLabel('Shift').selectOption({ label: 'B Shift' });
  await asg.getByLabel('Effective from').fill('2026-01-01');
  await asg.getByRole('button', { name: 'Add assignment' }).click();
  await expect(page.getByRole('cell', { name: 'People Station' })).toBeVisible();
  await expectAccessible(page);

  // Role
  await page.goto('/admin/roles');
  await expectAccessible(page);
  const role = page.getByRole('form', { name: 'Add role' });
  await role.getByLabel('Label').fill('Shift Scheduler');
  await role.getByLabel('View members').check();
  await role.getByRole('button', { name: 'Add role' }).click();
  await expect(page.getByRole('heading', { name: 'Shift Scheduler' })).toBeVisible();

  // Grant scoped to battalion + B shift, time-bound
  await page.goto('/admin/grants');
  await expectAccessible(page);
  const grant = page.getByRole('form', { name: 'Add grant' });
  await grant.getByLabel('Member').selectOption({ label: 'Lee, Jordan' });
  await grant.getByLabel('Role').selectOption({ label: 'Shift Scheduler' });
  await grant.getByLabel('Scope').selectOption({ label: 'Org unit and below' });
  await grant.getByLabel('Org unit').selectOption({ label: 'People Battalion' });
  await grant.getByLabel('Shift').selectOption({ label: 'B Shift' });
  await grant.getByLabel('Ends').fill('2027-01-01');
  await grant.getByRole('button', { name: 'Add grant' }).click();
  await expect(grant.getByRole('status')).toHaveText('Grant added');

  // Explain
  const why = page.getByRole('form', { name: 'Check access' });
  await why.getByLabel('Member').selectOption({ label: 'Lee, Jordan' });
  await why.getByLabel('Permission').selectOption({ label: 'View members' });
  await why.getByLabel('Org unit').selectOption({ label: 'People Station' });
  await why.getByLabel('Shift').selectOption({ label: 'B Shift' });
  await why.getByRole('button', { name: 'Check' }).click();
  await expect(why.getByRole('status')).toHaveText('allowed by role shift_scheduler (org_unit)');
  await why.getByLabel('Shift').selectOption({ label: 'C Shift' });
  await why.getByRole('button', { name: 'Check' }).click();
  await expect(why.getByRole('status')).toHaveText('no active grant for admin.members.view covering target');

  // Last admin protection
  await page.getByRole('form', { name: 'Revoke Department Admin from Admin, Dana' }).getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'cannot remove last admin' })).toBeVisible();

  // Audit
  await page.goto('/admin/audit?table=members');
  await expectAccessible(page);
  await expect(page.getByRole('cell', { name: 'Lee, Jordan' }).first()).toBeVisible();
});
