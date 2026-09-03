import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { bypassAuth, cleanupRoutes, deleteTask, seedTestTask } from './helpers/auth';

test.skip(process.env.DOCS_MEDIA_CAPTURE !== '1', 'Run only for an explicit docs media refresh.');
test.describe.configure({ mode: 'serial' });

const assetsDir = path.resolve(process.cwd(), 'docs/assets/v6.1.5');
const desktopViewport = { width: 1440, height: 1000 };
const mobileViewport = { width: 390, height: 844 };

async function capture(page: Page, filename: string) {
  const output = path.join(assetsDir, filename);
  await page.screenshot({ path: output, animations: 'disabled', fullPage: false });
}

async function useDarkTheme(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('veritas-kanban-theme', 'dark');
  });
}

test('captures public-safe 6.1.5 desktop and mobile documentation media', async ({ page }) => {
  test.setTimeout(180_000);
  await mkdir(assetsDir, { recursive: true });
  await bypassAuth(page);
  await useDarkTheme(page);

  const tasks = await Promise.all([
    seedTestTask(page, {
      title: 'Prepare the release candidate',
      description: 'Confirm the integrated desktop build and focused release evidence.',
      priority: 'high',
      status: 'todo',
    }),
    seedTestTask(page, {
      title: 'Refresh the visual tour',
      description: 'Capture public-safe screenshots from the current interface.',
      priority: 'medium',
      status: 'todo',
    }),
    seedTestTask(page, {
      title: 'Verify task workspace modes',
      description: 'Review Overview, Plan, Run, Results, and History in the integrated app.',
      priority: 'high',
      status: 'in-progress',
    }),
    seedTestTask(page, {
      title: 'Resolve documentation drift',
      description: 'Replace screenshots that no longer match the maintained interface.',
      priority: 'medium',
      status: 'blocked',
    }),
    seedTestTask(page, {
      title: 'Complete feature-level verification',
      description: 'Record the focused checks that prove the release behavior.',
      priority: 'low',
      status: 'done',
    }),
  ]);

  try {
    await page.setViewportSize(desktopViewport);
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'To Do' })).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole('heading', { name: 'Prepare the release candidate' })
    ).toBeVisible();
    await capture(page, 'board-overview.png');

    await page.getByRole('heading', { name: 'Prepare the release candidate' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByTestId('task-workspace-mode-navigation')).toBeVisible();
    await capture(page, 'task-workspace.png');
    await page.getByRole('button', { name: 'Close task workspace' }).click();

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await expect(settings).toBeVisible();
    await expect(settings.getByText('Core', { exact: true })).toBeVisible();
    await capture(page, 'settings-navigation.png');

    await settings.getByRole('tab', { name: 'Agents' }).click();
    await expect(settings.getByRole('heading', { name: 'Agents', exact: true })).toBeVisible();
    await capture(page, 'agent-providers.png');

    await settings.getByRole('tab', { name: 'Maintenance' }).click();
    await expect(settings.getByRole('heading', { name: 'Maintenance', exact: true })).toBeVisible();
    await capture(page, 'maintenance-center.png');

    await settings.getByRole('tab', { name: 'Notifications' }).click();
    await expect(
      settings.getByRole('heading', { name: 'Notifications', exact: true })
    ).toBeVisible();
    await capture(page, 'notification-adapters.png');
    await page.getByRole('button', { name: 'Close settings' }).click();

    await page.getByRole('button', { name: 'Command palette' }).click();
    await expect(page.getByRole('textbox', { name: 'Search commands' })).toBeVisible();
    await capture(page, 'command-palette.png');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Open Board Chat' }).click();
    await expect(page.getByRole('region', { name: 'Workbench bottom dock' })).toBeVisible();
    await expect(page.locator('section[aria-label="Board Chat"]')).toBeVisible();
    await capture(page, 'workbench-panel.png');
    await page.getByText('Squad Chat', { exact: true }).last().click();
    await expect(page.getByRole('region', { name: 'Squad Chat' })).toBeVisible();
    await capture(page, 'squad-chat.png');
    await page.getByRole('button', { name: 'Close bottom dock' }).click();

    await page.setViewportSize(mobileViewport);
    await page.goto('/');
    await page.getByRole('button', { name: 'Mobile board' }).click();
    await expect(page.getByRole('region', { name: 'To Do' })).toBeVisible({ timeout: 15_000 });
    await capture(page, 'mobile-board.png');

    await page.getByRole('heading', { name: 'Prepare the release candidate' }).click();
    await expect(
      page.getByRole('dialog').getByLabel('Task workspace mode', { exact: true })
    ).toBeVisible();
    await capture(page, 'mobile-task-workspace.png');
    await page.getByRole('button', { name: 'Close task workspace' }).click();

    await page.getByRole('button', { name: 'Mobile settings', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'General', exact: true })).toBeVisible();
    await capture(page, 'mobile-settings.png');
  } finally {
    for (const task of tasks) {
      const id = task.id;
      if (typeof id === 'string') await deleteTask(page, id).catch(() => {});
    }
    await cleanupRoutes(page);
  }
});
