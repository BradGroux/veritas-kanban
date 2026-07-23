import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockApi, mockFindTask } = vi.hoisted(() => ({
  mockApi: vi.fn(),
  mockFindTask: vi.fn(),
}));

vi.mock('../utils/api.js', () => ({ api: mockApi }));
vi.mock('../utils/find.js', () => ({ findTask: mockFindTask }));

import { agentTools, handleAgentTool } from '../tools/agents.js';

describe('MCP agent runtime capability controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindTask.mockResolvedValue({
      id: 'task_1',
      type: 'code',
      git: { worktreePath: '/tmp/task_1' },
    });
    mockApi.mockImplementation(async (url: string) =>
      url.endsWith('/status')
        ? { running: true, attemptId: 'attempt_1' }
        : { attemptId: 'attempt_1' }
    );
  });

  it('publishes required runtime capabilities in the start tool schema', () => {
    const start = agentTools.find((tool) => tool.name === 'start_agent');
    expect(start?.inputSchema.properties.requiredRuntimeCapabilities).toMatchObject({
      type: 'array',
    });
    expect(start?.inputSchema.properties.commitPolicy).toMatchObject({
      enum: ['forbidden', 'allowed', 'required'],
    });
    expect(start?.inputSchema.properties.parentAttemptId).toMatchObject({
      type: 'string',
    });
  });

  it('forwards a parent attempt for material launch drift', async () => {
    await handleAgentTool('start_agent', {
      id: 'task_1',
      agent: 'claude-code',
      parentAttemptId: 'attempt_parent',
    });

    expect(mockApi).toHaveBeenCalledWith('/api/agents/task_1/start', {
      method: 'POST',
      body: JSON.stringify({
        agent: 'claude-code',
        parentAttemptId: 'attempt_parent',
      }),
    });
  });

  it('forwards an explicit run commit policy', async () => {
    await handleAgentTool('start_agent', {
      id: 'task_1',
      agent: 'claude-code',
      commitPolicy: 'required',
    });

    expect(mockApi).toHaveBeenCalledWith('/api/agents/task_1/start', {
      method: 'POST',
      body: JSON.stringify({
        agent: 'claude-code',
        requiredRuntimeCapabilities: undefined,
        commitPolicy: 'required',
      }),
    });
  });

  it('forwards required capabilities to the authoritative launch API', async () => {
    await handleAgentTool('start_agent', {
      id: 'task_1',
      agent: 'claude-code',
      requiredRuntimeCapabilities: ['tool.mcp', 'output.structured'],
    });

    expect(mockApi).toHaveBeenCalledWith('/api/agents/task_1/start', {
      method: 'POST',
      body: JSON.stringify({
        agent: 'claude-code',
        requiredRuntimeCapabilities: ['tool.mcp', 'output.structured'],
      }),
    });
  });

  it('preserves fail-closed stop errors from the API', async () => {
    mockApi
      .mockResolvedValueOnce({ running: true, attemptId: 'attempt_1' })
      .mockRejectedValueOnce(
        new Error(
          'Provider runtime does not support stop run: run.stop is unsupported. Select a capable provider.'
        )
      );

    await expect(handleAgentTool('stop_agent', { id: 'task_1' })).rejects.toThrow(
      'run.stop is unsupported'
    );
  });

  it('binds stop requests to the attempt returned by status', async () => {
    await handleAgentTool('stop_agent', { id: 'task_1' });

    expect(mockApi).toHaveBeenNthCalledWith(1, '/api/agents/task_1/status');
    expect(mockApi).toHaveBeenNthCalledWith(2, '/api/agents/task_1/stop', {
      method: 'POST',
      body: JSON.stringify({ attemptId: 'attempt_1' }),
    });
  });
});
