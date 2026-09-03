import { expect, test } from '@playwright/test';
import { bypassAuth, cleanupRoutes, deleteTask, seedTestTask } from './helpers/auth';

for (const theme of ['light', 'dark']) {
  test(`Task Chat preserves its workspace, focus, and task scope in ${theme}`, async ({ page }) => {
    await bypassAuth(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript((value) => localStorage.setItem('veritas-kanban-theme', value), theme);
    const title = `E2E Shared Task Chat ${theme}`;
    const task = await seedTestTask(page, { title, type: 'code', status: 'todo' });
    const taskId = String(task.id);
    // Supply a historical attempt in browser fixtures only. Never launch an agent.
    const historicalTask = {
      ...task,
      attempt: { id: 'chat-layout-attempt', status: 'failed', startedAt: '2026-09-01T12:00:00Z' },
    };
    await page.route('**/api/tasks', (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ json: [historicalTask] })
        : route.fallback()
    );
    await page.route(`**/api/tasks/${taskId}`, (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ json: historicalTask })
        : route.fallback()
    );
    await page.route('**/api/chat/sessions', (route) => route.fulfill({ json: [] }));
    await page.route(`**/api/chat/sessions/task_${taskId}`, (route) =>
      route.fulfill({
        json: {
          id: `task_${taskId}`,
          taskId,
          messages: [
            {
              id: 'old-message',
              role: 'assistant',
              content: 'Task-scoped history',
              timestamp: '2026-09-01T12:00:00Z',
            },
          ],
        },
      })
    );
    const sent: Record<string, unknown>[] = [];
    await page.route('**/api/chat/send', (route) => {
      sent.push(route.request().postDataJSON());
      return route.fulfill({
        json: { sessionId: `task_${taskId}`, messageId: 'new-message', message: 'accepted' },
      });
    });

    try {
      await page.setViewportSize({ width: 1700, height: 900 });
      await page.goto('/');
      await page.getByRole('article', { name: `Task: ${title}` }).click();
      const detail = page.getByTestId('task-detail-panel');
      const headerChat = detail.getByRole('button', { name: 'Chat', exact: true }).first();
      const executionChat = detail
        .locator('[aria-label="Current execution"]')
        .getByRole('button', { name: 'Chat', exact: true });
      await executionChat.click();
      const chat = detail.getByRole('region', { name: `Task Chat: ${title}`, exact: true });
      const input = chat.getByRole('textbox', { name: 'Message Task Chat' });
      await expect(input).toBeFocused();
      await input.fill('Keep the task conversation draft');
      await input.press('Escape');
      await expect(chat).toBeHidden();
      await expect(executionChat).toBeFocused();
      await executionChat.click();
      await expect(input).toHaveValue('Keep the task conversation draft');

      // Tab can leave the inline chat and reach the still-visible task header.
      await chat.getByRole('button', { name: 'Build', exact: true }).focus();
      await page.keyboard.press('Tab');
      await expect(headerChat).toBeFocused();
      await detail.getByRole('button', { name: 'Results', exact: true }).click();
      await chat.getByRole('button', { name: 'Close Task Chat panel' }).click();
      await expect(headerChat).toBeFocused(); // The previous Overview invoker is now hidden.
      await headerChat.click();

      await chat.getByRole('button', { name: 'Clear chat' }).click();
      const confirmation = page.getByRole('dialog', { name: 'Clear chat history?' });
      await expect(confirmation).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(confirmation).toBeHidden();
      await expect(chat.getByRole('button', { name: 'Clear chat' })).toBeFocused();
      await expect(detail).toBeVisible();

      for (const geometry of [
        { width: 740, height: 700, fontSize: '16px' },
        { width: 900, height: 480, fontSize: '20px' },
      ]) {
        await page.setViewportSize(geometry);
        await page.evaluate((size) => {
          document.documentElement.style.fontSize = size;
        }, geometry.fontSize);
        await expect(detail.locator('.vk-task-workspace-main')).toBeHidden();
        await expect(input).toHaveValue('Keep the task conversation draft');
        const transcript = await chat.locator('.vk-chat-transcript').boundingBox();
        const composer = await chat.locator('.vk-chat-composer').boundingBox();
        expect(transcript!.height).toBeGreaterThan(20);
        expect(transcript!.y + transcript!.height).toBeLessThanOrEqual(composer!.y + 1);
        expect(composer!.y + composer!.height).toBeLessThanOrEqual(geometry.height + 1);
        expect(await detail.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
      }
      await chat.getByRole('button', { name: 'Send chat message', exact: true }).click();
      await expect.poll(() => sent.length).toBe(1);
      expect(sent[0]).toMatchObject({
        taskId,
        sessionId: `task_${taskId}`,
        message: 'Keep the task conversation draft',
        mode: 'ask',
      });
      await chat.getByRole('button', { name: 'Close Task Chat panel' }).click();
      await expect(detail.getByRole('combobox', { name: 'Task workspace mode' })).toHaveValue(
        'Results'
      );
    } finally {
      await deleteTask(page, taskId);
      await cleanupRoutes(page);
    }
  });
}
