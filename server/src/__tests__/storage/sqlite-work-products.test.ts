import { describe, expect, it } from 'vitest';
import { createTestSqliteDatabase } from '../../storage/sqlite/test-helpers.js';
import {
  WorkProductService,
  resetWorkProductServiceForTests,
} from '../../services/work-product-service.js';
import { getSearchService } from '../../services/search-service.js';
import type { Task } from '@veritas-kanban/shared';

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

      const completedTask: Task = {
        id: 'task_20260602_packet',
        title: 'Ship completion packets',
        description: 'Generate a durable handoff artifact when task work is done.',
        type: 'code',
        status: 'done',
        priority: 'high',
        project: 'veritas',
        created: '2026-06-02T10:00:00.000Z',
        updated: '2026-06-02T11:00:00.000Z',
        revision: 7,
        agent: 'codex',
        git: {
          repo: 'BradGroux/veritas-kanban',
          branch: 'v5-completion-packets',
          baseBranch: 'main',
          worktreePath: '/Users/bradgroux/private/veritas-kanban',
          prUrl: 'https://github.com/BradGroux/veritas-kanban/pull/999',
          prNumber: 999,
        },
        attempt: {
          id: 'attempt_packet',
          agent: 'codex',
          status: 'complete',
          started: '2026-06-02T10:10:00.000Z',
          ended: '2026-06-02T10:20:00.000Z',
          model: 'gpt-5',
          orchestration: {
            mode: 'orchestrated',
            parentAgent: 'orchestrator',
            completion: 'all-required',
            handoff: 'Subagents returned findings for reconciliation.',
            totals: {
              roles: 2,
              required: 2,
              completed: 1,
              blocked: 1,
              failed: 0,
            },
            roles: [
              {
                id: 'researcher',
                label: 'Researcher',
                agent: 'researcher',
                scope: 'Inspect source material.',
                taskBrief: 'Find relevant facts.',
                deliverable: 'Research findings.',
                verification: ['Cites source material.'],
                dependsOn: [],
                required: true,
                status: 'completed',
                telemetry: { durationSeconds: 120, tokensUsed: 1200 },
              },
              {
                id: 'reviewer',
                label: 'Reviewer',
                agent: 'reviewer',
                scope: 'Check the research.',
                taskBrief: 'Validate findings.',
                deliverable: 'Review notes.',
                verification: ['Lists blockers first.'],
                dependsOn: ['researcher'],
                required: true,
                status: 'blocked',
                telemetry: { durationSeconds: 60 },
              },
            ],
          },
        },
        verificationSteps: [
          {
            id: 'verify_1',
            description: 'pnpm --filter @veritas-kanban/server test -- completion-packets',
            checked: true,
            checkedAt: '2026-06-02T10:45:00.000Z',
          },
        ],
        deliverables: [
          {
            id: 'deliverable_1',
            title: 'Completion packet service',
            type: 'code',
            path: 'server/src/services/work-product-service.ts',
            status: 'attached',
            sourceRunId: 'attempt_packet',
            created: '2026-06-02T10:40:00.000Z',
          },
        ],
        attachments: [
          {
            id: 'attachment_1',
            filename: 'packet-preview.png',
            originalName: 'packet-preview.png',
            mimeType: 'image/png',
            size: 1200,
            uploaded: '2026-06-02T10:50:00.000Z',
            validationStatus: 'valid',
          },
        ],
        review: {
          decision: 'approved',
          decidedAt: '2026-06-02T10:55:00.000Z',
          summary: 'Ready to hand off',
        },
        timeTracking: {
          entries: [],
          totalSeconds: 900,
          isRunning: false,
        },
        actualCost: 0.18,
      };

      const packet = await restarted.generateCompletionPacket(completedTask);
      expect(packet).toMatchObject({
        kind: 'report',
        title: 'Completion Packet: Ship completion packets',
        taskId: completedTask.id,
        sourceRunId: 'attempt_packet',
        metadata: {
          packetType: 'completion_packet',
          generatedFromRevision: 7,
          verificationPassed: 1,
          orchestrationRoles: 2,
          orchestrationBlocked: 1,
        },
      });
      expect(packet.sourceLinks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            label: 'Run timeline',
            href: expect.stringContaining('tab=timeline'),
          }),
          expect.objectContaining({ type: 'pr' }),
        ])
      );
      expect(restarted.exportProduct(packet)).toContain('Verification Evidence');
      expect(restarted.exportProduct(packet)).toContain('Orchestration Pipeline');
      expect(restarted.exportProduct(packet)).toContain('Reviewer is blocked');
      expect(restarted.exportProduct(packet)).not.toContain('/Users/bradgroux/private');

      const regenerated = await restarted.generateCompletionPacket({
        ...completedTask,
        updated: '2026-06-02T12:00:00.000Z',
        revision: 8,
        verificationSteps: [
          ...(completedTask.verificationSteps ?? []),
          { id: 'verify_2', description: 'Manual smoke test', checked: false },
        ],
      });
      expect(regenerated.id).toBe(packet.id);
      expect(regenerated.version).toBe(2);
      await expect(restarted.listVersions(packet.id)).resolves.toHaveLength(2);

      await restarted.archive(packet.id);
      const maintenancePreview = await restarted.maintenancePreview();
      expect(maintenancePreview.totals).toMatchObject({
        products: 3,
        active: 2,
        archived: 1,
        cleanupCandidates: 1,
      });
      expect(maintenancePreview.totals.versions).toBeGreaterThanOrEqual(6);
      expect(maintenancePreview.totals.estimatedBytes).toBeGreaterThan(0);
      expect(maintenancePreview.cleanupCandidates[0]).toMatchObject({
        id: packet.id,
        status: 'archived',
        cleanupEligible: true,
        taskId: completedTask.id,
        sourceRunId: 'attempt_packet',
        versionCount: 2,
      });
      expect(maintenancePreview.retained.map((item) => item.id)).toContain(created.id);
      expect(maintenancePreview.byKind.find((group) => group.kind === 'report')).toMatchObject({
        products: 1,
        versions: 2,
      });
      expect(maintenancePreview.notes.join(' ')).toContain('Preview only');
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
