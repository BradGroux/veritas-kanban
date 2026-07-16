import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SqliteJournalMaintenanceService } from '../storage/sqlite/journal-maintenance-service.js';
import { getSqliteStorageDiagnostics, SqliteDatabase } from '../storage/sqlite/database.js';
import {
  getSqliteJournalPolicyPath,
  loadSqliteJournalPolicy,
} from '../storage/sqlite/sqlite-journal-policy.js';
import { resetSqliteOwnershipLocksForTests } from '../storage/sqlite/sqlite-ownership-lock.js';

const supportedFilesystem = () => ({
  platform: process.platform,
  filesystemType: process.platform === 'win32' ? 'ntfs' : 'apfs',
  posture: 'supported-local' as const,
  detectionSource: 'test',
  reasonCode: 'test-supported-local',
});

function createDatabase(path: string, mode: 'wal' | 'delete' = 'wal'): void {
  const database = new DatabaseSync(path);
  database.exec(`PRAGMA journal_mode = ${mode === 'wal' ? 'WAL' : 'DELETE'};`);
  database.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT NOT NULL);');
  database.prepare('INSERT INTO items (value) VALUES (?)').run('seed');
  database.close();
}

function journalMode(path: string): string {
  const database = new DatabaseSync(path);
  try {
    return (database.prepare('PRAGMA journal_mode;').get() as { journal_mode: string })
      .journal_mode;
  } finally {
    database.close();
  }
}

describe('SqliteJournalMaintenanceService', () => {
  let directory: string;
  let databasePath: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'veritas-sqlite-maintenance-'));
    databasePath = join(directory, 'veritas.db');
    process.env.VERITAS_ADMIN_KEY = 'test-admin-key-that-is-long-enough';
    process.env.VERITAS_SQLITE_HOST_ID = 'test-host-a';
    process.env.VERITAS_SQLITE_TOPOLOGY = 'single-host';
  });

  afterEach(() => {
    resetSqliteOwnershipLocksForTests();
    rmSync(directory, { recursive: true, force: true });
    process.env = { ...originalEnv };
  });

  it('previews without mutation, then converts WAL to governed DELETE mode', async () => {
    createDatabase(databasePath, 'wal');
    const before = readFileSync(databasePath);
    const service = new SqliteJournalMaintenanceService(databasePath);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const preview = await service.preview(
      {
        targetMode: 'delete',
        singleHost: true,
        overrideReason: 'Single-host compatibility test',
        expiresAt,
      },
      'test-admin'
    );

    expect(readFileSync(databasePath)).toEqual(before);
    expect(preview).toMatchObject({
      currentMode: 'wal',
      targetMode: 'delete',
      backupLocation: 'adjacent-secure-directory',
      overrideRequired: true,
      restartRequired: true,
    });
    expect(preview.sidecars.map((sidecar) => sidecar.kind)).toEqual(['wal', 'shm', 'journal']);

    const scheduled = await service.schedule(
      {
        previewId: preview.id,
        previewToken: preview.token,
        confirm: preview.id,
        acknowledgeRisks: true,
      },
      'test-admin'
    );
    expect(scheduled.state).toBe('scheduled');

    const completed = await service.executeScheduledOperation();
    expect(completed).toMatchObject({
      state: 'completed',
      targetMode: 'delete',
      backupAvailable: true,
      recoveryRequired: false,
    });
    expect(journalMode(databasePath)).toBe('delete');
    expect(loadSqliteJournalPolicy(databasePath)).toMatchObject({
      mode: 'delete',
      actor: 'test-admin',
      expiresAt,
    });

    const runtimeDatabase = new SqliteDatabase({
      databasePath,
      applyMigrations: false,
      filesystemClassifier: supportedFilesystem,
    });
    runtimeDatabase.open();
    expect(getSqliteStorageDiagnostics(databasePath)).toMatchObject({
      journalMode: 'delete',
      healthPosture: 'degraded',
      lockingPosture: 'single-host-owner-lock',
      ownershipState: 'owned',
      override: { status: 'active', source: 'single-host-compatibility' },
    });
    runtimeDatabase.close();
    expect(existsSync(`${databasePath}.owner.lock`)).toBe(false);

    await expect(
      service.schedule(
        {
          previewId: preview.id,
          previewToken: preview.token,
          confirm: preview.id,
          acknowledgeRisks: true,
        },
        'test-admin'
      )
    ).rejects.toMatchObject({ code: 'SQLITE_PREVIEW_REPLAYED' });
  }, 15_000);

  it.skipIf(process.platform === 'win32')(
    'rejects a symlinked maintenance event journal without touching its target',
    async () => {
      createDatabase(databasePath, 'wal');
      const maintenanceDirectory = `${databasePath}.maintenance`;
      mkdirSync(maintenanceDirectory, { mode: 0o700 });
      const targetPath = join(directory, 'event-target.log');
      writeFileSync(targetPath, 'sentinel\n', 'utf8');
      symlinkSync(targetPath, join(maintenanceDirectory, 'events.jsonl'));
      const service = new SqliteJournalMaintenanceService(databasePath);

      await expect(
        service.preview(
          {
            targetMode: 'delete',
            singleHost: true,
            overrideReason: 'Symlink event journal regression coverage',
            expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          },
          'test-admin'
        )
      ).rejects.toMatchObject({ code: 'SQLITE_MAINTENANCE_PATH_UNSAFE' });
      expect(readFileSync(targetPath, 'utf8')).toBe('sentinel\n');
    }
  );

  it('converts governed DELETE mode back to ordinary local WAL mode', async () => {
    createDatabase(databasePath, 'wal');
    const service = new SqliteJournalMaintenanceService(databasePath);
    const deletePreview = await service.preview(
      {
        targetMode: 'delete',
        singleHost: true,
        overrideReason: 'Temporary rollback compatibility',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
      'test-admin'
    );
    await service.schedule(
      {
        previewId: deletePreview.id,
        previewToken: deletePreview.token,
        confirm: deletePreview.id,
        acknowledgeRisks: true,
      },
      'test-admin'
    );
    expect((await service.executeScheduledOperation())?.state).toBe('completed');

    const walPreview = await service.preview({ targetMode: 'wal' }, 'test-admin');
    expect(walPreview.overrideRequired).toBe(false);
    await service.schedule(
      {
        previewId: walPreview.id,
        previewToken: walPreview.token,
        confirm: walPreview.id,
        acknowledgeRisks: true,
      },
      'test-admin'
    );
    expect((await service.executeScheduledOperation())?.state).toBe('completed');
    expect(journalMode(databasePath)).toBe('wal');
    expect(existsSync(getSqliteJournalPolicyPath(databasePath))).toBe(false);
  }, 15_000);

  it('rebinds the restored compatibility policy after a failed DELETE to WAL conversion', async () => {
    createDatabase(databasePath, 'wal');
    const initialService = new SqliteJournalMaintenanceService(databasePath);
    const deletePreview = await initialService.preview(
      {
        targetMode: 'delete',
        singleHost: true,
        overrideReason: 'Rollback policy identity regression coverage',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
      'test-admin'
    );
    await initialService.schedule(
      {
        previewId: deletePreview.id,
        previewToken: deletePreview.token,
        confirm: deletePreview.id,
        acknowledgeRisks: true,
      },
      'test-admin'
    );
    expect((await initialService.executeScheduledOperation())?.state).toBe('completed');

    const rollbackService = new SqliteJournalMaintenanceService({
      databasePath,
      postConversionIntegrityCheck: () => 'injected corruption',
    });
    const walPreview = await rollbackService.preview({ targetMode: 'wal' }, 'test-admin');
    await rollbackService.schedule(
      {
        previewId: walPreview.id,
        previewToken: walPreview.token,
        confirm: walPreview.id,
        acknowledgeRisks: true,
      },
      'test-admin'
    );

    expect(await rollbackService.executeScheduledOperation()).toMatchObject({
      state: 'rolled-back',
      originalMode: 'delete',
      recoveryRequired: false,
    });
    expect(journalMode(databasePath)).toBe('delete');
    expect(loadSqliteJournalPolicy(databasePath)).toMatchObject({
      mode: 'delete',
      actor: 'test-admin',
    });
  }, 20_000);

  it('rejects a stale offline preview before scheduling', async () => {
    createDatabase(databasePath, 'wal');
    const service = new SqliteJournalMaintenanceService(databasePath);
    const preview = await service.preview(
      {
        targetMode: 'delete',
        singleHost: true,
        overrideReason: 'Stale preview regression coverage',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
      'test-admin'
    );
    const writer = new DatabaseSync(databasePath);
    writer.prepare('INSERT INTO items (value) VALUES (?)').run('changed-after-preview');
    writer.close();

    await expect(
      service.schedule(
        {
          previewId: preview.id,
          previewToken: preview.token,
          confirm: preview.id,
          acknowledgeRisks: true,
        },
        'test-admin'
      )
    ).rejects.toMatchObject({ code: 'SQLITE_PREVIEW_STALE' });
  });

  it('reports a busy WAL reader and leaves the source unchanged', async () => {
    createDatabase(databasePath, 'wal');
    const reader = new DatabaseSync(databasePath);
    reader.exec('BEGIN;');
    reader.prepare('SELECT * FROM items;').all();
    const writer = new DatabaseSync(databasePath);
    writer.prepare('INSERT INTO items (value) VALUES (?)').run('wal-only');
    writer.close();

    const service = new SqliteJournalMaintenanceService(databasePath);
    const preview = await service.preview(
      {
        targetMode: 'delete',
        singleHost: true,
        overrideReason: 'Busy reader regression coverage',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
      'test-admin'
    );
    await service.schedule(
      {
        previewId: preview.id,
        previewToken: preview.token,
        confirm: preview.id,
        acknowledgeRisks: true,
      },
      'test-admin'
    );

    const result = await service.executeScheduledOperation();
    expect(result).toMatchObject({ state: 'failed', recoveryRequired: false });
    expect(['SQLITE_BUSY', 'SQLITE_CHECKPOINT_BUSY']).toContain(result?.errorCode);
    expect(journalMode(databasePath)).toBe('wal');
    reader.exec('ROLLBACK;');
    reader.close();
  }, 15_000);

  it('holds SQLite exclusivity from backup through conversion and rollback', async () => {
    createDatabase(databasePath, 'wal');
    let peerWriteError: unknown;
    const service = new SqliteJournalMaintenanceService({
      databasePath,
      postConversionIntegrityCheck: () => 'injected corruption',
      faultInjector: (stage) => {
        if (stage !== 'backup-created') return;
        const peer = new DatabaseSync(databasePath, { timeout: 0 });
        try {
          peer.exec('PRAGMA busy_timeout = 0;');
          peer.prepare('INSERT INTO items (value) VALUES (?)').run('post-backup-peer-write');
        } catch (error) {
          peerWriteError = error;
        } finally {
          peer.close();
        }
      },
    });
    const preview = await service.preview(
      {
        targetMode: 'delete',
        singleHost: true,
        overrideReason: 'Exclusive conversion ownership regression coverage',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
      'test-admin'
    );
    await service.schedule(
      {
        previewId: preview.id,
        previewToken: preview.token,
        confirm: preview.id,
        acknowledgeRisks: true,
      },
      'test-admin'
    );

    const result = await service.executeScheduledOperation();
    expect(peerWriteError).toMatchObject({ errcode: 5 });
    expect(result).toMatchObject({ state: 'rolled-back', recoveryRequired: false });
    const database = new DatabaseSync(databasePath, { readOnly: true });
    expect(database.prepare('SELECT value FROM items ORDER BY id;').all()).toEqual([
      { value: 'seed' },
    ]);
    database.close();
  });

  it('reverts journal mode in place when pre-close integrity verification fails', async () => {
    createDatabase(databasePath, 'wal');
    const service = new SqliteJournalMaintenanceService({
      databasePath,
      postConversionIntegrityCheck: () => 'injected corruption',
    });
    const preview = await service.preview(
      {
        targetMode: 'delete',
        singleHost: true,
        overrideReason: 'Rollback recovery regression coverage',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
      'test-admin'
    );
    await service.schedule(
      {
        previewId: preview.id,
        previewToken: preview.token,
        confirm: preview.id,
        acknowledgeRisks: true,
      },
      'test-admin'
    );

    const result = await service.executeScheduledOperation();
    expect(result).toMatchObject({
      state: 'rolled-back',
      recoveryRequired: false,
      backupAvailable: true,
      errorCode: 'SQLITE_INTEGRITY_FAILED',
    });
    expect(journalMode(databasePath)).toBe('wal');
    const database = new DatabaseSync(databasePath, { readOnly: true });
    expect(database.prepare('SELECT value FROM items ORDER BY id;').all()).toEqual([
      { value: 'seed' },
    ]);
    database.close();
  });

  it('retains recovery-required state across repeated restarts when rollback cannot complete', async () => {
    createDatabase(databasePath, 'wal');
    const maintenanceDirectory = `${databasePath}.maintenance`;
    const service = new SqliteJournalMaintenanceService({
      databasePath,
      postConversionIntegrityCheck: () => 'injected corruption',
      faultInjector: (stage) => {
        if (stage === 'rollback-started') throw new Error('injected rollback failure');
      },
    });
    const preview = await service.preview(
      {
        targetMode: 'delete',
        singleHost: true,
        overrideReason: 'Persistent recovery sentinel regression coverage',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
      'test-admin'
    );
    await service.schedule(
      {
        previewId: preview.id,
        previewToken: preview.token,
        confirm: preview.id,
        acknowledgeRisks: true,
      },
      'test-admin'
    );

    const firstRestart = await service.executeScheduledOperation();
    expect(firstRestart).toMatchObject({
      state: 'recovery-required',
      recoveryRequired: true,
      restartRequired: true,
    });
    expect(existsSync(join(maintenanceDirectory, 'scheduled.json'))).toBe(true);

    rmSync(databasePath, { force: true });

    const secondRestart = await new SqliteJournalMaintenanceService(
      databasePath
    ).executeScheduledOperation();
    expect(secondRestart).toMatchObject({
      state: 'recovery-required',
      recoveryRequired: true,
      restartRequired: true,
    });
    expect(existsSync(join(maintenanceDirectory, 'scheduled.json'))).toBe(true);
  });

  it('recovers an interrupted post-mutation operation on the next process start', async () => {
    createDatabase(databasePath, 'wal');
    const service = new SqliteJournalMaintenanceService(databasePath);
    const preview = await service.preview(
      {
        targetMode: 'delete',
        singleHost: true,
        overrideReason: 'Crash recovery regression coverage',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
      'test-admin'
    );
    await service.schedule(
      {
        previewId: preview.id,
        previewToken: preview.token,
        confirm: preview.id,
        acknowledgeRisks: true,
      },
      'test-admin'
    );

    const helperPath = join(directory, 'crash-helper.mjs');
    const serviceModule = new URL(
      '../storage/sqlite/journal-maintenance-service.ts',
      import.meta.url
    ).href;
    writeFileSync(
      helperPath,
      `import { SqliteJournalMaintenanceService } from ${JSON.stringify(serviceModule)};\n` +
        `const service = new SqliteJournalMaintenanceService(${JSON.stringify(databasePath)});\n` +
        `await service.executeScheduledOperation();\n`,
      'utf8'
    );
    const crashed = spawnSync(process.execPath, ['--import', 'tsx', helperPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        VERITAS_SQLITE_MAINTENANCE_CRASH_STAGE: 'target-set',
      },
      encoding: 'utf8',
    });
    expect(crashed.status, crashed.stderr).toBe(86);

    const recovered = await service.executeScheduledOperation();
    expect(recovered).toMatchObject({ state: 'completed', recoveryRequired: false });
    expect(journalMode(databasePath)).toBe('delete');
    expect(service.getOperation()).toBeUndefined();
  });

  it('refreshes a pre-mutation backup after a crash before converting', async () => {
    createDatabase(databasePath, 'wal');
    const service = new SqliteJournalMaintenanceService(databasePath);
    const runtimeDatabase = new SqliteDatabase({
      databasePath,
      applyMigrations: false,
      filesystemClassifier: supportedFilesystem,
    });
    runtimeDatabase.open();
    const preview = await service.preview(
      {
        targetMode: 'delete',
        singleHost: true,
        overrideReason: 'Pre-mutation backup refresh regression coverage',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
      'test-admin'
    );
    runtimeDatabase.close();
    await service.schedule(
      {
        previewId: preview.id,
        previewToken: preview.token,
        confirm: preview.id,
        acknowledgeRisks: true,
      },
      'test-admin'
    );

    const helperPath = join(directory, 'backup-crash-helper.mjs');
    const serviceModule = new URL(
      '../storage/sqlite/journal-maintenance-service.ts',
      import.meta.url
    ).href;
    writeFileSync(
      helperPath,
      `import { SqliteJournalMaintenanceService } from ${JSON.stringify(serviceModule)};\n` +
        `const service = new SqliteJournalMaintenanceService(${JSON.stringify(databasePath)});\n` +
        `await service.executeScheduledOperation();\n`,
      'utf8'
    );
    const crashed = spawnSync(process.execPath, ['--import', 'tsx', helperPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        VERITAS_SQLITE_MAINTENANCE_CRASH_STAGE: 'backup-created',
      },
      encoding: 'utf8',
    });
    expect(crashed.status, crashed.stderr).toBe(86);
    const operation = service.getOperation();
    expect(operation?.state).toBe('backup-created');

    const writer = new DatabaseSync(databasePath);
    writer.prepare('INSERT INTO items (value) VALUES (?)').run('committed-after-crash');
    writer.close();

    const resumed = await new SqliteJournalMaintenanceService(
      databasePath
    ).executeScheduledOperation();
    expect(resumed).toMatchObject({ state: 'completed', recoveryRequired: false });
    const backupPath = join(`${databasePath}.maintenance`, 'backups', `${operation?.id}.db`);
    const backupDatabase = new DatabaseSync(backupPath, { readOnly: true });
    expect(backupDatabase.prepare('SELECT value FROM items ORDER BY id;').all()).toEqual([
      { value: 'seed' },
      { value: 'committed-after-crash' },
    ]);
    backupDatabase.close();
  }, 20_000);

  it('fails closed when persisted operation state is tampered', async () => {
    createDatabase(databasePath, 'wal');
    const service = new SqliteJournalMaintenanceService(databasePath);
    const preview = await service.preview(
      {
        targetMode: 'delete',
        singleHost: true,
        overrideReason: 'Tamper detection regression coverage',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
      'test-admin'
    );
    const operation = await service.schedule(
      {
        previewId: preview.id,
        previewToken: preview.token,
        confirm: preview.id,
        acknowledgeRisks: true,
      },
      'test-admin'
    );
    const operationPath = join(`${databasePath}.maintenance`, 'operations', `${operation.id}.json`);
    const tampered = JSON.parse(readFileSync(operationPath, 'utf8')) as Record<string, unknown>;
    tampered.state = 'completed';
    writeFileSync(operationPath, `${JSON.stringify(tampered)}\n`, 'utf8');

    await expect(service.executeScheduledOperation()).rejects.toMatchObject({
      code: 'SQLITE_OPERATION_INVALID',
    });
    expect(journalMode(databasePath)).toBe('wal');
  });
});
