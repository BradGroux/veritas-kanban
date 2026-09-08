import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

/** Exercise the real packaged board after the performance sample is recorded. */
export async function verifyLargeBoardJourney(page, count) {
  const column = (status) => page.locator(`[data-column-status="${status}"]`);
  const card = (id) => page.locator(`[data-task-id="${id}"][role="article"]`);
  const total = () =>
    page
      .locator('.vk-column-status-count')
      .evaluateAll((elements) =>
        elements.reduce((sum, element) => sum + Number(element.textContent), 0)
      );
  const request = (method, route, body) =>
    page.evaluate(
      async ({ method, route, body }) => {
        const response = await fetch(route, {
          method,
          headers: { 'Content-Type': 'application/json' },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        if (!response.ok) throw new Error(`Fixture request failed: ${response.status}`);
        const payload = await response.json();
        return payload.data ?? payload;
      },
      { method, route, body }
    );

  await column('todo').locator('h2').click();
  await page.keyboard.press('Escape');
  // More than one rendered window: selection must scroll and remain mounted.
  for (let index = 0; index < 65; index++) await page.keyboard.press('j');
  const id = 'task_scale_00256';
  await expect(card(id)).toHaveAttribute('data-selected', 'true');
  await expect(card(id)).toBeInViewport();
  const detailResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/tasks/${id}` &&
      response.request().method() === 'GET'
  );
  await page.keyboard.press('Enter');
  const detail = await detailResponse;
  assert(detail.ok(), 'Full task detail failed after selecting an offscreen summary');
  const payload = await detail.json();
  assert.equal((payload.data ?? payload).description.length, 4096);
  const panel = page.getByTestId('task-detail-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('textbox', { name: 'Task title', exact: true })).toHaveValue(
    'Scale fixture 00256'
  );
  await page.getByRole('button', { name: 'Close task workspace', exact: true }).click();
  await expect(panel).toBeHidden();

  const moved = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/tasks/${id}/move` &&
      response.request().method() === 'POST'
  );
  await page.keyboard.press('3');
  assert((await moved).ok(), 'Keyboard status move failed');
  await expect(column('blocked').locator(`[data-task-id="${id}"]`)).toBeInViewport();
  assert.equal((await request('GET', `/api/tasks/${id}`)).status, 'blocked');

  const search = page.getByRole('textbox', { name: 'Search tasks', exact: true });
  // This text lives only in the full description, not the board summary.
  const descriptionResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === '/api/tasks' &&
      url.searchParams.get('fields') === 'id' &&
      url.searchParams.get('search') === 'Public-safe board performance fixture'
    );
  });
  await search.fill('Public-safe board performance fixture');
  const searchResponse = await descriptionResponse;
  assert(searchResponse.ok(), 'Full-description search failed');
  const searchPayload = await searchResponse.json();
  assert.equal((searchPayload.data ?? searchPayload).length, count);
  await expect.poll(total).toBe(count);
  await search.fill('Scale fixture 00256');
  await expect.poll(total).toBe(1);
  await expect(card(id)).toBeVisible();

  // Direct API mutation performs no React Query invalidation in this renderer.
  // The changed card must arrive through the production realtime path.
  const title = 'Scale fixture 00256 realtime update';
  await request('PATCH', `/api/tasks/${id}`, { title });
  await expect(card(id).getByRole('heading', { name: title, exact: true })).toBeVisible();

  const source = await card(id).boundingBox();
  const target = await column('todo').boundingBox();
  assert(source && target, 'Drag source or destination has no visible bounds');
  const dragged = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/tasks/${id}/move` &&
      response.request().method() === 'POST'
  );
  await page.mouse.move(source.x + source.width / 2, source.y + 30);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2 - 15, source.y + 35, { steps: 3 });
  await page.mouse.move(target.x + target.width / 2, target.y + 100, { steps: 20 });
  await page.mouse.up();
  assert((await dragged).ok(), 'Pointer drag did not commit');
  await expect(column('todo').locator(`[data-task-id="${id}"]`)).toBeVisible();
  assert.equal((await request('GET', `/api/tasks/${id}`)).status, 'todo');
  await search.fill('');
  await expect.poll(total).toBe(count);
  await page.reload();
  await expect.poll(total).toBe(count);
  assert.equal((await request('GET', `/api/tasks/${id}`)).title, title);
  return {
    offscreenKeyboardSelection: true,
    fullDetail: true,
    keyboardMove: true,
    descriptionSearch: true,
    realtimeUpdate: true,
    pointerMove: true,
    persistedAfterReload: true,
  };
}
