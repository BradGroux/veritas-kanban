/**
 * TemplateService Tests
 * Tests template CRUD operations using temp directories.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import matter from '../utils/frontmatter.js';

// We need to mock the constructor's process.cwd() dependency
// Instead, let's test the service by creating an instance and overriding the dir
import { TemplateService } from '../services/template-service.js';

describe('TemplateService', () => {
  let service: TemplateService;
  let testDir: string;
  let templatesDir: string;

  beforeEach(async () => {
    const suffix = Math.random().toString(36).substring(7);
    testDir = path.join(os.tmpdir(), `veritas-test-templates-${suffix}`);
    templatesDir = path.join(testDir, '.veritas-kanban', 'templates');
    await fs.mkdir(templatesDir, { recursive: true });

    // Create service and override the private templatesDir
    service = new TemplateService();
    // Access private field to override for testing
    (service as any).templatesDir = templatesDir;
  });

  afterEach(async () => {
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  describe('getTemplates', () => {
    it('should return empty array when no templates exist', async () => {
      const templates = await service.getTemplates();
      expect(templates).toEqual([]);
    });

    it('should return templates sorted by name', async () => {
      // Create test template files
      const template1 = {
        id: 'template_beta_123',
        name: 'Beta Template',
        description: 'Second template',
        version: 1,
        taskDefaults: { type: 'code', priority: 'medium' },
        created: '2024-01-01T00:00:00.000Z',
        updated: '2024-01-01T00:00:00.000Z',
      };
      const template2 = {
        id: 'template_alpha_456',
        name: 'Alpha Template',
        description: 'First template',
        version: 1,
        taskDefaults: { type: 'research', priority: 'high' },
        created: '2024-01-02T00:00:00.000Z',
        updated: '2024-01-02T00:00:00.000Z',
      };

      await fs.writeFile(
        path.join(templatesDir, 'template_beta_123.md'),
        matter.stringify('', template1),
        'utf-8'
      );
      await fs.writeFile(
        path.join(templatesDir, 'template_alpha_456.md'),
        matter.stringify('', template2),
        'utf-8'
      );

      const templates = await service.getTemplates();
      expect(templates).toHaveLength(2);
      expect(templates[0].name).toBe('Alpha Template');
      expect(templates[1].name).toBe('Beta Template');
    });

    it('should skip non-md files', async () => {
      await fs.writeFile(path.join(templatesDir, 'readme.txt'), 'not a template', 'utf-8');
      const template = {
        id: 'template_test_1',
        name: 'Test Template',
        version: 1,
        taskDefaults: {},
        created: '2024-01-01T00:00:00.000Z',
        updated: '2024-01-01T00:00:00.000Z',
      };
      await fs.writeFile(
        path.join(templatesDir, 'template_test_1.md'),
        matter.stringify('', template),
        'utf-8'
      );

      const templates = await service.getTemplates();
      expect(templates).toHaveLength(1);
    });
  });

  describe('getTemplate', () => {
    it('should return null for non-existent template', async () => {
      const result = await service.getTemplate('nonexistent');
      expect(result).toBeNull();
    });

    it('should return a template by id', async () => {
      const template = {
        id: 'template_my_test',
        name: 'My Test Template',
        description: 'A test',
        version: 1,
        taskDefaults: { type: 'code' },
        created: '2024-01-01T00:00:00.000Z',
        updated: '2024-01-01T00:00:00.000Z',
      };
      await fs.writeFile(
        path.join(templatesDir, 'template_my_test.md'),
        matter.stringify('', template),
        'utf-8'
      );

      const result = await service.getTemplate('template_my_test');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('template_my_test');
      expect(result!.name).toBe('My Test Template');
    });
  });

  describe('createTemplate', () => {
    it('should create a new template and return it', async () => {
      const result = await service.createTemplate({
        name: 'New Bug Report',
        description: 'Template for bug reports',
        category: 'bugs',
        taskDefaults: {
          type: 'code',
          priority: 'high',
          descriptionTemplate: 'Bug details here',
        },
        subtaskTemplates: [],
        blueprint: '',
      } as any);

      expect(result.id).toMatch(/^template_new-bug-report_/);
      expect(result.name).toBe('New Bug Report');
      expect(result.description).toBe('Template for bug reports');
      expect(result.version).toBe(1);
      expect(result.taskDefaults.type).toBe('code');
      expect(result.taskDefaults.priority).toBe('high');
      expect(result.created).toBeDefined();
      expect(result.updated).toBeDefined();

      // Verify file was created
      const files = await fs.readdir(templatesDir);
      expect(files.filter((f) => f.endsWith('.md'))).toHaveLength(1);
    });

    it('should preserve empty task defaults when reading created templates', async () => {
      const created = await service.createTemplate({
        name: 'Empty Defaults',
        taskDefaults: {},
      });

      expect(created.taskDefaults).toEqual({});

      const listed = await service.getTemplates();
      expect(listed).toHaveLength(1);
      expect(listed[0]?.taskDefaults).toEqual({});

      const loaded = await service.getTemplate(created.id);
      expect(loaded?.taskDefaults).toEqual({});
    });
  });

  describe('updateTemplate', () => {
    it('should return null for non-existent template', async () => {
      const result = await service.updateTemplate('nonexistent', { name: 'New Name' });
      expect(result).toBeNull();
    });

    it('should update an existing template', async () => {
      // Create a template first
      const created = await service.createTemplate({
        name: 'Original',
        description: 'Original desc',
        category: 'testing',
        taskDefaults: { type: 'code', priority: 'medium', descriptionTemplate: 'Template text' },
        subtaskTemplates: [],
        blueprint: '',
      } as any);

      const updated = await service.updateTemplate(created.id, {
        name: 'Updated Name',
        description: 'Updated desc',
        taskDefaults: { priority: 'high' },
      });

      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('Updated Name');
      expect(updated!.description).toBe('Updated desc');
      expect(updated!.taskDefaults.priority).toBe('high');
      // Type should be preserved from the merge
      expect(updated!.taskDefaults.type).toBe('code');
    });
  });

  describe('deleteTemplate', () => {
    it('should return false for non-existent template', async () => {
      const result = await service.deleteTemplate('nonexistent');
      expect(result).toBe(false);
    });

    it('should delete an existing template', async () => {
      const created = await service.createTemplate({
        name: 'To Delete',
        description: 'Will be deleted',
        category: 'temp',
        taskDefaults: { type: 'code', priority: 'low', descriptionTemplate: 'Delete me' },
        subtaskTemplates: [],
        blueprint: '',
      } as any);

      const result = await service.deleteTemplate(created.id);
      expect(result).toBe(true);

      // Verify it's gone
      const fetched = await service.getTemplate(created.id);
      expect(fetched).toBeNull();
    });
  });

  describe('v0 to v1 migration', () => {
    it('should migrate v0 templates to v1 format', async () => {
      // Create a v0 template (no version field)
      const v0Template = {
        id: 'template_v0_test',
        name: 'Legacy Template',
        description: 'Old format',
        taskDefaults: {
          type: 'code',
          priority: 'medium',
          descriptionTemplate: 'Some template text',
        },
        created: '2024-01-01T00:00:00.000Z',
        updated: '2024-01-01T00:00:00.000Z',
      };

      await fs.writeFile(
        path.join(templatesDir, 'template_v0_test.md'),
        matter.stringify('', v0Template),
        'utf-8'
      );

      const result = await service.getTemplate('template_v0_test');
      expect(result).not.toBeNull();
      expect(result!.version).toBe(1);
      expect(result!.taskDefaults.type).toBe('code');
      expect(result!.taskDefaults.priority).toBe('medium');
    });

    it('should not re-migrate v1 templates', async () => {
      const v1Template = {
        id: 'template_v1_test',
        name: 'V1 Template',
        version: 1,
        taskDefaults: { type: 'research' },
        category: 'testing',
        created: '2024-01-01T00:00:00.000Z',
        updated: '2024-01-01T00:00:00.000Z',
      };

      await fs.writeFile(
        path.join(templatesDir, 'template_v1_test.md'),
        matter.stringify('', v1Template),
        'utf-8'
      );

      const result = await service.getTemplate('template_v1_test');
      expect(result).not.toBeNull();
      expect(result!.version).toBe(1);
      expect(result!.category).toBe('testing');
    });
  });
});
