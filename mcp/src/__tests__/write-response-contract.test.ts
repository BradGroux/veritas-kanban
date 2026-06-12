import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  findTask: vi.fn(),
}));

vi.mock('../utils/api.js', () => ({
  api: mocks.api,
}));

vi.mock('../utils/find.js', () => ({
  findTask: mocks.findTask,
}));

import { handleCommentTool } from '../tools/comments.js';
import { handleTaskTool } from '../tools/tasks.js';

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task_20260612_abc123',
    title: 'Token-heavy task',
    description: 'Full task details should stay out of MCP write confirmations.',
    type: 'code',
    status: 'todo',
    priority: 'medium',
    created: '2026-06-12T00:00:00.000Z',
    updated: '2026-06-12T00:00:00.000Z',
    comments: [],
    ...overrides,
  };
}

describe('MCP write response contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a concise create_task confirmation instead of full task JSON', async () => {
    mocks.api.mockResolvedValueOnce(
      task({
        priority: 'high',
        comments: [{ id: 'comment_1', text: 'Existing context' }],
      })
    );

    const result = await handleTaskTool('create_task', {
      title: 'Token-heavy task',
      priority: 'high',
    });

    const text = result.content[0].text;
    expect(text).toBe(
      ['Task created: task_20260612_abc123', 'Status: todo', 'Priority: high', 'Comments: 1'].join(
        '\n'
      )
    );
    expect(text).not.toContain('{');
    expect(text).not.toContain('Full task details');
  });

  it('returns changed fields for update_task without echoing comments', async () => {
    mocks.findTask.mockResolvedValueOnce(task());
    mocks.api.mockResolvedValueOnce(
      task({
        status: 'in-progress',
        priority: 'high',
        comments: [
          { id: 'comment_1', text: 'First long comment' },
          { id: 'comment_2', text: 'Second long comment' },
        ],
      })
    );

    const result = await handleTaskTool('update_task', {
      id: 'abc123',
      status: 'in-progress',
      priority: 'high',
    });

    const text = result.content[0].text;
    expect(text).toBe('Task updated: task_20260612_abc123; fields: status, priority; comments: 2');
    expect(text).not.toContain('First long comment');
    expect(text).not.toContain('{');
  });

  it('returns the added comment id and count for add_comment', async () => {
    mocks.api.mockResolvedValueOnce(
      task({
        comments: [
          { id: 'comment_1', text: 'Earlier status' },
          { id: 'comment_2', text: 'New status' },
        ],
      })
    );

    const result = await handleCommentTool('add_comment', {
      taskId: 'task_20260612_abc123',
      text: 'New status',
      agent: 'agent',
    });

    const text = result.content[0].text;
    expect(text).toBe(
      'Comment added to task task_20260612_abc123; comment: comment_2; comments: 2'
    );
    expect(text).not.toContain('Earlier status');
    expect(text).not.toContain('{');
  });

  it('returns a concise delete_comment confirmation', async () => {
    mocks.api.mockResolvedValueOnce(
      task({
        comments: [{ id: 'comment_2', text: 'Remaining status' }],
      })
    );

    const result = await handleCommentTool('delete_comment', {
      taskId: 'task_20260612_abc123',
      commentId: 'comment_1',
    });

    const text = result.content[0].text;
    expect(text).toBe(
      'Comment deleted from task task_20260612_abc123; comment: comment_1; comments: 1'
    );
    expect(text).not.toContain('Remaining status');
    expect(text).not.toContain('{');
  });
});
