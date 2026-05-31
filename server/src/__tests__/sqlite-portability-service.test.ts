import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import matter from 'gray-matter';
import yaml from 'yaml';
import { SqlitePortabilityService } from '../services/sqlite-portability-service.js';
import { SqliteDatabase } from '../storage/sqlite/database.js';
import { SqliteTaskRepository } from '../storage/sqlite/task-repository.js';
import { SqliteSettingsRepository } from '../storage/sqlite/settings-repository.js';
import { createDefaultConfig, normalizeAppConfig } from '../services/config-service.js';
import type { Task } from '@veritas-kanban/shared';
import type { WorkflowDefinition, WorkflowRun } from '../types/workflow.js';

describe('SqlitePortabilityService', () => {
  let testRoot: string;

  beforeEach(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-sqlite-portability-'));
  });

  afterEach(async () => {
    await fs.rm(testRoot, { recursive: true, force: true }).catch(() => {});
  });

  it('dry-runs malformed legacy data, then migrates files into SQLite with a backup', async () => {
    const sourceRoot = path.join(testRoot, 'project');
    const runtimeDir = path.join(sourceRoot, '.veritas-kanban');
    const activeDir = path.join(sourceRoot, 'tasks', 'active');
    const archiveDir = path.join(sourceRoot, 'tasks', 'archive');
    const backlogDir = path.join(sourceRoot, 'tasks', 'backlog');
    const now = '2026-05-31T12:00:00.000Z';
    const taskId = 'task_20260531_alpha1';

    await fs.mkdir(activeDir, { recursive: true });
    await fs.mkdir(archiveDir, { recursive: true });
    await fs.mkdir(backlogDir, { recursive: true });
    await fs.mkdir(runtimeDir, { recursive: true });

    await writeTask(activeDir, {
      id: taskId,
      title: 'Migrate active task',
      description: 'Preserve comments, subtasks, and dependencies.',
      type: 'feature',
      status: 'todo',
      priority: 'high',
      created: now,
      updated: now,
      comments: [{ id: 'comment_1', author: 'brad', text: 'keep me', timestamp: now }],
      subtasks: [{ id: 'sub_1', title: 'check parity', completed: false, created: now }],
      dependencies: { depends_on: ['task_20260531_beta2'] },
    });
    await writeTask(archiveDir, {
      id: 'task_20260531_arch1',
      title: 'Archived task',
      description: 'Archived body',
      type: 'task',
      status: 'done',
      priority: 'medium',
      created: now,
      updated: now,
    });
    await writeTask(backlogDir, {
      id: 'task_20260531_back1',
      title: 'Backlog task',
      description: 'Backlog body',
      type: 'task',
      status: 'todo',
      priority: 'low',
      created: now,
      updated: now,
    });
    await fs.writeFile(
      path.join(activeDir, 'not-a-task.md'),
      matter.stringify('bad', { id: 'bad', title: 'Bad task' }),
      'utf-8'
    );

    await fs.writeFile(
      path.join(runtimeDir, 'config.json'),
      JSON.stringify({
        repos: [{ name: 'veritas', path: sourceRoot, defaultBranch: 'main' }],
        agents: [],
        defaultAgent: 'codex',
        features: { telemetry: { enabled: true, retentionDays: 14, enableTraces: true } },
      }),
      'utf-8'
    );

    await fs.mkdir(path.join(runtimeDir, 'templates'), { recursive: true });
    await fs.writeFile(
      path.join(runtimeDir, 'templates', 'launch.md'),
      matter.stringify('', {
        id: 'template_launch',
        name: 'Launch template',
        version: 1,
        taskDefaults: { type: 'feature', priority: 'high' },
        created: now,
        updated: now,
      }),
      'utf-8'
    );

    await fs.mkdir(path.join(runtimeDir, 'prompt-templates'), { recursive: true });
    await fs.mkdir(path.join(runtimeDir, 'prompt-versions'), { recursive: true });
    await fs.mkdir(path.join(runtimeDir, 'prompt-usage'), { recursive: true });
    await fs.writeFile(
      path.join(runtimeDir, 'prompt-templates', 'triage.md'),
      matter.stringify('', {
        id: 'prompt_triage',
        name: 'Triage',
        category: 'planning',
        content: 'Review {{task}}',
        variables: ['task'],
        currentVersionId: 'prompt_triage_v1',
        created: now,
        updated: now,
      }),
      'utf-8'
    );
    await fs.writeFile(
      path.join(runtimeDir, 'prompt-versions', 'triage_v1.md'),
      matter.stringify('', {
        id: 'prompt_triage_v1',
        templateId: 'prompt_triage',
        versionNumber: 1,
        content: 'Review {{task}}',
        changelog: 'Initial',
        createdAt: now,
      }),
      'utf-8'
    );
    await fs.writeFile(
      path.join(runtimeDir, 'prompt-usage', 'usage_1.json'),
      JSON.stringify({
        id: 'usage_1',
        templateId: 'prompt_triage',
        usedAt: now,
        usedBy: 'codex',
        model: 'gpt-5',
      }),
      'utf-8'
    );

    await fs.writeFile(
      path.join(runtimeDir, 'activity.json'),
      JSON.stringify([
        {
          id: 'activity_1',
          type: 'task_created',
          taskId,
          taskTitle: 'Migrate active task',
          timestamp: now,
        },
      ]),
      'utf-8'
    );
    await fs.writeFile(
      path.join(runtimeDir, 'status-history.json'),
      JSON.stringify([
        {
          id: 'status_1',
          timestamp: now,
          previousStatus: 'idle',
          newStatus: 'working',
          taskId,
        },
      ]),
      'utf-8'
    );

    await fs.mkdir(path.join(runtimeDir, 'telemetry'), { recursive: true });
    await fs.writeFile(
      path.join(runtimeDir, 'telemetry', 'events-2026-05-31.ndjson'),
      `${JSON.stringify({
        id: 'evt_1',
        type: 'task.created',
        taskId,
        timestamp: now,
        project: 'v5',
      })}\n{bad json}\n`,
      'utf-8'
    );

    const workflow: WorkflowDefinition = {
      id: 'migration-check',
      name: 'Migration Check',
      version: 1,
      description: 'Check migration',
      agents: [{ id: 'codex', name: 'Codex', role: 'engineer', description: 'Builds' }],
      steps: [{ id: 'inspect', name: 'Inspect', type: 'agent', agent: 'codex' }],
    };
    await fs.mkdir(path.join(runtimeDir, 'workflows'), { recursive: true });
    await fs.writeFile(
      path.join(runtimeDir, 'workflows', 'migration-check.yml'),
      yaml.stringify(workflow),
      'utf-8'
    );

    const run: WorkflowRun = {
      id: 'run_1780000000000_abcdef',
      workflowId: workflow.id,
      workflowVersion: 1,
      taskId,
      status: 'completed',
      context: {},
      startedAt: now,
      completedAt: now,
      steps: [{ stepId: 'inspect', status: 'completed', retries: 0 }],
    };
    await fs.mkdir(path.join(runtimeDir, 'workflow-runs', run.id), { recursive: true });
    await fs.writeFile(
      path.join(runtimeDir, 'workflow-runs', run.id, 'run.json'),
      JSON.stringify(run, null, 2),
      'utf-8'
    );

    const chatsDir = path.join(runtimeDir, 'chats');
    await fs.mkdir(path.join(chatsDir, 'sessions'), { recursive: true });
    await fs.mkdir(path.join(chatsDir, 'squad'), { recursive: true });
    await fs.writeFile(
      path.join(chatsDir, `task_${taskId}.md`),
      matter.stringify(`**msg_1** | user | ${now}\n\nShip this safely.`, {
        id: `task_${taskId}`,
        taskId,
        title: 'Task chat',
        agent: 'codex',
        mode: 'ask',
        created: now,
        updated: now,
      }),
      'utf-8'
    );
    await fs.writeFile(
      path.join(chatsDir, 'squad', '2026-05-31.md'),
      `# Squad Chat - 2026-05-31\n\n## codex | squad_1 | ${now} [agent.started] [model:gpt-5] [migration]\n\nMigration started.\n\n---\n`,
      'utf-8'
    );

    const service = new SqlitePortabilityService();
    const sqlitePath = path.join(testRoot, 'migration.db');
    const journalPath = path.join(runtimeDir, 'sqlite-migration-journal.json');
    const dryRun = await service.migrateFilesToSqlite({ sourceRoot, sqlitePath, dryRun: true });

    expect(dryRun.dryRun).toBe(true);
    expect(await exists(sqlitePath)).toBe(false);
    expect(dryRun.counts.find((count) => count.entity === 'tasks.active')?.scanned).toBe(1);
    expect(dryRun.warnings.some((warning) => warning.entity === 'tasks.active')).toBe(true);
    expect(dryRun.warnings.some((warning) => warning.entity === 'telemetry')).toBe(true);

    const report = await service.migrateFilesToSqlite({ sourceRoot, sqlitePath, journalPath });
    expect(report.backupPath).toBeTruthy();
    expect(await exists(path.join(report.backupPath!, 'backup-manifest.json'))).toBe(true);
    expect(
      await exists(
        path.join(report.backupPath!, '.veritas-kanban', 'sqlite-migration-journal.json')
      )
    ).toBe(false);
    const journal = await service.readMigrationJournal(journalPath);
    expect(journal?.status).toBe('completed');
    expect(journal?.backupPath).toBe(report.backupPath);
    expect(journal?.completedStages).toEqual(
      expect.arrayContaining(['scan-source', 'create-backup', 'open-sqlite', 'write-sqlite'])
    );
    expect(journal?.counts.find((count) => count.entity === 'tasks.active')?.written).toBe(1);

    const recovery = await service.getMigrationRecoveryState({
      sourceRoot,
      sqlitePath,
      journalPath,
    });
    expect(recovery.safeMode).toBe('normal');
    expect(recovery.canRestoreBackup).toBe(true);
    expect(recovery.canOpenSourceFiles).toBe(true);
    expect(recovery.canOpenSqlite).toBe(true);

    const database = new SqliteDatabase({ databasePath: sqlitePath });
    database.open();
    try {
      const tasks = new SqliteTaskRepository(database);
      const active = await tasks.findById(taskId);
      expect(active?.comments?.[0]?.text).toBe('keep me');
      expect(active?.subtasks?.[0]?.title).toBe('check parity');
      expect(active?.dependencies?.depends_on).toEqual(['task_20260531_beta2']);
      expect((await tasks.listArchived()).map((task) => task.id)).toContain('task_20260531_arch1');
      expect((await tasks.listBacklog()).map((task) => task.id)).toContain('task_20260531_back1');

      const settings = await new SqliteSettingsRepository(database, {
        defaultConfig: createDefaultConfig(),
        normalizeConfig: normalizeAppConfig,
      }).getConfig();
      expect(settings.repos[0]?.name).toBe('veritas');

      expect(rowCount(database, 'task_templates')).toBe(1);
      expect(rowCount(database, 'prompt_templates')).toBe(1);
      expect(rowCount(database, 'telemetry_events')).toBe(1);
      expect(rowCount(database, 'workflow_definitions')).toBe(1);
      expect(rowCount(database, 'workflow_runs')).toBe(1);
      expect(rowCount(database, 'chat_sessions')).toBe(1);
      expect(rowCount(database, 'chat_messages')).toBe(1);
      expect(rowCount(database, 'squad_messages')).toBe(1);
    } finally {
      database.close();
    }
  });

  it('records failed migration recovery state and supports rerun to a fresh database', async () => {
    const service = new SqlitePortabilityService();
    const { sourceRoot, taskId, runtimeDir } = await createMinimalLegacyProject(
      testRoot,
      'failed',
      'task_20260531_fail1'
    );
    const sqlitePath = path.join(testRoot, 'corrupt.db');
    const journalPath = path.join(runtimeDir, 'sqlite-migration-journal.json');
    await fs.writeFile(sqlitePath, 'not a sqlite database', 'utf-8');

    await expect(
      service.migrateFilesToSqlite({ sourceRoot, sqlitePath, journalPath })
    ).rejects.toThrow();

    const journal = await service.readMigrationJournal(journalPath);
    expect(journal?.status).toBe('failed');
    expect(journal?.failure?.stage).toBe('open-sqlite');
    expect(journal?.completedStages).not.toContain('open-sqlite');
    expect(journal?.backupPath).toBeTruthy();
    expect(journal?.recovery.safeMode).toBe('file-readonly');
    expect(await exists(path.join(sourceRoot, 'tasks', 'active'))).toBe(true);
    expect(
      await exists(
        path.join(journal!.backupPath!, '.veritas-kanban', 'sqlite-migration-journal.json')
      )
    ).toBe(false);

    const recovery = await service.getMigrationRecoveryState({
      sourceRoot,
      sqlitePath,
      journalPath,
    });
    expect(recovery.canOpenSourceFiles).toBe(true);
    expect(recovery.canOpenSqlite).toBe(false);
    expect(recovery.canRestoreBackup).toBe(true);
    expect(recovery.nextActions.join(' ')).toContain('file storage');

    const rerunPath = path.join(testRoot, 'rerun.db');
    await service.migrateFilesToSqlite({ sourceRoot, sqlitePath: rerunPath });
    const rerunDb = new SqliteDatabase({ databasePath: rerunPath });
    rerunDb.open();
    try {
      const task = await new SqliteTaskRepository(rerunDb).findById(taskId);
      expect(task?.title).toBe('Minimal failed task');
    } finally {
      rerunDb.close();
    }
  });

  it('restores a pre-migration backup over the file tree and records restored recovery state', async () => {
    const service = new SqlitePortabilityService();
    const { sourceRoot, activeDir, runtimeDir, taskId } = await createMinimalLegacyProject(
      testRoot,
      'restore',
      'task_20260531_restore1'
    );
    const sqlitePath = path.join(testRoot, 'restore.db');
    const journalPath = path.join(runtimeDir, 'sqlite-migration-journal.json');
    const report = await service.migrateFilesToSqlite({ sourceRoot, sqlitePath, journalPath });

    await writeTask(activeDir, {
      id: taskId,
      title: 'Mutated task',
      description: 'This should be replaced by the backup.',
      type: 'feature',
      status: 'todo',
      priority: 'high',
      created: '2026-05-31T12:00:00.000Z',
      updated: '2026-05-31T13:00:00.000Z',
    });

    await expect(
      service.restorePreMigrationBackup({ backupPath: report.backupPath!, targetRoot: sourceRoot })
    ).rejects.toThrow(/replaceExisting=true/);

    const dryRun = await service.restorePreMigrationBackup({
      backupPath: report.backupPath!,
      targetRoot: sourceRoot,
      dryRun: true,
    });
    expect(dryRun.filesRestored).toBeGreaterThan(0);

    const restore = await service.restorePreMigrationBackup({
      backupPath: report.backupPath!,
      targetRoot: sourceRoot,
      journalPath,
      replaceExisting: true,
    });
    expect(restore.filesRestored).toBeGreaterThan(0);

    const activeFiles = await fs.readdir(activeDir);
    const restoredTaskFile = activeFiles.find((file) => file.startsWith(`${taskId}-`));
    expect(restoredTaskFile).toBeTruthy();
    const restoredTask = matter(
      await fs.readFile(path.join(activeDir, restoredTaskFile!), 'utf-8')
    );
    expect(restoredTask.data.title).toBe('Minimal restore task');
    expect(restoredTask.content).toContain('Original restore body');

    const journal = await service.readMigrationJournal(journalPath);
    expect(journal?.status).toBe('restored');
    expect(journal?.recovery.safeMode).toBe('file-readonly');
  });

  it('warns about duplicate task ids and missing attachment files before migration', async () => {
    const service = new SqlitePortabilityService();
    const { sourceRoot, activeDir, backlogDir, taskId } = await createMinimalLegacyProject(
      testRoot,
      'warnings',
      'task_20260531_warn1'
    );
    await writeTask(activeDir, {
      id: taskId,
      title: 'Task with missing attachment',
      description: 'Attachment metadata points at a missing file.',
      type: 'feature',
      status: 'todo',
      priority: 'high',
      created: '2026-05-31T12:00:00.000Z',
      updated: '2026-05-31T12:00:00.000Z',
      attachments: [
        {
          id: 'att_missing',
          filename: 'missing.txt',
          originalName: 'missing.txt',
          mimeType: 'text/plain',
          size: 12,
          uploaded: '2026-05-31T12:00:00.000Z',
          storagePath: 'tasks/attachments/task_20260531_warn1/missing.txt',
        },
      ],
    });
    await writeTask(backlogDir, {
      id: taskId,
      title: 'Duplicate task id',
      description: 'This duplicate should be called out before migration.',
      type: 'task',
      status: 'todo',
      priority: 'medium',
      created: '2026-05-31T12:00:00.000Z',
      updated: '2026-05-31T12:00:00.000Z',
    });

    const report = await service.migrateFilesToSqlite({
      sourceRoot,
      sqlitePath: path.join(testRoot, 'warnings.db'),
      dryRun: true,
    });

    expect(report.warnings.some((warning) => warning.message.includes('Duplicate task id'))).toBe(
      true
    );
    expect(
      report.warnings.some((warning) => warning.message.includes('Attachment file not found'))
    ).toBe(true);
  });

  it('exports a SQLite backup bundle and imports it into a fresh database', async () => {
    const service = new SqlitePortabilityService();
    const sourceDbPath = path.join(testRoot, 'source.db');
    const sourceDb = new SqliteDatabase({ databasePath: sourceDbPath });
    sourceDb.open();
    try {
      const task: Task = {
        id: 'task_20260531_roundtrip',
        title: 'Roundtrip task',
        description: 'Export and import me.',
        type: 'feature',
        status: 'todo',
        priority: 'high',
        created: '2026-05-31T12:00:00.000Z',
        updated: '2026-05-31T12:00:00.000Z',
      };
      await new SqliteTaskRepository(sourceDb).create(task);
      await new SqliteSettingsRepository(sourceDb, {
        defaultConfig: createDefaultConfig(),
        normalizeConfig: normalizeAppConfig,
      }).saveConfig({
        ...createDefaultConfig(),
        repos: [{ name: 'roundtrip', path: testRoot, defaultBranch: 'main' }],
      });
    } finally {
      sourceDb.close();
    }

    const bundleDir = path.join(testRoot, 'bundle');
    const exportReport = await service.exportSqliteBackup({
      sqlitePath: sourceDbPath,
      outputDir: bundleDir,
    });
    expect(exportReport.counts.find((count) => count.entity === 'table.tasks')?.written).toBe(1);
    expect(await exists(path.join(bundleDir, 'manifest.json'))).toBe(true);
    expect(
      await exists(
        path.join(bundleDir, 'tasks', 'active', 'task_20260531_roundtrip-roundtrip-task.md')
      )
    ).toBe(true);

    const importedDbPath = path.join(testRoot, 'imported.db');
    const importReport = await service.importSqliteBackup({
      sqlitePath: importedDbPath,
      bundleDir,
      replaceExisting: true,
    });
    expect(importReport.counts.find((count) => count.entity === 'table.tasks')?.written).toBe(1);

    const importedDb = new SqliteDatabase({ databasePath: importedDbPath });
    importedDb.open();
    try {
      const task = await new SqliteTaskRepository(importedDb).findById('task_20260531_roundtrip');
      expect(task?.title).toBe('Roundtrip task');
      expect((await new SqliteTaskRepository(importedDb).search('Roundtrip'))[0]?.id).toBe(
        'task_20260531_roundtrip'
      );

      const settings = await new SqliteSettingsRepository(importedDb, {
        defaultConfig: createDefaultConfig(),
        normalizeConfig: normalizeAppConfig,
      }).getConfig();
      expect(settings.repos[0]?.name).toBe('roundtrip');
    } finally {
      importedDb.close();
    }
  });
});

async function createMinimalLegacyProject(
  testRoot: string,
  name: string,
  taskId: string
): Promise<{
  sourceRoot: string;
  runtimeDir: string;
  activeDir: string;
  backlogDir: string;
  taskId: string;
}> {
  const sourceRoot = path.join(testRoot, `project-${name}`);
  const runtimeDir = path.join(sourceRoot, '.veritas-kanban');
  const activeDir = path.join(sourceRoot, 'tasks', 'active');
  const archiveDir = path.join(sourceRoot, 'tasks', 'archive');
  const backlogDir = path.join(sourceRoot, 'tasks', 'backlog');
  const now = '2026-05-31T12:00:00.000Z';

  await fs.mkdir(activeDir, { recursive: true });
  await fs.mkdir(archiveDir, { recursive: true });
  await fs.mkdir(backlogDir, { recursive: true });
  await fs.mkdir(runtimeDir, { recursive: true });

  await writeTask(activeDir, {
    id: taskId,
    title: `Minimal ${name} task`,
    description: `Original ${name} body`,
    type: 'feature',
    status: 'todo',
    priority: 'high',
    created: now,
    updated: now,
  });

  await fs.writeFile(
    path.join(runtimeDir, 'config.json'),
    JSON.stringify({
      repos: [{ name, path: sourceRoot, defaultBranch: 'main' }],
      agents: [],
      defaultAgent: 'codex',
    }),
    'utf-8'
  );

  return { sourceRoot, runtimeDir, activeDir, backlogDir, taskId };
}

async function writeTask(dir: string, task: Task): Promise<void> {
  const { description, ...frontmatter } = task;
  const slug = task.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  await fs.writeFile(
    path.join(dir, `${task.id}-${slug}.md`),
    matter.stringify(description, frontmatter),
    'utf-8'
  );
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function rowCount(database: SqliteDatabase, table: string): number {
  const row = database
    .getConnection()
    .prepare(`SELECT COUNT(*) AS count FROM "${table}"`)
    .get() as { count: number };
  return row.count;
}
