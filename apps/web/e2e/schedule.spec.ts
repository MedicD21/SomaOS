import { expect, test } from '@playwright/test';
import { expectAccessible, login, loginAdmin } from './helpers';

const TZ = 'America/New_York';
const ANCHOR = Date.UTC(2026, 0, 1);
const DAY = 86_400_000;

function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** Next calendar month relative to today (department zone): its key, first day and last day. */
function nextMonth(): { key: string; first: string; last: string; days: string[] } {
  const [y, m] = today().split('-').map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m, 1));
  const end = new Date(Date.UTC(y, m + 1, 0));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const days: string[] = [];
  for (let d = new Date(first); d <= end; d = new Date(d.getTime() + DAY)) days.push(iso(d));
  return { key: iso(first).slice(0, 7), first: iso(first), last: iso(end), days };
}

test('member sees their month: A-platoon shifts every third day, Kelly day labelled', async ({ page }) => {
  const month = nextMonth();

  // An admin generates the month first (the seed creates no assignments).
  await loginAdmin(page);
  await page.goto('/roster');
  const gen = page.getByRole('form', { name: 'Generate schedule' });
  await gen.getByLabel('From').fill(month.first);
  await gen.getByLabel('To').fill(new Date(Date.parse(`${month.last}T00:00:00Z`) + DAY).toISOString().slice(0, 10));
  await gen.getByRole('button', { name: 'Generate' }).click();
  await expect(gen.getByRole('status')).toContainText(/Generated \d+ shifts/);

  await page.context().clearCookies();
  await login(page, 'member@soma.local');
  await expect(page).toHaveURL('/');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'My schedule' }).click();
  await expect(page).toHaveURL(/\/schedule/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('My schedule');

  await page.goto(`/schedule?month=${month.key}`);
  const table = page.getByRole('table', { name: /My schedule/ });
  await expect(table).toBeVisible();

  const offset = (d: string) => Math.round((Date.parse(`${d}T00:00:00Z`) - ANCHOR) / DAY);
  const expectedDates = month.days.filter((d) => offset(d) % 3 === 0);
  const expectedKelly = expectedDates.filter((d) => (offset(d) / 3) % 9 === 0);
  expect(expectedKelly.length).toBeGreaterThan(0);

  const dates = await table.locator('[data-shift]').evaluateAll((els) => els.map((e) => e.getAttribute('data-date')));
  expect(dates).toEqual(expectedDates);
  const kelly = await table.locator('[data-shift][data-kelly]').evaluateAll((els) => els.map((e) => e.getAttribute('data-date')));
  expect(kelly).toEqual(expectedKelly);
  await expect(table.getByText('Kelly day').first()).toBeVisible();
  await expect(table.getByText('Medic 1').first()).toBeVisible();
  await expect(table.getByText(/\b24 h\b/).first()).toBeVisible();
  await expectAccessible(page);

  // Invalid month falls back to the current month.
  await page.goto('/schedule?month=nope');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('My schedule');

  // Phone: list layout, no page-level horizontal scroll.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/schedule?month=${month.key}`);
  await expect(table).toBeHidden();
  const list = page.getByRole('list', { name: /Shifts in/ });
  await expect(list).toBeVisible();
  await expect(list.getByRole('listitem')).toHaveCount(expectedDates.length);
  await expect(list.getByText('Kelly day').first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expectAccessible(page);
});
