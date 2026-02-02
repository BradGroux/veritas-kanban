import { z } from 'zod';
import { api } from '../utils/api.js';
import { findTask } from '../utils/find.js';
import { Task } from '../utils/types.js';

// Tool input schemas
const ListTasksSchema = z.object({
  status: z.enum(['todo', 'in-progress', 'blocked', 'done']).optional(),
  type: z.enum(['code', 'research', 'content', 'automation']).optional(),
  project: z.string().optional(),
});

const CreateTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(['code', 'research', 'content', 'automation']).default('code'),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  project: z.string().optional(),
});

const UpdateTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(['todo', 'in-progress', 'blocked', 'done']).optional(),
  type: z.enum(['code', 'research', 'content', 'automation']).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  project: z.string().optional(),
});

const TaskIdSchema = z.object({
  id: z.string().min(1),
});

export const taskTools = [
  {
    name: 'list_tasks',
    description: 'List all tasks in Veritas Kanban. Can filter by status, type, or project.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['todo', 'in-progress', 'blocked', 'done'],
          description: 'Filter by task status',
        },
        type: {
          type: 'string',
          enum: ['code', 'research', 'content', 'automation'],
          description: 'Filter by task type',
        },
        project: {
          type: 'string',
          description: 'Filter by project name',
        },
      },
    },
  },
  {
    name: 'get_task',
    description: 'Get details of a specific task by ID (supports partial ID matching)',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Task ID or partial ID (last 6+ characters)',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_task',
    description: 'Create a new task in Veritas Kanban',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Task title',
        },
        description: {
          type: 'string',
          description: 'Task description',
        },
        type: {
          type: 'string',
          enum: ['code', 'research', 'content', 'automation'],
          description: 'Task type (default: code)',
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'Task priority (default: medium)',
        },
        project: {
          type: 'string',
          description: 'Project name',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_task',
    description: 'Update an existing task',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Task ID or partial ID',
        },
        title: {
          type: 'string',
          description: 'New title',
        },
        description: {
          type: 'string',
          description: 'New description',
        },
        status: {
          type: 'string',
          enum: ['todo', 'in-progress', 'blocked', 'done'],
          description: 'New status',
        },
        type: {
          type: 'string',
          enum: ['code', 'research', 'content', 'automation'],
          description: 'New type',
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'New priority',
        },
        project: {
          type: 'string',
          description: 'New project',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'archive_task',
    description: 'Archive a completed task',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Task ID or partial ID',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_task',
    description: 'Delete a task permanently',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Task ID or partial ID',
        },
      },
      required: ['id'],
    },
  },
];

export async function handleTaskTool(name: string, args: any): Promise<any> {
  switch (name) {
    case 'list_tasks': {
      const params = ListTasksSchema.parse(args || {});
      let tasks = await api<Task[]>('/api/tasks');

      if (params.status) {
        tasks = tasks.filter((t) => t.status === params.status);
      }
      if (params.type) {
        tasks = tasks.filter((t) => t.type === params.type);
      }
      if (params.project) {
        tasks = tasks.filter((t) => t.project === params.project);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(tasks, null, 2),
          },
        ],
      };
    }

    case 'get_task': {
      const { id } = TaskIdSchema.parse(args);
      const task = await findTask(id);

      if (!task) {
        return {
          content: [{ type: 'text', text: `Task not found: ${id}` }],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(task, null, 2) }],
      };
    }

    case 'create_task': {
      const params = CreateTaskSchema.parse(args);
      const task = await api<Task>('/api/tasks', {
        method: 'POST',
        body: JSON.stringify(params),
      });

      return {
        content: [
          {
            type: 'text',
            text: `Task created: ${task.id}\n${JSON.stringify(task, null, 2)}`,
          },
        ],
      };
    }

    case 'update_task': {
      const { id, ...updates } = UpdateTaskSchema.parse(args);
      const task = await findTask(id);

      if (!task) {
        return {
          content: [{ type: 'text', text: `Task not found: ${id}` }],
          isError: true,
        };
      }

      const updated = await api<Task>(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });

      return {
        content: [
          {
            type: 'text',
            text: `Task updated: ${updated.id}\n${JSON.stringify(updated, null, 2)}`,
          },
        ],
      };
    }

    case 'archive_task': {
      const { id } = TaskIdSchema.parse(args);
      const task = await findTask(id);

      if (!task) {
        return {
          content: [{ type: 'text', text: `Task not found: ${id}` }],
          isError: true,
        };
      }

      await api(`/api/tasks/${task.id}/archive`, { method: 'POST' });

      return {
        content: [{ type: 'text', text: `Task archived: ${task.id}` }],
      };
    }

    case 'delete_task': {
      const { id } = TaskIdSchema.parse(args);
      const task = await findTask(id);

      if (!task) {
        return {
          content: [{ type: 'text', text: `Task not found: ${id}` }],
          isError: true,
        };
      }

      await api(`/api/tasks/${task.id}`, { method: 'DELETE' });

      return {
        content: [{ type: 'text', text: `Task deleted: ${task.id}` }],
      };
    }

    default:
      throw new Error(`Unknown task tool: ${name}`);
  }
}
