import { z } from 'zod';
import { api } from '../utils/api.js';

// Local response types
interface ProjectConfig {
  id: string;
  label: string;
  description?: string;
  color?: string;
  order?: number;
  isHidden?: boolean;
  created?: string;
  updated?: string;
}

interface Task {
  id: string;
  status: string;
  project?: string;
  [key: string]: any;
}

interface ProjectStats {
  projectId: string;
  total: number;
  byStatus: Record<string, number>;
}

// Tailwind color class validation: e.g. bg-green-500, text-red-200
const tailwindColorRegex = /^[a-z]+-\d{2,3}$/;

// Tool input schemas
const ListProjectsSchema = z.object({
  includeHidden: z.boolean().optional(),
});

const ProjectIdSchema = z.object({
  id: z.string().min(1),
});

const CreateProjectSchema = z.object({
  label: z.string().min(1),
  description: z.string().optional(),
  color: z
    .string()
    .optional()
    .refine(
      (val) => val === undefined || tailwindColorRegex.test(val),
      { message: 'color must be a valid Tailwind class segment like "green-500" or "red-200"' }
    ),
});

const UpdateProjectSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  description: z.string().optional(),
  color: z
    .string()
    .optional()
    .refine(
      (val) => val === undefined || tailwindColorRegex.test(val),
      { message: 'color must be a valid Tailwind class segment like "green-500" or "red-200"' }
    ),
  isHidden: z.boolean().optional(),
});

const DeleteProjectSchema = z.object({
  id: z.string().min(1),
  force: z.boolean().optional(),
});

const ReorderProjectsSchema = z.object({
  orderedIds: z.array(z.string()),
});

export const projectTools = [
  {
    name: 'list_projects',
    description: 'List all projects. Use includeHidden to show hidden projects.',
    inputSchema: {
      type: 'object',
      properties: {
        includeHidden: {
          type: 'boolean',
          description: 'Include hidden projects in the list',
        },
      },
    },
  },
  {
    name: 'get_project',
    description: 'Get details of a specific project by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Project ID',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_project',
    description: 'Create a new project',
    inputSchema: {
      type: 'object',
      properties: {
        label: {
          type: 'string',
          description: 'Project name/label',
        },
        description: {
          type: 'string',
          description: 'Project description',
        },
        color: {
          type: 'string',
          description:
            'Tailwind color class segment (e.g. "green-500", "red-200"). Must match pattern [a-z]+-\\d{2,3}.',
        },
      },
      required: ['label'],
    },
  },
  {
    name: 'update_project',
    description: 'Update an existing project',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Project ID',
        },
        label: {
          type: 'string',
          description: 'New project name',
        },
        description: {
          type: 'string',
          description: 'New description',
        },
        color: {
          type: 'string',
          description:
            'New Tailwind color class segment (e.g. "green-500", "red-200"). Must match pattern [a-z]+-\\d{2,3}.',
        },
        isHidden: {
          type: 'boolean',
          description: 'Hide or show the project',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_project',
    description:
      'Delete a project. Use force=true to delete even if tasks are assigned to this project.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Project ID',
        },
        force: {
          type: 'boolean',
          description: 'Force delete even if tasks reference this project',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_project_stats',
    description:
      'Get task counts per status for a project. Returns total count and breakdown by status.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Project ID',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'reorder_projects',
    description:
      'Reorder projects by providing an array of project IDs in the desired order',
    inputSchema: {
      type: 'object',
      properties: {
        orderedIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of project IDs in desired order',
        },
      },
      required: ['orderedIds'],
    },
  },
];

export async function handleProjectTool(name: string, args: any): Promise<any> {
  switch (name) {
    case 'list_projects': {
      const params = ListProjectsSchema.parse(args || {});
      const query = params.includeHidden ? '?includeHidden=true' : '';
      const projects = await api<ProjectConfig[]>(`/api/projects${query}`);

      return {
        content: [{ type: 'text', text: JSON.stringify(projects, null, 2) }],
      };
    }

    case 'get_project': {
      const { id } = ProjectIdSchema.parse(args);
      const project = await api<ProjectConfig>(`/api/projects/${id}`);

      return {
        content: [{ type: 'text', text: JSON.stringify(project, null, 2) }],
      };
    }

    case 'create_project': {
      const params = CreateProjectSchema.parse(args);
      const project = await api<ProjectConfig>('/api/projects', {
        method: 'POST',
        body: JSON.stringify(params),
      });

      return {
        content: [
          {
            type: 'text',
            text: `Project created: ${project.label}\n${JSON.stringify(project, null, 2)}`,
          },
        ],
      };
    }

    case 'update_project': {
      const { id, ...updates } = UpdateProjectSchema.parse(args);
      const project = await api<ProjectConfig>(`/api/projects/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });

      return {
        content: [
          {
            type: 'text',
            text: `Project updated: ${project.label}\n${JSON.stringify(project, null, 2)}`,
          },
        ],
      };
    }

    case 'delete_project': {
      const { id, force } = DeleteProjectSchema.parse(args);
      const query = force ? '?force=true' : '';
      await api(`/api/projects/${id}${query}`, { method: 'DELETE' });

      return {
        content: [{ type: 'text', text: `Project deleted: ${id}` }],
      };
    }

    case 'get_project_stats': {
      const { id } = ProjectIdSchema.parse(args);
      const tasks = await api<{ data?: Task[]; success?: boolean } | Task[]>(
        `/api/tasks?project=${id}`
      );

      // Handle both array response and wrapped {data: [...]} response
      const taskList: Task[] = Array.isArray(tasks)
        ? tasks
        : (tasks as any).data ?? [];

      const byStatus: Record<string, number> = {};
      for (const task of taskList) {
        const status = task.status ?? 'unknown';
        byStatus[status] = (byStatus[status] ?? 0) + 1;
      }

      const stats: ProjectStats = {
        projectId: id,
        total: taskList.length,
        byStatus,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }],
      };
    }

    case 'reorder_projects': {
      const { orderedIds } = ReorderProjectsSchema.parse(args);
      const projects = await api<ProjectConfig[]>('/api/projects/reorder', {
        method: 'POST',
        body: JSON.stringify({ orderedIds }),
      });

      return {
        content: [
          {
            type: 'text',
            text: `Projects reordered\n${JSON.stringify(projects, null, 2)}`,
          },
        ],
      };
    }

    default:
      throw new Error(`Unknown project tool: ${name}`);
  }
}
