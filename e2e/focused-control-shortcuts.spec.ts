import { expect, test } from '@playwright/test';
import { bypassAuth, cleanupRoutes } from './helpers/auth';

test('focused Policy actions activate by Enter and regain focus after Escape', async ({ page }) => {
  await bypassAuth(page);
  await page.goto('/policies');
  for (const name of ['Edit', 'Test', 'Edit', 'Test']) {
    const action = page.getByRole('button', { name, exact: true }).first();
    await action.focus();
    await expect(action).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toContainText(
      name === 'Edit' ? 'Edit Policy' : 'Test Policy'
    );
    // Intentionally do not wait for initial dialog focus or an animation timeout.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(action).toBeFocused();
  }
  const edit = page.getByRole('button', { name: 'Edit', exact: true }).first();
  await edit.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(edit).toBeFocused();
  await cleanupRoutes(page);
});
