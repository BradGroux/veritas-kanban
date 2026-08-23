import { test, expect } from '@playwright/test';
import { bypassAuth, cleanupRoutes, deleteTask, seedTestTask } from './helpers/auth';

test('long task detail content remains constrained and scrollable', async ({ page }) => {
  await bypassAuth(page);
  const task = await seedTestTask(page, {
    title: 'E2E Scroll Regression Task',
    description: Array.from(
      { length: 120 },
      (_, index) => `Scroll regression paragraph ${index + 1}`
    ).join('\n\n'),
    status: 'todo',
  });

  try {
    await page.goto('/');
    await page.getByText('E2E Scroll Regression Task').first().click();

    const detailPanel = page.getByRole('dialog');
    const tabsRoot = detailPanel.locator('.mantine-Tabs-root').first();
    const scrollPanel = detailPanel.locator('.veritas-overlay-scroll').first();

    await expect(tabsRoot).toHaveCSS('display', 'flex');
    await expect(tabsRoot).toHaveCSS('flex-direction', 'column');

    const dimensions = await scrollPanel.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));
    expect(dimensions.clientHeight).toBeLessThan(dimensions.scrollHeight);

    const scrollBox = await scrollPanel.boundingBox();
    expect(scrollBox).not.toBeNull();
    await page.mouse.move(
      scrollBox!.x + scrollBox!.width - 4,
      scrollBox!.y + scrollBox!.height / 2
    );
    await page.mouse.wheel(0, 600);
    await expect
      .poll(() => scrollPanel.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
  } finally {
    await deleteTask(page, (task as { id: string }).id).catch(() => {});
    await cleanupRoutes(page);
  }
});
