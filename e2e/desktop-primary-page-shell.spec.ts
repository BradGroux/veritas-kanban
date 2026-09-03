import { expect, type Page, type TestInfo, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { bypassAuth, cleanupRoutes } from './helpers/auth';

const populatedBriefing =
  '# Agent Operations Digest\n\n## Summary\n\n### Active work\n\nOne active task.\n';

const primaryRoutes = [
  { name: 'activity', path: '/activity', title: 'Activity' },
  { name: 'backlog', path: '/backlog', title: 'Backlog' },
  { name: 'archive', path: '/archive', title: 'Archive' },
  { name: 'templates', path: '/templates', title: 'Task Templates' },
  { name: 'workflows', path: '/workflows', title: 'Workflows' },
  { name: 'operations', path: '/operations', title: 'Operations Digest' },
  { name: 'evidence', path: '/evidence', title: 'Evidence Timeline' },
  { name: 'time-breakdowns', path: '/time', title: 'Time Breakdowns' },
  { name: 'drift', path: '/drift', title: 'Behavioral Drift Monitor' },
  { name: 'decisions', path: '/decisions', title: 'Decision Audit Trail' },
  { name: 'scoring', path: '/scoring', title: 'Agent Output Scoring' },
  { name: 'policies', path: '/policies', title: 'Agent Policies' },
] as const;

const matrixModes = [
  { name: 'dark', scheme: 'dark', viewport: { width: 1360, height: 800 }, rootFontSize: '16px' },
  { name: 'light', scheme: 'light', viewport: { width: 1360, height: 800 }, rootFontSize: '16px' },
  { name: 'compact', scheme: 'dark', viewport: { width: 1180, height: 760 }, rootFontSize: '16px' },
  {
    name: 'increased-text',
    scheme: 'light',
    viewport: { width: 1360, height: 800 },
    rootFontSize: '18px',
  },
] as const;

type ShellMetrics = {
  contentY: number;
  headerHeight: number;
  headerY: number;
  route: string;
  titleY: number;
};

async function assertNoHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client + 2);
}

async function capture(page: Page, testInfo: TestInfo, route: string, mode: string) {
  const path = testInfo.outputPath(`primary-page-${route}-${mode}.png`);
  await page.screenshot({ path, animations: 'disabled', fullPage: false });
  await testInfo.attach(`primary-page-${route}-${mode}.png`, {
    path,
    contentType: 'image/png',
  });
}

test.describe('desktop primary page shell', () => {
  test.beforeEach(async ({ page }) => {
    await bypassAuth(page);
    await page.route('**/api/digest/operations?*', (route) => {
      if (new URL(route.request().url()).searchParams.get('format') !== 'markdown') {
        return route.continue();
      }
      return route.fulfill({ json: { isEmpty: false, markdown: populatedBriefing } });
    });
    await page.route('**/api/v1/system/health', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          timestamp: new Date().toISOString(),
          status: 'stable',
          signals: {
            system: { status: 'ok', storage: true, disk: true, memory: true },
            agents: { status: 'ok', total: 0, online: 0, offline: 0 },
            operations: { status: 'ok', recentRuns: 0, successRate: 100, failedRuns: 0 },
          },
        }),
      })
    );
    await page.addInitScript(() => {
      Object.defineProperty(window, 'veritasDesktop', {
        configurable: true,
        value: {
          onMenuCommand: () => () => undefined,
          toggleWindowMaximize: async () => ({ maximized: false }),
        },
      });
      window.localStorage.setItem('veritas.desktop.leftRailOpen', 'false');
    });
  });

  test.afterEach(async ({ page }) => {
    await cleanupRoutes(page);
  });

  test('keeps the complete route matrix aligned, focused, and overflow-free', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);

    for (const mode of matrixModes) {
      await page.setViewportSize(mode.viewport);
      const regularMetrics: ShellMetrics[] = [];

      for (const route of primaryRoutes) {
        await page.goto(route.path, { timeout: 15_000 });
        await expect(page.getByRole('button', { name: /^System health:/ })).toBeVisible({
          timeout: 15_000,
        });
        await page.evaluate(({ rootFontSize, scheme }) => {
          document.documentElement.style.fontSize = rootFontSize;
          document.documentElement.dataset.mantineColorScheme = scheme;
          document.documentElement.classList.toggle('dark', scheme === 'dark');
          window.localStorage.setItem('veritas-kanban-theme', scheme);
        }, mode);

        const shell = page.locator('[data-page-shell="primary"]');
        const heading = shell.getByRole('heading', { level: 1, name: route.title, exact: true });
        const back = shell.getByRole('button', { name: 'Back', exact: true });
        await expect(heading).toBeFocused();
        if (route.name === 'operations') {
          await expect(
            page.getByRole('heading', { name: 'Agent Operations Digest', exact: true })
          ).toBeAttached();
          await expect(
            page.getByRole('heading', { name: 'Rendered Briefing', level: 2 })
          ).toBeAttached();
          await expect(
            page.getByRole('heading', { name: 'Agent Operations Digest', level: 3 })
          ).toBeAttached();
          await expect(page.getByRole('heading', { name: 'Summary', level: 4 })).toBeAttached();
          await expect(page.getByRole('heading', { name: 'Active work', level: 5 })).toBeAttached();
          await expect(page.getByLabel('Operations digest markdown')).toHaveValue(
            populatedBriefing
          );
          const downloadPromise = page.waitForEvent('download');
          await page.getByRole('button', { name: 'Markdown', exact: true }).click();
          const download = await downloadPromise;
          const file = await download.path();
          expect(file).not.toBeNull();
          expect(await readFile(file!, 'utf8')).toBe(populatedBriefing);
          await heading.focus();
        }
        await expect(shell).toHaveCount(1);
        await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
        await expect(heading).toBeVisible({ timeout: 15_000 });
        await expect(heading).toBeFocused();
        await expect(back).toBeVisible();
        await expect(back).toHaveText('');

        const backBox = await back.boundingBox();
        const expectedBackSize = 40 * (Number.parseFloat(mode.rootFontSize) / 16);
        expect(backBox?.width).toBe(expectedBackSize);
        expect(backBox?.height).toBe(expectedBackSize);

        const metrics = await shell.evaluate((element) => {
          const header = element.querySelector<HTMLElement>('.primary-page-header');
          const title = element.querySelector<HTMLElement>('h1');
          const content = element.querySelector<HTMLElement>('.primary-page-content');
          if (!header || !title || !content) throw new Error('Primary page shell is incomplete');
          const headerBox = header.getBoundingClientRect();
          const titleBox = title.getBoundingClientRect();
          const contentBox = content.getBoundingClientRect();
          return {
            contentY: contentBox.y,
            headerHeight: headerBox.height,
            headerY: headerBox.y,
            titleY: titleBox.y,
          };
        });

        if (mode.name === 'dark' || mode.name === 'light') {
          regularMetrics.push({ ...metrics, route: route.name });
        }
        await assertNoHorizontalOverflow(page);
        await capture(page, testInfo, route.name, mode.name);
        if (route.name === 'operations') {
          await page
            .getByRole('heading', { name: 'Rendered Briefing', level: 2 })
            .scrollIntoViewIfNeeded();
          await capture(page, testInfo, 'operations-briefing', mode.name);
        }
      }

      if (regularMetrics.length > 0) {
        const baseline = regularMetrics[0];
        for (const metrics of regularMetrics.slice(1)) {
          expect(
            Math.abs(metrics.headerY - baseline.headerY),
            `${metrics.route} header top should match ${baseline.route}`
          ).toBeLessThanOrEqual(2);
          expect(
            Math.abs(metrics.headerHeight - baseline.headerHeight),
            `${metrics.route} header height should match ${baseline.route}`
          ).toBeLessThanOrEqual(2);
          expect(
            Math.abs(metrics.titleY - baseline.titleY),
            `${metrics.route} title baseline should match ${baseline.route}`
          ).toBeLessThanOrEqual(2);
          expect(
            Math.abs(metrics.contentY - baseline.contentY),
            `${metrics.route} content baseline should match ${baseline.route}`
          ).toBeLessThanOrEqual(2);
        }
      }
    }
  });
});
