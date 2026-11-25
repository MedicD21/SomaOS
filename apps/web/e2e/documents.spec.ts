import { expect, test, type Page } from '@playwright/test';
import { sql } from './db';
import { expectAccessible, login, loginAdmin } from './helpers';

const SLOW = { timeout: 30_000 };
const pdf = (text: string) => ({ name: `${text}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF\n`) });

async function signIn(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await login(page, email);
  await expect(page).toHaveURL('/');
}

test('upload, publish, assign, acknowledge, major revision, restricted folder', async ({ page }) => {
  test.setTimeout(180_000);
  await sql`update profiles set active_tenant_id = (select id from tenants where slug = 'demo-fire-rescue')
            where user_id = (select id from auth.users where email = 'member@soma.local')`;

  // 1. The chief creates an SOG that members must acknowledge.
  await loginAdmin(page);
  await page.goto('/documents');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Documents');
  const folders = page.getByRole('list', { name: 'Folders', exact: true });
  await expect(folders).toContainText('Policies and SOGs');
  await expect(folders.getByRole('listitem').filter({ hasText: 'HR' }).first()).toContainText('Restricted');
  await expectAccessible(page);

  const create = page.getByRole('form', { name: 'New document' });
  await create.getByLabel('Title').fill('Vehicle Fires');
  await create.getByLabel('Folder').selectOption({ label: 'Policies and SOGs' });
  await create.getByLabel('Kind').selectOption('sog');
  await create.getByLabel('Number (optional)').fill('SOG 3.4');
  await create.getByLabel('Members must acknowledge reading it').check();
  await create.getByRole('button', { name: 'Add document' }).click();
  await expect(create.getByRole('status')).toHaveText('Created Vehicle Fires', SLOW);

  await page.getByRole('link', { name: 'Vehicle Fires' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Vehicle Fires');

  // 2. Upload version 1.0 as a draft, then publish it.
  const upload = page.getByRole('form', { name: 'Upload new version' });
  await upload.getByLabel('File').setInputFiles(pdf('vehicle-fires-1'));
  await upload.getByLabel('Version label').fill('1.0');
  await upload.getByRole('button', { name: 'Upload as draft' }).click();
  await expect(upload.getByRole('status')).toContainText('Added draft version 1.0', SLOW);
  const versions = page.getByRole('list', { name: 'Versions' });
  await expect(versions.getByRole('listitem').first()).toContainText('Draft');
  await versions.getByText('Publish this version').click();
  await page.getByRole('form', { name: 'Publish version 1.0' }).getByRole('button', { name: 'Publish 1.0' }).click();
  await expect(versions.getByRole('listitem').first()).toContainText('Published', SLOW);
  await expectAccessible(page);

  // 3. Assign it to everyone.
  await versions.getByText('Assign required reading').click();
  const assign = page.getByRole('form', { name: 'Assign reading of 1.0' });
  await assign.getByLabel('Everyone in the department').check();
  await assign.getByRole('button', { name: 'Assign reading' }).click();
  const readings = page.getByRole('list', { name: 'Readings' });
  await expect(readings.getByRole('listitem').first()).toContainText(/Version 1\.0: 0 of \d+ acknowledged/, SLOW);

  // 4. A member sees it under required reading and acknowledges.
  await signIn(page, 'member@soma.local');
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'SOGs' })).toBeVisible();
  await page.goto('/sogs');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('SOGs and required reading');
  const todo = page.getByRole('list', { name: 'Required reading to do' });
  await expect(todo.getByRole('listitem')).toContainText('Vehicle Fires');
  await expect(todo.getByRole('link', { name: 'Open the document' })).toHaveAttribute('href', /^\/files\//);
  await expectAccessible(page);
  await todo.getByRole('form', { name: 'Acknowledge Vehicle Fires' }).getByRole('button', { name: 'Acknowledge' }).click();
  await expect(page.getByText('You are all caught up.')).toBeVisible(SLOW);
  await expect(page.getByRole('list', { name: 'Acknowledged reading' })).toContainText('Vehicle Fires, version 1.0');

  // 5. The chief sees who has read it.
  await page.context().clearCookies();
  await loginAdmin(page);
  await page.goto('/sogs');
  const status = page.getByRole('list', { name: 'Reading status' });
  await expect(status).toContainText(/1 of \d+ acknowledged/);
  await status.getByText(/Not yet acknowledged/).click();
  await expect(status).not.toContainText('Medic, Riley');

  // 6. A major revision opens a new reading; the old acknowledgement stays as history.
  await page.goto('/documents');
  await page.getByRole('link', { name: 'Vehicle Fires' }).click();
  const up2 = page.getByRole('form', { name: 'Upload new version' });
  await up2.getByLabel('File').setInputFiles(pdf('vehicle-fires-2'));
  await up2.getByLabel('Version label').fill('2.0');
  await up2.getByLabel('What changed (optional)').fill('New ventilation steps');
  await up2.getByRole('button', { name: 'Upload as draft' }).click();
  await expect(up2.getByRole('status')).toContainText('Added draft version 2.0', SLOW);
  const list2 = page.getByRole('list', { name: 'Versions' });
  await list2.getByRole('listitem').filter({ hasText: 'Version 2.0' }).getByText('Publish this version').click();
  const pub2 = page.getByRole('form', { name: 'Publish version 2.0' });
  await pub2.getByLabel('Major revision — members must read it again').check();
  await pub2.getByRole('button', { name: 'Publish 2.0' }).click();
  await expect(list2.getByRole('listitem').filter({ hasText: 'Version 1.0' })).toContainText('Superseded', SLOW);
  await expect(page.getByRole('list', { name: 'Readings' }).getByRole('listitem')).toHaveCount(2, SLOW);

  await signIn(page, 'member@soma.local');
  await page.goto('/sogs');
  await expect(page.getByRole('list', { name: 'Required reading to do' })).toContainText('Version 2.0', SLOW);
  await expect(page.getByRole('list', { name: 'Acknowledged reading' })).toContainText('Vehicle Fires, version 1.0');

  // 7. The restricted HR folder is invisible to a member; the library shows the published SOG.
  await page.goto('/documents');
  const memberFolders = page.getByRole('list', { name: 'Folders', exact: true });
  await expect(memberFolders).toContainText('Policies and SOGs');
  await expect(memberFolders).toContainText('Vehicle Fires');
  await expect(memberFolders.getByRole('heading', { name: 'HR' })).toHaveCount(0);
  await expect(page.getByRole('form', { name: 'New document' })).toHaveCount(0);
  await expectAccessible(page);

  // 8. Phone layout.
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/documents', '/sogs']) {
    await page.goto(path);
    await page.addStyleTag({ content: 'body, body * { letter-spacing: 0.06em !important; }' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), path).toBeLessThanOrEqual(0);
  }
});
