import { type Page, type Route } from '@playwright/test';

/**
 * Admin API key for E2E tests.
 * Read from VERITAS_ADMIN_KEY env var (set by playwright.config.ts via dotenv).
 * Falls back to 'dev-admin-key' only for backwards compatibility.
 */
const ADMIN_KEY = process.env.VERITAS_ADMIN_KEY || 'dev-admin-key';

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
  // The dev server has rate limiting (100 req/min) which E2E tests
  // can exceed during rapid test execution.
  await page.route('**/api/**', async (route: Route) => {
    const url = route.request().url();
    // Skip the auth/status route (already handled above)
    if (url.includes('/api/auth/status')) {
      return;
    }

    // Try the request, retry on 429
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await route.fetch();
      if (response.status() !== 429 || attempt === 2) {
        await route.fulfill({ response });
        return;
      }
      // Wait before retrying (exponential backoff)
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  });
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
 * Includes retry logic for rate limiting (429).
 */
export async function seedTestTask(
  page: Page,
  overrides: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const taskData = {
    title: `E2E Test Task ${Date.now()}`,
    description: 'Created by Playwright E2E tests',
    status: 'todo',
    priority: 'medium',
    type: 'task',
    ...overrides,
  };

  const response = await withRetry(() =>
    page.request.post('/api/tasks', {
      headers: { 'X-API-Key': ADMIN_KEY },
      data: taskData,
    })
  );

  if (!response.ok()) {
    throw new Error(`Failed to seed task: ${response.status()} ${await response.text()}`);
  }

  return response.json();
}

/**
 * Delete a task via the API (cleanup after tests).
 * Includes retry logic for rate limiting (429).
 */
export async function deleteTask(page: Page, taskId: string): Promise<void> {
  await withRetry(() =>
    page.request.delete(`/api/tasks/${taskId}`, {
      headers: { 'X-API-Key': ADMIN_KEY },
    })
  );
}
