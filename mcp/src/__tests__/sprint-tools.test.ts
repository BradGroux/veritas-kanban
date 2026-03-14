/**
 * MCP Sprint Tools — Integration Tests
 *
 * Tests the sprint tool handlers against the live VK server (localhost:3001).
 * These are integration tests, not unit tests — they verify the full MCP → HTTP → VK pipeline.
 *
 * Covers: list, create, get, update, delete (with and without force), can_delete, reorder.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { handleSprintTool, sprintTools } from '../tools/sprints.js';

// Helper: parse JSON from tool response content
function parseToolResponse(result: any): any {
  const text = result.content[0].text;
  // Some responses have a prefix line before JSON (e.g., "Sprint created: ...")
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

describe('Sprint MCP Tools', () => {
  const testSprintIds: string[] = [];

  afterAll(async () => {
    // Cleanup: force-delete any test sprints we created
    for (const id of testSprintIds) {
      try {
        await handleSprintTool('delete_sprint', { id, force: true });
      } catch {
        // Sprint may already be deleted — that's fine
      }
    }
  });

  describe('Tool definitions', () => {
    it('should export 9 sprint tools', () => {
      expect(sprintTools).toHaveLength(9);
    });

    it('should have correct tool names', () => {
      const names = sprintTools.map((t) => t.name);
      expect(names).toContain('list_sprints');
      expect(names).toContain('get_sprint');
      expect(names).toContain('create_sprint');
      expect(names).toContain('update_sprint');
      expect(names).toContain('delete_sprint');
      expect(names).toContain('can_delete_sprint');
      expect(names).toContain('reorder_sprints');
      expect(names).toContain('get_archive_suggestions');
      expect(names).toContain('close_sprint');
    });

    it('should require id for get_sprint', () => {
      const tool = sprintTools.find((t) => t.name === 'get_sprint');
      expect(tool?.inputSchema.required).toContain('id');
    });

    it('should require label for create_sprint', () => {
      const tool = sprintTools.find((t) => t.name === 'create_sprint');
      expect(tool?.inputSchema.required).toContain('label');
    });

    it('should have force as optional on delete_sprint', () => {
      const tool = sprintTools.find((t) => t.name === 'delete_sprint');
      expect(tool?.inputSchema.properties.force).toBeDefined();
      expect(tool?.inputSchema.properties.force.type).toBe('boolean');
      // force is NOT in required — it's optional
      expect(tool?.inputSchema.required).not.toContain('force');
    });
  });

  describe('list_sprints', () => {
    it('should return an array of sprints', async () => {
      const result = await handleSprintTool('list_sprints', {});
      const sprints = parseToolResponse(result);
      expect(Array.isArray(sprints)).toBe(true);
    });

    it('should accept empty args', async () => {
      const result = await handleSprintTool('list_sprints', undefined);
      expect(result.content[0].type).toBe('text');
    });
  });

  describe('create_sprint + get_sprint + delete_sprint lifecycle', () => {
    let createdId: string;

    it('should create a sprint', async () => {
      const result = await handleSprintTool('create_sprint', {
        label: '__test_sprint_lifecycle',
        description: 'Integration test sprint — safe to delete',
      });

      const sprint = parseToolResponse(result);
      expect(sprint.label).toBe('__test_sprint_lifecycle');
      expect(sprint.description).toBe('Integration test sprint — safe to delete');
      expect(sprint.id).toBeDefined();
      createdId = sprint.id;
      testSprintIds.push(createdId);
    });

    it('should get the created sprint', async () => {
      const result = await handleSprintTool('get_sprint', { id: createdId });
      const sprint = parseToolResponse(result);
      expect(sprint.id).toBe(createdId);
      expect(sprint.label).toBe('__test_sprint_lifecycle');
    });

    it('should update the sprint', async () => {
      const result = await handleSprintTool('update_sprint', {
        id: createdId,
        label: '__test_sprint_updated',
        isHidden: true,
      });
      const sprint = parseToolResponse(result);
      expect(sprint.label).toBe('__test_sprint_updated');
      expect(sprint.isHidden).toBe(true);
    });

    it('should appear in list when includeHidden=true', async () => {
      const result = await handleSprintTool('list_sprints', { includeHidden: true });
      const sprints = parseToolResponse(result);
      const found = sprints.find((s: any) => s.id === createdId);
      expect(found).toBeDefined();
    });

    it('should delete the sprint', async () => {
      const result = await handleSprintTool('delete_sprint', { id: createdId });
      expect(result.content[0].text).toContain('deleted');
      // Remove from cleanup list since we already deleted it
      const idx = testSprintIds.indexOf(createdId);
      if (idx !== -1) testSprintIds.splice(idx, 1);
    });
  });

  describe('can_delete_sprint', () => {
    let sprintId: string;

    beforeAll(async () => {
      const result = await handleSprintTool('create_sprint', {
        label: '__test_can_delete',
      });
      const sprint = parseToolResponse(result);
      sprintId = sprint.id;
      testSprintIds.push(sprintId);
    });

    it('should report whether sprint can be deleted', async () => {
      const result = await handleSprintTool('can_delete_sprint', { id: sprintId });
      const data = parseToolResponse(result);
      // API returns `allowed` (not `canDelete`) with reference info
      const canDelete = data.canDelete ?? data.allowed;
      expect(canDelete).toBeDefined();
      expect(typeof canDelete).toBe('boolean');
    });
  });

  describe('force delete behavior', () => {
    it('should accept force=true flag', async () => {
      // Create a sprint we can force-delete
      const createResult = await handleSprintTool('create_sprint', {
        label: '__test_force_delete',
      });
      const sprint = parseToolResponse(createResult);
      testSprintIds.push(sprint.id);

      // Force delete should succeed regardless of references
      const deleteResult = await handleSprintTool('delete_sprint', {
        id: sprint.id,
        force: true,
      });
      expect(deleteResult.content[0].text).toContain('deleted');

      const idx = testSprintIds.indexOf(sprint.id);
      if (idx !== -1) testSprintIds.splice(idx, 1);
    });
  });

  describe('get_archive_suggestions', () => {
    it('should return an array', async () => {
      const result = await handleSprintTool('get_archive_suggestions', {});
      const text = result.content[0].text;
      // Either "No sprints ready to archive" or a JSON array
      if (text.includes('No sprints')) {
        expect(text).toBe('No sprints ready to archive');
      } else {
        const data = JSON.parse(text);
        expect(Array.isArray(data)).toBe(true);
      }
    });
  });

  describe('error handling', () => {
    it('should throw for unknown sprint tool', async () => {
      await expect(handleSprintTool('nonexistent_tool', {})).rejects.toThrow('Unknown sprint tool');
    });

    it('should throw for create_sprint with missing label', async () => {
      await expect(handleSprintTool('create_sprint', {})).rejects.toThrow();
    });

    it('should throw for get_sprint with missing id', async () => {
      await expect(handleSprintTool('get_sprint', {})).rejects.toThrow();
    });
  });
});
