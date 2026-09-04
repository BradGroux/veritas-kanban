import { expect, test } from '@playwright/test';
import { bypassAuth, cleanupRoutes } from './helpers/auth';

test.use({ viewport: { width: 320, height: 844 }, isMobile: true, hasTouch: true });
test.beforeEach(async ({ page }) => bypassAuth(page));
test.afterEach(async ({ page }) => cleanupRoutes(page));

test('loaded dashboard status preserves the mobile viewport and chat entry', async ({ page }) => {
  await page.goto('/');
  await page.addStyleTag({ content: ':root { font-size: 20px !important; }' });
  const dashboard = page.getByRole('region', { name: 'Board dashboard', exact: true });
  await dashboard.scrollIntoViewIfNeeded();
  const updated = dashboard.getByText(/^Updated \d/);
  await expect(updated).toBeVisible();
  const status = updated.locator('..');
  await expect(status.getByText('Enforcement', { exact: true })).toBeVisible();
  await expect(status.locator(':scope > div')).toHaveCount(2);
  expect(
    await status.evaluate((row) => {
      const rect = row.getBoundingClientRect();
      return [...row.children].every((child) => {
        const box = child.getBoundingClientRect();
        return box.left >= rect.left && box.right <= rect.right;
      });
    })
  ).toBe(true);
  expect(await page.evaluate(() => [innerWidth, document.documentElement.scrollWidth])).toEqual([
    320, 320,
  ]);

  await page.evaluate(() => window.scrollTo(0, 0));
  const trigger = page.getByRole('button', { name: 'Open chat', exact: true });
  await trigger.click();
  const composer = page.getByRole('textbox', { name: 'Message Board Chat', exact: true });
  await composer.fill('Unsent dashboard draft');
  const close = page.getByRole('button', { name: 'Close Board Chat panel', exact: true });
  await close.click();
  await expect(composer).not.toBeVisible();
  expect(await page.evaluate(() => [innerWidth, document.documentElement.scrollWidth])).toEqual([
    320, 320,
  ]);
  await expect(trigger).toBeInViewport({ ratio: 1 });
  await trigger.click();
  await expect(composer).toHaveValue('Unsent dashboard draft');
  await close.click();
});
