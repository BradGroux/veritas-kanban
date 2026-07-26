import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MaintenanceService } from '../services/maintenance-service.js';
import { resetWorkProductServiceForTests } from '../services/work-product-service.js';
import {
  resetSqliteStorageDiagnosticsForTests,
  SqliteDatabase,
} from '../storage/sqlite/database.js';

const seededSensitiveValues = [
  'vk_seededNegativeFixture1234567890',
  'seededBearerToken1234567890',
  '/Users/brad/private/customer-board/roadmap.md',
  String.raw`C:\Users\Brad\private\board\notes.md`,
  'Write a launch prompt with private roadmap details.',
  'Customer says launch price is confidential.',
  'stdout leaked generated summary for private customer.',
  'stderr failed with customer secret output.',
  'model returned private generated content.',
];

describe('MaintenanceService', () => {
  let root: string;
  let originalDataDir: string | undefined;
  let originalSqlitePath: string | undefined;

  beforeEach(async () => {
    originalDataDir = process.env.DATA_DIR;
    originalSqlitePath = process.env.VERITAS_SQLITE_PATH;
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'vk-maintenance-'));
    process.env.DATA_DIR = root;
    resetWorkProductServiceForTests();
    await fs.mkdir(path.join(root, '.veritas-kanban', 'logs'), { recursive: true });
    await fs.writeFile(
      path.join(root, '.veritas-kanban', 'logs', 'server.log'),
      [
        'startup ok',
        'Bearer abcdefghijklmnop token=sk_supersecret1234567890',
        `api_key=${seededSensitiveValues[0]}`,
        `Authorization: Bearer ${seededSensitiveValues[1]}`,
        '/Users/brad/private/project/file.txt',
        seededSensitiveValues[2],
        seededSensitiveValues[3],
        `prompt: "${seededSensitiveValues[4]}"`,
        `chat message: "${seededSensitiveValues[5]}"`,
        `stdout: "${seededSensitiveValues[6]}"`,
        `stderr: "${seededSensitiveValues[7]}"`,
        `model output: "${seededSensitiveValues[8]}"`,
      ].join('\n'),
      'utf-8'
    );
  });

  afterEach(async () => {
    if (originalDataDir === undefined) {
      delete process.env.DATA_DIR;
    } else {
      process.env.DATA_DIR = originalDataDir;
    }
    if (originalSqlitePath === undefined) {
      delete process.env.VERITAS_SQLITE_PATH;
    } else {
      process.env.VERITAS_SQLITE_PATH = originalSqlitePath;
    }
    resetSqliteStorageDiagnosticsForTests();
    resetWorkProductServiceForTests();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('builds a read-only cleanup preview with lifecycle and storage data', async () => {
    const service = new MaintenanceService();

    const summary = await service.buildSummary();

    expect(summary.cleanupPreview.destructiveActionsEnabled).toBe(false);
    expect(summary.cleanupPreview.confirmationRequired).toBe(true);
    expect(summary.storage.categories.map((category) => category.id)).toEqual(
      expect.arrayContaining(['logs', 'work-products', 'debug-bundles'])
    );
    expect(summary.logs.find((source) => source.id === 'server')?.path).toContain(
      '[redacted-logs]'
    );
    expect(summary.logs.find((source) => source.id === 'server')?.path).not.toContain(root);
    expect(summary.lifecycle.map((entry) => entry.id)).toContain('workProducts');
    expect(summary.health.map((check) => check.id)).toEqual(
      expect.arrayContaining([
        'storage',
        'disk',
        'logs',
        'agent-runner',
        'recent-runs',
        'lifecycle-policy',
      ])
    );
  });

  it('includes redacted SQLite posture in support diagnostics', async () => {
    const databasePath = path.join(root, '.veritas-kanban', 'support-diagnostics.db');
    process.env.VERITAS_SQLITE_PATH = databasePath;
    const database = new SqliteDatabase({
      databasePath,
      applyMigrations: false,
      filesystemClassifier: () => ({
        platform: 'linux',
        filesystemType: 'ext4',
        posture: 'supported-local',
        detectionSource: 'maintenance-test',
        reasonCode: 'supported-local-filesystem',
      }),
    });
    database.open();

    try {
      const summary = await new MaintenanceService().buildSummary();

      expect(summary.sqlite).toMatchObject({
        databaseLocation: 'configured',
        filesystemType: 'ext4',
        filesystemPosture: 'supported-local',
        journalMode: 'wal',
        detectionSource: 'maintenance-test',
        decisionSource: 'automatic',
      });
      expect(JSON.stringify(summary.sqlite)).not.toContain(databasePath);
    } finally {
      database.close();
    }
  });

  it('tails allowlisted logs with secrets and local paths redacted', async () => {
    const service = new MaintenanceService();

    const tail = await service.tailLog('server', 10);
    const text = tail.lines.join('\n');

    expect(tail.redacted).toBe(true);
    expect(tail.source.path).toContain('[redacted-logs]');
    expect(tail.source.path).not.toContain(root);
    expect(text).toContain('Bearer [REDACTED]');
    expect(text).toContain('[REDACTED_API_KEY]');
    expect(text).toContain('[redacted-local-path]');
    expect(text).not.toContain('abcdefghijklmnop');
    expect(text).not.toContain('sk_supersecret1234567890');
    expect(text).not.toContain('/Users/brad/private');
  });

  it('creates a redacted debug bundle manifest and redacted log tails', async () => {
    const service = new MaintenanceService(
      async () => ({
        generatedAt: '2026-07-25T00:00:00.000Z',
        status: 'ok',
        truncated: false,
        records: [
          {
            taskId: 'task-phase',
            attemptId: 'attempt-phase',
            effective: {
              identity: { mode: 'profile', phase: 'verify' },
              digest: 'sha256:123456789012',
            },
            authorityExpansions: [{ sequence: 2, dimensions: ['filesystem.write'] }],
          },
        ],
      }),
      async () => ({
        generatedAt: '2026-07-25T00:00:00.000Z',
        status: 'ok',
        truncated: false,
        depth: {
          global: { current: 1, limit: 64 },
          workspaces: [],
        },
        entries: [
          {
            schemaVersion: 'admission-queue-inspection/v1',
            id: 'admission-queue-support',
            state: 'queued',
            position: 1,
            rawPriority: 5,
            effectivePriority: 5,
            agePromotion: 0,
            ageMs: 100,
            readiness: 'conditional',
            lease: { posture: 'none' },
            limitingPolicies: [],
            conditionalStartFactors: ['capacity-recheck'],
            launch: {
              source: 'conversation',
              target: 'agent-launch',
              workspaceId: 'workspace-a',
              taskKey: `sha256:${'a'.repeat(64)}`,
              rootTaskKey: `sha256:${'b'.repeat(64)}`,
              workspaceKey: `sha256:${'c'.repeat(64)}`,
              provider: 'codex-cli',
              hostKey: `sha256:${'d'.repeat(64)}`,
            },
            navigation: {
              taskId: 'task-support',
              attemptId: 'attempt-support',
            },
            retry: {
              count: 0,
              maximum: 3,
              availableAt: '2026-07-25T00:00:00.000Z',
            },
            createdAt: '2026-07-25T00:00:00.000Z',
            updatedAt: '2026-07-25T00:00:00.000Z',
          },
        ],
        treeControls: [
          {
            rootObjectiveKey: `sha256:${'e'.repeat(64)}`,
            state: 'paused',
            trigger: 'fan-out-breaker',
            recordedAt: '2026-07-25T00:00:00.000Z',
            signals: ['descendant-limit'],
            observed: { descendants: 257 },
            thresholds: { maxDescendants: 256 },
            recoveryGuidance: ['Inspect the tree before resuming.'],
          },
        ],
      })
    );

    const bundle = await service.createDebugBundle();
    const manifest = JSON.parse(
      await fs.readFile(path.join(bundle.outputPath, 'manifest.json'), 'utf-8')
    ) as typeof bundle.manifest;
    const serverLog = await fs.readFile(
      path.join(bundle.outputPath, 'logs', 'server.log'),
      'utf-8'
    );
    const summary = await fs.readFile(path.join(bundle.outputPath, 'summary.json'), 'utf-8');
    const phaseAuthority = JSON.parse(
      await fs.readFile(path.join(bundle.outputPath, 'phase-authority.json'), 'utf-8')
    ) as { records: Array<Record<string, unknown>> };
    const admissionQueue = JSON.parse(
      await fs.readFile(path.join(bundle.outputPath, 'admission-queue.json'), 'utf-8')
    ) as {
      entries: Array<Record<string, unknown>>;
      treeControls: Array<Record<string, unknown>>;
    };
    const bundleText = await readDirectoryText(bundle.outputPath);

    expect(bundle.redacted).toBe(true);
    expect(manifest.includedCategories).toEqual(
      expect.arrayContaining([
        'health',
        'storage',
        'phase-authority',
        'admission-queue',
        'redacted-log-tails',
      ])
    );
    expect(phaseAuthority.records).toContainEqual(
      expect.objectContaining({ taskId: 'task-phase', attemptId: 'attempt-phase' })
    );
    expect(admissionQueue.entries).toContainEqual(
      expect.objectContaining({
        state: 'queued',
        launch: expect.objectContaining({
          source: 'conversation',
          target: 'agent-launch',
        }),
      })
    );
    expect(JSON.stringify(admissionQueue)).not.toContain('options');
    expect(admissionQueue.treeControls).toContainEqual(
      expect.objectContaining({
        state: 'paused',
        trigger: 'fan-out-breaker',
        signals: ['descendant-limit'],
      })
    );
    expect(JSON.stringify(admissionQueue.treeControls)).not.toContain('objective-a');
    expect(JSON.stringify(admissionQueue.treeControls)).not.toContain('idempotencyKey');
    expect(manifest.files.find((file) => file.id === 'server')?.path).toContain('[redacted-logs]');
    expect(serverLog).not.toContain('sk_supersecret1234567890');
    expect(summary).not.toContain(root);
    expect(bundleText).toContain('[REDACTED_API_KEY]');
    expect(bundleText).toContain('Bearer [REDACTED]');
    expect(bundleText).toContain('[redacted-local-path]');
    expect(bundleText).toContain('[redacted-prompt]');
    expect(bundleText).toContain('[redacted-chat-content]');
    expect(bundleText).toContain('[redacted-process-output]');
    expect(bundleText).toContain('[redacted-generated-text]');
    for (const sensitiveValue of seededSensitiveValues) {
      expect(bundleText).not.toContain(sensitiveValue);
    }
  });
});

async function readDirectoryText(dirPath: string): Promise<string> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const chunks = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) return readDirectoryText(entryPath);
      if (!entry.isFile()) return '';
      return fs.readFile(entryPath, 'utf-8');
    })
  );
  return chunks.join('\n');
}
