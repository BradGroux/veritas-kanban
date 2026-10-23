import { expect, test } from '@playwright/test';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { unwrapApiData } from './helpers/auth';

test('browser fixture CRUD stays inside its generated environment', async ({ request }) => {
  const manifest = JSON.parse(await readFile(process.env.VK_PLAYWRIGHT_ENVIRONMENT!, 'utf8'));
  expect(process.env.DATA_DIR).toBe(manifest.root);
  expect(process.env.VERITAS_DATA_DIR).toBe(manifest.root);
  expect(process.env.API_BASE_URL).toBe(`http://127.0.0.1:${manifest.apiPort}`);
  const api = `${process.env.API_BASE_URL}/api/tasks`;
  const created = await request.post(api, {
    data: { title: 'Owned browser fixture', priority: 'low', type: 'task' },
  });
  expect(created.ok()).toBe(true);
  const task = unwrapApiData<{ id: string }>(await created.json());
  const taskUrl = `${api}/${encodeURIComponent(task.id)}`;
  try {
    expect((await stat(path.join(manifest.root, 'tasks/active'))).isDirectory()).toBe(true);
    const patched = await request.patch(taskUrl, { data: { title: 'Updated owned fixture' } });
    expect(patched.ok()).toBe(true);
    const loaded = await request.get(taskUrl);
    expect(loaded.ok()).toBe(true);
    expect(unwrapApiData<{ title: string }>(await loaded.json()).title).toBe(
      'Updated owned fixture'
    );
  } finally {
    expect((await request.delete(taskUrl)).ok()).toBe(true);
  }
});
