import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { DEFAULT_FEATURE_SETTINGS, type ManagedListItem } from '@veritas-kanban/shared';
import { ConfigService } from '../../services/config-service.js';
import { ManagedListService } from '../../services/managed-list-service.js';
import { TemplateService } from '../../services/template-service.js';
import { PromptRegistryService } from '../../services/prompt-registry-service.js';
import {
  createTestSqliteDatabase,
  type TestSqliteDatabase,
} from '../../storage/sqlite/test-helpers.js';

interface TestListItem extends ManagedListItem {
  color?: string;
}

describe('SQLite configuration repositories', () => {
  let fixture: TestSqliteDatabase;
  let testRoot: string;

  beforeEach(async () => {
    fixture = createTestSqliteDatabase();
    fixture.database.open();
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-sqlite-config-'));
  });

  afterEach(async () => {
    fixture.cleanup();
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it('stores ConfigService settings in SQLite without creating config JSON files', async () => {
    const configFile = path.join(testRoot, '.veritas-kanban', 'config.json');
    const service = new ConfigService({
      configDir: path.dirname(configFile),
      configFile,
      storageType: 'sqlite',
      sqliteDatabase: fixture.database,
    });

    const defaults = await service.getFeatureSettings();
    expect(defaults).toEqual(DEFAULT_FEATURE_SETTINGS);

    const updated = await service.updateFeatureSettings({
      board: { showDashboard: false },
      tasks: { enableTimeTracking: false },
    });

    expect(updated.board.showDashboard).toBe(false);
    expect(updated.board.showArchiveSuggestions).toBe(
      DEFAULT_FEATURE_SETTINGS.board.showArchiveSuggestions
    );
    expect(updated.tasks.enableTimeTracking).toBe(false);

    const secondService = new ConfigService({
      configDir: path.dirname(configFile),
      configFile,
      storageType: 'sqlite',
      sqliteDatabase: fixture.database,
    });
    expect((await secondService.getFeatureSettings()).board.showDashboard).toBe(false);
    await expect(fs.access(configFile)).rejects.toThrow();
  });

  it('supports managed list defaults, CRUD, delete safety, and reorder in SQLite', async () => {
    const service = new ManagedListService<TestListItem>({
      filename: 'test-items.json',
      configDir: path.join(testRoot, '.veritas-kanban'),
      storageType: 'sqlite',
      sqliteDatabase: fixture.database,
      defaults: [
        {
          id: 'default-1',
          label: 'Default One',
          order: 0,
          isDefault: true,
          created: '2026-01-01T00:00:00.000Z',
          updated: '2026-01-01T00:00:00.000Z',
        },
      ],
      referenceCounter: async (id: string) => (id === 'default-1' ? 2 : 0),
    });

    expect((await service.list()).map((item) => item.id)).toEqual(['default-1']);
    const created = await service.create({ label: 'Created Item', color: 'blue' });
    expect(created.id).toContain('created-item');
    expect(created.order).toBe(1);

    const hidden = await service.update(created.id, { isHidden: true });
    expect(hidden?.isHidden).toBe(true);
    expect((await service.list()).map((item) => item.id)).toEqual(['default-1']);
    expect(await service.list(true)).toHaveLength(2);

    expect(await service.canDelete('default-1')).toMatchObject({
      allowed: false,
      referenceCount: 2,
      isDefault: true,
    });
    expect(await service.delete('default-1')).toEqual({ deleted: false, referenceCount: 2 });
    expect(await service.delete('default-1', true)).toEqual({ deleted: true });

    await service.update(created.id, { isHidden: false });
    const reordered = await service.reorder([created.id]);
    expect(reordered[0].id).toBe(created.id);
    expect(reordered[0].order).toBe(0);
  });

  it('stores task templates in SQLite with v1 update semantics', async () => {
    const service = new TemplateService({
      storageType: 'sqlite',
      sqliteDatabase: fixture.database,
    });

    const created = await service.createTemplate({
      name: 'SQLite Template',
      description: 'Stored in SQLite',
      category: 'feature',
      taskDefaults: {
        type: 'code',
        priority: 'medium',
        descriptionTemplate: 'Build {{feature}}',
      },
      subtaskTemplates: [{ title: 'Review {{feature}}', order: 0 }],
    });

    expect(created.id).toMatch(/^template_sqlite-template_/);
    expect(await service.getTemplate(created.id)).toEqual(created);

    const updated = await service.updateTemplate(created.id, {
      name: 'Updated SQLite Template',
      taskDefaults: { priority: 'high' },
    });
    expect(updated?.taskDefaults.type).toBe('code');
    expect(updated?.taskDefaults.priority).toBe('high');
    expect((await service.getTemplates()).map((template) => template.name)).toEqual([
      'Updated SQLite Template',
    ]);

    expect(await service.deleteTemplate(created.id)).toBe(true);
    expect(await service.getTemplate(created.id)).toBeNull();
  });

  it('stores prompt templates, versions, usage, stats, and preview rendering in SQLite', async () => {
    const service = new PromptRegistryService({
      storageType: 'sqlite',
      sqliteDatabase: fixture.database,
    });

    const created = await service.createTemplate({
      name: 'SQLite Prompt',
      category: 'agent',
      content: 'Hello {{ name }} from {{team}}',
    });
    expect(created.variables).toEqual(['name', 'team']);
    expect(
      (await service.getVersionHistory(created.id)).map((version) => version.versionNumber)
    ).toEqual([1]);

    await expect(service.updateTemplate(created.id, { content: 'Hello {{name}}' })).rejects.toThrow(
      /changelog is required/
    );

    const updated = await service.updateTemplate(created.id, {
      content: 'Hello {{name}} from {{team}} in {{env}}',
      changelog: 'Add environment variable',
    });
    expect(updated?.currentVersionId).toBe(`${created.id}_v2`);
    expect(
      (await service.getVersionHistory(created.id)).map((version) => version.versionNumber)
    ).toEqual([2, 1]);

    await service.recordUsage(created.id, 'brad', 'Hello Brad', 'gpt', 10, 5);
    const stats = await service.getStats(created.id);
    expect(stats).toMatchObject({
      templateId: created.id,
      totalUsages: 1,
      totalVersions: 2,
      mostFrequentUser: 'brad',
      averageTokensPerUsage: 15,
    });

    const preview = await service.renderPreview({
      templateId: created.id,
      sampleVariables: { name: 'Brad', team: 'Veritas' },
    });
    expect(preview.renderedPrompt).toBe('Hello Brad from Veritas in {{env}}');
    expect(preview.unmatchedVariables).toEqual(['env']);

    expect(await service.deleteTemplate(created.id)).toBe(true);
    expect(await service.getTemplate(created.id)).toBeNull();
    expect(await service.getVersionHistory(created.id)).toEqual([]);
    expect(await service.getUsageRecords(created.id)).toEqual([]);
  });
});
