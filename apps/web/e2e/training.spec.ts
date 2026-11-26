import { expect, test, type Page } from '@playwright/test';
import { createAccount, sql } from './db';
import { expectAccessible, login } from './helpers';

const TZ = 'America/New_York';
const DAY = 86_400_000;
const localDate = (offsetDays: number) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(Date.now() + offsetDays * DAY));

async function addPerson(email: string, first: string, last: string, tenantId: string, perms: string[], unitId: string | null = null): Promise<string> {
  const userId = await createAccount(email);
  const roleKey = `trn_${email.split('@')[0]}`;
  const [role] = await sql<{ id: string }[]>`insert into roles (tenant_id, key, label) values (${tenantId}, ${roleKey}, ${roleKey}) returning id`;
  for (const p of perms) await sql`insert into role_permissions (tenant_id, role_id, permission) values (${tenantId}, ${role!.id}, ${p})`;
  await sql`insert into memberships (tenant_id, user_id, status) values (${tenantId}, ${userId}, 'active')`;
  const [m] = await sql<{ id: string }[]>`insert into members (tenant_id, user_id, first_name, last_name, employment_type)
    values (${tenantId}, ${userId}, ${first}, ${last}, 'career_full_time') returning id`;
  await sql`insert into role_grants (tenant_id, member_id, role_id, scope_kind, scope_org_unit_id)
            values (${tenantId}, ${m!.id}, ${role!.id}, ${unitId ? 'org_unit' : 'department'}, ${unitId})`;
  await sql`update profiles set active_tenant_id = ${tenantId} where user_id = ${userId}`;
  return m!.id;
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await login(page, email);
  await expect(page).toHaveURL('/');
}

async function scheduleSession(page: Page, o: { title: string; date: string; time: string; hours: string; capacity?: string; rank?: string; publish: boolean }): Promise<void> {
  await page.goto('/training');
  const form = page.getByRole('form', { name: 'Schedule a session' });
  await form.getByLabel('Course').selectOption({ label: 'CPR renewal' });
  await form.getByLabel('Title').fill(o.title);
  await form.getByLabel('Date').fill(o.date);
  await form.getByLabel('Start time').fill(o.time);
  await form.getByLabel('Length in hours').fill(o.hours);
  if (o.capacity) await form.getByLabel('Capacity').fill(o.capacity);
  if (o.rank) await form.getByLabel('Required: ranks').selectOption({ label: o.rank });
  if (o.publish) await form.getByLabel('Publish now').check();
  await form.getByRole('button', { name: 'Save session' }).click();
  await expect(form.getByRole('status')).toContainText(o.publish ? 'Published' : 'Saved');
}

test('officer schedules, members sign up and wait, attendance completes and renews a credential, compliance, roster, cancel, scope', async ({ page }) => {
  test.setTimeout(180_000);
  const [t] = await sql<{ id: string }[]>`select id from tenants where slug = 'demo-fire-rescue'`;
  const tenantId = t!.id;
  await sql`update profiles set active_tenant_id = ${tenantId} where user_id = (select id from auth.users where email = 'member@soma.local')`;

  // Riley (member@) has a rank; the training module data comes from the template applied to the demo department.
  const [riley] = await sql<{ id: string }[]>`select m.id from members m join auth.users u on u.id = m.user_id where u.email = 'member@soma.local' and m.tenant_id = ${tenantId}`;
  const [rank] = await sql<{ id: string; label: string }[]>`select id, label from ranks where tenant_id = ${tenantId} order by sort desc limit 1`;
  await sql`update members set rank_id = ${rank!.id} where id = ${riley!.id}`;
  const [home] = await sql<{ seat_id: string }[]>`select ss.seat_id from standing_seats ss where ss.member_id = ${riley!.id}`;
  // Cancel (not delete): other specs' trades and claims reference these rows. Cancelled rows free the overlap rule.
  await sql`update shift_assignments set status = 'cancelled', cancelled_reason = 'training e2e setup' where member_id = ${riley!.id} and status = 'scheduled' and lower(during) > now() - interval '10 days'`;
  await sql`delete from member_credentials where member_id = ${riley!.id} and type_id = (select id from credential_types where tenant_id = ${tenantId} and key = 'cpr')`;

  const [type] = await sql<{ id: string }[]>`select id from org_unit_types where tenant_id = ${tenantId} and key = 'station'`;
  const [elsewhere] = await sql<{ id: string }[]>`insert into org_units (tenant_id, type_id, name) values (${tenantId}, ${type!.id}, 'Training Test Elsewhere') returning id`;
  await addPerson('trainer@soma.local', 'Tess', 'Trainer', tenantId,
    ['training.course.view', 'training.course.manage', 'training.session.view', 'training.session.manage', 'training.attendance.manage',
     'training.compliance.view', 'credentials.manage', 'scheduling.roster.edit']);
  await addPerson('sam-learner@soma.local', 'Sam', 'Learner', tenantId, ['training.course.view', 'training.session.view']);
  await addPerson('train-other@soma.local', 'Olly', 'Other', tenantId, ['training.course.view', 'training.session.view', 'training.session.manage'], elsewhere!.id);

  // 1. The trainer schedules a future class (capacity 1, required for Riley's rank) and a past class, plus a draft.
  await signIn(page, 'trainer@soma.local');
  await scheduleSession(page, { title: 'E2E CPR tomorrow', date: localDate(1), time: '10:00', hours: '2', capacity: '1', rank: rank!.label, publish: true });
  await scheduleSession(page, { title: 'E2E CPR past', date: localDate(-3), time: '09:00', hours: '4', rank: rank!.label, publish: true });
  await scheduleSession(page, { title: 'E2E draft only', date: localDate(5), time: '10:00', hours: '1', publish: false });
  await expectAccessible(page);

  // 2. Riley is required (enrolled); Sam signs up and goes on the waitlist because the class is full.
  await signIn(page, 'member@soma.local');
  await page.goto('/training');
  const mine = page.getByRole('list', { name: 'My classes' });
  await expect(mine).toContainText('E2E CPR tomorrow');
  await expect(page.getByRole('list', { name: 'Upcoming sessions' })).not.toContainText('E2E draft only');
  expect((await sql`select 1 from notifications where member_id = ${riley!.id} and title like 'Required training:%'`).length).toBeGreaterThan(0);

  await signIn(page, 'sam-learner@soma.local');
  await page.goto('/training');
  const tomorrow = page.getByRole('list', { name: 'Upcoming sessions' }).getByRole('listitem').filter({ hasText: 'E2E CPR tomorrow' });
  await tomorrow.getByRole('button', { name: 'Sign up' }).click();
  await expect(tomorrow).toContainText('You are on the waitlist');

  // 3. An officer at another station cannot see the trainer's draft.
  await signIn(page, 'train-other@soma.local');
  await page.goto('/training');
  await expect(page.getByRole('list', { name: 'Upcoming sessions' })).toContainText('E2E CPR tomorrow');
  await expect(page.getByRole('list', { name: 'Upcoming sessions' })).not.toContainText('E2E draft only');

  // 4. Roster link: Riley already works during the class, so he is skipped with the reason.
  const [future] = await sql<{ id: string; starts_at: Date; ends_at: Date }[]>`select id, starts_at, ends_at from training_sessions where title = 'E2E CPR tomorrow'`;
  await sql`insert into shift_assignments (tenant_id, member_id, seat_id, during, type, source)
            values (${tenantId}, ${riley!.id}, ${home!.seat_id}, tstzrange(${new Date(future!.starts_at.getTime() - 3_600_000).toISOString()}, ${new Date(future!.ends_at.getTime() + 3_600_000).toISOString()}), 'regular', 'manual')`;
  await signIn(page, 'trainer@soma.local');
  await page.goto(`/training/${future!.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('E2E CPR tomorrow');
  const roster = page.getByRole('list', { name: 'Enrolled members' });
  await expect(roster).toContainText('Medic, Riley');
  await expect(roster).toContainText('Learner, Sam');
  await expectAccessible(page);
  await page.getByRole('form', { name: 'Schedule on roster' }).getByRole('button', { name: 'Schedule on roster' }).click();
  await expect(page.getByRole('form', { name: 'Schedule on roster' }).getByRole('status')).toContainText('already scheduled during that time');
  expect((await sql`select 1 from shift_assignments where member_id = ${riley!.id} and type = 'training'`).length).toBe(0);

  // 5. Cancelling tells everyone enrolled or waiting.
  const cancel = page.getByRole('form', { name: 'Cancel session' });
  await cancel.getByLabel('Why is it cancelled?').fill('Instructor unavailable');
  await cancel.getByRole('button', { name: 'Cancel session' }).click();
  await expect(page.getByText('Cancelled — Instructor unavailable')).toBeVisible();
  expect((await sql`select 1 from notifications where member_id = ${riley!.id} and title like 'Training cancelled:%'`).length).toBe(1);

  // 6. The past class: mark everyone present, preview the credential, complete.
  const [past] = await sql<{ id: string }[]>`select id from training_sessions where title = 'E2E CPR past'`;
  await page.goto(`/training/${past!.id}`);
  await page.getByRole('form', { name: 'Mark everyone present' }).getByRole('button', { name: 'Present for all' }).click();
  await expect(page.getByRole('list', { name: 'Enrolled members' })).toContainText('Attended · 4 h');
  await expect(page.getByRole('list', { name: 'Credentials to award' })).toContainText('Medic, Riley');
  await expectAccessible(page);
  await page.getByRole('form', { name: 'Complete session' }).getByRole('button', { name: 'Complete and award' }).click();
  await expect(page.getByRole('list', { name: 'Enrolled members' })).toContainText('Credential granted');
  const [cred] = await sql<{ issued_on: string; ok: boolean }[]>`
    select c.issued_on::text, (c.expires_on = c.issued_on + interval '24 months') as ok
    from member_credentials c join training_awards w on w.credential_id = c.id where w.session_id = ${past!.id} and c.member_id = ${riley!.id}`;
  expect(cred).toBeTruthy();
  expect(cred!.ok).toBe(true);
  expect(cred!.issued_on).toBe(localDate(-3));

  // 7. Compliance: Riley's four hours meet a 4 h requirement for his rank and fall short of a 10 h one for everyone.
  const year = new Date().getUTCFullYear();
  const [ems] = await sql<{ id: string }[]>`select id from training_categories where tenant_id = ${tenantId} and key = 'ems'`;
  await sql`insert into training_requirements (tenant_id, label, category_id, rank_id, required_hours, span, effective_from, effective_to)
            values (${tenantId}, 'E2E rank hours', ${ems!.id}, ${rank!.id}, 4, ${sql.json({ kind: 'calendar_year' })}, ${`${year - 1}-01-01`}, ${`${year}-12-31`}),
                   (${tenantId}, 'E2E everyone hours', ${ems!.id}, null, 10, ${sql.json({ kind: 'calendar_year' })}, ${`${year - 1}-01-01`}, ${`${year}-12-31`})`;
  await page.goto('/training/compliance');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Training compliance');
  const list = page.getByRole('list', { name: 'Compliance' });
  await expect(list.getByRole('listitem').filter({ hasText: 'E2E rank hours' }).filter({ hasText: 'Medic, Riley' })).toContainText('Met');
  await expect(list.getByRole('listitem').filter({ hasText: 'E2E everyone hours' }).filter({ hasText: 'Medic, Riley' })).toContainText('4 of 10 h');
  await expectAccessible(page);
  const csv = await page.request.get('/training/compliance/export');
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain('E2E rank hours');

  // 8. Admin page, and a plain member has no compliance view.
  await page.goto('/admin/training');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Training');
  await expectAccessible(page);
  await signIn(page, 'sam-learner@soma.local');
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Compliance' })).toHaveCount(0);
  await page.goto('/training/compliance');
  await expect(page.getByRole('heading', { name: 'Not allowed' })).toBeVisible();
  expect((await page.request.get('/training/compliance/export')).status()).toBe(403);

  // 9. Phone layout.
  await signIn(page, 'trainer@soma.local');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/training', `/training/${past!.id}`, '/training/compliance', '/admin/training']) {
    await page.goto(path);
    await page.addStyleTag({ content: 'body, body * { letter-spacing: 0.06em !important; }' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), path).toBeLessThanOrEqual(0);
  }
});
