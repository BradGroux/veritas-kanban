import { expect, test, type Page } from '@playwright/test';
import { bypassAuth, cleanupRoutes, deleteTask, seedTestTask } from './helpers/auth';

test.use({ viewport: { width: 320, height: 844 }, isMobile: true, hasTouch: true });
test.beforeEach(async ({ page }) => bypassAuth(page));
test.afterEach(async ({ page }) => cleanupRoutes(page));

async function assertNavigationFits(page: Page) {
  const navigation = page.getByRole('navigation', { name: 'Mobile navigation' });
  await expect(navigation).toBeVisible();
  const labels = navigation.locator('[data-mobile-nav-label]');
  await expect(labels).toHaveText(['Home', 'Board', 'Alerts', 'Runs', 'Work', 'Settings']);
  expect(
    await labels.evaluateAll((elements) =>
      elements.filter((el) => el.scrollWidth > el.clientWidth).map((el) => el.textContent)
    )
  ).toEqual([]);
  const targets = await navigation.locator('button').evaluateAll((buttons) =>
    buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return {
        name: button.getAttribute('aria-label'),
        width: rect.width,
        height: rect.height,
        inside: rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
        reachable: button.contains(
          document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
        ),
      };
    })
  );
  for (const target of targets) {
    expect(target.inside, target.name!).toBe(true);
    expect(target.reachable, target.name!).toBe(true);
    expect(target.width, target.name!).toBeGreaterThanOrEqual(44);
    expect(target.height, target.name!).toBeGreaterThanOrEqual(44);
  }
  await expect
    .poll(async () => {
      const nav = await page.locator('[data-mobile-navigation-surface]').boundingBox();
      const chat = await page.getByRole('button', { name: 'Open chat', exact: true }).boundingBox();
      return !!nav && !!chat && chat.y >= nav.y && chat.y + chat.height <= nav.y + nav.height;
    })
    .toBe(true);
  expect(
    await page
      .locator('#main-content')
      .evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom))
  ).toBeGreaterThan((await page.locator('[data-mobile-navigation-surface]').boundingBox())!.height);
}

for (const width of [320, 390, 430]) {
  for (const textSize of [16, 20]) {
    for (const theme of ['light', 'dark']) {
      test(`readable mobile layout at ${width}px, ${textSize}px text, ${theme}`, async ({
        page,
      }, testInfo) => {
        await page.setViewportSize({ width, height: 844 });
        await page.addInitScript(
          (value) => localStorage.setItem('veritas-kanban-theme', value),
          theme
        );
        const task = await seedTestTask(page, { title: 'Readable task summary', type: 'code' });
        try {
          await page.goto('/');
          await page.addStyleTag({ content: `:root { font-size: ${textSize}px !important; }` });
          await expect(page.locator('#mobile-board-columns')).toBeVisible();
          await assertNavigationFits(page);
          expect(await page.evaluate(() => innerWidth)).toBe(width);
          await testInfo.attach('navigation', {
            body: await page.screenshot(),
            contentType: 'image/png',
          });
          await page.getByRole('heading', { name: 'Readable task summary', exact: true }).click();
          const detail = page.getByTestId('task-detail-panel');
          await detail.getByRole('combobox', { name: 'Task workspace mode', exact: true }).click();
          await page.getByRole('option', { name: 'Overview', exact: true }).click();
          const card = page.getByTestId('task-overview-primary');
          await expect(card).toBeVisible();
          const title = card.getByRole('heading', { name: 'Needs preparation' });
          const action = card.getByTestId('task-overview-primary-action');
          const summary = title.locator('..');
          const [summaryBox, actionBox, cardBox] = await Promise.all([
            summary.boundingBox(),
            action.boundingBox(),
            card.boundingBox(),
          ]);
          expect(summaryBox).not.toBeNull();
          expect(actionBox).not.toBeNull();
          expect(cardBox).not.toBeNull();
          expect(actionBox!.y).toBeGreaterThan(summaryBox!.y + summaryBox!.height);
          expect(summaryBox!.width).toBeGreaterThan(cardBox!.width * 0.75);
          expect(await summary.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
          await testInfo.attach('summary', {
            body: await page.screenshot(),
            contentType: 'image/png',
          });
          await action.click();
          await expect(detail.getByRole('combobox', { name: 'Task workspace mode' })).toHaveValue(
            'Plan'
          );
          await detail.getByRole('button', { name: 'Close task workspace' }).click();
          await expect(detail).not.toBeVisible();
        } finally {
          await deleteTask(page, task.id as string);
        }
      });
    }
  }
}

test('navigation height follows window and text resizing', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#mobile-board-columns')).toBeVisible();
  const navigation = page.getByRole('navigation', { name: 'Mobile navigation' });
  const surface = page.locator('[data-mobile-navigation-surface]');
  for (const width of [320, 680, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await assertNavigationFits(page);
    await expect
      .poll(async () => {
        const height = (await surface.boundingBox())!.height;
        const reserved = await page.evaluate(() =>
          parseFloat(document.documentElement.style.getPropertyValue('--vk-mobile-nav-height'))
        );
        return Math.abs(height - reserved);
      })
      .toBeLessThan(1);
  }
  await page.addStyleTag({ content: ':root { font-size: 20px !important; }' });
  await assertNavigationFits(page);
  // Safe-area changes can alter padding without changing the content box.
  await surface.evaluate((el) => {
    el.style.paddingBottom = '42px';
  });
  await expect
    .poll(async () => {
      const height = (await surface.boundingBox())!.height;
      const reserved = await page.evaluate(() =>
        parseFloat(document.documentElement.style.getPropertyValue('--vk-mobile-nav-height'))
      );
      return Math.abs(height - reserved);
    })
    .toBeLessThan(1);
  await assertNavigationFits(page);
  await page.setViewportSize({ width: 900, height: 844 });
  await expect(navigation).not.toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.style.getPropertyValue('--vk-mobile-nav-height'))
    )
    .toBe('0px');
});

test('all six mobile destinations remain usable', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#mobile-board-columns')).toBeVisible();
  await page.addStyleTag({ content: ':root { font-size: 20px !important; }' });
  await page.getByRole('button', { name: 'Mobile runs', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Workflows', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mobile board', exact: true }).click();
  await expect(page.locator('#mobile-board-columns')).toBeVisible();
  await page.getByRole('button', { name: 'Mobile home', exact: true }).click();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await page.getByRole('button', { name: 'Mobile notifications', exact: true }).click();
  const notifications = page.getByRole('dialog', { name: 'Notifications', exact: true });
  await expect(notifications).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(notifications).not.toBeVisible();
  await page.getByRole('button', { name: 'Mobile work', exact: true }).click();
  const search = page.getByRole('dialog', { name: 'Universal Search', exact: true });
  await expect(search).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(search).not.toBeVisible();
  await page.getByRole('button', { name: 'Mobile settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: /^Settings/ });
  await expect(settings).toBeVisible();
  await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(settings).not.toBeVisible();
  await assertNavigationFits(page);
});
