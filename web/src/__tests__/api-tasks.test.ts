/**
 * Tests for lib/api/tasks.ts — task API client methods.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockTask } from './test-utils';

// We need to mock config before importing the API module
vi.mock('@/lib/config', () => ({
  API_BASE: 'http://test-api',
}));

// Dynamic import after mock setup
const { tasksApi } = await import('@/lib/api/tasks');

// ── Helpers ──────────────────────────────────────────────────

function envelope<T>(data: T) {
  return {
    success: true,
    data,
    meta: { timestamp: new Date().toISOString() },
  };
}

function errorEnvelope(code: string, message: string) {
  return {
    success: false,
    error: { code, message },
    meta: { timestamp: new Date().toISOString() },
  };
}

// ── Tests ────────────────────────────────────────────────────

describe('tasksApi', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => envelope([]),
      })
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('list() calls GET /tasks and unwraps data', async () => {
    const tasks = [createMockTask({ id: 't1' }), createMockTask({ id: 't2' })];
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => envelope(tasks),
    } as Response);

    const result = await tasksApi.list();
    expect(fetch).toHaveBeenCalledWith('http://test-api/tasks');
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('t1');
  });

  it('get() calls GET /tasks/:id', async () => {
    const task = createMockTask({ id: 'abc123' });
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => envelope(task),
    } as Response);

    const result = await tasksApi.get('abc123');
    expect(fetch).toHaveBeenCalledWith('http://test-api/tasks/abc123');
    expect(result.id).toBe('abc123');
  });

  it('create() calls POST /tasks with body', async () => {
    const created = createMockTask({ id: 'new-1', title: 'New Task' });
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => envelope(created),
    } as Response);

    const input = { title: 'New Task', description: 'Desc', priority: 'high' as const };
    const result = await tasksApi.create(input);

    expect(fetch).toHaveBeenCalledWith('http://test-api/tasks', {
      credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    expect(result.title).toBe('New Task');
  });

  it('update() calls PATCH /tasks/:id with body', async () => {
    const updated = createMockTask({ id: 'u1', status: 'done' });
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => envelope(updated),
    } as Response);

    const result = await tasksApi.update('u1', { status: 'done' });
    expect(fetch).toHaveBeenCalledWith('http://test-api/tasks/u1', {
      credentials: 'include',
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    });
    expect(result.status).toBe('done');
  });

  it('update() sends If-Match and strips expectedRevision from the JSON body', async () => {
    const updated = createMockTask({ id: 'u1', title: 'Updated' });
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => envelope(updated),
    } as Response);

    await tasksApi.update('u1', { title: 'Updated', expectedRevision: 7 });
    expect(fetch).toHaveBeenCalledWith('http://test-api/tasks/u1', {
      credentials: 'include',
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'If-Match': '"task:u1:7"' },
      body: JSON.stringify({ title: 'Updated' }),
    });
  });

  it('addComment() sends the parent task revision when provided', async () => {
    const updated = createMockTask({ id: 'task-1' });
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => envelope(updated),
    } as Response);

    await tasksApi.addComment('task-1', 'Tester', 'Comment body', 3);
    expect(fetch).toHaveBeenCalledWith('http://test-api/tasks/task-1/comments', {
      credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'If-Match': '"task:task-1:3"' },
      body: JSON.stringify({ author: 'Tester', text: 'Comment body' }),
    });
  });

  it('delete() calls DELETE /tasks/:id', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 204,
      json: vi.fn(),
    } as unknown as Response);

    await tasksApi.delete('d1');
    expect(fetch).toHaveBeenCalledWith('http://test-api/tasks/d1', {
      credentials: 'include',
      method: 'DELETE',
    });
  });

  it('archive() calls POST /tasks/:id/archive', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 204,
      json: vi.fn(),
    } as unknown as Response);

    await tasksApi.archive('a1');
    expect(fetch).toHaveBeenCalledWith('http://test-api/tasks/a1/archive', {
      credentials: 'include',
      method: 'POST',
    });
  });

  it('reorder() calls POST /tasks/reorder with orderedIds', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => envelope({ updated: 3 }),
    } as Response);

    const result = await tasksApi.reorder(['a', 'b', 'c']);
    expect(fetch).toHaveBeenCalledWith('http://test-api/tasks/reorder', {
      credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds: ['a', 'b', 'c'] }),
    });
    expect(result.updated).toBe(3);
  });

  it('throws for error envelope responses', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => errorEnvelope('NOT_FOUND', 'Task not found'),
    } as Response);

    await expect(tasksApi.get('nonexistent')).rejects.toThrow('Task not found');
  });
});
