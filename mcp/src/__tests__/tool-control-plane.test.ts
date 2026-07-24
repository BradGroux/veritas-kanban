import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/api.js', () => ({ api: vi.fn() }));

import { api } from '../utils/api.js';
import { handleToolControlPlaneTool, toolControlPlaneTools } from '../tools/tool-control-plane.js';

const apiMock = vi.mocked(api);

describe('MCP run-scoped tool control plane', () => {
  beforeEach(() => apiMock.mockReset());

  it('publishes discovery, catalog, and mediated call tools', () => {
    expect(toolControlPlaneTools.map((tool) => tool.name)).toEqual([
      'list_tool_servers',
      'discover_tool_server',
      'get_run_tool_catalog',
      'call_run_tool',
    ]);
  });

  it('forwards an exact run-bound tool call without changing provenance', async () => {
    apiMock.mockResolvedValue({
      serverId: 'veritas',
      tool: 'get_task',
      operationId: 'operation-1',
      isError: false,
      eventId: 'event-1',
    });
    await handleToolControlPlaneTool('call_run_tool', {
      taskId: 'task-1',
      attemptId: 'attempt-1',
      serverId: 'veritas',
      tool: 'get_task',
      arguments: { id: 'task-2' },
      operationId: 'operation-1',
      approvalId: 'approval-1',
    });
    expect(apiMock).toHaveBeenCalledWith('/api/tool-servers/call', {
      method: 'POST',
      body: JSON.stringify({
        taskId: 'task-1',
        attemptId: 'attempt-1',
        serverId: 'veritas',
        tool: 'get_task',
        arguments: { id: 'task-2' },
        operationId: 'operation-1',
        approvalId: 'approval-1',
      }),
    });
  });

  it('rejects incomplete mediated calls before the API boundary', async () => {
    await expect(
      handleToolControlPlaneTool('call_run_tool', {
        taskId: 'task-1',
        attemptId: 'attempt-1',
        serverId: 'veritas',
        tool: 'get_task',
      })
    ).rejects.toThrow();
    expect(apiMock).not.toHaveBeenCalled();
  });
});
