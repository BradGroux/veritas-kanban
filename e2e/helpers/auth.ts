import { type Page, type Route } from '@playwright/test';

/**
 * Admin API key for E2E tests.
 * Read from VERITAS_ADMIN_KEY env var (set by playwright.config.ts via dotenv).
 * Falls back to 'dev-admin-key' only for backwards compatibility.
 */
const ADMIN_KEY = process.env.VERITAS_ADMIN_KEY || 'dev-admin-key';

/**
 * Backend API base URL. Direct to Express on port 3001 to avoid
 * Vite proxy issues (IPv4/IPv6 binding differences on macOS).
 */
const API_BASE = process.env.API_BASE_URL || 'http://127.0.0.1:3001';

/**
 * Bypass authentication for E2E tests.
 *
 * Strategy: intercept the /api/auth/status call and return a response
 * indicating auth is disabled. This avoids needing a real password and
 * lets the app render directly without the login screen.
 *
 * All other /api/* requests pass through normally — the dev server has
 * VERITAS_AUTH_LOCALHOST_BYPASS=true so API calls succeed without a JWT.
 */
export async function bypassAuth(page: Page): Promise<void> {
  // Bypass auth check — mock the auth status endpoint
  await page.route('**/api/auth/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        needsSetup: false,
        authenticated: true,
        sessionExpiry: new Date(Date.now() + 86400000).toISOString(),
        authEnabled: true,
      }),
    })
  );

  // Add 429 retry interceptor for all API calls from the browser.
  // The dev server has rate limiting which E2E tests can exceed.
  await page.route('**/api/**', async (route: Route) => {
    const url = route.request().url();
    // Skip the auth/status route (already handled by the specific handler above).
    // Use route.fallback() so Playwright passes the request to the next matching
    // handler instead of hanging (routes are matched LIFO).
    if (url.includes('/api/auth/status')) {
      await route.fallback();
      return;
    }

    // Try the request, retry on 429
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await route.fetch();
        if (response.status() !== 429 || attempt === 2) {
          await route.fulfill({ response });
          return;
        }
        // Wait before retrying (exponential backoff)
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
      } catch {
        // If page/context was closed during fetch, silently bail out.
        // This prevents "Target page, context or browser has been closed" errors
        // that occur when tests end while route handlers are still in flight.
        return;
      }
    }
  });
}

/**
 * Clean up route handlers. Call in afterEach to prevent
 * "route.fetch: Target page closed" errors.
 */
export async function cleanupRoutes(page: Page): Promise<void> {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
}

/**
 * Sleep for the given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a page.request call with exponential backoff on 429 responses.
 */
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3, baseDelay = 1000): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await fn();
    // Check if it's a Playwright APIResponse with a status method
    if (result && typeof result === 'object' && 'status' in result) {
      const response = result as { status: () => number; text: () => Promise<string> };
      if (response.status() === 429 && attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        await sleep(delay);
        continue;
      }
    }
    return result;
  }
  return fn();
}

/**
 * Seed a test task via the API for tests that need known data.
 * Returns the created task object.
 *
 * Note: The API always creates tasks with status 'todo'. If a different
 * status is needed, we create the task first then PATCH the status.
 */
export async function seedTestTask(
  page: Page,
  overrides: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const { status: desiredStatus, git: desiredGit, ...rest } = overrides;

  const taskData = {
    title: `E2E Test Task ${Date.now()}`,
    description: 'Created by Playwright E2E tests',
    priority: 'medium',
    type: 'task',
    ...rest,
  };

  const response = await withRetry(() =>
    page.request.post(`${API_BASE}/api/tasks`, {
      headers: { 'X-API-Key': ADMIN_KEY },
      data: taskData,
    })
  );

  if (!response.ok()) {
    throw new Error(`Failed to seed task: ${response.status()} ${await response.text()}`);
  }

  const createdBody = await response.json();
  const task = (createdBody as { data?: Record<string, unknown> }).data ?? createdBody;

  // The API creates tasks as 'todo' and only accepts git/worktree data on PATCH.
  const targetStatus = desiredStatus ?? 'todo';
  const patchData: Record<string, unknown> = {};
  if (targetStatus !== 'todo') {
    patchData.status = targetStatus;
  }
  if (desiredGit) {
    patchData.git = desiredGit;
  }

  if (Object.keys(patchData).length > 0) {
    const patchResponse = await withRetry(() =>
      page.request.patch(`${API_BASE}/api/tasks/${(task as { id: string }).id}`, {
        headers: { 'X-API-Key': ADMIN_KEY, 'Content-Type': 'application/json' },
        data: patchData,
      })
    );
    if (!patchResponse.ok()) {
      throw new Error(
        `Failed to patch seeded task: ${patchResponse.status()} ${await patchResponse.text()}`
      );
    }
    const patchedBody = await patchResponse.json();
    return (patchedBody as { data?: Record<string, unknown> }).data ?? patchedBody;
  }

  return task;
}

/**
 * Delete a task via the API (cleanup after tests).
 * Includes retry logic for rate limiting (429).
 */
export async function deleteTask(page: Page, taskId: string): Promise<void> {
  await withRetry(() =>
    page.request.delete(`${API_BASE}/api/tasks/${taskId}`, {
      headers: { 'X-API-Key': ADMIN_KEY },
    })
  );
}
