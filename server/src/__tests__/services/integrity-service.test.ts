import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { createBackup, runIntegrityChecks } from '../../services/integrity-service.js';
import { FileWorkProductArtifactRepository } from '../../storage/work-product-artifact-repository.js';

describe('integrity-service', () => {
  let tmpDir: string;
  let dataDir: string;
  let tasksDir: string;

  beforeEach(async () => {
    const suffix = Math.random().toString(36).substring(7);
    tmpDir = path.join(os.tmpdir(), `veritas-integrity-test-${suffix}`);
    // Layout: tmpDir/.veritas-kanban (data), tmpDir/tasks/active (tasks)
    dataDir = path.join(tmpDir, '.veritas-kanban');
    tasksDir = path.join(tmpDir, 'tasks', 'active');
    await fs.mkdir(dataDir, { recursive: true });
    await fs.mkdir(tasksDir, { recursive: true });
  });

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  // ===========================
  // Helper: write a valid task markdown file
  // ===========================
  async function writeTask(
    id: string,
    overrides: Record<string, string | undefined> = {}
  ): Promise<void> {
    const fields: Record<string, string | undefined> = {
      id,
      title: `Task ${id}`,
      status: 'todo',
      created: '2026-01-28T00:00:00.000Z',
      ...overrides,
    };
    const frontmatter = Object.entries(fields)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}: '${v}'`)
      .join('\n');
    const content = `---\n${frontmatter}\n---\nBody text`;
    const slug = id.replace(/[^a-z0-9_-]/gi, '-');
    await fs.writeFile(path.join(tasksDir, `${slug}.md`), content, 'utf-8');
  }

  // ===========================
  // Integrity Checks
  // ===========================
  describe('runIntegrityChecks', () => {
    it('should pass with valid data', async () => {
      // Write valid JSON config
      await fs.writeFile(path.join(dataDir, 'config.json'), JSON.stringify({ repos: [] }), 'utf-8');
      // Write valid task
      await writeTask('task_20260128_aaa');

      const report = await runIntegrityChecks(dataDir);
      expect(report.filesChecked).toBeGreaterThanOrEqual(2);
      expect(report.issuesFound).toBe(0);
      expect(report.issues).toHaveLength(0);
    });

    it('should detect invalid JSON', async () => {
      await fs.writeFile(path.join(dataDir, 'config.json'), '{ broken', 'utf-8');

      const report = await runIntegrityChecks(dataDir);
      expect(report.issuesFound).toBeGreaterThanOrEqual(1);
      const jsonIssue = report.issues.find((i) => i.type === 'invalid-json');
      expect(jsonIssue).toBeDefined();
      expect(jsonIssue!.file).toContain('config.json');
    });

    it('should detect missing required fields in task files', async () => {
      // Task missing "status" and "created"
      const content = `---\nid: 'task_test'\ntitle: 'Test'\n---\nBody`;
      await fs.writeFile(path.join(tasksDir, 'task_test.md'), content, 'utf-8');

      const report = await runIntegrityChecks(dataDir);
      const missing = report.issues.filter((i) => i.type === 'missing-field');
      expect(missing.length).toBeGreaterThanOrEqual(2);
      const fields = missing.map((i) => i.message);
      expect(fields.some((m) => m.includes('status'))).toBe(true);
      expect(fields.some((m) => m.includes('created'))).toBe(true);
    });

    it('should detect orphaned parent references', async () => {
      // Task referencing a non-existent parent
      await writeTask('task_child', { parentId: 'task_nonexistent' });

      const report = await runIntegrityChecks(dataDir);
      const orphaned = report.issues.filter((i) => i.type === 'orphaned-ref');
      expect(orphaned.length).toBe(1);
      expect(orphaned[0].message).toContain('task_nonexistent');
    });

    it('should not flag valid parent references', async () => {
      await writeTask('task_parent');
      await writeTask('task_child', { parentId: 'task_parent' });

      const report = await runIntegrityChecks(dataDir);
      const orphaned = report.issues.filter((i) => i.type === 'orphaned-ref');
      expect(orphaned.length).toBe(0);
    });

    it('should handle non-existent data directory gracefully', async () => {
      const report = await runIntegrityChecks('/tmp/nonexistent-dir-' + Date.now());
      expect(report.filesChecked).toBe(0);
      expect(report.issuesFound).toBe(0);
    });
  });

  // ===========================
  // Backup
  // ===========================
  describe('createBackup', () => {
    it('should create a timestamped backup', async () => {
      await fs.writeFile(path.join(dataDir, 'config.json'), JSON.stringify({ repos: [] }), 'utf-8');

      const backupPath = await createBackup(dataDir);
      expect(backupPath).toBeTruthy();
      expect(backupPath).toContain('backups/backup-');

      // Verify backup content
      const backupConfig = await fs.readFile(path.join(backupPath, 'config.json'), 'utf-8');
      expect(JSON.parse(backupConfig)).toEqual({ repos: [] });
    });

    it('backs up and restores immutable file Work Product artifact bodies', async () => {
      const content = Buffer.from('backup artifact bytes', 'utf8');
      const metadata = {
        schemaVersion: 'work-product-artifact/v1' as const,
        id: `wpa_${'a'.repeat(24)}`,
        productId: `wp_${'b'.repeat(24)}`,
        version: 1,
        workspaceId: 'local',
        taskId: 'task_backup',
        runId: 'run_backup',
        attemptId: 'attempt_backup',
        producingEventId: 'event_backup',
        requestIdDigest: `sha256:${'c'.repeat(64)}`,
        launchManifestDigest: `sha256:${'d'.repeat(64)}`,
        mediaType: 'application/octet-stream',
        byteSize: content.byteLength,
        sha256: '80d785e8c4d256e11f8af19ed041cdba6ad63dfd5ef9881544f4e8128963fbc1',
        safeName: 'backup.bin',
        state: 'available' as const,
        redaction: { state: 'none' as const },
        createdAt: '2026-08-30T12:00:00.000Z',
      };
      const source = new FileWorkProductArtifactRepository(
        path.join(dataDir, 'work-product-artifacts')
      );
      await source.create(metadata, content);

      const backupPath = await createBackup(dataDir);
      const restoredDir = path.join(tmpDir, '.veritas-kanban-restored');
      await fs.cp(backupPath, restoredDir, { recursive: true });
      const restored = await new FileWorkProductArtifactRepository(
        path.join(restoredDir, 'work-product-artifacts')
      ).read({
        workspaceId: 'local',
        productId: metadata.productId,
        version: 1,
        artifactId: metadata.id,
      });

      expect(restored?.metadata).toEqual(metadata);
      expect(Buffer.from(restored?.content ?? []).toString('utf8')).toBe('backup artifact bytes');
    });

    it('should skip backup when data directory is empty', async () => {
      // dataDir exists but has no meaningful files
      // Remove any default files
      const entries = await fs.readdir(dataDir);
      for (const e of entries) {
        await fs.rm(path.join(dataDir, e), { recursive: true, force: true });
      }

      const backupPath = await createBackup(dataDir);
      expect(backupPath).toBe('');
    });

    it('should skip backup when data directory does not exist', async () => {
      const backupPath = await createBackup('/tmp/nonexistent-dir-' + Date.now());
      expect(backupPath).toBe('');
    });

    it('should rotate and keep only last 5 backups', async () => {
      await fs.writeFile(path.join(dataDir, 'config.json'), JSON.stringify({ ok: true }), 'utf-8');

      const backupsRoot = path.join(dataDir, 'backups');

      // Pre-create 6 old backups (sorted alphabetically before any new one)
      for (let i = 0; i < 6; i++) {
        const name = `backup-2025-01-0${i + 1}-120000`;
        const dir = path.join(backupsRoot, name);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, 'marker.txt'), `backup-${i}`, 'utf-8');
      }

      // Verify we have 6 old backups
      let entries = await fs.readdir(backupsRoot);
      expect(entries.filter((e) => e.startsWith('backup-')).length).toBe(6);

      // Create a new backup — triggers rotation
      await createBackup(dataDir);

      entries = await fs.readdir(backupsRoot);
      const backups = entries.filter((e) => e.startsWith('backup-')).sort();
      expect(backups.length).toBe(5);

      // Oldest backups should have been deleted (backup-2025-01-01 and backup-2025-01-02)
      expect(backups.some((b) => b.includes('2025-01-01'))).toBe(false);
      expect(backups.some((b) => b.includes('2025-01-02'))).toBe(false);
    });

    it('should not include backups directory in the backup', async () => {
      await fs.writeFile(path.join(dataDir, 'config.json'), JSON.stringify({ ok: true }), 'utf-8');

      // Create a first backup
      const firstBackup = await createBackup(dataDir);
      expect(firstBackup).toBeTruthy();

      // Create a second backup — should NOT contain backups/
      const secondBackup = await createBackup(dataDir);
      expect(secondBackup).toBeTruthy();

      const backupEntries = await fs.readdir(secondBackup);
      expect(backupEntries).not.toContain('backups');
    });
  });

  // ===========================
  // Recovery
  // ===========================
  describe('recovery', () => {
    it('should recover a corrupt JSON file from the latest backup', async () => {
      // 1. Write valid config
      await fs.writeFile(
        path.join(dataDir, 'config.json'),
        JSON.stringify({ repos: ['test'] }),
        'utf-8'
      );

      // 2. Create a backup (so there's something to recover from)
      const backupPath = await createBackup(dataDir);
      expect(backupPath).toBeTruthy();

      // 3. Corrupt the config
      await fs.writeFile(path.join(dataDir, 'config.json'), '{ broken json', 'utf-8');

      // 4. Run integrity checks — should detect and recover
      const report = await runIntegrityChecks(dataDir);
      const jsonIssue = report.issues.find((i) => i.type === 'invalid-json');
      expect(jsonIssue).toBeDefined();
      expect(jsonIssue!.recovered).toBe(true);
      expect(report.recoveredCount).toBe(1);

      // 5. Verify the file was restored
      const restored = await fs.readFile(path.join(dataDir, 'config.json'), 'utf-8');
      expect(JSON.parse(restored)).toEqual({ repos: ['test'] });
    });

    it('should report issue but not recover when no backup exists', async () => {
      // Write corrupt JSON without creating a backup first
      await fs.writeFile(path.join(dataDir, 'config.json'), '!not json!', 'utf-8');

      const report = await runIntegrityChecks(dataDir);
      expect(report.issuesFound).toBe(1);
      expect(report.recoveredCount).toBe(0);
      expect(report.issues[0].recovered).toBe(false);
    });
  });
});
