import { z } from 'zod';
import { api } from '../utils/api.js';

const listSchema = z.object({}).strict();
const discoverSchema = z
  .object({
    serverId: z.string().trim().min(1).max(80),
    force: z.boolean().optional(),
  })
  .strict();
const catalogSchema = z
  .object({
    taskId: z.string().trim().min(1).max(240),
    attemptId: z.string().trim().min(1).max(240),
  })
  .strict();
const callSchema = catalogSchema
  .extend({
    serverId: z.string().trim().min(1).max(80),
    tool: z.string().trim().min(1).max(240),
    arguments: z.record(z.string(), z.unknown()),
    operationId: z.string().trim().min(1).max(120),
    approvalId: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export const toolControlPlaneTools = [
  {
    name: 'list_tool_servers',
    description: 'List registered run-scoped MCP and tool server definitions',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'discover_tool_server',
    description: 'Validate one tool server and refresh its version-bound tool schema cache',
    inputSchema: {
      type: 'object',
      properties: {
        serverId: { type: 'string' },
        force: { type: 'boolean' },
      },
      required: ['serverId'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_run_tool_catalog',
    description: 'Read the immutable tool catalog bound to an exact run attempt',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        attemptId: { type: 'string' },
      },
      required: ['taskId', 'attemptId'],
      additionalProperties: false,
    },
  },
  {
    name: 'call_run_tool',
    description:
      'Invoke an allowed tool through the exact run catalog with policy, approval, redaction, and causal event enforcement',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        attemptId: { type: 'string' },
        serverId: { type: 'string' },
        tool: { type: 'string' },
        arguments: { type: 'object', additionalProperties: true },
        operationId: { type: 'string' },
        approvalId: { type: 'string' },
      },
      required: ['taskId', 'attemptId', 'serverId', 'tool', 'arguments', 'operationId'],
      additionalProperties: false,
    },
  },
];

export async function handleToolControlPlaneTool(name: string, argumentsValue: unknown) {
  if (name === 'list_tool_servers') {
    listSchema.parse(argumentsValue ?? {});
    return text(await api('/api/tool-servers'));
  }
  if (name === 'discover_tool_server') {
    const input = discoverSchema.parse(argumentsValue);
    return text(
      await api(`/api/tool-servers/${encodeURIComponent(input.serverId)}/discover`, {
        method: 'POST',
        body: JSON.stringify({ force: input.force === true }),
      })
    );
  }
  if (name === 'get_run_tool_catalog') {
    const input = catalogSchema.parse(argumentsValue);
    return text(
      await api(
        `/api/tool-servers/runs/${encodeURIComponent(input.taskId)}/${encodeURIComponent(input.attemptId)}/catalog`
      )
    );
  }
  if (name === 'call_run_tool') {
    const input = callSchema.parse(argumentsValue);
    return text(
      await api('/api/tool-servers/call', {
        method: 'POST',
        body: JSON.stringify(input),
      })
    );
  }
  throw new Error(`Unknown tool control plane action: ${name}`);
}

function text(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  };
}
