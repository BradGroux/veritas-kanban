import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ScheduledDeliverablesService } from '../../services/scheduled-deliverables-service.js';
import {
  createTestSqliteDatabase,
  type TestSqliteDatabase,
} from '../../storage/sqlite/test-helpers.js';

describe('SQLite scheduled deliverable repositories', () => {
  let fixture: TestSqliteDatabase;
  let testRoot: string;

  beforeEach(async () => {
    fixture = createTestSqliteDatabase();
    fixture.database.open();
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-sqlite-scheduled-'));
  });

  afterEach(async () => {
    fixture.cleanup();
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it('persists scheduled deliverables and stable run snapshots without JSON files', async () => {
    const dataDir = path.join(testRoot, 'data');
    const service = new ScheduledDeliverablesService({
      dataDir,
      storageType: 'sqlite',
      sqliteDatabase: fixture.database,
    });

    const deliverable = await service.create({
      name: 'Weekly QA Packet',
      description: 'Summarize completed QA runs.',
      schedule: 'weekly',
      agent: 'codex',
      outputPath: 'docs/reports/weekly-qa.md',
      tags: ['qa', 'weekly'],
    });
    await service.create({
      name: 'Paused Report',
      description: 'Disabled report fixture.',
      schedule: 'daily',
      enabled: false,
      tags: ['paused'],
    });
    await service.recordRun({
      deliverableId: deliverable.id,
      status: 'success',
      outputFile: 'docs/reports/weekly-qa-2026-05-31.md',
      summary: 'Three runs completed, no release blockers.',
      durationMs: 1234,
      sourceRunId: 'run_20260531_weekly_qa',
      workflowId: 'workflow_weekly_qa',
      snapshotMetadata: { reviewed: true, completedRuns: 3, releaseBlockers: 0 },
    });

    const restarted = new ScheduledDeliverablesService({
      dataDir,
      storageType: 'sqlite',
      sqliteDatabase: fixture.database,
    });

    expect(await restarted.list({ enabled: true, agent: 'codex', tag: 'weekly' })).toEqual([
      expect.objectContaining({
        id: deliverable.id,
        name: 'Weekly QA Packet',
        totalRuns: 1,
        lastRunAt: expect.any(String),
        nextRunAt: expect.any(String),
      }),
    ]);
    expect(await restarted.list({ enabled: false })).toEqual([
      expect.objectContaining({ name: 'Paused Report' }),
    ]);

    const detail = await restarted.get(deliverable.id);
    expect(detail?.recentRuns).toEqual([
      expect.objectContaining({
        deliverableId: deliverable.id,
        status: 'success',
        sourceRunId: 'run_20260531_weekly_qa',
        workflowId: 'workflow_weekly_qa',
        snapshot: expect.objectContaining({
          status: 'success',
          capturedAt: expect.any(String),
          outputFile: 'docs/reports/weekly-qa-2026-05-31.md',
          summary: 'Three runs completed, no release blockers.',
          metadata: { reviewed: true, completedRuns: 3, releaseBlockers: 0 },
        }),
      }),
    ]);
    await expect(fs.access(path.join(dataDir, 'scheduled-deliverables.json'))).rejects.toThrow();
    await expect(fs.access(path.join(dataDir, 'deliverable-runs.json'))).rejects.toThrow();
  });
});
