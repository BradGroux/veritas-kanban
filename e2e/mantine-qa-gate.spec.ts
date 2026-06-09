import { expect, type Page, type TestInfo, test } from '@playwright/test';
import { bypassAuth, cleanupRoutes, deleteTask, seedTestTask } from './helpers/auth';

const COLOR_SCHEME_STORAGE_KEY = 'veritas-kanban-theme';

const desktopViewport = { width: 1440, height: 1000 };
const mobileViewport = { width: 390, height: 844 };

const routeSurfaces = [
  {
    name: 'board',
    path: '/',
    ready: async (page: Page) => {
      await expect(page.getByRole('region', { name: 'To Do' })).toBeVisible({
        timeout: 15_000,
      });
    },
  },
  {
    name: 'activity',
    path: '/activity',
    ready: async (page: Page) => {
      await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible({
        timeout: 15_000,
      });
    },
  },
  {
    name: 'backlog',
    path: '/backlog',
    ready: async (page: Page) => {
      await expect(page.getByRole('heading', { name: 'Backlog' })).toBeVisible({
        timeout: 15_000,
      });
    },
  },
  {
    name: 'archive',
    path: '/archive',
    ready: async (page: Page) => {
      await expect(page.getByRole('heading', { name: 'Archive' })).toBeVisible({
        timeout: 15_000,
      });
    },
  },
  {
    name: 'templates',
    path: '/templates',
    ready: async (page: Page) => {
      await expect(page.getByRole('heading', { name: 'Task Templates' })).toBeVisible({
        timeout: 15_000,
      });
    },
  },
  {
    name: 'workflows',
    path: '/workflows',
    ready: async (page: Page) => {
      await expect(page.getByRole('heading', { name: 'Workflows' })).toBeVisible({
        timeout: 15_000,
      });
    },
  },
  {
    name: 'drift',
    path: '/drift',
    ready: async (page: Page) => {
      await expect(page.getByRole('heading', { name: 'Behavioral Drift Monitor' })).toBeVisible({
        timeout: 15_000,
      });
    },
  },
  {
    name: 'decisions',
    path: '/decisions',
    ready: async (page: Page) => {
      await expect(page.getByRole('heading', { name: 'Decision Audit Trail' })).toBeVisible({
        timeout: 15_000,
      });
    },
  },
  {
    name: 'scoring',
    path: '/scoring',
    ready: async (page: Page) => {
      await expect(page.getByRole('heading', { name: 'Agent Output Scoring' })).toBeVisible({
        timeout: 15_000,
      });
    },
  },
  {
    name: 'policies',
    path: '/policies',
    ready: async (page: Page) => {
      await expect(page.getByRole('heading', { name: 'Agent Policies' })).toBeVisible({
        timeout: 15_000,
      });
    },
  },
] as const;

async function mockAgentStatus(page: Page) {
  await page.route(/\/api\/agent\/status(?:\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          status: 'idle',
          subAgentCount: 0,
          activeAgents: [],
          lastUpdated: new Date().toISOString(),
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      }),
    })
  );
}

async function mockEmptyTaskChatSessions(page: Page) {
  await page.route('**/api/chat/sessions/task_*', (route) => {
    const sessionId = new URL(route.request().url()).pathname.split('/').pop() ?? 'task_unknown';
    const taskId = sessionId.replace(/^task_/, '');
    const timestamp = new Date().toISOString();

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: sessionId,
        taskId,
        title: 'Task Chat',
        messages: [],
        agent: 'default',
        mode: 'ask',
        created: timestamp,
        updated: timestamp,
      }),
    });
  });
}

function getSeededTaskId(task: Record<string, unknown>) {
  const directId = task.id;
  const dataId =
    task.data && typeof task.data === 'object' ? (task.data as Record<string, unknown>).id : null;
  const id = typeof directId === 'string' ? directId : dataId;

  return typeof id === 'string' ? id : null;
}

function captureUnexpectedBrowserErrors(page: Page): string[] {
  const messages: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      const location = message.location();
      messages.push(`${message.text()}${location.url ? ` (${location.url})` : ''}`);
    }
  });

  page.on('pageerror', (error) => {
    messages.push(error.message);
  });

  return messages;
}

async function setColorScheme(page: Page, scheme: 'dark' | 'light') {
  await page.evaluate(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
      document.documentElement.dataset.mantineColorScheme = value;
      document.documentElement.classList.toggle('dark', value === 'dark');
    },
    { key: COLOR_SCHEME_STORAGE_KEY, value: scheme }
  );
}

async function attachViewportScreenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
  scheme: 'dark' | 'light'
) {
  const screenshot = await page.screenshot({
    animations: 'disabled',
    fullPage: false,
  });

  await testInfo.attach(`${name}-${scheme}-${page.viewportSize()?.width ?? 'viewport'}.png`, {
    body: screenshot,
    contentType: 'image/png',
  });
}

async function assertColorScheme(page: Page, scheme: 'dark' | 'light') {
  await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', scheme);

  const hasDarkClass = await page
    .locator('html')
    .evaluate((element) => element.classList.contains('dark'));
  expect(hasDarkClass).toBe(scheme === 'dark');
}

async function assertNoLegacyPrimitiveSlots(page: Page) {
  const legacySlots = page.locator(
    [
      '[data-slot="alert-dialog-content"]',
      '[data-slot="button"]',
      '[data-slot="checkbox"]',
      '[data-slot="dialog-content"]',
      '[data-slot="input"]',
      '[data-slot="label"]',
      '[data-slot="select-trigger"]',
      '[data-slot="sheet-content"]',
      '[data-slot="switch"]',
      '[data-slot="tabs-list"]',
      '[data-slot="textarea"]',
      '[data-slot="tooltip-content"]',
    ].join(',')
  );

  await expect(legacySlots).toHaveCount(0);
}

async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    offenders: Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          html: element.outerHTML.slice(0, 220),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      })
      .filter((entry) => entry.right > document.documentElement.clientWidth + 2)
      .sort((a, b) => b.right - a.right)
      .slice(0, 5),
    scrollWidth: document.documentElement.scrollWidth,
  }));

  expect(
    overflow.scrollWidth,
    `Horizontal overflow offenders: ${JSON.stringify(overflow.offenders)}`
  ).toBeLessThanOrEqual(overflow.clientWidth + 2);
}

async function assertVisibleInteractiveControlsHaveNames(page: Page) {
  const missingNames = await page.evaluate(() => {
    const selector = [
      'a[href]',
      'button',
      'input:not([type="hidden"])',
      'select',
      'textarea',
      '[role="button"]',
      '[role="combobox"]',
      '[role="switch"]',
      '[role="tab"]',
    ].join(',');

    function isVisible(element: Element) {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        !element.classList.contains('sr-only')
      );
    }

    function labelledByText(element: Element) {
      const labelledBy = element.getAttribute('aria-labelledby');
      if (!labelledBy) return '';

      return labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
        .join(' ')
        .trim();
    }

    function associatedLabelText(element: Element) {
      const id = element.getAttribute('id');
      if (!id) return '';
      return document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent?.trim() ?? '';
    }

    return Array.from(document.querySelectorAll(selector))
      .filter((element) => isVisible(element))
      .filter((element) => !element.closest('[aria-hidden="true"]'))
      .map((element) => {
        const text = element.textContent?.trim() ?? '';
        const name =
          element.getAttribute('aria-label')?.trim() ||
          labelledByText(element) ||
          associatedLabelText(element) ||
          element.getAttribute('title')?.trim() ||
          element.getAttribute('placeholder')?.trim() ||
          text;

        return {
          hasName: name.length > 0,
          html: element.outerHTML.slice(0, 240),
        };
      })
      .filter((entry) => !entry.hasName)
      .map((entry) => entry.html);
  });

  expect(missingNames).toEqual([]);
}

async function assertMobileTouchTargets(page: Page) {
  const undersizedTargets = await page.evaluate(() => {
    const selector = [
      'a[href]',
      'button',
      'input:not([type="hidden"])',
      'select',
      'textarea',
      '[role="button"]',
      '[role="combobox"]',
      '[role="switch"]',
      '[role="tab"]',
    ].join(',');

    function isVisible(element: Element) {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        !element.classList.contains('sr-only')
      );
    }

    return Array.from(document.querySelectorAll(selector))
      .filter((element) => isVisible(element))
      .filter((element) => !element.closest('[aria-hidden="true"]'))
      .map((element) => {
        const hitTarget = element.classList.contains('mantine-Switch-input')
          ? (element.closest('.mantine-Switch-root') ?? element.closest('label') ?? element)
          : element;
        const rect = hitTarget.getBoundingClientRect();
        return {
          ariaLabel: element.getAttribute('aria-label'),
          height: Math.round(rect.height),
          html: element.outerHTML.slice(0, 500),
          hitTargetHtml: hitTarget.outerHTML.slice(0, 500),
          text: element.textContent?.trim(),
          title: element.getAttribute('title'),
          width: Math.round(rect.width),
        };
      })
      .filter((entry) => entry.height < 32 || entry.width < 32);
  });

  expect(undersizedTargets).toEqual([]);
}

async function assertKeyboardFocusLandsOnVisibleControl(page: Page) {
  await page.keyboard.press('Tab');

  const focused = await page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return null;
    const rect = element.getBoundingClientRect();
    return {
      height: rect.height,
      tagName: element.tagName,
      width: rect.width,
    };
  });

  expect(focused).not.toBeNull();
  expect(focused?.width).toBeGreaterThan(0);
  expect(focused?.height).toBeGreaterThan(0);
}

async function assertFocusRemainsInsideDialog(page: Page, dialogLabel: string) {
  const dialog = page.locator('[role="dialog"]').last();
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  const focusable = dialog.locator(
    [
      'a[href]',
      'button:not([disabled])',
      'input:not([type="hidden"]):not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[role="button"]:not([aria-disabled="true"])',
      '[role="combobox"]:not([aria-disabled="true"])',
      '[role="tab"]:not([aria-disabled="true"])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',')
  );
  await focusable.first().focus();

  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press('Tab');
    const focusState = await page.evaluate((step) => {
      const active = document.activeElement;
      const activeElement = active instanceof HTMLElement ? active : null;
      const dialogElement = Array.from(document.querySelectorAll('[role="dialog"]')).find(
        (element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }
      );

      return {
        activeHtml: activeElement?.outerHTML.slice(0, 220) ?? null,
        activeText: activeElement?.textContent?.trim().slice(0, 120) ?? null,
        dialogCount: document.querySelectorAll('[role="dialog"]').length,
        hasVisibleDialog: Boolean(dialogElement),
        inside: Boolean(active && dialogElement?.contains(active)),
        step,
      };
    }, i + 1);

    expect(
      focusState.inside,
      `${dialogLabel} should keep keyboard focus inside its dialog/drawer: ${JSON.stringify(focusState)}`
    ).toBe(true);
  }
}

test.describe('v5 Mantine migration QA gate', () => {
  test.describe.configure({ mode: 'serial' });

  let createdTaskIds: string[] = [];

  test.beforeEach(async ({ page }) => {
    await bypassAuth(page);
    await mockAgentStatus(page);
    await mockEmptyTaskChatSessions(page);
  });

  test.afterEach(async ({ page }) => {
    for (const taskId of createdTaskIds) {
      await deleteTask(page, taskId).catch(() => {});
    }
    createdTaskIds = [];
    await cleanupRoutes(page);
  });

  test('captures desktop visual and accessibility smoke for every current app route', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const browserErrors = captureUnexpectedBrowserErrors(page);

    for (const scheme of ['dark', 'light'] as const) {
      await page.setViewportSize(desktopViewport);

      for (const surface of routeSurfaces) {
        await page.goto(surface.path, { timeout: 15_000 });
        await surface.ready(page);
        await setColorScheme(page, scheme);

        await assertColorScheme(page, scheme);
        await assertNoLegacyPrimitiveSlots(page);
        await assertNoHorizontalOverflow(page);
        await assertVisibleInteractiveControlsHaveNames(page);
        await assertKeyboardFocusLandsOnVisibleControl(page);
        await attachViewportScreenshot(page, testInfo, `route-${surface.name}-desktop`, scheme);
      }
    }

    expect(browserErrors).toEqual([]);
  });

  test('covers migrated overlays, focus traps, and form controls', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const browserErrors = captureUnexpectedBrowserErrors(page);
    const taskTitle = `Mantine QA Detail ${Date.now()}`;
    const task = await seedTestTask(page, {
      title: taskTitle,
      status: 'todo',
      priority: 'high',
      description: 'Task seeded for the Mantine migration QA gate.',
    });
    const taskId = getSeededTaskId(task);
    if (taskId) createdTaskIds.push(taskId);

    await page.setViewportSize(desktopViewport);
    await page.goto('/', { timeout: 15_000 });
    await expect(page.getByRole('region', { name: 'To Do' })).toBeVisible({
      timeout: 15_000,
    });
    await setColorScheme(page, 'dark');

    await page.getByRole('button', { name: /New Task/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
    await assertNoLegacyPrimitiveSlots(page);
    await assertVisibleInteractiveControlsHaveNames(page);
    await assertFocusRemainsInsideDialog(page, 'Create task');
    await attachViewportScreenshot(page, testInfo, 'overlay-create-task-desktop', 'dark');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 });

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const settingsDialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(settingsDialog).toBeVisible({ timeout: 5_000 });
    await settingsDialog.getByRole('tab', { name: 'Board' }).click();
    await assertNoLegacyPrimitiveSlots(page);
    await assertVisibleInteractiveControlsHaveNames(page);
    await assertFocusRemainsInsideDialog(page, 'Settings');
    await attachViewportScreenshot(page, testInfo, 'overlay-settings-desktop', 'dark');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 });

    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('textbox', { name: 'Search Veritas' })).toBeVisible();
    await assertNoLegacyPrimitiveSlots(page);
    await assertVisibleInteractiveControlsHaveNames(page);
    await assertFocusRemainsInsideDialog(page, 'Search');
    await attachViewportScreenshot(page, testInfo, 'overlay-search-desktop', 'dark');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 });

    await page.getByRole('button', { name: 'Command palette' }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('textbox', { name: 'Search commands' })).toBeVisible();
    await assertNoLegacyPrimitiveSlots(page);
    await assertVisibleInteractiveControlsHaveNames(page);
    await assertFocusRemainsInsideDialog(page, 'Command palette');
    await attachViewportScreenshot(page, testInfo, 'overlay-command-palette-desktop', 'dark');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 });

    await page.getByRole('heading', { name: taskTitle }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.mantine-Drawer-content')).toBeVisible();
    await assertNoLegacyPrimitiveSlots(page);
    await assertVisibleInteractiveControlsHaveNames(page);
    await assertFocusRemainsInsideDialog(page, 'Task detail');
    await attachViewportScreenshot(page, testInfo, 'overlay-task-detail-desktop', 'dark');

    expect(browserErrors).toEqual([]);
  });

  test('captures mobile board, task detail, settings, and auth/setup smoke', async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const browserErrors = captureUnexpectedBrowserErrors(page);
    const taskTitle = `Mantine Mobile QA ${Date.now()}`;
    const task = await seedTestTask(page, {
      title: taskTitle,
      status: 'todo',
      priority: 'medium',
    });
    const taskId = getSeededTaskId(task);
    if (taskId) createdTaskIds.push(taskId);

    await page.setViewportSize(mobileViewport);
    await page.goto('/', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Mobile board' }).click();
    await expect(page.getByRole('region', { name: 'To Do' })).toBeVisible({
      timeout: 15_000,
    });
    await setColorScheme(page, 'dark');
    await assertNoHorizontalOverflow(page);
    await assertMobileTouchTargets(page);
    await assertNoLegacyPrimitiveSlots(page);
    await attachViewportScreenshot(page, testInfo, 'mobile-board', 'dark');

    await page.getByRole('heading', { name: taskTitle }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.mantine-Drawer-content')).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await assertMobileTouchTargets(page);
    await assertNoLegacyPrimitiveSlots(page);
    await attachViewportScreenshot(page, testInfo, 'mobile-task-detail', 'dark');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 });

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
    await assertNoHorizontalOverflow(page);
    await assertMobileTouchTargets(page);
    await assertNoLegacyPrimitiveSlots(page);
    await attachViewportScreenshot(page, testInfo, 'mobile-settings', 'dark');

    await cleanupRoutes(page);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.route('**/api/auth/status', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          authenticated: false,
          authEnabled: true,
          needsSetup: true,
          sessionExpiry: null,
        }),
      })
    );

    await page.goto('/', { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Choose setup path' })).toBeVisible({
      timeout: 15_000,
    });
    await assertNoHorizontalOverflow(page);
    await assertMobileTouchTargets(page);
    await assertNoLegacyPrimitiveSlots(page);
    await page.getByRole('button', { name: 'Continue to Password' }).click();
    await expect(page.getByRole('heading', { name: 'Secure Your Board' })).toBeVisible({
      timeout: 15_000,
    });
    await assertNoHorizontalOverflow(page);
    await assertMobileTouchTargets(page);
    await assertNoLegacyPrimitiveSlots(page);
    await attachViewportScreenshot(page, testInfo, 'mobile-auth-setup', 'dark');

    expect(browserErrors).toEqual([]);
  });
});
