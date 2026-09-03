import { expect, test } from '@playwright/test';
import { bypassAuth, cleanupRoutes } from './helpers/auth';

test('focused Policy actions activate by Enter and regain focus after Escape', async ({ page }) => {
  await bypassAuth(page);
  await page.goto('/policies');
  for (const name of ['Edit', 'Test']) {
    const action = page.getByRole('button', { name, exact: true }).first();
    await action.focus();
    await expect(action).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toContainText(
      name === 'Edit' ? 'Edit Policy' : 'Test Policy'
    );
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(action).toBeFocused();
  }
  await cleanupRoutes(page);
});
