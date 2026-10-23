import { beforeEach, describe, expect, it, vi } from 'vitest';
const { mockApi } = vi.hoisted(() => ({ mockApi: vi.fn() }));
vi.mock('../utils/api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/api.js')>()),
  api: mockApi,
}));
import { handleProjectTool } from '../tools/projects.js';
import { handleSprintTool } from '../tools/sprints.js';
import { handleCommentTool } from '../tools/comments.js';

describe('resource identifier compatibility', () => {
  beforeEach(() => {
    mockApi.mockReset();
    mockApi.mockResolvedValue({ id: 'fixture', label: 'Fixture', archived: 0, comments: [] });
  });

  it('keeps legacy project and sprint names intact', async () => {
    const id = 'Release / October #1';
    await handleProjectTool('update_project', { id, label: 'Renamed' });
    expect(mockApi.mock.calls.at(-1)?.[0]).toBe('/api/projects/Release%20%2F%20October%20%231');
    await handleSprintTool('close_sprint', { id });
    expect(mockApi.mock.calls.at(-1)?.[0]).toBe(
      '/api/tasks/archive/sprint/Release%20%2F%20October%20%231'
    );
  });

  it('keeps the project filter as a single exact query value', async () => {
    mockApi.mockResolvedValue([]);
    const id = 'Release & review #1';
    await handleProjectTool('get_project_stats', { id });
    const url = new URL(mockApi.mock.calls[0][0], 'http://fixture.test');
    expect([...url.searchParams]).toEqual([['project', id]]);
    expect(url.hash).toBe('');
  });

  it('preserves both resource identities in comment operations', async () => {
    await handleCommentTool('delete_comment', { taskId: 'task_fixture', commentId: 'review #1' });
    expect(mockApi).toHaveBeenCalledWith('/api/tasks/task_fixture/comments/review%20%231', {
      method: 'DELETE',
    });
  });

  it('does not dispatch an operation for a non-resource identifier', async () => {
    await expect(handleProjectTool('delete_project', { id: '..' })).rejects.toThrow();
    await expect(handleSprintTool('delete_sprint', { id: '.' })).rejects.toThrow();
    await expect(
      handleCommentTool('delete_comment', { taskId: 'task_fixture', commentId: '..' })
    ).rejects.toThrow();
    expect(mockApi).not.toHaveBeenCalled();
  });
});
