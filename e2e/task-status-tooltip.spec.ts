import { expect, test } from '@playwright/test';
import { bypassAuth, cleanupRoutes, deleteTask, seedTestTask } from './helpers/auth';

test.use({ viewport: { width: 320, height: 844 }, isMobile: true, hasTouch: true });
test.beforeEach(async ({ page }) => bypassAuth(page));
test.afterEach(async ({ page }) => cleanupRoutes(page));

for (const input of ['pointer', 'keyboard']) {
  test(`task hint stays out of the status menu during ${input} interaction`, async ({
    page,
  }, testInfo) => {
    const title = `Status hint ${input}`;
    const task = await seedTestTask(page, { title, type: 'code' });
    try {
      await page.goto('/');
      await page.addStyleTag({ content: ':root { font-size: 20px !important; }' });
      const status = page.getByRole('combobox', {
        name: `Change status for ${title}`,
        exact: true,
      });
      await expect(status).toBeVisible();
      await status.evaluate((el) => {
        const bar = document
          .querySelector('[data-mobile-navigation-surface]')!
          .getBoundingClientRect();
        scrollBy(0, el.getBoundingClientRect().bottom - bar.top + 16);
      });
      const hint = page.getByRole('tooltip').filter({ hasText: title });
      await status.hover();
      await expect(hint).toBeVisible();
      const openMenu = async () => {
        if (input === 'pointer') await status.click();
        else {
          await status.focus();
          await page.keyboard.press('Space');
        }
      };
      await openMenu();
      const done = page.getByRole('option', { name: 'Done', exact: true });
      await expect(done).toBeVisible();
      await expect(hint).not.toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('status-menu.png') });
      await page.keyboard.press('Escape');
      await expect(status).toHaveValue('To Do');
      await page.getByRole('button', { name: 'Mobile home', exact: true }).hover();
      await status.hover();
      await expect(hint).toBeVisible();
      await openMenu();
      await expect(done).toBeVisible();
      await expect(hint).not.toBeVisible();
      if (input === 'pointer') await done.click();
      else {
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
      }
      await expect(status).toHaveValue('Done');
      await expect(page.getByTestId('task-detail-panel')).not.toBeVisible();
      await page.getByRole('button', { name: 'Mobile home', exact: true }).hover();
      await status.hover();
      await expect(hint).toBeVisible();
    } finally {
      await deleteTask(page, task.id as string);
    }
  });
}
