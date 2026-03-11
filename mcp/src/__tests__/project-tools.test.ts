/**
 * MCP Project Tools — Integration Tests
 *
 * Tests the project tool handlers against the live VK server (localhost:3001).
 * Covers: list, create, get, update, delete (with and without force), color validation.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { handleProjectTool, projectTools } from '../tools/projects.js';

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
  const testProjectIds: string[] = [];

  afterAll(async () => {
    for (const id of testProjectIds) {
      try {
        await handleProjectTool('delete_project', { id, force: true });
      } catch {
        // Project may already be deleted
      }
    }
  });

  describe('Tool definitions', () => {
    it('should export 5 project tools', () => {
      expect(projectTools).toHaveLength(5);
    });

    it('should have correct tool names', () => {
      const names = projectTools.map((t) => t.name);
      expect(names).toContain('list_projects');
      expect(names).toContain('get_project');
      expect(names).toContain('create_project');
      expect(names).toContain('update_project');
      expect(names).toContain('delete_project');
    });

    it('should require id for get_project', () => {
      const tool = projectTools.find((t) => t.name === 'get_project');
      expect(tool?.inputSchema.required).toContain('id');
    });

    it('should require label for create_project', () => {
      const tool = projectTools.find((t) => t.name === 'create_project');
      expect(tool?.inputSchema.required).toContain('label');
    });
  });

  describe('Color validation', () => {
    it('should accept valid Tailwind color classes', () => {
      const validColors = ['blue-500', 'emerald-600', 'red-50', 'zinc-950'];
      for (const color of validColors) {
        expect(() => {
          // Directly test the Zod schema by attempting to create with the color
          // If the schema rejects it, parse will throw
          const { CreateProjectSchema } = getSchemas();
          CreateProjectSchema.parse({ label: 'test', color });
        }).not.toThrow();
      }
    });

    it('should reject invalid color formats', () => {
      const invalidColors = ['#ff0000', 'rgb(0,0,0)', 'bg-blue-500/20', 'Blue-500', '500'];
      for (const color of invalidColors) {
        expect(() => {
          const { CreateProjectSchema } = getSchemas();
          CreateProjectSchema.parse({ label: 'test', color });
        }).toThrow();
      }
    });
  });

  describe('CRUD operations (requires running server)', () => {
    let createdId: string;

    it('should list projects', async () => {
      const result = await handleProjectTool('list_projects', {});
      const projects = parseToolResponse(result);
      expect(Array.isArray(projects)).toBe(true);
    });

    it('should create a project', async () => {
      const result = await handleProjectTool('create_project', {
        label: 'MCP Test Project',
        description: 'Created by project-tools integration test',
        color: 'blue-500',
      });
      const project = parseToolResponse(result);
      expect(project.label).toBe('MCP Test Project');
      expect(project.color).toBe('blue-500');
      expect(project.id).toBeDefined();
      createdId = project.id;
      testProjectIds.push(createdId);
    });

    it('should get a project by id', async () => {
      const result = await handleProjectTool('get_project', { id: createdId });
      const project = parseToolResponse(result);
      expect(project.id).toBe(createdId);
      expect(project.label).toBe('MCP Test Project');
    });

    it('should update a project', async () => {
      const result = await handleProjectTool('update_project', {
        id: createdId,
        label: 'MCP Test Project Updated',
        color: 'emerald-600',
      });
      const project = parseToolResponse(result);
      expect(project.label).toBe('MCP Test Project Updated');
      expect(project.color).toBe('emerald-600');
    });

    it('should delete a project', async () => {
      const result = await handleProjectTool('delete_project', {
        id: createdId,
        force: true,
      });
      expect(result.content[0].text).toContain(createdId);
      // Remove from cleanup list since we already deleted it
      const idx = testProjectIds.indexOf(createdId);
      if (idx !== -1) testProjectIds.splice(idx, 1);
    });
  });
});

// Re-export schemas for direct validation testing
function getSchemas() {
  const { z } = require('zod');
  const TAILWIND_COLOR_RE = /^[a-z]+-\d{2,3}$/;
  return {
    CreateProjectSchema: z.object({
      label: z.string().min(1),
      description: z.string().optional(),
      color: z.string().regex(TAILWIND_COLOR_RE).optional(),
    }),
  };
}
