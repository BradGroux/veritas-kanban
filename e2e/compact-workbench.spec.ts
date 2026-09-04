import { expect, test, type Route } from '@playwright/test';
import { bypassAuth, cleanupRoutes } from './helpers/auth';

for (const theme of ['dark', 'light']) {
  test(`compact Workbench preserves geometry, controls, drafts, and focus in ${theme}`, async ({
    page,
  }) => {
    await bypassAuth(page);
    await page.addInitScript((theme) => {
      localStorage.setItem('veritas-kanban-theme', theme);
      localStorage.setItem('veritas.desktop.leftRailOpen', 'true');
      localStorage.setItem('veritas.desktop.rightRailOpen', 'true');
      Object.defineProperty(window, 'veritasDesktop', {
        configurable: true,
        value: {
          onMenuCommand: () => () => undefined,
          toggleWindowMaximize: async () => ({ maximized: false }),
        },
      });
    }, theme);
    await page.setViewportSize({ width: 1180, height: 760 });
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Expand left sidebar' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Expand right sidebar' })).toBeVisible();
    const main = page.locator('.desktop-main-content');
    await expect.poll(() => main.evaluate((el) => el.getBoundingClientRect().width)).toBe(1132);
    const width = await main.evaluate((el) => el.getBoundingClientRect().width);
    await page.getByRole('button', { name: 'Open Squad Chat' }).click();
    const squad = page.getByRole('region', { name: 'Squad Chat', exact: true });
    await expect(squad).toBeVisible();
    expect(await main.evaluate((el) => el.getBoundingClientRect().width)).toBe(width);
    const clipped = await squad
      .locator('.mantine-Button-label')
      .evaluateAll((es) =>
        es.filter((e) => e.scrollWidth > e.clientWidth + 2).map((e) => e.textContent)
      );
    expect(clipped).toEqual([]);
    await squad.getByPlaceholder('Send a message to the squad...').fill('Keep this Squad draft');
    await page.getByRole('button', { name: 'Switch to Board Chat' }).click();
    await page.getByPlaceholder('Type a message...').fill('Keep this Board draft');
    await page.getByRole('button', { name: 'Switch to Squad Chat' }).click();
    await expect(squad.getByPlaceholder('Send a message to the squad...')).toHaveValue(
      'Keep this Squad draft'
    );
    await page.getByRole('button', { name: 'Close Squad Chat panel' }).click();
    await page.getByRole('button', { name: 'Open Board Chat' }).click();
    await expect(page.getByPlaceholder('Type a message...')).toHaveValue('Keep this Board draft');
    const dock = page.getByRole('region', { name: 'Workbench right dock' });
    await page.getByRole('button', { name: 'Expand left sidebar' }).click();
    await expect(dock).toHaveCount(0);
    await page.getByRole('button', { name: 'Expand right sidebar' }).click();
    await expect(page.getByRole('button', { name: 'Expand left sidebar' })).toBeVisible();
    await page.getByRole('button', { name: 'Open Squad Chat' }).click();
    await expect(page.getByRole('button', { name: 'Expand right sidebar' })).toBeVisible();

    // Exercise the smallest dock and enlarged text, not just the default 420px width.
    await page.getByRole('button', { name: 'Resize right dock' }).press('Home');
    await page.evaluate(() => (document.documentElement.style.fontSize = '20px'));
    expect(
      await squad
        .locator('.mantine-Button-label')
        .evaluateAll((es) =>
          es.filter((e) => e.scrollWidth > e.clientWidth + 2).map((e) => e.textContent)
        )
    ).toEqual([]);
    const filtersTrigger = squad.getByRole('button', { name: 'Squad filters and actions' });
    await filtersTrigger.focus();
    await filtersTrigger.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Squad filters and actions' })).toBeVisible();
    await filtersTrigger.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Squad filters and actions' })).toBeHidden();
    await expect(filtersTrigger).toBeFocused();
    await expect(dock).toBeVisible();
    for (const name of ['Filter by agent', 'Sending as']) {
      if (name === 'Filter by agent')
        await squad.getByRole('button', { name: 'Squad filters and actions' }).click();
      const selector = (
        name === 'Filter by agent'
          ? page.getByRole('dialog', { name: 'Squad filters and actions', exact: true })
          : squad
      ).getByRole('combobox', { name, exact: true });
      await selector.click();
      const menu = page.getByRole('listbox', { name, exact: true });
      await expect(menu).toBeVisible();
      const box = await menu.boundingBox();
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(760);
      await selector.press('Escape');
      await expect(menu).toBeHidden();
      await expect(dock).toBeVisible();
      await expect(selector).toBeFocused();
      await selector.click();
      await selector.press('ArrowDown');
      await selector.press('Enter');
      await expect(dock).toBeVisible();
      if (name === 'Filter by agent') {
        await selector.press('Escape');
        await expect(selector).toBeHidden();
        await expect(dock).toBeVisible();
        await expect(
          squad.getByRole('button', { name: 'Squad filters and actions' })
        ).toBeFocused();
      }
    }
    await page.evaluate(() => (document.documentElement.style.fontSize = ''));
    for (let cycle = 0; cycle < 2; cycle++) {
      await page.setViewportSize({ width: 1360, height: 900 });
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          )
      );
      await page.setViewportSize({ width: 1180, height: 760 });
      await expect(dock).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Open Squad Chat' })).toBeFocused();
      await page.getByRole('button', { name: 'Open Squad Chat' }).click();
      await expect(squad.getByPlaceholder('Send a message to the squad...')).toHaveValue(
        'Keep this Squad draft'
      );
    }
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(760);
    expect(await main.evaluate((el) => el.getBoundingClientRect().width)).toBe(width);
    // Never dispatch real chat: hold a mock response until its channel is hidden.
    for (const channel of ['Squad', 'Board']) {
      if (channel === 'Board')
        await page.getByRole('button', { name: 'Switch to Board Chat' }).click();
      let pending!: Route;
      const ready = new Promise<void>((resolve) => {
        void page.route(
          channel === 'Board' ? '**/api/chat/send' : '**/api/chat/squad',
          async (route) => {
            if (route.request().method() !== 'POST') return route.fallback();
            pending = route;
            resolve();
          }
        );
      });
      await page.route('**/api/chat/sessions/mock-session', (route) =>
        route.fulfill({ json: { id: 'mock-session', messages: [] } })
      );
      await page
        .getByRole('button', {
          name: channel === 'Board' ? 'Send chat message' : 'Send squad message',
          exact: true,
        })
        .click();
      await ready;
      await page.getByRole('button', { name: /^Close (Board|Squad) Chat panel$/ }).click();
      const responseReceived = page.waitForResponse(
        (response) => response.request() === pending.request()
      );
      await pending.fulfill({
        json:
          channel === 'Board'
            ? { sessionId: 'mock-session', messageId: 'mock-message', message: 'accepted' }
            : {
                id: 'mock-message',
                agent: 'Human',
                message: 'Native-free test',
                timestamp: new Date().toISOString(),
              },
      });
      await responseReceived;
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          )
      );
      await page.getByRole('button', { name: `Open ${channel} Chat`, exact: true }).click();
      await expect(
        page.getByPlaceholder(
          channel === 'Board' ? 'Type a message...' : 'Send a message to the squad...'
        )
      ).toHaveValue('');
    }
    await cleanupRoutes(page);
  });
}
