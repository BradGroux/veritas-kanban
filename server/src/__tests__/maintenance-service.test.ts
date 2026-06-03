import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MaintenanceService } from '../services/maintenance-service.js';
import { resetWorkProductServiceForTests } from '../services/work-product-service.js';

describe('MaintenanceService', () => {
  let root: string;
  let originalDataDir: string | undefined;

  beforeEach(async () => {
    originalDataDir = process.env.DATA_DIR;
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'vk-maintenance-'));
    process.env.DATA_DIR = root;
    resetWorkProductServiceForTests();
    await fs.mkdir(path.join(root, '.veritas-kanban', 'logs'), { recursive: true });
    await fs.writeFile(
      path.join(root, '.veritas-kanban', 'logs', 'server.log'),
      [
        'startup ok',
        'Bearer abcdefghijklmnop token=sk_supersecret1234567890',
        '/Users/brad/private/project/file.txt',
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
    const service = new MaintenanceService();

    const bundle = await service.createDebugBundle();
    const manifest = JSON.parse(
      await fs.readFile(path.join(bundle.outputPath, 'manifest.json'), 'utf-8')
    ) as typeof bundle.manifest;
    const serverLog = await fs.readFile(
      path.join(bundle.outputPath, 'logs', 'server.log'),
      'utf-8'
    );
    const summary = await fs.readFile(path.join(bundle.outputPath, 'summary.json'), 'utf-8');

    expect(bundle.redacted).toBe(true);
    expect(manifest.includedCategories).toEqual(
      expect.arrayContaining(['health', 'storage', 'redacted-log-tails'])
    );
    expect(manifest.files.find((file) => file.id === 'server')?.path).toContain('[redacted-logs]');
    expect(serverLog).not.toContain('sk_supersecret1234567890');
    expect(summary).not.toContain(root);
  });
});
