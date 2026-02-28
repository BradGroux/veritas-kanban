import { z } from 'zod';
import { api } from '../utils/api.js';

// Type for project responses from the API
interface Project {
  id: string;
  label: string;
  description?: string;
  color?: string;
  order: number;
  isDefault?: boolean;
  isHidden?: boolean;
  created: string;
  updated: string;
}

// Tool input schemas
const ListProjectsSchema = z.object({
  includeHidden: z.boolean().optional(),
});

const CreateProjectSchema = z.object({
  label: z.string().min(1),
  description: z.string().optional(),
  color: z.string().optional(),
});

const UpdateProjectSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).optional(),
  description: z.string().optional(),
  color: z.string().optional(),
  isHidden: z.boolean().optional(),
});

const ProjectIdSchema = z.object({
  id: z.string().min(1),
});

const DeleteProjectSchema = z.object({
  id: z.string().min(1),
  force: z.boolean().optional(),
});

export const projectTools = [
  {
    name: 'list_projects',
    description: 'List all projects in Veritas Kanban',
    inputSchema: {
      type: 'object',
      properties: {
        includeHidden: {
          type: 'boolean',
          description: 'Include hidden projects (default: false)',
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
    description: 'Create a new project in Veritas Kanban',
    inputSchema: {
      type: 'object',
      properties: {
        label: {
          type: 'string',
          description: 'Project name',
        },
        description: {
          type: 'string',
          description: 'Project description',
        },
        color: {
          type: 'string',
          description: 'Tailwind bg color class for badges (e.g., "bg-blue-500/20")',
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
          description: 'New color class',
        },
        isHidden: {
          type: 'boolean',
          description: 'Hide project from lists',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_project',
    description: 'Delete a project. Fails if tasks reference it unless force=true.',
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
];

export async function handleProjectTool(name: string, args: any): Promise<any> {
  switch (name) {
    case 'list_projects': {
      const params = ListProjectsSchema.parse(args || {});
      const query = params.includeHidden ? '?includeHidden=true' : '';
      const projects = await api<Project[]>(`/api/projects${query}`);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(projects, null, 2),
          },
        ],
      };
    }

    case 'get_project': {
      const { id } = ProjectIdSchema.parse(args);
      const project = await api<Project>(`/api/projects/${id}`);

      return {
        content: [{ type: 'text', text: JSON.stringify(project, null, 2) }],
      };
    }

    case 'create_project': {
      const params = CreateProjectSchema.parse(args);
      const project = await api<Project>('/api/projects', {
        method: 'POST',
        body: JSON.stringify(params),
      });

      return {
        content: [
          {
            type: 'text',
            text: `Project created: ${project.id}\n${JSON.stringify(project, null, 2)}`,
          },
        ],
      };
    }

    case 'update_project': {
      const { id, ...updates } = UpdateProjectSchema.parse(args);
      const project = await api<Project>(`/api/projects/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });

      return {
        content: [
          {
            type: 'text',
            text: `Project updated: ${project.id}\n${JSON.stringify(project, null, 2)}`,
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

    default:
      throw new Error(`Unknown project tool: ${name}`);
  }
}
