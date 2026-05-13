/**
 * MCP Project Tools — Unit Tests
 *
 * Tests tool definitions, Zod validation, and mocked API calls.
 * Does NOT require a running server — all API calls are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { projectTools, handleProjectTool } from '../tools/projects.js';

// Mock the API module
vi.mock('../utils/api.js', () => ({
  api: vi.fn(),
}));

import { api } from '../utils/api.js';
const mockApi = vi.mocked(api);

// Helper: parse JSON from tool response content
function parseToolResponse(result: any): any {
  const text = result.content[0].text;
  const jsonStart = text.indexOf('{');
  const jsonArrayStart = text.indexOf('[');
  const start =
    jsonStart === -1
      ? jsonArrayStart
      : jsonArrayStart === -1
        ? jsonStart
        : Math.min(jsonStart, jsonArrayStart);
  if (start === -1) return text;
  return JSON.parse(text.substring(start));
}

describe('Project MCP Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Tool Definitions ───────────────────────────────────────────────────────

  describe('Tool definitions', () => {
    it('should export 7 project tools', () => {
      expect(projectTools).toHaveLength(7);
    });

    it('should have correct tool names', () => {
      const names = projectTools.map((t) => t.name);
      expect(names).toContain('list_projects');
      expect(names).toContain('get_project');
      expect(names).toContain('create_project');
      expect(names).toContain('update_project');
      expect(names).toContain('delete_project');
      expect(names).toContain('get_project_stats');
      expect(names).toContain('reorder_projects');
    });

    it('should require id for get_project', () => {
      const tool = projectTools.find((t) => t.name === 'get_project');
      expect(tool?.inputSchema.required).toContain('id');
    });

    it('should require label for create_project', () => {
      const tool = projectTools.find((t) => t.name === 'create_project');
      expect(tool?.inputSchema.required).toContain('label');
    });

    it('should require id for update_project', () => {
      const tool = projectTools.find((t) => t.name === 'update_project');
      expect(tool?.inputSchema.required).toContain('id');
    });

    it('should require id for delete_project', () => {
      const tool = projectTools.find((t) => t.name === 'delete_project');
      expect(tool?.inputSchema.required).toContain('id');
    });

    it('should have force as optional on delete_project', () => {
      const tool = projectTools.find((t) => t.name === 'delete_project');
      const force = tool?.inputSchema.properties.force;
      expect(force).toBeDefined();
      expect(force?.type).toBe('boolean');
      expect(tool?.inputSchema.required).not.toContain('force');
    });

    it('should require id for get_project_stats', () => {
      const tool = projectTools.find((t) => t.name === 'get_project_stats');
      expect(tool?.inputSchema.required).toContain('id');
    });

    it('should require orderedIds for reorder_projects', () => {
      const tool = projectTools.find((t) => t.name === 'reorder_projects');
      expect(tool?.inputSchema.required).toContain('orderedIds');
    });
  });

  // ─── Zod Validation ─────────────────────────────────────────────────────────

  describe('Zod color validation', () => {
    it('should accept valid Tailwind color segments in create_project', async () => {
      const mockProject = { id: 'proj-1', label: 'Test', color: 'green-500' };
      mockApi.mockResolvedValueOnce(mockProject);

      const result = await handleProjectTool('create_project', {
        label: 'Test',
        color: 'green-500',
      });
      expect(result.content[0].text).toContain('Test');
    });

    it('should accept valid 3-digit Tailwind color segments', async () => {
      const mockProject = { id: 'proj-2', label: 'Test2', color: 'red-100' };
      mockApi.mockResolvedValueOnce(mockProject);

      const result = await handleProjectTool('create_project', {
        label: 'Test2',
        color: 'red-100',
      });
      expect(result.content[0].text).toContain('Test2');
    });

    it('should reject invalid color format (full bg- prefix)', async () => {
      await expect(
        handleProjectTool('create_project', {
          label: 'Test',
          color: 'bg-green-500',
        })
      ).rejects.toThrow();
    });

    it('should reject invalid color format (no number)', async () => {
      await expect(
        handleProjectTool('create_project', {
          label: 'Test',
          color: 'green',
        })
      ).rejects.toThrow();
    });

    it('should reject invalid color format (uppercase)', async () => {
      await expect(
        handleProjectTool('create_project', {
          label: 'Test',
          color: 'Green-500',
        })
      ).rejects.toThrow();
    });

    it('should allow color to be omitted (optional)', async () => {
      const mockProject = { id: 'proj-3', label: 'No color' };
      mockApi.mockResolvedValueOnce(mockProject);

      const result = await handleProjectTool('create_project', {
        label: 'No color',
      });
      expect(result.content[0].text).toContain('No color');
    });
  });

  // ─── list_projects ───────────────────────────────────────────────────────────

  describe('list_projects', () => {
    it('should call GET /api/projects', async () => {
      const mockProjects = [{ id: 'p1', label: 'Alpha' }];
      mockApi.mockResolvedValueOnce(mockProjects);

      const result = await handleProjectTool('list_projects', {});
      expect(mockApi).toHaveBeenCalledWith('/api/projects');
      const data = parseToolResponse(result);
      expect(Array.isArray(data)).toBe(true);
    });

    it('should pass includeHidden query param when true', async () => {
      mockApi.mockResolvedValueOnce([]);
      await handleProjectTool('list_projects', { includeHidden: true });
      expect(mockApi).toHaveBeenCalledWith('/api/projects?includeHidden=true');
    });

    it('should accept undefined args', async () => {
      mockApi.mockResolvedValueOnce([]);
      const result = await handleProjectTool('list_projects', undefined);
      expect(result.content[0].type).toBe('text');
    });
  });

  // ─── get_project ─────────────────────────────────────────────────────────────

  describe('get_project', () => {
    it('should call GET /api/projects/:id', async () => {
      const mockProject = { id: 'proj-abc', label: 'My Project' };
      mockApi.mockResolvedValueOnce(mockProject);

      const result = await handleProjectTool('get_project', { id: 'proj-abc' });
      expect(mockApi).toHaveBeenCalledWith('/api/projects/proj-abc');
      const data = parseToolResponse(result);
      expect(data.id).toBe('proj-abc');
    });

    it('should throw when id is missing', async () => {
      await expect(handleProjectTool('get_project', {})).rejects.toThrow();
    });
  });

  // ─── create_project ──────────────────────────────────────────────────────────

  describe('create_project', () => {
    it('should POST to /api/projects', async () => {
      const mockProject = { id: 'new-1', label: 'New Project', description: 'A test project' };
      mockApi.mockResolvedValueOnce(mockProject);

      const result = await handleProjectTool('create_project', {
        label: 'New Project',
        description: 'A test project',
      });

      expect(mockApi).toHaveBeenCalledWith(
        '/api/projects',
        expect.objectContaining({ method: 'POST' })
      );
      expect(result.content[0].text).toContain('Project created: New Project');
    });

    it('should throw when label is missing', async () => {
      await expect(handleProjectTool('create_project', {})).rejects.toThrow();
    });
  });

  // ─── update_project ──────────────────────────────────────────────────────────

  describe('update_project', () => {
    it('should PATCH /api/projects/:id', async () => {
      const mockProject = { id: 'proj-1', label: 'Updated Label' };
      mockApi.mockResolvedValueOnce(mockProject);

      const result = await handleProjectTool('update_project', {
        id: 'proj-1',
        label: 'Updated Label',
      });

      expect(mockApi).toHaveBeenCalledWith(
        '/api/projects/proj-1',
        expect.objectContaining({ method: 'PATCH' })
      );
      expect(result.content[0].text).toContain('Project updated: Updated Label');
    });

    it('should throw when id is missing', async () => {
      await expect(handleProjectTool('update_project', { label: 'x' })).rejects.toThrow();
    });
  });

  // ─── delete_project ──────────────────────────────────────────────────────────

  describe('delete_project', () => {
    it('should DELETE /api/projects/:id', async () => {
      mockApi.mockResolvedValueOnce(undefined);

      const result = await handleProjectTool('delete_project', { id: 'proj-del' });
      expect(mockApi).toHaveBeenCalledWith('/api/projects/proj-del', { method: 'DELETE' });
      expect(result.content[0].text).toContain('deleted');
    });

    it('should append ?force=true when force flag is set', async () => {
      mockApi.mockResolvedValueOnce(undefined);

      await handleProjectTool('delete_project', { id: 'proj-x', force: true });
      expect(mockApi).toHaveBeenCalledWith('/api/projects/proj-x?force=true', { method: 'DELETE' });
    });

    it('should throw when id is missing', async () => {
      await expect(handleProjectTool('delete_project', {})).rejects.toThrow();
    });
  });

  // ─── get_project_stats ───────────────────────────────────────────────────────

  describe('get_project_stats', () => {
    it('should aggregate tasks by status', async () => {
      const mockTasks = {
        success: true,
        data: [
          { id: 't1', status: 'todo', project: 'proj-1' },
          { id: 't2', status: 'in-progress', project: 'proj-1' },
          { id: 't3', status: 'todo', project: 'proj-1' },
          { id: 't4', status: 'done', project: 'proj-1' },
        ],
      };
      mockApi.mockResolvedValueOnce(mockTasks);

      const result = await handleProjectTool('get_project_stats', { id: 'proj-1' });
      const stats = parseToolResponse(result);

      expect(stats.projectId).toBe('proj-1');
      expect(stats.total).toBe(4);
      expect(stats.byStatus.todo).toBe(2);
      expect(stats.byStatus['in-progress']).toBe(1);
      expect(stats.byStatus.done).toBe(1);
    });

    it('should handle empty task list', async () => {
      mockApi.mockResolvedValueOnce({ success: true, data: [] });

      const result = await handleProjectTool('get_project_stats', { id: 'empty-proj' });
      const stats = parseToolResponse(result);

      expect(stats.total).toBe(0);
      expect(stats.byStatus).toEqual({});
    });

    it('should handle plain array response', async () => {
      mockApi.mockResolvedValueOnce([
        { id: 't1', status: 'todo' },
        { id: 't2', status: 'todo' },
      ]);

      const result = await handleProjectTool('get_project_stats', { id: 'proj-2' });
      const stats = parseToolResponse(result);

      expect(stats.total).toBe(2);
      expect(stats.byStatus.todo).toBe(2);
    });

    it('should throw when id is missing', async () => {
      await expect(handleProjectTool('get_project_stats', {})).rejects.toThrow();
    });
  });

  // ─── reorder_projects ────────────────────────────────────────────────────────

  describe('reorder_projects', () => {
    it('should POST to /api/projects/reorder', async () => {
      const mockProjects = [
        { id: 'p2', label: 'B', order: 1 },
        { id: 'p1', label: 'A', order: 2 },
      ];
      mockApi.mockResolvedValueOnce(mockProjects);

      const result = await handleProjectTool('reorder_projects', {
        orderedIds: ['p2', 'p1'],
      });

      expect(mockApi).toHaveBeenCalledWith(
        '/api/projects/reorder',
        expect.objectContaining({ method: 'POST' })
      );
      expect(result.content[0].text).toContain('Projects reordered');
    });

    it('should throw when orderedIds is missing', async () => {
      await expect(handleProjectTool('reorder_projects', {})).rejects.toThrow();
    });
  });

  // ─── Error handling ──────────────────────────────────────────────────────────

  describe('error handling', () => {
    it('should throw for unknown project tool', async () => {
      await expect(handleProjectTool('nonexistent_tool', {})).rejects.toThrow(
        'Unknown project tool'
      );
    });
  });
});
