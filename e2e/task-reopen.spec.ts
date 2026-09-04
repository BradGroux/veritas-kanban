import { test, expect } from '@playwright/test';
import { bypassAuth, seedTestTask, deleteTask, cleanupRoutes } from './helpers/auth';

for (const target of ['same', 'different'] as const) {
  test(`the ${target} task remains editable when opened immediately after closing`, async ({
    page,
  }) => {
    await bypassAuth(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const task = await seedTestTask(page, { title: 'Immediate reopen fixture', status: 'todo' });
    const id = (task as { id: string }).id;
    let targetId = id;
    try {
      if (target === 'different') {
        const other = await seedTestTask(page, {
          title: 'Different reopen fixture',
          status: 'todo',
        });
        targetId = (other as { id: string }).id;
      }
      await page.goto('/');
      const card = page.locator(`[data-task-id="${id}"]`);
      const detail = page.getByTestId('task-detail-panel');
      await card.focus();
      await card.press('Enter');
      await expect(detail).toBeVisible();
      await detail.getByRole('button', { name: 'Close task workspace', exact: true }).click();
      await expect(detail).toHaveCount(0);
      const nextCard = page.locator(`[data-task-id="${targetId}"]`);
      await nextCard.focus();
      await nextCard.press('Enter');
      const title = detail.getByRole('textbox', { name: 'Task title', exact: true });
      await expect(title).toHaveValue(
        target === 'same' ? 'Immediate reopen fixture' : 'Different reopen fixture'
      );
      const [saved] = await Promise.all([
        page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === `/api/tasks/${targetId}` &&
            response.request().method() === 'PATCH',
          { timeout: 5000 }
        ),
        title.fill('Reopened task stays editable'),
      ]);
      expect(saved.ok()).toBeTruthy();
      await expect(detail).toBeVisible();
      await expect(title).toHaveValue('Reopened task stays editable');
    } finally {
      if (targetId !== id) await deleteTask(page, targetId);
      await deleteTask(page, id);
      await cleanupRoutes(page);
    }
  });
}
