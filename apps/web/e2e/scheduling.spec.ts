import { expect, test, type Page } from '@playwright/test';
import { sql } from './db';
import { expectAccessible, loginAdmin } from './helpers';

const TZ = 'America/New_York';
const ANCHOR = Date.UTC(2026, 0, 1);
const DAY = 86_400_000;

/** Today's date in the department's time zone. */
function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function addDays(d: string, n: number): string {
  return new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}

/** First A-platoon day (24/48 anchored 2026-01-01, A offset 0) on or after d. */
function aDayOnOrAfter(d: string): string {
  let x = d;
  while (Math.round((Date.parse(`${x}T00:00:00Z`) - ANCHOR) / DAY) % 3 !== 0) x = addDays(x, 1);
  return x;
}

async function seatId(unit: string, label: string): Promise<string> {
  const [s] = await sql<{ id: string }[]>`
    select s.id from seats s join org_units ou on ou.id = s.org_unit_id
    where ou.name = ${unit} and s.label = ${label} and s.status = 'active'`;
  return s!.id;
}

async function memberId(first: string, last: string): Promise<string> {
  const [m] = await sql<{ id: string }[]>`select id from members where first_name = ${first} and last_name = ${last}`;
  return m!.id;
}

/** Cancels (via SQL) whatever occupies the seat on that local date so the test starts with a vacancy. */
async function vacate(seat: string, date: string): Promise<void> {
  await sql`update shift_assignments set status = 'cancelled', cancelled_reason = 'e2e setup'
            where seat_id = ${seat} and status = 'scheduled'
              and (lower(during) at time zone ${TZ})::date = ${date}::date`;
}

async function openRoster(page: Page, date: string): Promise<void> {
  await page.goto(`/roster?date=${date}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Roster');
}

test('roster shows seats, vacancies and staffing', async ({ page }) => {
  await loginAdmin(page);
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Roster' }).click();
  await expect(page).toHaveURL(/\/roster/);
  await expectAccessible(page);

  // Generate the default range (today → +28 days).
  const gen = page.getByRole('form', { name: 'Generate schedule' });
  await expect(gen.getByLabel('From')).toHaveValue(today());
  await expect(gen.getByLabel('To')).toHaveValue(addDays(today(), 28));
  await gen.getByRole('button', { name: 'Generate' }).click();
  await expect(gen.getByRole('status')).toContainText(/Generated \d+ shifts/);

  // An A-platoon day on which nobody on Engine 1 is on a Kelly day.
  const [row] = await sql<{ d: string }[]>`
    select (lower(a.during) at time zone ${TZ})::date::text as d
    from shift_assignments a
    join seats s on s.id = a.seat_id join org_units ou on ou.id = s.org_unit_id
    join members m on m.id = a.member_id
    where ou.name = 'Engine 1' and a.status = 'scheduled' and m.last_name in ('Ashford', 'Archer', 'Akers')
      and lower(a.during) > now()
    group by 1 having count(*) = 3 order by 1 limit 1`;
  const date = row!.d;

  await openRoster(page, date);
  const engine = page.getByRole('region', { name: 'Engine 1', exact: true });
  await expect(engine.getByRole('row')).toHaveCount(4); // header + 3 seats
  await expect(engine.getByTestId('staffing')).toHaveText('3/3');
  await expect(engine.getByRole('row', { name: /Officer/ })).toContainText('Alex Ashford');
  await expectAccessible(page);

  // Cancel the driver with a reason.
  const driverRow = engine.getByRole('row', { name: /Driver/ });
  await driverRow.getByText('Cancel', { exact: true }).click();
  const cancel = page.getByRole('form', { name: 'Cancel Engine 1 Driver' });
  await cancel.getByLabel('Cancel reason').fill('Sick leave');
  await cancel.getByRole('button', { name: 'Cancel shift' }).click();
  await expect(engine.getByRole('row', { name: /Driver/ })).toContainText('Vacant');
  await expect(engine.getByTestId('staffing')).toHaveText('2/3');
  await expectAccessible(page);

  // Day navigation.
  await page.getByRole('link', { name: 'Next day' }).click();
  await expect(page).toHaveURL(new RegExp(`date=${addDays(date, 1)}`));

  // Mobile: no page-level horizontal scroll.
  await page.setViewportSize({ width: 390, height: 844 });
  await openRoster(page, date);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expectAccessible(page);
});

test('a second fill of the same seat is rejected', async ({ page }) => {
  const date = aDayOnOrAfter(addDays(today(), 3));
  const driver = await seatId('Engine 1', 'Driver');
  await vacate(driver, date);

  await loginAdmin(page);
  await openRoster(page, date);
  const engine = page.getByRole('region', { name: 'Engine 1', exact: true });
  await expect(engine.getByRole('row', { name: /Driver/ })).toContainText('Vacant');

  // Someone else fills the seat after this page loaded.
  const bailey = await memberId('Bailey', 'Boone');
  await sql`insert into shift_assignments (tenant_id, member_id, seat_id, during, type, source)
            select tenant_id, ${bailey}, ${driver},
                   tstzrange((${date}::date + time '07:00') at time zone ${TZ}, (${date}::date + 1 + time '07:00') at time zone ${TZ}),
                   'overtime', 'manual'
            from seats where id = ${driver}`;

  await engine.getByRole('row', { name: /Driver/ }).getByText('Fill', { exact: true }).click();
  const fill = page.getByRole('form', { name: 'Fill Engine 1 Driver' });
  await fill.getByLabel('Member').selectOption(await memberId('Carmen', 'Cruz'));
  await fill.getByLabel('Type').selectOption({ label: 'Overtime' });
  await fill.getByRole('button', { name: 'Fill seat' }).click();
  await expect(fill.getByRole('alert')).toHaveText('That seat is already filled for that time.');
});

test('unqualified fill is blocked, override needs a reason', async ({ page }) => {
  // Casey's paramedic card lapses 20 days after seeding; A days are Casey's (B platoon) days off.
  const date = aDayOnOrAfter(addDays(today(), 22));
  const ffpm = await seatId('Engine 1', 'FF/PM');
  await vacate(ffpm, date);

  await loginAdmin(page);
  await openRoster(page, date);
  const engine = page.getByRole('region', { name: 'Engine 1', exact: true });
  const ffpmRow = engine.getByRole('row', { name: /FF\/PM/ });
  await expect(ffpmRow).toContainText('Vacant');

  await ffpmRow.getByText('Fill', { exact: true }).click();
  const fill = page.getByRole('form', { name: 'Fill Engine 1 FF/PM' });
  await fill.getByLabel('Member').selectOption(await memberId('Casey', 'Expiring'));
  await fill.getByLabel('Type').selectOption({ label: 'Overtime' });
  await fill.getByRole('button', { name: 'Fill seat' }).click();
  const blocked = fill.getByRole('alert');
  await expect(blocked).toContainText('Paramedic expires');
  await expectAccessible(page);

  // Override requires a reason.
  const reason = fill.getByLabel('Override reason');
  await expect(reason).toBeVisible();
  await reason.fill('Only paramedic available; BC approved');
  await fill.getByRole('button', { name: 'Fill seat' }).click();
  await expect(engine.getByRole('row', { name: /FF\/PM/ })).toContainText('Casey Expiring');
  await expect(engine.getByRole('row', { name: /FF\/PM/ })).toContainText('Override');

  await page.goto('/admin/audit?table=shift_assignments');
  await expect(page.getByRole('cell', { name: 'Only paramedic available; BC approved' }).first()).toBeVisible();
  await expectAccessible(page);
});
