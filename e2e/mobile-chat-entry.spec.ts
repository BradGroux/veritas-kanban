import { expect, test } from '@playwright/test';
import { bypassAuth, cleanupRoutes, deleteTask, seedTestTask } from './helpers/auth';

test.use({ viewport: { width: 320, height: 844 }, isMobile: true, hasTouch: true });
test.beforeEach(async ({ page }) => bypassAuth(page));
test.afterEach(async ({ page }) => cleanupRoutes(page));

test('mobile chat entry does not cover task content', async ({ page }, testInfo) => {
  const task = await seedTestTask(page, { title: 'Readable task summary', type: 'code' });
  try {
    await page.goto('/');
    await page.addStyleTag({ content: ':root { font-size: 20px !important; }' });
    const title = page.getByRole('heading', { name: 'Readable task summary', exact: true });
    await expect(title).toBeVisible();
    const trigger = page.getByRole('button', { name: 'Open chat', exact: true });
    await expect(trigger).toBeVisible();
    const overlaps = await title.evaluate((el) => {
      const titleBox = el.getBoundingClientRect();
      const chatBox = document.querySelector('[aria-label="Open chat"]')!.getBoundingClientRect();
      return (
        Math.min(titleBox.right, chatBox.right) > Math.max(titleBox.left, chatBox.left) &&
        Math.min(titleBox.bottom, chatBox.bottom) > Math.max(titleBox.top, chatBox.top)
      );
    });
    expect(overlaps).toBe(false);
    const surface = page.locator('[data-mobile-navigation-surface]');
    for (const top of [0, 180, 450, 800]) {
      await page.evaluate((y) => window.scrollTo(0, y), top);
      expect(
        await trigger.evaluate((el) => {
          const rect = el.getBoundingClientRect();
          const bar = el.closest('[data-mobile-navigation-surface]')!.getBoundingClientRect();
          return (
            rect.top >= bar.top &&
            rect.bottom <= bar.bottom &&
            rect.right <= innerWidth &&
            rect.width >= 44 &&
            rect.height >= 44 &&
            el.contains(
              document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
            )
          );
        })
      ).toBe(true);
    }
    const status = page.getByRole('combobox', {
      name: 'Change status for Readable task summary',
      exact: true,
    });
    await status.evaluate((el) => {
      const bar = document
        .querySelector('[data-mobile-navigation-surface]')!
        .getBoundingClientRect();
      window.scrollBy(0, el.getBoundingClientRect().bottom - bar.top + 16);
    });
    expect((await status.boundingBox())!.y + (await status.boundingBox())!.height).toBeLessThan(
      (await surface.boundingBox())!.y
    );
    await status.click();
    await expect(page.getByRole('option', { name: 'Blocked', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await testInfo.attach('mobile-chat-entry', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await trigger.click();
    const composer = page.getByRole('textbox', { name: 'Message Board Chat', exact: true });
    await expect(composer).toBeVisible();
    await composer.fill('Unsent mobile draft');
    await testInfo.attach('mobile-chat-open', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(composer).toHaveValue('Unsent mobile draft');
    await page.getByRole('button', { name: 'Close Board Chat panel', exact: true }).click();
    await expect(composer).not.toBeVisible();
    await expect(trigger).toBeVisible();
    expect(await trigger.evaluate((el) => getComputedStyle(el).position)).toBe('fixed');
    await page.setViewportSize({ width: 320, height: 844 });
    await trigger.click();
    await expect(composer).toHaveValue('Unsent mobile draft');
    await page.getByRole('button', { name: 'Close Board Chat panel', exact: true }).click();
  } finally {
    await deleteTask(page, task.id as string);
  }
});

test.describe('wide browser chat entry', () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });
  test('retains the floating chat control without mobile navigation', async ({ page }) => {
    await page.goto('/');
    const trigger = page.getByRole('button', { name: 'Open chat', exact: true });
    await expect(trigger).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).not.toBeVisible();
    expect(await trigger.evaluate((el) => getComputedStyle(el).position)).toBe('fixed');
    await trigger.click();
    await expect(
      page.getByRole('textbox', { name: 'Message Board Chat', exact: true })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Close Board Chat panel', exact: true }).click();
    await expect(trigger).toBeVisible();
  });
});
