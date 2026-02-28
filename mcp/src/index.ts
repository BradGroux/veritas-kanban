#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Import utilities
import { api } from './utils/api.js';
import { findTask } from './utils/find.js';
import { Task } from './utils/types.js';

// Import tool modules
import { taskTools, handleTaskTool } from './tools/tasks.js';
import { agentTools, handleAgentTool } from './tools/agents.js';
import { automationTools, handleAutomationTool } from './tools/automation.js';
import { notificationTools, handleNotificationTool } from './tools/notifications.js';
import { summaryTools, handleSummaryTool } from './tools/summary.js';
import { projectTools, handleProjectTool } from './tools/projects.js';

// Create MCP server
const server = new Server(
  {
    name: 'veritas-kanban',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// Combine all tools
const allTools = [
  ...taskTools,
  ...agentTools,
  ...automationTools,
  ...notificationTools,
  ...summaryTools,
  ...projectTools,
];

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: allTools,
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // Route to appropriate handler
    if (taskTools.some((t) => t.name === name)) {
      return await handleTaskTool(name, args);
    }
    if (agentTools.some((t) => t.name === name)) {
      return await handleAgentTool(name, args);
    }
    if (automationTools.some((t) => t.name === name)) {
      return await handleAutomationTool(name, args);
    }
    if (notificationTools.some((t) => t.name === name)) {
      return await handleNotificationTool(name, args);
    }
    if (summaryTools.some((t) => t.name === name)) {
      return await handleSummaryTool(name, args);
    }
    if (projectTools.some((t) => t.name === name)) {
      return await handleProjectTool(name, args);
    }

    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

// List available resources
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const tasks = await api<Task[]>('/api/tasks');

  return {
    resources: [
      {
        uri: 'kanban://tasks',
        name: 'All Tasks',
        description: 'List of all tasks in Veritas Kanban',
        mimeType: 'application/json',
      },
      {
        uri: 'kanban://tasks/active',
        name: 'Active Tasks',
        description: 'Tasks that are in-progress or in review',
        mimeType: 'application/json',
      },
      ...tasks.map((task) => ({
        uri: `kanban://task/${task.id}`,
        name: task.title,
        description: `${task.type} task - ${task.status} - ${task.project || 'no project'}`,
        mimeType: 'application/json',
      })),
    ],
  };
});

// Read resource content
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  if (uri === 'kanban://tasks') {
    const tasks = await api<Task[]>('/api/tasks');
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(tasks, null, 2),
        },
      ],
    };
  }

  if (uri === 'kanban://tasks/active') {
    const tasks = await api<Task[]>('/api/tasks');
    const active = tasks.filter((t) => t.status === 'in-progress' || t.status === 'blocked');
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(active, null, 2),
        },
      ],
    };
  }

  if (uri.startsWith('kanban://task/')) {
    const id = uri.replace('kanban://task/', '');
    const task = await findTask(id);

    if (!task) {
      throw new Error(`Task not found: ${id}`);
    }

    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(task, null, 2),
        },
      ],
    };
  }

  throw new Error(`Unknown resource: ${uri}`);
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Veritas Kanban MCP server running on stdio');
}

main().catch(console.error);
