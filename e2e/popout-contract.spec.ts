import { expect, test } from '@playwright/test';
import { bypassAuth, cleanupRoutes } from './helpers/auth';

for (const theme of ['dark', 'light']) {
  test(`shared popouts stay bounded and preserve the focus stack in ${theme}`, async ({ page }) => {
    test.setTimeout(120_000);
    await bypassAuth(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript((theme) => {
      localStorage.setItem('veritas-kanban-theme', theme);
      Object.defineProperty(window, 'veritasDesktop', {
        configurable: true,
        value: { onMenuCommand: () => () => undefined },
      });
    }, theme);
    await page.goto('/?ui-gallery=1');
    for (const viewport of [
      { width: 1180, height: 760 },
      { width: 900, height: 480 },
    ]) {
      await page.setViewportSize(viewport);
      await page.evaluate(
        (size) => (document.documentElement.style.fontSize = size),
        viewport.height === 480 ? '20px' : '16px'
      );
      for (const variant of ['confirm', 'form', 'authoring', 'utility', 'task', 'chat']) {
        const trigger = page.getByRole('button', { name: `Inspect ${variant}`, exact: true });
        await trigger.click();
        const dialog = page.getByRole('dialog', { name: `${variant} popout`, exact: true });
        await expect(dialog).toBeVisible();
        const box = await dialog.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.y).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
        expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
        const close = dialog.getByRole('button', { name: 'Close dialog', exact: true });
        await expect(close).toBeVisible();
        const selector = dialog.getByLabel('Example selector');
        await selector.click();
        await page.getByRole('option', { name: 'Beta', exact: true }).click();
        await expect(selector).toHaveValue('Beta');
        await selector.click();
        await selector.press('Escape');
        await expect(page.getByRole('listbox')).toBeHidden();
        await expect(dialog).toBeVisible();
        const inset = await dialog
          .locator('.vk-overlay-header')
          .evaluate((el) => getComputedStyle(el).paddingLeft);
        expect(inset).toBe(viewport.height === 480 ? '20px' : '16px');
        await dialog
          .getByRole('textbox', { name: 'First field' })
          .fill('Preserved across child dialog');
        await dialog.getByRole('button', { name: 'Review action' }).click();
        const child = page.getByRole('dialog', { name: 'Confirm example', exact: true });
        await expect(child).toBeVisible();
        await child.getByRole('button', { name: 'Return to popout' }).press('Escape');
        await expect(child).toBeHidden();
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('textbox', { name: 'First field' })).toHaveValue(
          'Preserved across child dialog'
        );
        await expect(dialog.getByRole('button', { name: 'Review action' })).toBeFocused();
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).press('Escape');
        await expect(dialog).toBeHidden();
        await expect(trigger).toBeFocused();
      }
    }
    await cleanupRoutes(page);
  });

  test(`template popout keeps real dropdowns and actions reachable in ${theme}`, async ({
    page,
  }) => {
    await bypassAuth(page);
    await page.addInitScript((theme) => {
      localStorage.setItem('veritas-kanban-theme', theme);
      Object.defineProperty(window, 'veritasDesktop', {
        configurable: true,
        value: { onMenuCommand: () => () => undefined },
      });
    }, theme);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1180, height: 760 });
    await page.goto('/templates');
    await page.evaluate(() => (document.documentElement.style.fontSize = '20px'));
    await page.getByRole('button', { name: 'New Template', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Create New Template', exact: true });
    await expect(dialog).toBeVisible();
    const select = async (label: string) => {
      const input = dialog.getByLabel(label, { exact: true });
      await input.click();
      const option = page.getByRole('option').first();
      await expect(option).toBeVisible();
      const text = await option.innerText();
      await option.click();
      await expect(input).toHaveValue(text);
      await input.click();
      await input.press('Escape');
      await expect(page.getByRole('listbox')).toBeHidden();
      await expect(dialog).toBeVisible();
      await expect(input).toBeFocused();
    };
    await select('Category');
    await dialog.getByRole('tab', { name: 'Task Defaults' }).click();
    for (const label of ['Default Type', 'Default Priority', 'Default Agent']) await select(label);
    const scroll = dialog.getByTestId('template-editor-scroll-region');
    await scroll.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(
      dialog.getByRole('button', { name: 'Create Template', exact: true })
    ).toBeInViewport();
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(760);
    page.once('dialog', (prompt) => prompt.accept());
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'New Template', exact: true })).toBeFocused();
    await cleanupRoutes(page);
  });
}
