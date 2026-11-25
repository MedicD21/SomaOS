import { expect, test, type Page } from '@playwright/test';
import { sql } from './db';
import { expectAccessible, login, loginAdmin } from './helpers';

// Runs after scheduling.spec.ts (file order): the pattern change below moves shift start
// times from 7 days out, which the earlier roster tests do not expect.

const TZ = 'America/New_York';
const ANCHOR = Date.UTC(2026, 0, 1);
const DAY = 86_400_000;

function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function addDays(d: string, n: number): string {
  return new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}

const isADay = (d: string) => Math.round((Date.parse(`${d}T00:00:00Z`) - ANCHOR) / DAY) % 3 === 0;

function aDayOnOrAfter(d: string): string {
  let x = d;
  while (!isADay(x)) x = addDays(x, 1);
  return x;
}

function aDayBefore(d: string): string {
  let x = addDays(d, -1);
  while (!isADay(x)) x = addDays(x, -1);
  return x;
}

async function memberId(first: string, last: string): Promise<string> {
  const [m] = await sql<{ id: string }[]>`select id from members where first_name = ${first} and last_name = ${last}`;
  return m!.id;
}

async function noHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const wide = overflow > 0
    ? await page.evaluate(() => [...document.querySelectorAll('body *')]
        .filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
        .slice(0, 8).map((e) => `${e.tagName}.${e.className} ${e.getBoundingClientRect().right}`))
    : [];
  expect(overflow, `${page.url()} ${JSON.stringify(wide)}`).toBeLessThanOrEqual(0);
}

async function generate(page: Page, from: string, to: string): Promise<void> {
  await page.goto('/roster');
  const gen = page.getByRole('form', { name: 'Generate schedule' });
  await gen.getByLabel('From').fill(from);
  await gen.getByLabel('To').fill(to);
  await gen.getByRole('button', { name: 'Generate' }).click();
  await expect(gen.getByRole('status')).toContainText(/Generated \d+ shifts/);
}

test('admin configures a seat and a credential, then the roster reflects it', async ({ page }) => {
  await loginAdmin(page);

  // 1. Credential type.
  await page.goto('/admin');
  await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Credential types' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Credential types');
  const addType = page.getByRole('form', { name: 'Add credential type' });
  await addType.getByLabel('Label').fill('Hazmat');
  await addType.getByLabel('Key').fill('hazmat');
  await addType.getByLabel('Validity').selectOption({ label: 'Months after issue' });
  await addType.getByLabel('Months').fill('24');
  await addType.getByRole('button', { name: 'Add credential type' }).click();
  await expect(addType.getByRole('status')).toHaveText('Added Hazmat');
  await expect(page.getByRole('row', { name: /Hazmat/ })).toContainText('24 months');
  await expectAccessible(page);

  // 2. Seat on Engine 1 requiring hazmat.
  await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Seats' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Seats');
  const addSeat = page.getByRole('form', { name: 'Add seat' });
  await addSeat.getByLabel('Unit').selectOption({ label: 'Engine 1' });
  await addSeat.getByLabel('Label').fill('Hazmat Tech');
  await addSeat.getByLabel('Order').fill('4');
  await expect(addSeat.getByLabel('Required')).toBeChecked();
  await addSeat.getByRole('button', { name: 'Add requirement group' }).click();
  await addSeat.getByRole('group', { name: 'Requirement group 1' }).getByLabel('Hazmat').check();
  await addSeat.getByRole('button', { name: 'Add seat' }).click();
  await expect(addSeat.getByRole('status')).toHaveText('Added Hazmat Tech');
  const engineSeats = page.getByRole('region', { name: 'Engine 1', exact: true });
  await expect(engineSeats.getByRole('row', { name: /Hazmat Tech/ })).toContainText('Hazmat');
  const [req] = await sql<{ n: number }[]>`
    select count(*)::int as n from seat_requirements r join seats s on s.id = r.seat_id
    join credential_types t on t.id = r.credential_type_id where s.label = 'Hazmat Tech' and t.key = 'hazmat'`;
  expect(req!.n).toBe(1);
  await expectAccessible(page);

  // 3. Corey Chen gets hazmat, issued today; expiry is computed (24 months) and a document attached.
  const corey = await memberId('Corey', 'Chen');
  await page.goto(`/admin/members/${corey}`);
  const addCred = page.getByRole('form', { name: 'Add credential' });
  await addCred.getByLabel('Credential type').selectOption({ label: 'Hazmat' });
  await addCred.getByLabel('Number').fill('HZ-1001');
  await addCred.getByLabel('Issued on').fill(today());
  await addCred.getByRole('button', { name: 'Add credential' }).click();
  await expect(addCred.getByRole('status')).toHaveText('Added Hazmat');
  const credRow = page.getByRole('table', { name: 'Credentials' }).getByRole('row', { name: /Hazmat/ });
  const [y, md] = [today().slice(0, 4), today().slice(4)];
  await expect(credRow).toContainText(`${Number(y) + 2}${md}`);
  await expect(credRow).toContainText('HZ-1001');

  await credRow.getByText('Add document', { exact: true }).click();
  const upload = page.getByRole('form', { name: 'Upload document for Hazmat' });
  await upload.getByLabel('Document').setInputFiles({ name: 'hazmat-card.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% hazmat\n') });
  await upload.getByRole('button', { name: 'Upload' }).click();
  await expect(upload.getByRole('status')).toHaveText('Uploaded hazmat-card.pdf');
  await expect(credRow.getByRole('link', { name: 'hazmat-card.pdf' })).toBeVisible();
  const [att] = await sql<{ sensitivity: string }[]>`
    select a.sensitivity from attachments a join member_credentials c on c.id = a.entity_id
    where a.entity = 'member_credential' and c.member_id = ${corey}`;
  expect(att!.sensitivity).toBe('HR');
  await expectAccessible(page);

  // 4. Generate the next 7 days; Engine 1 now needs 4 and the new seat is vacant.
  await generate(page, today(), addDays(today(), 6));
  const date = aDayOnOrAfter(addDays(today(), 1));
  await page.goto(`/roster?date=${date}`);
  const engine = page.getByRole('region', { name: 'Engine 1', exact: true });
  const staffing = engine.getByTestId('staffing');
  await expect(staffing).toHaveText(/^\d\/4$/);
  const before = Number((await staffing.textContent())!.split('/')[0]);
  const hazRow = engine.getByRole('row', { name: /Hazmat Tech/ });
  await expect(hazRow).toContainText('Vacant');

  // 5. Fill with the newly credentialed member.
  await hazRow.getByText('Fill', { exact: true }).click();
  const fill = page.getByRole('form', { name: 'Fill Engine 1 Hazmat Tech' });
  await fill.getByLabel('Member').selectOption(corey);
  await fill.getByLabel('Type').selectOption({ label: 'Overtime' });
  await fill.getByRole('button', { name: 'Fill seat' }).click();
  await expect(engine.getByRole('row', { name: /Hazmat Tech/ })).toContainText('Corey Chen');
  await expect(staffing).toHaveText(`${before + 1}/4`);
  await expectAccessible(page);

  // Phone layout for the new admin pages.
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/admin/scheduling/seats', '/admin/scheduling/credential-types', `/admin/members/${corey}`]) {
    await page.goto(path);
    await noHorizontalScroll(page);
    await expectAccessible(page);
  }
});

test('a new standing seat ends the current one', async ({ page }) => {
  const corey = await memberId('Corey', 'Chen');
  const from = addDays(today(), 60);
  await loginAdmin(page);
  await page.goto(`/admin/members/${corey}`);
  const form = page.getByRole('form', { name: 'Change standing seat' });
  await form.getByLabel('Seat').selectOption({ label: 'Engine 1 — FF/PM' });
  await form.getByLabel('Platoon').selectOption({ label: 'C Shift' });
  await form.getByLabel('Kelly group').fill('5');
  await form.getByLabel('Effective from').fill(from);
  await form.getByRole('button', { name: 'Save standing seat' }).click();
  await expect(form.getByRole('status')).toContainText(`Standing seat saved from ${from}`);
  const table = page.getByRole('table', { name: 'Standing seats' });
  await expect(table.getByRole('row')).toHaveCount(3);
  await expect(table.getByRole('row').nth(1)).toContainText(`${from}`);
  await expect(table.getByRole('row').nth(1)).toContainText('open');
  await expect(table.getByRole('row').nth(2)).toContainText(addDays(from, -1));
  await expectAccessible(page);
});

test('pattern change takes effect from its date', async ({ page }) => {
  const switchDate = addDays(today(), 7);
  await loginAdmin(page);
  await page.goto('/admin');
  await page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Shift patterns' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Shift patterns');
  const versions = page.getByRole('table', { name: 'Pattern versions' });
  await expect(versions.getByRole('row', { name: /v1/ })).toContainText('approved');

  // Draft v2: 08:00 start.
  const draft = page.getByRole('form', { name: 'Pattern draft' });
  await expect(draft.getByLabel('Start time')).toHaveValue('07:00');
  await expect(draft.getByRole('checkbox', { name: 'Day 1 on duty' })).toBeChecked();
  await expect(draft.getByRole('checkbox', { name: 'Day 2 on duty' })).not.toBeChecked();
  await draft.getByLabel('Start time').fill('08:00');
  await draft.getByRole('button', { name: 'Save draft' }).click();
  await expect(draft.getByRole('status')).toHaveText('Saved draft v2');
  await expect(versions.getByRole('row', { name: /v2/ })).toContainText('draft');
  const preview = page.getByRole('table', { name: /Preview/ });
  await expect(preview).toContainText('08:00');
  await expectAccessible(page);

  // Approving needs a simulation of exactly this draft first.
  const approve = page.getByRole('form', { name: 'Approve pattern' });
  await expect(approve.getByRole('button', { name: 'Approve v2' })).toBeDisabled();
  const sim = page.getByRole('form', { name: 'Simulate the draft pattern' });
  await sim.getByRole('button', { name: 'Simulate draft v2' }).click();
  await expect(sim.getByRole('status')).toContainText('Simulated draft v2');
  await expect(page.getByTestId('simulation-result')).toContainText('days added');
  await expect(page.getByTestId('simulation-result')).toContainText('Approving would withdraw');
  await expect(approve.getByRole('button', { name: 'Approve v2' })).toBeEnabled();

  // Approval cannot precede the current version.
  await approve.getByLabel('Effective from').fill('2025-06-01');
  await approve.getByRole('button', { name: 'Approve v2' }).click();
  await expect(approve.getByRole('alert')).toContainText('after');

  await approve.getByLabel('Effective from').fill(switchDate);
  await approve.getByRole('button', { name: 'Approve v2' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Approved v2' })).toContainText(`Approved v2 effective ${switchDate}`);
  await expect(versions.getByRole('row', { name: /v1/ })).toContainText(`to ${addDays(switchDate, -1)}`);
  await expect(versions.getByRole('row', { name: /v2/ })).toContainText(`from ${switchDate}`);
  await expect(versions.getByRole('row', { name: /v2/ })).toContainText('approved');

  // No old-time generated shift survives on or after the switch.
  const [stale] = await sql<{ n: number }[]>`
    select count(*)::int as n from shift_assignments
    where source = 'generated' and status = 'scheduled' and pattern_version = 1
      and (lower(during) at time zone ${TZ})::date >= ${switchDate}::date`;
  expect(stale!.n).toBe(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await noHorizontalScroll(page);
  await expectAccessible(page);
  await page.setViewportSize({ width: 1280, height: 720 });

  // Regenerate across the switch.
  await generate(page, today(), addDays(today(), 13));

  const beforeDay = aDayBefore(switchDate);
  const afterDay = aDayOnOrAfter(switchDate);
  await page.context().clearCookies();
  await login(page, 'member@soma.local');
  await expect(page).toHaveURL('/');
  for (const [d, time] of [[beforeDay, '07:00'], [afterDay, '08:00']] as const) {
    await page.goto(`/schedule?month=${d.slice(0, 7)}`);
    const cell = page.getByRole('table', { name: /My schedule/ }).locator(`[data-shift][data-date="${d}"]`);
    await expect(cell).toHaveCount(1);
    await expect(cell).toContainText(`${time}–${time}`);
  }
});
