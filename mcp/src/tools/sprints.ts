import { z } from 'zod';
import { api } from '../utils/api.js';
import type { SprintConfig, Task } from '../utils/types.js';

// Local response types
interface ArchiveSuggestion {
  sprint: string;
  taskCount: number;
  tasks: Task[];
}

interface ArchiveResult {
  archived: number;
  taskIds: string[];
}

interface CanDeleteResult {
  canDelete: boolean;
  referenceCount?: number;
}

// Tool input schemas
const ListSprintsSchema = z.object({
  includeHidden: z.boolean().optional(),
});

const SprintIdSchema = z.object({
  id: z.string().min(1),
});

const CreateSprintSchema = z.object({
  label: z.string().min(1),
  description: z.string().optional(),
});

const UpdateSprintSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  description: z.string().optional(),
  isHidden: z.boolean().optional(),
});

const DeleteSprintSchema = z.object({
  id: z.string().min(1),
  force: z.boolean().optional(),
});

const ReorderSprintsSchema = z.object({
  orderedIds: z.array(z.string()),
});

export const sprintTools = [
  {
    name: 'list_sprints',
    description: 'List all sprints. Use includeHidden to show hidden sprints.',
    inputSchema: {
      type: 'object',
      properties: {
        includeHidden: {
          type: 'boolean',
          description: 'Include hidden sprints in the list',
        },
      },
    },
  },
  {
    name: 'get_sprint',
    description: 'Get details of a specific sprint by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Sprint ID',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_sprint',
    description: 'Create a new sprint',
    inputSchema: {
      type: 'object',
      properties: {
        label: {
          type: 'string',
          description: 'Sprint name/label',
        },
        description: {
          type: 'string',
          description: 'Sprint description',
        },
      },
      required: ['label'],
    },
  },
  {
    name: 'update_sprint',
    description: 'Update an existing sprint',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Sprint ID',
        },
        label: {
          type: 'string',
          description: 'New sprint name',
        },
        description: {
          type: 'string',
          description: 'New description',
        },
        isHidden: {
          type: 'boolean',
          description: 'Hide or show the sprint',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_sprint',
    description: 'Delete a sprint. Use force=true to delete even if tasks reference this sprint.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Sprint ID',
        },
        force: {
          type: 'boolean',
          description: 'Force delete even if tasks reference this sprint',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'can_delete_sprint',
    description: 'Check if a sprint can be deleted and get reference count',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Sprint ID',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'reorder_sprints',
    description: 'Reorder sprints by providing an array of sprint IDs in the desired order',
    inputSchema: {
      type: 'object',
      properties: {
        orderedIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of sprint IDs in desired order',
        },
      },
      required: ['orderedIds'],
    },
  },
  {
    name: 'get_archive_suggestions',
    description: 'Get sprints that are ready to archive (all tasks completed)',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'close_sprint',
    description: 'Archive all completed tasks in a sprint',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Sprint ID',
        },
      },
      required: ['id'],
    },
  },
];

export async function handleSprintTool(name: string, args: any): Promise<any> {
  switch (name) {
    case 'list_sprints': {
      const params = ListSprintsSchema.parse(args || {});
      const query = params.includeHidden ? '?includeHidden=true' : '';
      const sprints = await api<SprintConfig[]>(`/api/sprints${query}`);

      return {
        content: [{ type: 'text', text: JSON.stringify(sprints, null, 2) }],
      };
    }

    case 'get_sprint': {
      const { id } = SprintIdSchema.parse(args);
      const sprint = await api<SprintConfig>(`/api/sprints/${id}`);

      return {
        content: [{ type: 'text', text: JSON.stringify(sprint, null, 2) }],
      };
    }

    case 'create_sprint': {
      const params = CreateSprintSchema.parse(args);
      const sprint = await api<SprintConfig>('/api/sprints', {
        method: 'POST',
        body: JSON.stringify(params),
      });

      return {
        content: [
          {
            type: 'text',
            text: `Sprint created: ${sprint.label}\n${JSON.stringify(sprint, null, 2)}`,
          },
        ],
      };
    }

    case 'update_sprint': {
      const { id, ...updates } = UpdateSprintSchema.parse(args);
      const sprint = await api<SprintConfig>(`/api/sprints/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });

      return {
        content: [
          {
            type: 'text',
            text: `Sprint updated: ${sprint.label}\n${JSON.stringify(sprint, null, 2)}`,
          },
        ],
      };
    }

    case 'delete_sprint': {
      const { id, force } = DeleteSprintSchema.parse(args);
      const query = force ? '?force=true' : '';
      await api(`/api/sprints/${id}${query}`, { method: 'DELETE' });

      return {
        content: [{ type: 'text', text: `Sprint deleted: ${id}` }],
      };
    }

    case 'can_delete_sprint': {
      const { id } = SprintIdSchema.parse(args);
      const result = await api<CanDeleteResult>(`/api/sprints/${id}/can-delete`);

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }

    case 'reorder_sprints': {
      const { orderedIds } = ReorderSprintsSchema.parse(args);
      const sprints = await api<SprintConfig[]>('/api/sprints/reorder', {
        method: 'POST',
        body: JSON.stringify({ orderedIds }),
      });

      return {
        content: [
          {
            type: 'text',
            text: `Sprints reordered\n${JSON.stringify(sprints, null, 2)}`,
          },
        ],
      };
    }

    case 'get_archive_suggestions': {
      const suggestions = await api<ArchiveSuggestion[]>('/api/tasks/archive/suggestions');

      if (suggestions.length === 0) {
        return {
          content: [{ type: 'text', text: 'No sprints ready to archive' }],
        };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(suggestions, null, 2) }],
      };
    }

    case 'close_sprint': {
      const { id } = SprintIdSchema.parse(args);
      const result = await api<ArchiveResult>(`/api/tasks/archive/sprint/${id}`, {
        method: 'POST',
      });

      return {
        content: [
          {
            type: 'text',
            text: `Archived ${result.archived} task(s) from sprint\n${JSON.stringify(result, null, 2)}`,
          },
        ],
      };
    }

    default:
      throw new Error(`Unknown sprint tool: ${name}`);
  }
}
