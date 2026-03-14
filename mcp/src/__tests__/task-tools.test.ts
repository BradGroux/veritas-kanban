/**
 * MCP Task Tools — Integration Tests
 *
 * Tests the task tool handlers against the live VK server (localhost:3001).
 * Covers: list (with project/status/type filters), create, get, update, delete.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { handleTaskTool, taskTools } from '../tools/tasks.js';

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

describe('Task MCP Tools', () => {
  const testTaskIds: string[] = [];

  afterAll(async () => {
    for (const id of testTaskIds) {
      try {
        await handleTaskTool('delete_task', { id });
      } catch {
        // Already deleted
      }
    }
  });

  describe('Tool definitions', () => {
    it('should export 6 task tools', () => {
      expect(taskTools).toHaveLength(6);
    });

    it('should have correct tool names', () => {
      const names = taskTools.map((t) => t.name);
      expect(names).toEqual([
        'list_tasks',
        'get_task',
        'create_task',
        'update_task',
        'archive_task',
        'delete_task',
      ]);
    });

    it('should require title for create_task', () => {
      const tool = taskTools.find((t) => t.name === 'create_task');
      expect(tool?.inputSchema.required).toContain('title');
    });

    it('should require id for update_task', () => {
      const tool = taskTools.find((t) => t.name === 'update_task');
      expect(tool?.inputSchema.required).toContain('id');
    });

    it('should have project filter on list_tasks', () => {
      const tool = taskTools.find((t) => t.name === 'list_tasks');
      expect(tool?.inputSchema.properties.project).toBeDefined();
    });
  });

  describe('list_tasks', () => {
    it('should return an array', async () => {
      const result = await handleTaskTool('list_tasks', {});
      const tasks = parseToolResponse(result);
      expect(Array.isArray(tasks)).toBe(true);
    });

    it('should filter by status', async () => {
      const result = await handleTaskTool('list_tasks', { status: 'done' });
      const tasks = parseToolResponse(result);
      expect(Array.isArray(tasks)).toBe(true);
      for (const task of tasks) {
        expect(task.status).toBe('done');
      }
    });

    it('should filter by type', async () => {
      const result = await handleTaskTool('list_tasks', { type: 'code' });
      const tasks = parseToolResponse(result);
      for (const task of tasks) {
        expect(task.type).toBe('code');
      }
    });

    it('should filter by project', async () => {
      const result = await handleTaskTool('list_tasks', { project: '__nonexistent_project__' });
      const tasks = parseToolResponse(result);
      expect(tasks).toHaveLength(0);
    });
  });

  describe('create + get + update + delete lifecycle', () => {
    let taskId: string;

    it('should create a task', async () => {
      const result = await handleTaskTool('create_task', {
        title: '__mcp_test_task',
        type: 'research',
        priority: 'low',
        description: 'Integration test task — safe to delete',
      });
      const task = parseToolResponse(result);
      expect(task.title).toBe('__mcp_test_task');
      expect(task.type).toBe('research');
      expect(task.priority).toBe('low');
      expect(task.id).toBeDefined();
      taskId = task.id;
      testTaskIds.push(taskId);
    });

    it('should get the created task', async () => {
      const result = await handleTaskTool('get_task', { id: taskId });
      const task = parseToolResponse(result);
      expect(task.id).toBe(taskId);
      expect(task.title).toBe('__mcp_test_task');
    });

    it('should update the task', async () => {
      const result = await handleTaskTool('update_task', {
        id: taskId,
        status: 'in-progress',
        priority: 'high',
      });
      const task = parseToolResponse(result);
      expect(task.status).toBe('in-progress');
      expect(task.priority).toBe('high');
    });

    it('should delete the task', async () => {
      const result = await handleTaskTool('delete_task', { id: taskId });
      expect(result.content[0].text).toContain('deleted');
      const idx = testTaskIds.indexOf(taskId);
      if (idx !== -1) testTaskIds.splice(idx, 1);
    });
  });

  describe('error handling', () => {
    it('should return isError for nonexistent task', async () => {
      const result = await handleTaskTool('get_task', { id: 'nonexistent_id_12345' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not found');
    });

    it('should throw for unknown tool', async () => {
      await expect(handleTaskTool('fake_tool', {})).rejects.toThrow('Unknown task tool');
    });

    it('should throw for create_task with missing title', async () => {
      await expect(handleTaskTool('create_task', {})).rejects.toThrow();
    });
  });
});
