import { expect, test } from '@playwright/test';
import { bypassAuth, cleanupRoutes } from './helpers/auth';

for (const theme of ['light', 'dark']) {
  test(`Create Task uses bounded shared form geometry in ${theme}`, async ({ page }) => {
    await bypassAuth(page);
    await page.addInitScript((theme) => localStorage.setItem('veritas-kanban-theme', theme), theme);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 900, height: 480 });
    await page.goto('/');
    await page.evaluate(() => (document.documentElement.style.fontSize = '20px'));
    const opener = page.getByRole('button', { name: 'New Task', exact: true });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Create New Task', exact: true });
    const title = dialog.getByRole('textbox', { name: 'Title', exact: true });
    await expect(title).toBeFocused();
    await title.fill('Synthetic popout draft');
    await dialog.getByLabel('Description', { exact: true }).fill('A retained description');
    const scroll = dialog.getByTestId('create-task-scroll-region');
    const footer = dialog.locator('.vk-overlay-footer');
    await expect(footer.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport();
    await expect(footer.getByRole('button', { name: 'Create Task', exact: true })).toBeInViewport();
    const type = dialog.getByLabel('Type', { exact: true });
    const priority = dialog.getByLabel('Priority', { exact: true });
    const typeBox = await type.boundingBox();
    const priorityBox = await priority.boundingBox();
    expect(Math.abs(typeBox!.width - priorityBox!.width)).toBeLessThanOrEqual(1);
    await priority.click();
    await page.getByRole('option', { name: 'Critical', exact: true }).click();
    await priority.click();
    await priority.press('Escape');
    await expect(page.getByRole('listbox')).toBeHidden();
    await expect(dialog).toBeVisible();
    await expect(priority).toBeFocused();
    const project = dialog.getByLabel('Project (optional)', { exact: true });
    await project.click();
    await page.getByRole('option', { name: '+ New Project', exact: true }).click();
    const newProject = dialog.getByRole('textbox', { name: 'New project', exact: true });
    await expect(newProject).toBeFocused();
    await newProject.fill('Synthetic project');
    await newProject.press('Escape');
    await expect(newProject).toBeHidden();
    await expect(project).toBeFocused();
    await expect(dialog).toBeVisible();
    await expect(title).toHaveValue('Synthetic popout draft');
    await expect(priority).toHaveValue('Critical');
    await scroll.evaluate((element) => (element.scrollTop = 0));
    const footerBefore = await footer.boundingBox();
    await scroll.evaluate((element) => (element.scrollTop = element.scrollHeight));
    expect(await scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect(await footer.boundingBox()).toEqual(footerBefore);
    const geometry = await dialog.evaluate((element) => {
      const content = element.getBoundingClientRect();
      const body = element.querySelector('.vk-overlay-scroll')!.getBoundingClientRect();
      const footer = element.querySelector('.vk-overlay-footer')!.getBoundingClientRect();
      return {
        bottom: content.bottom,
        bodyBottom: body.bottom,
        footerTop: footer.top,
        horizontalOverflow: element.scrollWidth - element.clientWidth,
      };
    });
    expect(geometry.bottom).toBeLessThanOrEqual(480);
    expect(geometry.bodyBottom).toBeLessThanOrEqual(geometry.footerTop + 1);
    expect(geometry.horizontalOverflow).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(480);
    await footer.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    await opener.click();
    await expect(title).toHaveValue('Synthetic popout draft');
    await expect(priority).toHaveValue('Critical');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    await cleanupRoutes(page);
  });
}
