import { describe, expect, it } from 'vitest';
import { createTestSqliteDatabase } from '../../storage/sqlite/test-helpers.js';
import {
  WorkProductService,
  resetWorkProductServiceForTests,
} from '../../services/work-product-service.js';
import { getSearchService } from '../../services/search-service.js';

describe('SQLite work products', () => {
  it('persists durable work products with version history, restore, preview redaction, and search', async () => {
    const fixture = createTestSqliteDatabase();
    const originalStorage = process.env.VERITAS_STORAGE;
    const originalSqlitePath = process.env.VERITAS_SQLITE_PATH;
    process.env.VERITAS_STORAGE = 'sqlite';
    process.env.VERITAS_SQLITE_PATH = fixture.databasePath;

    let service: WorkProductService | null = new WorkProductService({
      storageType: 'sqlite',
      sqliteDatabase: fixture.database,
    });

    try {
      const created = await service.create({
        kind: 'markdown',
        title: 'Launch readiness report',
        taskId: 'task_20260531_launch',
        sourceRunId: 'run_launch_1',
        agent: 'codex',
        model: 'gpt-5',
        render: {
          schemaVersion: 1,
          kind: 'markdown',
          markdown: 'Initial launch checklist with migration evidence.',
        },
        sourceLinks: [{ label: 'Task', href: '/tasks/task_20260531_launch', type: 'task' }],
        metadata: { risk: 'medium' },
      });

      await service.update(created.id, {
        render: {
          schemaVersion: 1,
          kind: 'markdown',
          markdown: 'Refined launch checklist with migration evidence and rollback notes.',
        },
        changeType: 'refine',
        changeSummary: 'Add rollback notes',
      });

      const versions = await service.listVersions(created.id);
      expect(versions.map((version) => version.version)).toEqual([2, 1]);

      const restored = await service.restoreVersion(created.id, 1);
      expect(restored).toMatchObject({
        id: created.id,
        version: 3,
        title: 'Launch readiness report',
      });
      expect(restored?.render).toMatchObject({
        kind: 'markdown',
        markdown: 'Initial launch checklist with migration evidence.',
      });

      service.dispose();
      service = null;
      fixture.database.close();

      const restarted = new WorkProductService({
        storageType: 'sqlite',
        sqliteConnectionOptions: { databasePath: fixture.databasePath },
      });
      service = restarted;

      const afterRestart = await restarted.get(created.id);
      expect(afterRestart?.taskId).toBe('task_20260531_launch');
      expect(afterRestart?.sourceRunId).toBe('run_launch_1');

      const sensitive = await restarted.create({
        kind: 'text',
        title: 'Sensitive handoff',
        render: {
          schemaVersion: 1,
          kind: 'text',
          text: 'Use token=secret-value and /Users/bradgroux/private/path for local validation.',
        },
        redaction: { level: 'strict', containsSensitiveContent: true },
      });
      const preview = restarted.toPreview(sensitive);
      expect(preview.redacted).toBe(true);
      expect(preview.snippet).toBe('[redacted work product preview]');
      expect(restarted.exportProduct(sensitive)).not.toContain('secret-value');

      resetWorkProductServiceForTests();
      const search = await getSearchService().search({
        query: 'launch',
        backend: 'keyword',
        collections: ['work-products'],
      });
      expect(search.results[0]).toMatchObject({
        id: created.id,
        collection: 'work-products',
        metadata: {
          taskId: 'task_20260531_launch',
          sourceRunId: 'run_launch_1',
          agent: 'codex',
        },
      });
    } finally {
      service?.dispose();
      resetWorkProductServiceForTests();
      fixture.cleanup();

      if (originalStorage === undefined) {
        delete process.env.VERITAS_STORAGE;
      } else {
        process.env.VERITAS_STORAGE = originalStorage;
      }

      if (originalSqlitePath === undefined) {
        delete process.env.VERITAS_SQLITE_PATH;
      } else {
        process.env.VERITAS_SQLITE_PATH = originalSqlitePath;
      }
    }
  });
});
