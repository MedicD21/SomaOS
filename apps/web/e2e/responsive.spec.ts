import { expect, test } from '@playwright/test';
import { login } from './helpers';

/**
 * Regression: the department switcher in the header could not wrap, so on a phone it stuck out
 * (13 px in CI, whose fallback font is wider than the one used on dev machines). Letter-spacing
 * widens text the same way on every machine, so this does not depend on installed fonts.
 */
test('header fits a phone for a member of several departments, even with wide text', async ({ page }) => {
  await login(page, 'member@soma.local');
  await expect(page).toHaveURL('/');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/', '/notifications']) {
    await page.goto(path);
    await expect(page.getByLabel('Department')).toBeVisible();
    await page.addStyleTag({ content: 'body, body * { letter-spacing: 0.06em !important; }' });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(0);
  }
});
