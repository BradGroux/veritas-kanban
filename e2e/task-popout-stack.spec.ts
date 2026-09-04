import { expect, test } from '@playwright/test';
import { bypassAuth, cleanupRoutes, deleteTask, seedTestTask, unwrapApiData } from './helpers/auth';

for (const theme of ['light', 'dark']) {
  test(`nested task utilities retain fixed controls and Escape ownership in ${theme}`, async ({
    page,
  }) => {
    await bypassAuth(page);
    await page.addInitScript((theme) => localStorage.setItem('veritas-kanban-theme', theme), theme);
    const title = `Task utility fixture ${theme}`;
    const task = await seedTestTask(page, {
      title,
      type: 'code',
      git: {
        repo: 'Fixture/repo',
        branch: 'fixture',
        baseBranch: 'main',
        worktreePath: '/tmp/task-overlay-fixture',
        worktreeManifestId: 'fixture-manifest',
      },
    });
    const writes: string[] = [];
    // The public update API deliberately cannot manufacture a managed worktree.
    // Add ownership only to the browser's synthetic read fixture, never storage.
    await page.route(/\/api\/tasks(?:\/[^/?]+)?(?:\?.*)?$/, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const response = await route.fetch();
      const json = JSON.parse(JSON.stringify(await response.json()), (_key, value) =>
        value && typeof value === 'object' && value.id === task.id
          ? { ...value, git: { ...value.git, worktreeManifestId: 'fixture-manifest' } }
          : value
      );
      await route.fulfill({ response, json });
    });
    await page.route('**/api/config', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const config = unwrapApiData<Record<string, unknown>>(await (await route.fetch()).json());
      await route.fulfill({
        json: {
          ...config,
          repos: [
            { name: 'Fixture/repo', path: '/tmp/task-overlay-fixture', defaultBranch: 'main' },
          ],
        },
      });
    });
    await page.route(new RegExp(`/api/(?:preview|conflicts)/${task.id}/`), (route) => {
      if (route.request().method() === 'GET') return route.fallback();
      writes.push(route.request().url());
      return route.fulfill({ status: 409, json: { error: 'Read-only fixture' } });
    });
    const fixture = async (path: string, json: unknown) =>
      page.route(path, (route) => {
        if (route.request().method() !== 'GET') {
          writes.push(route.request().url());
          return route.fulfill({ status: 409, json: { error: 'Read-only fixture' } });
        }
        return route.fulfill({ json });
      });
    await fixture(`**/api/preview/${task.id}`, { status: 'stopped' });
    await fixture(`**/api/tasks/${task.id}/worktree`, {
      aheadBehind: { ahead: 1, behind: 0 },
      hasChanges: false,
      changedFiles: 0,
      remoteState: { stale: false },
    });
    await fixture(`**/api/conflicts/${task.id}`, {
      hasConflicts: true,
      conflictingFiles: ['fixture.txt'],
      rebaseInProgress: true,
      mergeInProgress: false,
    });
    await fixture(`**/api/conflicts/${task.id}/file?*`, {
      filePath: 'fixture.txt',
      content: 'Draft resolution',
      oursContent: 'Ours\n'.repeat(100),
      theirsContent: 'Theirs\n'.repeat(100),
      markers: [],
    });
    try {
      await page.setViewportSize({ width: 1700, height: 900 });
      await page.goto('/');
      await page.getByRole('article', { name: `Task: ${title}` }).click();
      const workspace = page.getByTestId('task-detail-panel');
      await workspace.getByRole('button', { name: 'Run', exact: true }).click();
      await workspace.getByRole('tab', { name: /Git/ }).click();
      const previewOpener = workspace.getByRole('button', { name: 'Preview', exact: true });
      await previewOpener.click();
      const preview = page.getByRole('dialog', { name: 'Preview', exact: true });
      await expect(preview).toBeVisible();
      await expect(preview).toHaveCSS('opacity', '1');
      await expect(workspace).toHaveAttribute('inert', '');
      await page.setViewportSize({ width: 900, height: 480 });
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '20px';
      });
      const start = preview.getByRole('button', { name: 'Start Preview', exact: true });
      await expect(start).toBeInViewport({ ratio: 1 });
      const startBox = await start.boundingBox();
      await preview.locator('.vk-overlay-scroll').evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      expect(await start.boundingBox()).toEqual(startBox);
      await page.screenshot({ path: test.info().outputPath(`preview-${theme}.png`) });
      await page.keyboard.press('Escape');
      await expect(preview).toHaveCount(0);
      await expect(previewOpener).toBeFocused();
      const conflictOpener = workspace.getByRole('button', {
        name: 'Resolve Conflicts',
        exact: true,
      });
      await conflictOpener.click();
      const conflict = page.getByRole('dialog', { name: 'Merge Conflicts', exact: true });
      await expect(conflict).toBeVisible();
      await expect(conflict).toHaveCSS('opacity', '1');
      const abortOpener = conflict.getByRole('button', { name: 'Abort', exact: true });
      await expect(abortOpener).toBeInViewport({ ratio: 1 });
      const abortBox = await abortOpener.boundingBox();
      await conflict.locator('.vk-overlay-scroll').evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      expect(await abortOpener.boundingBox()).toEqual(abortBox);
      expect(await conflict.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(
        0
      );
      await page.screenshot({ path: test.info().outputPath(`conflicts-${theme}.png`) });
      await abortOpener.click();
      const confirmation = page.getByRole('dialog', { name: 'Abort Rebase?', exact: true });
      await expect(confirmation).toBeVisible();
      await expect(confirmation).toHaveCSS('opacity', '1');
      await page.screenshot({ path: test.info().outputPath(`abort-${theme}.png`) });
      expect(
        await conflict.evaluate((element) =>
          element.closest('[data-overlay-variant]')?.hasAttribute('inert')
        )
      ).toBe(true);
      await confirmation.getByRole('button', { name: 'Cancel', exact: true }).focus();
      await page.keyboard.press('Escape');
      await expect(confirmation).toHaveCount(0);
      await expect(abortOpener).toBeFocused();
      await expect(workspace).toHaveAttribute('inert', '');
      await page.keyboard.press('Escape');
      await expect(conflict).toHaveCount(0);
      await expect(conflictOpener).toBeFocused();
      expect(writes).toEqual([]);
    } finally {
      await deleteTask(page, String(task.id)).catch(() => {});
      await cleanupRoutes(page).catch(() => {});
    }
  });
  test(`task template popout keeps task state and bounded actions in ${theme}`, async ({
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
    const title = `Task popout fixture ${theme}`;
    const task = await seedTestTask(page, { title, type: 'code', status: 'todo' });
    try {
      await page.setViewportSize({ width: 1700, height: 900 });
      await page.goto('/');
      const card = page.getByRole('article', { name: `Task: ${title}` });
      await card.focus();
      await card.press('Enter');
      const workspace = page.getByTestId('task-detail-panel');
      await workspace.getByRole('button', { name: 'Plan', exact: true }).click();
      const opener = workspace.getByRole('button', { name: 'Template', exact: true });
      for (const geometry of [
        { width: 1700, height: 900, fontSize: '16px' },
        { width: 1180, height: 760, fontSize: '20px' },
        { width: 900, height: 480, fontSize: '20px' },
      ]) {
        await page.setViewportSize(geometry);
        await page.evaluate((fontSize) => {
          document.documentElement.style.fontSize = fontSize;
        }, geometry.fontSize);
        await opener.click();
        const dialog = page.getByRole('dialog', { name: 'Apply Template to Task' });
        await expect(dialog).toBeVisible();
        await expect(workspace).toHaveAttribute('inert', '');
        const scroll = dialog.locator('.vk-overlay-scroll');
        const footer = dialog.locator('.vk-overlay-footer');
        await dialog.getByRole('button', { name: 'Help', exact: true }).click();
        for (const action of ['Cancel', 'Apply Template']) {
          await expect(footer.getByRole('button', { name: action, exact: true })).toBeInViewport({
            ratio: 1,
          });
        }
        const before = await footer.boundingBox();
        await scroll.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        expect(await footer.boundingBox()).toEqual(before);
        const bounds = await dialog.evaluate((element) => ({
          top: element.getBoundingClientRect().top,
          bottom: element.getBoundingClientRect().bottom,
          overflow: element.scrollWidth - element.clientWidth,
        }));
        expect(bounds.top).toBeGreaterThanOrEqual(0);
        expect(bounds.bottom).toBeLessThanOrEqual(geometry.height);
        expect(bounds.overflow).toBe(0);
        await footer.getByRole('button', { name: 'Cancel', exact: true }).focus();
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(workspace).not.toHaveAttribute('inert');
        await expect(opener).toBeFocused();
        await expect(
          workspace.getByRole('textbox', { name: 'Task title', exact: true })
        ).toHaveValue(title);
      }
      await page.keyboard.press('Escape');
      await expect(workspace).toHaveCount(0);
      await expect(card).toBeFocused();
    } finally {
      await deleteTask(page, String(task.id));
      await cleanupRoutes(page);
    }
  });
}
