import { expect, test } from '@playwright/test';
import type { Task } from '@veritas-kanban/shared';
import { bypassAuth, cleanupRoutes, deleteTask, seedTestTask, unwrapApiData } from './helpers/auth';

const API_BASE = process.env.API_BASE_URL || 'http://127.0.0.1:3001';

test.describe('Atomic board drag', () => {
  const taskIds: string[] = [];

  test.beforeEach(async ({ page }) => {
    await bypassAuth(page);
  });

  test.afterEach(async ({ page }) => {
    await Promise.all(taskIds.splice(0).map((taskId) => deleteTask(page, taskId).catch(() => {})));
    await cleanupRoutes(page);
  });

  for (const theme of ['dark', 'light'] as const)
    test(`keeps the pending projection and commits one revisioned move in ${theme} theme`, async ({
      page,
    }) => {
      const rightRailOpen = theme === 'dark';
      await page.addInitScript(
        ({ selectedTheme, openRightRail }) => {
          window.localStorage.setItem('veritas-kanban-theme', selectedTheme);
          window.localStorage.setItem('veritas.desktop.rightRailOpen', String(openRightRail));
          Object.defineProperty(window, 'veritasDesktop', {
            configurable: true,
            value: {
              onMenuCommand: () => () => undefined,
              toggleWindowMaximize: async () => ({ maximized: false }),
            },
          });
        },
        { selectedTheme: theme, openRightRail: rightRailOpen }
      );
      await page.route('**/api/settings/features', async (route) => {
        const response = await route.fetch();
        const body = (await response.json()) as Record<string, unknown>;
        const data = (body.data ?? body) as Record<string, unknown>;
        data.board = {
          ...(data.board as Record<string, unknown>),
          showDashboard: true,
        };
        await route.fulfill({
          status: response.status(),
          contentType: 'application/json',
          body: JSON.stringify(body),
        });
      });
      const destination = await seedTestTask(page, {
        title: 'Atomic drag destination',
        status: 'blocked',
      });
      const moving = await seedTestTask(page, {
        title: 'Atomic drag source',
        status: 'todo',
      });
      const pendingPeer = await seedTestTask(page, {
        title: 'Atomic drag pending peer',
        status: 'todo',
      });
      const destinationId = destination.id as string;
      const movingId = moving.id as string;
      const pendingPeerId = pendingPeer.id as string;
      taskIds.push(destinationId, movingId, pendingPeerId);

      let releaseMove!: () => void;
      const moveRelease = new Promise<void>((resolve) => {
        releaseMove = resolve;
      });
      let markMoveSeen!: () => void;
      const moveSeen = new Promise<void>((resolve) => {
        markMoveSeen = resolve;
      });
      const mutationRequests: Array<{ method: string; pathname: string }> = [];
      let moveOperationId: string | undefined;
      page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.pathname.startsWith('/api/tasks')) {
          mutationRequests.push({ method: request.method(), pathname: url.pathname });
          if (url.pathname === `/api/tasks/${movingId}/move`) {
            moveOperationId = (request.postDataJSON() as { operationId?: string }).operationId;
          }
        }
      });
      await page.route(`**/api/tasks/${movingId}/move`, async (route) => {
        markMoveSeen();
        await moveRelease;
        await route.fallback();
      });

      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('/');
      const source = page.locator(`[data-task-id="${movingId}"]`);
      const destinationCard = page.locator(`[data-task-id="${destinationId}"]`);
      const blocked = page.getByRole('region', { name: 'Blocked' });
      await expect(source).toBeVisible();
      await expect(destinationCard).toBeVisible();
      await expect(blocked).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-client', 'desktop');
      if (rightRailOpen) await expect(page.getByLabel('Board right sidebar')).toBeVisible();
      else await expect(page.getByLabel('Board right sidebar')).toBeHidden();
      await expect(page.getByLabel('Board dashboard')).toBeAttached();
      await page.waitForTimeout(500);

      const sourceBox = await source.boundingBox();
      const destinationBox = await destinationCard.boundingBox();
      expect(sourceBox).not.toBeNull();
      expect(destinationBox).not.toBeNull();
      const countBefore = {
        todo: Number(
          await page
            .getByRole('region', { name: 'To Do' })
            .locator('span[aria-live="polite"]')
            .textContent()
        ),
        blocked: Number(await blocked.locator('span[aria-live="polite"]').textContent()),
      };
      const geometryBefore = await page.evaluate(() => ({
        documentHeight: document.documentElement.scrollHeight,
        scrollY: window.scrollY,
        board: document
          .querySelector('[aria-label^="Kanban board"]')
          ?.getBoundingClientRect()
          .toJSON(),
        grid: document
          .querySelector('[aria-label="Kanban columns"]')
          ?.getBoundingClientRect()
          .toJSON(),
        dashboard: document
          .querySelector('[aria-label="Board dashboard"]')
          ?.getBoundingClientRect()
          .toJSON(),
      }));
      expect(geometryBefore.dashboard?.top).toBeGreaterThanOrEqual(
        geometryBefore.board?.bottom ?? 0
      );

      await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + 18);
      await page.mouse.down();
      await page.mouse.move(sourceBox!.x + sourceBox!.width / 2 + 12, sourceBox!.y + 30, {
        steps: 3,
      });
      await page.mouse.move(destinationBox!.x + destinationBox!.width / 2, destinationBox!.y + 18, {
        steps: 8,
      });

      const overlay = page.locator('[data-board-drag-overlay]');
      await expect(overlay).toHaveCount(1);
      const overlayBox = await overlay.boundingBox();
      expect(overlayBox).not.toBeNull();
      expect(Math.abs(overlayBox!.width - sourceBox!.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(overlayBox!.height - sourceBox!.height)).toBeLessThanOrEqual(1);
      const overlayColors = await overlay.evaluate((element) => {
        const style = getComputedStyle(element);
        return { backgroundColor: style.backgroundColor, color: style.color };
      });
      expect(await overlay.evaluate((element) => element.classList.contains('bg-card'))).toBe(true);
      if (theme === 'dark') expect(overlayColors.backgroundColor).not.toBe('rgb(255, 255, 255)');

      const geometryDuring = await page.evaluate(() => ({
        documentHeight: document.documentElement.scrollHeight,
        scrollY: window.scrollY,
        board: document
          .querySelector('[aria-label^="Kanban board"]')
          ?.getBoundingClientRect()
          .toJSON(),
        grid: document
          .querySelector('[aria-label="Kanban columns"]')
          ?.getBoundingClientRect()
          .toJSON(),
        dashboard: document
          .querySelector('[aria-label="Board dashboard"]')
          ?.getBoundingClientRect()
          .toJSON(),
      }));
      expect(geometryDuring).toEqual(geometryBefore);
      await expect(page.getByLabel('Search tasks')).toBeVisible();

      await page.mouse.up();
      await moveSeen;
      await expect(blocked.locator(`[data-task-id="${movingId}"]`)).toBeVisible();
      await expect(page.locator('[data-board-drag-overlay]')).toHaveCount(0);
      await expect(page.getByText(/Atomic drag source moved to Blocked/)).toHaveCount(0);

      const pendingPeerCard = page.locator(`[data-task-id="${pendingPeerId}"]`);
      const pendingPeerBox = await pendingPeerCard.boundingBox();
      expect(pendingPeerBox).not.toBeNull();
      await page.mouse.move(pendingPeerBox!.x + pendingPeerBox!.width / 2, pendingPeerBox!.y + 18);
      await page.mouse.down();
      await page.mouse.move(destinationBox!.x + destinationBox!.width / 2, destinationBox!.y + 18, {
        steps: 8,
      });
      await page.mouse.up();
      await expect(page.locator('[data-board-drag-overlay]')).toHaveCount(0);
      expect(
        mutationRequests.filter(
          (request) => request.pathname === `/api/tasks/${pendingPeerId}/move`
        )
      ).toHaveLength(0);

      releaseMove();
      await expect
        .poll(async () => {
          const response = await page.request.get(`${API_BASE}/api/tasks/${movingId}`);
          const body = unwrapApiData<Record<string, unknown>>(await response.json());
          return {
            status: body.status,
            revision: body.revision,
            hasPosition: typeof body.position === 'number',
          };
        })
        .toEqual({ status: 'blocked', revision: 2, hasPosition: true });

      await expect(page.getByText('Task changed elsewhere')).toHaveCount(0);
      await expect(page.getByText('Move not saved')).toHaveCount(0);
      await expect(page.getByText(/Atomic drag source moved to Blocked/)).toHaveCount(1);
      await expect(page.locator(`[data-task-id="${movingId}"]`)).toHaveCount(1);
      expect(
        Number(
          await page
            .getByRole('region', { name: 'To Do' })
            .locator('span[aria-live="polite"]')
            .textContent()
        )
      ).toBe(countBefore.todo - 1);
      expect(Number(await blocked.locator('span[aria-live="polite"]').textContent())).toBe(
        countBefore.blocked + 1
      );
      if (rightRailOpen) {
        await expect(
          page
            .getByLabel('Board right sidebar')
            .getByRole('button', { name: /→ blockedAtomic drag source/ })
            .first()
        ).toBeVisible();
      }
      await expect
        .poll(async () => {
          const response = await page.request.get(
            `${API_BASE}/api/activity?taskId=${movingId}&limit=50`
          );
          const activities = unwrapApiData<Array<{ details?: { operationId?: string } }>>(
            await response.json()
          );
          return activities.filter((activity) => activity.details?.operationId === moveOperationId)
            .length;
        })
        .toBe(1);
      const moveMutations = mutationRequests.filter((request) => request.method !== 'GET');
      expect(moveMutations).toEqual([{ method: 'POST', pathname: `/api/tasks/${movingId}/move` }]);

      await page.reload();
      await expect(
        page.getByRole('region', { name: 'Blocked' }).locator(`[data-task-id="${movingId}"]`)
      ).toBeVisible();
    });

  test('rejects a genuinely stale pointer move without partial status state', async ({ page }) => {
    const moving = await seedTestTask(page, {
      title: 'Atomic stale drag source',
      status: 'todo',
    });
    const movingId = moving.id as string;
    taskIds.push(movingId);
    let injectedConflict = false;
    await page.route(`**/api/tasks/${movingId}/move`, async (route) => {
      if (!injectedConflict) {
        injectedConflict = true;
        const response = await page.request.patch(`${API_BASE}/api/tasks/${movingId}`, {
          headers: { 'If-Match': `"task:${movingId}:1"` },
          data: { title: 'Atomic stale drag source updated' },
        });
        expect(response.ok()).toBe(true);
      }
      await route.fallback();
    });

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');
    const source = page.locator(`[data-task-id="${movingId}"]`);
    const blocked = page.getByRole('region', { name: 'Blocked' });
    await expect(source).toBeVisible();
    const sourceBox = await source.boundingBox();
    const blockedBox = await blocked.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(blockedBox).not.toBeNull();

    await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + 18);
    await page.mouse.down();
    await page.mouse.move(sourceBox!.x + sourceBox!.width / 2 + 12, sourceBox!.y + 30);
    await page.mouse.move(blockedBox!.x + blockedBox!.width / 2, blockedBox!.y + 90, {
      steps: 8,
    });
    await page.mouse.up();

    await expect(page.getByText('Move not saved')).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'To Do' }).locator(`[data-task-id="${movingId}"]`)
    ).toBeVisible();
    await expect(blocked.locator(`[data-task-id="${movingId}"]`)).toHaveCount(0);
    await expect
      .poll(async () => {
        const response = await page.request.get(`${API_BASE}/api/tasks/${movingId}`);
        const body = unwrapApiData<Record<string, unknown>>(await response.json());
        return { status: body.status, revision: body.revision, title: body.title };
      })
      .toEqual({ status: 'todo', revision: 2, title: 'Atomic stale drag source updated' });
  });

  test('moves two tasks consecutively when one detail cache trails the live board', async ({
    page,
  }) => {
    const destination = await seedTestTask(page, {
      title: 'Consecutive drag destination',
      status: 'blocked',
    });
    const first = await seedTestTask(page, {
      title: 'Consecutive drag first',
      status: 'todo',
    });
    const second = await seedTestTask(page, {
      title: 'Consecutive drag second',
      status: 'todo',
    });
    const destinationId = destination.id as string;
    const firstId = first.id as string;
    const secondId = second.id as string;
    taskIds.push(destinationId, firstId, secondId);

    const moveHeaders: Array<{ taskId: string; revision: string | undefined }> = [];
    page.on('request', (request) => {
      const match = new URL(request.url()).pathname.match(/^\/api\/tasks\/([^/]+)\/move$/);
      if (request.method() !== 'POST' || !match) return;
      moveHeaders.push({ taskId: match[1], revision: request.headers()['if-match'] });
    });

    await page.goto('/');
    await page.getByLabel('Search tasks').fill('Consecutive drag');
    await page.getByLabel('Search tasks').blur();
    const secondCard = page.locator(`[data-task-id="${secondId}"]`);
    await secondCard.click();
    const detail = page.locator('[role="dialog"]');
    await expect(detail).toBeVisible();
    const titleInput = detail.locator('input').first();
    await expect(titleInput).toHaveValue('Consecutive drag second');
    const titleSave = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/tasks/${secondId}` &&
        response.request().method() === 'PATCH'
    );
    await titleInput.fill('Consecutive drag second edited');
    const titleResponse = await titleSave;
    expect(titleResponse.ok()).toBe(true);
    const edited = unwrapApiData<Task>(await titleResponse.json());
    await detail.getByRole('button', { name: 'Close task workspace' }).click();
    await expect(detail).not.toBeVisible();

    const externalResponse = await page.request.patch(`${API_BASE}/api/tasks/${secondId}`, {
      headers: { 'If-Match': `"task:${secondId}:${edited.revision}"` },
      data: { description: 'The live board has a newer revision than the inactive detail cache.' },
    });
    expect(externalResponse.ok()).toBe(true);
    const externallyUpdated = unwrapApiData<Task>(await externalResponse.json());
    await expect(secondCard).toContainText('The live board has a newer revision');

    const blocked = page.getByRole('region', { name: 'Blocked' });
    const destinationCard = page.locator(`[data-task-id="${destinationId}"]`);
    const dragToDestination = async (taskId: string) => {
      const moveResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === `/api/tasks/${taskId}/move` &&
          response.request().method() === 'POST'
      );
      const source = page.locator(`[data-task-id="${taskId}"]`);
      const sourceBox = await source.boundingBox();
      const destinationBox = await destinationCard.boundingBox();
      expect(sourceBox).not.toBeNull();
      expect(destinationBox).not.toBeNull();
      await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + 18);
      await page.mouse.down();
      await page.mouse.move(destinationBox!.x + destinationBox!.width / 2, destinationBox!.y + 18, {
        steps: 8,
      });
      await page.mouse.up();
      expect((await moveResponse).ok()).toBe(true);
      await expect(page.locator('[data-board-drag-overlay]')).toHaveCount(0);
      await expect(blocked.locator(`[data-task-id="${taskId}"]`)).toBeVisible();
    };

    await dragToDestination(firstId);
    await dragToDestination(secondId);

    expect(moveHeaders).toEqual([
      { taskId: firstId, revision: `"task:${firstId}:${first.revision}"` },
      { taskId: secondId, revision: `"task:${secondId}:${externallyUpdated.revision}"` },
    ]);
    await expect(page.getByText('Move not saved')).toHaveCount(0);
  });

  test('routes a keyboard column move through the same move endpoint', async ({ page }) => {
    const moving = await seedTestTask(page, {
      title: 'Atomic keyboard source',
      status: 'todo',
    });
    const movingId = moving.id as string;
    taskIds.push(movingId);
    const moveRequests: string[] = [];
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        new URL(request.url()).pathname === `/api/tasks/${movingId}/move`
      ) {
        moveRequests.push(request.url());
      }
    });

    await page.goto('/');
    await page.getByLabel('Search tasks').fill('Atomic keyboard source');
    await page.getByLabel('Search tasks').blur();
    const movingCard = page.locator(`[data-task-id="${movingId}"]`);
    await expect(movingCard).toBeVisible();
    await expect(page.locator('[data-task-id]')).toHaveCount(1);
    await page.keyboard.press('j');
    await expect(movingCard).toHaveAttribute('data-selected', 'true');
    await page.keyboard.press('3');

    await expect(
      page.getByRole('region', { name: 'Blocked' }).locator(`[data-task-id="${movingId}"]`)
    ).toBeVisible();
    await expect
      .poll(async () => {
        const response = await page.request.get(`${API_BASE}/api/tasks/${movingId}`);
        return unwrapApiData<Record<string, unknown>>(await response.json()).status;
      })
      .toBe('blocked');
    expect(moveRequests).toHaveLength(1);
    await expect(page.getByText(/Task Atomic keyboard source moved to Blocked/)).toHaveCount(1);
  });

  test('handles cancel, an empty column, and same-column ordering through real sensors', async ({
    page,
  }) => {
    const moving = await seedTestTask(page, {
      title: 'Atomic matrix moving',
      status: 'todo',
      position: 0,
    });
    const withinFirst = await seedTestTask(page, {
      title: 'Atomic matrix within first',
      status: 'todo',
      position: 1,
    });
    const withinSecond = await seedTestTask(page, {
      title: 'Atomic matrix within second',
      status: 'todo',
      position: 2,
    });
    const movingId = moving.id as string;
    const withinFirstId = withinFirst.id as string;
    const withinSecondId = withinSecond.id as string;
    taskIds.push(movingId, withinFirstId, withinSecondId);

    const moveRequests: Array<{
      taskId: string;
      destinationStatus: string;
      destinationIndex: number;
    }> = [];
    page.on('request', (request) => {
      const match = new URL(request.url()).pathname.match(/^\/api\/tasks\/([^/]+)\/move$/);
      if (request.method() !== 'POST' || !match) return;
      const payload = request.postDataJSON() as {
        destinationStatus: string;
        destinationIndex: number;
      };
      moveRequests.push({ taskId: match[1], ...payload });
    });

    await page.goto('/');
    await page.getByLabel('Search tasks').fill('Atomic matrix');
    await page.getByLabel('Search tasks').blur();
    const movingCard = page.locator(`[data-task-id="${movingId}"]`);
    const blocked = page.getByRole('region', { name: 'Blocked' });
    await expect(movingCard).toBeVisible();
    await expect(blocked.locator('[data-task-id]')).toHaveCount(0);

    const movingBox = await movingCard.boundingBox();
    const blockedBox = await blocked.boundingBox();
    expect(movingBox).not.toBeNull();
    expect(blockedBox).not.toBeNull();
    await page.mouse.move(movingBox!.x + movingBox!.width / 2, movingBox!.y + 18);
    await page.mouse.down();
    await page.mouse.move(blockedBox!.x + blockedBox!.width / 2, blockedBox!.y + 90, {
      steps: 8,
    });
    await expect(page.locator('[data-board-drag-overlay]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await page.mouse.up();

    await expect(page.locator('[data-board-drag-overlay]')).toHaveCount(0);
    await expect(
      page.getByRole('region', { name: 'To Do' }).locator(`[data-task-id="${movingId}"]`)
    ).toBeVisible();
    expect(moveRequests).toHaveLength(0);

    const canceledBox = await movingCard.boundingBox();
    expect(canceledBox).not.toBeNull();
    await page.mouse.move(canceledBox!.x + canceledBox!.width / 2, canceledBox!.y + 18);
    await page.mouse.down();
    await page.mouse.move(blockedBox!.x + blockedBox!.width / 2, blockedBox!.y + 90, {
      steps: 8,
    });
    await page.mouse.up();
    await expect(blocked.locator(`[data-task-id="${movingId}"]`)).toBeVisible();
    expect(moveRequests).toHaveLength(1);
    expect(moveRequests[0]).toMatchObject({
      taskId: movingId,
      destinationStatus: 'blocked',
      destinationIndex: 0,
    });
    await expect
      .poll(async () => {
        const response = await page.request.get(`${API_BASE}/api/tasks/${movingId}`);
        return unwrapApiData<Record<string, unknown>>(await response.json()).status;
      })
      .toBe('blocked');
    await expect(page.getByText(/Atomic matrix moving moved to Blocked/)).toHaveCount(1);

    const todoCards = page.getByRole('region', { name: 'To Do' }).locator('[data-task-id]');
    const beforeWithinOrder = await todoCards.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-task-id')).filter(Boolean)
    );
    expect(beforeWithinOrder).toHaveLength(2);
    const targetWithinId = beforeWithinOrder[0] as string;
    const sourceWithinId = beforeWithinOrder[1] as string;
    const secondCard = page.locator(`[data-task-id="${sourceWithinId}"]`);
    await secondCard.focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Space');

    await expect.poll(() => moveRequests.length).toBe(2);
    expect(moveRequests[1]).toMatchObject({
      taskId: sourceWithinId,
      destinationStatus: 'todo',
    });
    expect(moveRequests[1].destinationIndex).toBeGreaterThanOrEqual(0);
    const visibleTodoOrder = await page
      .getByRole('region', { name: 'To Do' })
      .locator('[data-task-id]')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-task-id')));
    expect(visibleTodoOrder.indexOf(sourceWithinId)).toBeLessThan(
      visibleTodoOrder.indexOf(targetWithinId)
    );
    await expect
      .poll(async () => {
        const response = await page.request.get(`${API_BASE}/api/tasks/${sourceWithinId}`);
        const task = unwrapApiData<Record<string, unknown>>(await response.json());
        return { status: task.status, hasPosition: typeof task.position === 'number' };
      })
      .toEqual({ status: 'todo', hasPosition: true });
  });
});
