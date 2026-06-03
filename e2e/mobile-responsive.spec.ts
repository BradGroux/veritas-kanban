import { test, expect, type Page } from '@playwright/test';
import { bypassAuth, cleanupRoutes, deleteTask, seedTestTask } from './helpers/auth';

async function useMobileDeviceContext(page: Page) {
  await page.route('**/api/auth/context', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        role: 'read-only',
        isLocalhost: false,
        actorType: 'device',
        authMethod: 'device-session',
        deviceSessionId: 'e2e-mobile-session',
        deviceId: 'e2e-phone',
        clientId: 'e2e-mobile-browser',
        clientMode: 'mobile-pwa',
        capabilities: [
          'board:read',
          'workspace:read',
          'task:read',
          'task:write',
          'comment:write',
          'workflow:read',
          'notification:read',
          'notification:receive',
        ],
        permissions: [
          'workspace:read',
          'task:read',
          'task:write',
          'comment:write',
          'workflow:read',
          'work_product:read',
          'agent:read',
          'settings:read',
        ],
      }),
    })
  );
}

test.describe('mobile responsive flows', () => {
  let testTaskId: string | null = null;

  test.beforeEach(async ({ page }) => {
    await bypassAuth(page);
    await useMobileDeviceContext(page);
  });

  test.afterEach(async ({ page }) => {
    if (testTaskId) {
      await deleteTask(page, testTaskId).catch(() => {});
      testTaskId = null;
    }
    await cleanupRoutes(page);
  });

  test('supports board, task detail, comments, approval review, notifications, and pairing setup', async ({
    page,
  }) => {
    const taskTitle = `E2E Mobile Responsive Task ${Date.now()}`;
    const task = await seedTestTask(page, {
      title: taskTitle,
      description: 'Verify phone-sized task review and coordination flows.',
      status: 'todo',
      priority: 'high',
      type: 'code',
      git: {
        repo: 'BradGroux/veritas-kanban',
        branch: 'mobile-responsive-e2e',
        baseBranch: 'main',
        worktreePath: '/tmp/mobile-responsive-e2e',
      },
      verificationSteps: [
        { id: 'mobile-verify', description: 'Mobile responsive e2e passes', checked: false },
      ],
    });
    testTaskId = (task as { id: string }).id;

    await page.goto('/');

    await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mobile notifications' })).toBeVisible();

    const statusSelect = page.getByRole('combobox', {
      name: `Change status for ${taskTitle}`,
    });
    await expect(statusSelect).toBeVisible();
    await statusSelect.click();
    await page.getByRole('option', { name: 'Blocked' }).click();
    await expect(page.getByText(taskTitle).first()).toBeVisible();

    await page.getByText(taskTitle).first().click();
    const detail = page.getByTestId('task-detail-panel');
    await expect(detail).toBeVisible();
    await expect(detail.getByRole('textbox', { name: 'Task title' })).toHaveValue(taskTitle);
    const detailBox = await detail.boundingBox();
    expect(detailBox?.width ?? 0).toBeLessThanOrEqual(page.viewportSize()!.width);

    await detail.getByRole('tab', { name: 'Review', exact: true }).click();
    await detail.getByRole('button', { name: 'Request Changes' }).click();
    await detail.getByPlaceholder('Describe the changes needed...').fill('Mobile review works.');
    await detail.getByRole('button', { name: 'Submit Changes Requested' }).click();
    await expect(detail.getByText('Mobile review works.')).toBeVisible();

    await detail.getByRole('tab', { name: 'Details' }).click();
    await detail.getByPlaceholder(/Add a comment/).fill('Mobile comment submitted.');
    await detail.getByRole('button', { name: 'Add Comment' }).click();
    await expect(detail.getByText('Mobile comment submitted.')).toBeVisible();

    await detail.getByRole('button', { name: 'Close task details' }).click();
    await expect(detail).not.toBeVisible();

    await page.getByRole('button', { name: 'Mobile notifications' }).click();
    const notifications = page.getByLabel('Notifications', { exact: true });
    await expect(notifications).toBeVisible();
    await expect(notifications.getByRole('heading', { name: 'Needs Attention' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(notifications).not.toBeVisible();

    await page.evaluate(() => window.dispatchEvent(new CustomEvent('veritas:open-diagnostics')));
    await page.getByRole('button', { name: /Remote Server/ }).click();
    await expect(page.getByLabel('Pairing link')).toBeVisible();
  });

  test('renders login controls at a phone viewport', async ({ page }) => {
    await cleanupRoutes(page);
    await page.route('**/api/auth/status', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          needsSetup: false,
          authenticated: false,
          sessionExpiry: null,
          authEnabled: true,
        }),
      })
    );

    await page.goto('/');

    await expect(page.getByPlaceholder('Enter your password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Forgot password?' })).toBeVisible();
  });
});
