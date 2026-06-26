import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import readline from 'readline';
import { createGunzip } from 'zlib';
import type { SQLInputValue } from 'node:sqlite';
import matter from '../utils/frontmatter.js';
import yaml from 'yaml';
import type {
  AnyTelemetryEvent,
  AppConfig,
  PromptTemplate,
  PromptUsage,
  PromptVersion,
  Task,
  TaskTemplate,
  WorkProductRender,
} from '@veritas-kanban/shared';
import type { Activity } from './activity-service.js';
import type { StatusHistoryEntry } from './status-history-service.js';
import type { ChatSession, SquadMessage } from '@veritas-kanban/shared';
import type { WorkflowDefinition, WorkflowRun } from '../types/workflow.js';
import {
  getRuntimeDir,
  getStorageRoot,
  getTasksActiveDir,
  getTasksArchiveDir,
  getTasksBacklogDir,
  getTelemetryDir,
  getWorkflowsDir,
  getWorkflowRunsDir,
  getChatsDir,
} from '../utils/paths.js';
import { createDefaultConfig, normalizeAppConfig } from './config-service.js';
import { SqliteDatabase } from '../storage/sqlite/database.js';
import { SqliteTaskRepository } from '../storage/sqlite/task-repository.js';
import { SqliteSettingsRepository } from '../storage/sqlite/settings-repository.js';
import { SqliteChatRepository } from '../storage/sqlite/chat-repository.js';
import { SqliteWorkflowDefinitionRepository } from '../storage/sqlite/workflow-repositories.js';
import { WorkflowService } from './workflow-service.js';
import { WorkflowRunService } from './workflow-run-service.js';
import { ChatService } from './chat-service.js';
import { buildDataLifecycleManifest } from './data-lifecycle-policy.js';

const TASK_ID_REGEX = /^task_(\d{8}_[a-zA-Z0-9_-]{1,20}|[a-zA-Z0-9_-]+)$/;

const SQLITE_BACKUP_TABLES = [
  'workspaces',
  'users',
  'workspace_memberships',
  'workspace_invitations',
  'app_config_documents',
  'tasks',
  'task_attachments',
  'task_deliverables',
  'managed_list_items',
  'task_templates',
  'prompt_templates',
  'prompt_versions',
  'prompt_usage',
  'activity_events',
  'status_history',
  'telemetry_events',
  'decision_records',
  'governance_decision_traces',
  'feedback_records',
  'scoring_profiles',
  'scoring_evaluations',
  'drift_alerts',
  'drift_baselines',
  'audit_entries',
  'agent_policies',
  'tool_policies',
  'workflow_definitions',
  'workflow_acls',
  'workflow_audit_events',
  'workflow_runs',
  'chat_sessions',
  'chat_messages',
  'squad_messages',
  'notifications',
  'thread_subscriptions',
  'scheduled_deliverables',
  'scheduled_deliverable_runs',
  'work_products',
  'work_product_versions',
] as const;

type SqliteBackupTable = (typeof SQLITE_BACKUP_TABLES)[number];

export type SqlitePortabilityEntity =
  | 'tasks.active'
  | 'tasks.archived'
  | 'tasks.backlog'
  | 'settings'
  | 'taskTemplates'
  | 'promptTemplates'
  | 'promptVersions'
  | 'promptUsage'
  | 'activity'
  | 'statusHistory'
  | 'telemetry'
  | 'workflows'
  | 'workflowRuns'
  | 'chatSessions'
  | 'squadMessages'
  | `table.${SqliteBackupTable}`;

export interface SqlitePortabilityWarning {
  entity: SqlitePortabilityEntity | 'backup' | 'sqlite';
  source?: string;
  message: string;
}

export interface SqlitePortabilityEntityCount {
  entity: SqlitePortabilityEntity;
  scanned: number;
  written: number;
  skipped: number;
}

export interface SqlitePortabilityReport {
  operation: 'file-to-sqlite' | 'sqlite-export' | 'sqlite-import';
  dryRun: boolean;
  startedAt: string;
  completedAt: string;
  sqlitePath?: string;
  sourceRoot?: string;
  backupPath?: string;
  bundlePath?: string;
  counts: SqlitePortabilityEntityCount[];
  warnings: SqlitePortabilityWarning[];
}

export interface FileToSqliteMigrationOptions {
  sourceRoot?: string;
  sqlitePath: string;
  dryRun?: boolean;
  backupDir?: string;
  journalPath?: string;
}

export interface SqliteBackupExportOptions {
  sqlitePath: string;
  outputDir: string;
  workspaceId?: string;
}

export interface SqliteBackupImportOptions {
  sqlitePath: string;
  bundleDir: string;
  replaceExisting?: boolean;
}

export type SqliteMigrationStage =
  | 'scan-source'
  | 'create-backup'
  | 'open-sqlite'
  | 'write-sqlite'
  | 'promote-database'
  | 'completed'
  | 'failed';

export interface SqliteMigrationJournal {
  formatVersion: 1;
  operation: 'file-to-sqlite';
  status: 'running' | 'completed' | 'failed' | 'restored';
  startedAt: string;
  updatedAt: string;
  sourceRoot: string;
  sqlitePath: string;
  backupPath?: string;
  tempSqlitePath?: string;
  currentStage: SqliteMigrationStage;
  completedStages: SqliteMigrationStage[];
  counts: SqlitePortabilityEntityCount[];
  warnings: SqlitePortabilityWarning[];
  failure?: {
    stage: SqliteMigrationStage;
    name: string;
    message: string;
  };
  recovery: {
    safeMode: 'file-readonly' | 'sqlite-readonly' | 'normal';
    nextActions: string[];
    preserveArtifacts: string[];
  };
}

export interface SqliteMigrationRecoveryState {
  journalPath: string;
  journal: SqliteMigrationJournal | null;
  safeMode: SqliteMigrationJournal['recovery']['safeMode'];
  canRestoreBackup: boolean;
  canOpenSourceFiles: boolean;
  canOpenSqlite: boolean;
  nextActions: string[];
  preserveArtifacts: string[];
}

export interface SqliteMigrationRecoveryOptions {
  sourceRoot?: string;
  sqlitePath?: string;
  journalPath?: string;
}

export interface RestorePreMigrationBackupOptions {
  backupPath: string;
  targetRoot?: string;
  journalPath?: string;
  replaceExisting?: boolean;
  dryRun?: boolean;
}

export interface RestorePreMigrationBackupReport {
  operation: 'restore-pre-migration-backup';
  dryRun: boolean;
  startedAt: string;
  completedAt: string;
  backupPath: string;
  targetRoot: string;
  restoredPaths: string[];
  filesRestored: number;
  warnings: SqlitePortabilityWarning[];
}

interface LegacyPaths {
  sourceRoot: string;
  runtimeDir: string;
  tasksActiveDir: string;
  tasksArchiveDir: string;
  tasksBacklogDir: string;
  configFile: string;
  taskTemplatesDir: string;
  promptTemplatesDir: string;
  promptVersionsDir: string;
  promptUsageDir: string;
  activityFile: string;
  statusHistoryFile: string;
  telemetryDir: string;
  workflowsDir: string;
  workflowRunsDir: string;
  chatsDir: string;
}

interface ParsedTaskSet {
  active: Task[];
  archived: Task[];
  backlog: Task[];
}

interface LegacyData {
  tasks: ParsedTaskSet;
  config: AppConfig | null;
  taskTemplates: TaskTemplate[];
  promptTemplates: PromptTemplate[];
  promptVersions: PromptVersion[];
  promptUsage: PromptUsage[];
  activities: Activity[];
  statusHistory: StatusHistoryEntry[];
  telemetry: AnyTelemetryEvent[];
  workflows: WorkflowDefinition[];
  workflowRuns: WorkflowRun[];
  chatSessions: ChatSession[];
  squadMessages: SquadMessage[];
}

interface TableSnapshot {
  table: SqliteBackupTable;
  rows: Record<string, unknown>[];
}

export class SqlitePortabilityService {
  async migrateFilesToSqlite(
    options: FileToSqliteMigrationOptions
  ): Promise<SqlitePortabilityReport> {
    const dryRun = options.dryRun === true;
    const startedAt = new Date().toISOString();
    const paths = this.resolveLegacyPaths(options.sourceRoot);
    const warnings: SqlitePortabilityWarning[] = [];
    const legacy = await this.readLegacyData(paths, warnings);
    const counts = this.buildLegacyCounts(legacy, 0);
    const journalPath = dryRun
      ? undefined
      : this.resolveMigrationJournalPath(paths, options.journalPath);
    let journal = journalPath
      ? this.createMigrationJournal({
          startedAt,
          sourceRoot: paths.sourceRoot,
          sqlitePath: path.resolve(options.sqlitePath),
          journalPath,
          counts,
          warnings,
        })
      : null;

    let backupPath: string | undefined;
    let database: SqliteDatabase | null = null;
    let tempSqlitePath: string | null = null;

    try {
      if (journalPath && journal) {
        journal = await this.writeMigrationJournal(journalPath, journal, 'scan-source');
      }

      if (!dryRun) {
        const sqlitePath = path.resolve(options.sqlitePath);
        const sqliteExists = await this.exists(sqlitePath);
        const writeSqlitePath = sqliteExists
          ? sqlitePath
          : `${sqlitePath}.tmp-${Date.now().toString(36)}`;

        backupPath = await this.createPreMigrationBackup(paths, options.backupDir, warnings);
        if (journalPath && journal) {
          journal.backupPath = backupPath;
          journal.warnings = warnings;
          journal = await this.writeMigrationJournal(journalPath, journal, 'create-backup');
        }

        tempSqlitePath = sqliteExists ? null : writeSqlitePath;
        if (journalPath && journal) {
          journal.tempSqlitePath = tempSqlitePath ?? undefined;
        }

        await fs.mkdir(path.dirname(writeSqlitePath), { recursive: true });
        database = new SqliteDatabase({ databasePath: writeSqlitePath });
        if (journalPath && journal) {
          journal = await this.writeMigrationJournal(journalPath, journal, 'open-sqlite', {
            completeStage: false,
          });
        }
        database.open();
        if (journalPath && journal) {
          journal = await this.writeMigrationJournal(journalPath, journal, 'open-sqlite');
          journal = await this.writeMigrationJournal(journalPath, journal, 'write-sqlite', {
            completeStage: false,
          });
        }
        await this.writeLegacyData(database, legacy);
        if (journalPath && journal) {
          journal = await this.writeMigrationJournal(journalPath, journal, 'write-sqlite');
        }

        database.getConnection().exec('PRAGMA wal_checkpoint(FULL);');
        database.close();
        database = null;

        if (tempSqlitePath) {
          if (journalPath && journal) {
            journal.tempSqlitePath = tempSqlitePath;
            journal = await this.writeMigrationJournal(journalPath, journal, 'promote-database', {
              completeStage: false,
            });
          }
          await this.promoteTempDatabase(tempSqlitePath, sqlitePath);
          tempSqlitePath = null;
          if (journalPath && journal) {
            journal.tempSqlitePath = undefined;
            journal = await this.writeMigrationJournal(journalPath, journal, 'promote-database');
          }
        }

        for (const count of counts) {
          count.written = count.scanned - count.skipped;
        }
      }

      const report: SqlitePortabilityReport = {
        operation: 'file-to-sqlite',
        dryRun,
        startedAt,
        completedAt: new Date().toISOString(),
        sqlitePath: path.resolve(options.sqlitePath),
        sourceRoot: paths.sourceRoot,
        backupPath,
        counts,
        warnings,
      };

      if (journalPath && journal) {
        await this.completeMigrationJournal(journalPath, journal, report);
      }

      return report;
    } catch (error) {
      if (journalPath && journal) {
        await this.failMigrationJournal(journalPath, journal, error);
      }
      throw error;
    } finally {
      database?.close();
      if (tempSqlitePath) {
        await this.cleanupTempDatabase(tempSqlitePath);
      }
    }
  }

  async exportSqliteBackup(options: SqliteBackupExportOptions): Promise<SqlitePortabilityReport> {
    const startedAt = new Date().toISOString();
    const warnings: SqlitePortabilityWarning[] = [];
    const database = new SqliteDatabase({ databasePath: options.sqlitePath });
    database.open();

    try {
      const bundleDir = path.resolve(options.outputDir);
      const dataDir = path.join(bundleDir, 'data', 'sqlite');
      await fs.mkdir(dataDir, { recursive: true });

      const snapshots = this.readSqliteSnapshots(database, warnings, options.workspaceId);
      const counts: SqlitePortabilityEntityCount[] = [];

      for (const snapshot of snapshots) {
        await this.writeJson(path.join(dataDir, `${snapshot.table}.json`), snapshot.rows);
        counts.push({
          entity: `table.${snapshot.table}`,
          scanned: snapshot.rows.length,
          written: snapshot.rows.length,
          skipped: 0,
        });
      }

      const tableCounts = Object.fromEntries(
        snapshots.map((snapshot) => [snapshot.table, snapshot.rows.length])
      );
      await this.writeHumanReadableBundle(database, bundleDir, warnings, options.workspaceId);
      await this.writeJson(path.join(bundleDir, 'manifest.json'), {
        formatVersion: 2,
        exportedAt: new Date().toISOString(),
        sqlitePath: path.resolve(options.sqlitePath),
        scope: options.workspaceId
          ? { type: 'workspace', workspaceId: options.workspaceId }
          : { type: 'database' },
        tables: tableCounts,
        dataClasses: buildDataLifecycleManifest({
          workspaceId: options.workspaceId,
          tableCounts,
        }),
        redaction: {
          backupBundle: 'raw',
          supportBundles:
            'redact tokens, cookies, local paths, credentialed URLs, prompts, message content, and generated sensitive text by default',
        },
      });

      return {
        operation: 'sqlite-export',
        dryRun: false,
        startedAt,
        completedAt: new Date().toISOString(),
        sqlitePath: path.resolve(options.sqlitePath),
        bundlePath: bundleDir,
        counts,
        warnings,
      };
    } finally {
      database.close();
    }
  }

  async importSqliteBackup(options: SqliteBackupImportOptions): Promise<SqlitePortabilityReport> {
    const startedAt = new Date().toISOString();
    const warnings: SqlitePortabilityWarning[] = [];
    const bundleDir = path.resolve(options.bundleDir);
    const dataDir = path.join(bundleDir, 'data', 'sqlite');
    const database = new SqliteDatabase({ databasePath: options.sqlitePath });
    database.open();

    try {
      const snapshots = await this.readBundleSnapshots(dataDir, warnings);
      if (!options.replaceExisting) {
        this.assertImportTargetIsEmpty(database, warnings);
      }

      const db = database.getConnection();
      db.exec('BEGIN IMMEDIATE;');
      try {
        if (options.replaceExisting) {
          for (const table of [...SQLITE_BACKUP_TABLES].reverse()) {
            db.prepare(`DELETE FROM ${this.quoteIdentifier(table)}`).run();
          }
        }

        for (const snapshot of snapshots) {
          this.insertRows(database, snapshot.table, snapshot.rows, true);
        }

        this.rebuildSearchIndexes(database);
        db.exec('COMMIT;');
      } catch (error) {
        db.exec('ROLLBACK;');
        throw error;
      }

      return {
        operation: 'sqlite-import',
        dryRun: false,
        startedAt,
        completedAt: new Date().toISOString(),
        sqlitePath: path.resolve(options.sqlitePath),
        bundlePath: bundleDir,
        counts: snapshots.map((snapshot) => ({
          entity: `table.${snapshot.table}`,
          scanned: snapshot.rows.length,
          written: snapshot.rows.length,
          skipped: 0,
        })),
        warnings,
      };
    } finally {
      database.close();
    }
  }

  async readMigrationJournal(journalPath: string): Promise<SqliteMigrationJournal | null> {
    if (!(await this.exists(journalPath))) {
      return null;
    }

    return JSON.parse(await fs.readFile(journalPath, 'utf-8')) as SqliteMigrationJournal;
  }

  async getMigrationRecoveryState(
    options: SqliteMigrationRecoveryOptions = {}
  ): Promise<SqliteMigrationRecoveryState> {
    const paths = this.resolveLegacyPaths(options.sourceRoot);
    const journalPath = this.resolveMigrationJournalPath(paths, options.journalPath);
    const journal = await this.readMigrationJournal(journalPath);
    const sqlitePath = options.sqlitePath ?? journal?.sqlitePath;
    const canOpenSourceFiles = await this.exists(paths.sourceRoot);
    const canOpenSqlite = sqlitePath ? await this.canOpenSqlite(sqlitePath) : false;
    const canRestoreBackup = journal?.backupPath ? await this.exists(journal.backupPath) : false;
    const fallback = this.buildRecoveryPlan({
      status: journal?.status ?? 'failed',
      sourceRoot: paths.sourceRoot,
      sqlitePath: sqlitePath ? path.resolve(sqlitePath) : undefined,
      backupPath: journal?.backupPath,
      journalPath,
      failureStage: journal?.failure?.stage ?? journal?.currentStage ?? 'failed',
    });

    return {
      journalPath,
      journal,
      safeMode: journal?.recovery.safeMode ?? fallback.safeMode,
      canRestoreBackup,
      canOpenSourceFiles,
      canOpenSqlite,
      nextActions: journal?.recovery.nextActions ?? fallback.nextActions,
      preserveArtifacts: journal?.recovery.preserveArtifacts ?? fallback.preserveArtifacts,
    };
  }

  async restorePreMigrationBackup(
    options: RestorePreMigrationBackupOptions
  ): Promise<RestorePreMigrationBackupReport> {
    const startedAt = new Date().toISOString();
    const backupPath = path.resolve(options.backupPath);
    const warnings: SqlitePortabilityWarning[] = [];
    const manifest = await this.readBackupManifest(backupPath);
    const targetRoot = path.resolve(options.targetRoot ?? manifest.sourceRoot);
    const journalPath = path.resolve(
      options.journalPath ??
        path.join(targetRoot, '.veritas-kanban', 'sqlite-migration-journal.json')
    );
    const journal = await this.readMigrationJournal(journalPath);
    const dryRun = options.dryRun === true;
    const restoredPaths: string[] = [];
    let filesRestored = 0;

    const restoreTargets = [
      {
        source: path.join(backupPath, 'tasks'),
        target: path.join(targetRoot, 'tasks'),
      },
      {
        source: path.join(backupPath, '.veritas-kanban'),
        target: path.join(targetRoot, '.veritas-kanban'),
      },
    ];

    for (const restoreTarget of restoreTargets) {
      const files = await this.countRecursiveFiles(restoreTarget.source);
      if (files === 0) {
        continue;
      }
      filesRestored += files;
      restoredPaths.push(restoreTarget.target);

      if (dryRun) {
        continue;
      }

      if (!options.replaceExisting) {
        await this.assertRestoreTargetIsClear(restoreTarget.target);
      } else {
        await fs.rm(restoreTarget.target, { recursive: true, force: true });
      }

      await this.copyBackupSource(restoreTarget.source, restoreTarget.target, [], warnings);
    }

    if (!dryRun && journal) {
      const restored: SqliteMigrationJournal = {
        ...journal,
        status: 'restored',
        updatedAt: new Date().toISOString(),
        recovery: this.buildRecoveryPlan({
          status: 'restored',
          sourceRoot: targetRoot,
          sqlitePath: journal.sqlitePath,
          backupPath,
          tempSqlitePath: journal.tempSqlitePath,
          journalPath,
          failureStage: journal.failure?.stage ?? journal.currentStage,
        }),
      };
      await this.writeJson(journalPath, restored);
    }

    return {
      operation: 'restore-pre-migration-backup',
      dryRun,
      startedAt,
      completedAt: new Date().toISOString(),
      backupPath,
      targetRoot,
      restoredPaths,
      filesRestored,
      warnings,
    };
  }

  private resolveLegacyPaths(sourceRoot?: string): LegacyPaths {
    if (!sourceRoot) {
      const runtimeDir = getRuntimeDir();
      return {
        sourceRoot: getStorageRoot(),
        runtimeDir,
        tasksActiveDir: getTasksActiveDir(),
        tasksArchiveDir: getTasksArchiveDir(),
        tasksBacklogDir: getTasksBacklogDir(),
        configFile: path.join(runtimeDir, 'config.json'),
        taskTemplatesDir: path.join(runtimeDir, 'templates'),
        promptTemplatesDir: path.join(runtimeDir, 'prompt-templates'),
        promptVersionsDir: path.join(runtimeDir, 'prompt-versions'),
        promptUsageDir: path.join(runtimeDir, 'prompt-usage'),
        activityFile: path.join(runtimeDir, 'activity.json'),
        statusHistoryFile: path.join(runtimeDir, 'status-history.json'),
        telemetryDir: getTelemetryDir(),
        workflowsDir: getWorkflowsDir(),
        workflowRunsDir: getWorkflowRunsDir(),
        chatsDir: getChatsDir(),
      };
    }

    const resolvedRoot = path.resolve(sourceRoot);
    const runtimeDir = path.join(resolvedRoot, '.veritas-kanban');
    return {
      sourceRoot: resolvedRoot,
      runtimeDir,
      tasksActiveDir: path.join(resolvedRoot, 'tasks', 'active'),
      tasksArchiveDir: path.join(resolvedRoot, 'tasks', 'archive'),
      tasksBacklogDir: path.join(resolvedRoot, 'tasks', 'backlog'),
      configFile: path.join(runtimeDir, 'config.json'),
      taskTemplatesDir: path.join(runtimeDir, 'templates'),
      promptTemplatesDir: path.join(runtimeDir, 'prompt-templates'),
      promptVersionsDir: path.join(runtimeDir, 'prompt-versions'),
      promptUsageDir: path.join(runtimeDir, 'prompt-usage'),
      activityFile: path.join(runtimeDir, 'activity.json'),
      statusHistoryFile: path.join(runtimeDir, 'status-history.json'),
      telemetryDir: path.join(runtimeDir, 'telemetry'),
      workflowsDir: path.join(runtimeDir, 'workflows'),
      workflowRunsDir: path.join(runtimeDir, 'workflow-runs'),
      chatsDir: path.join(runtimeDir, 'chats'),
    };
  }

  private async readLegacyData(
    paths: LegacyPaths,
    warnings: SqlitePortabilityWarning[]
  ): Promise<LegacyData> {
    const tasks: ParsedTaskSet = {
      active: await this.readTasks(paths.tasksActiveDir, 'tasks.active', warnings),
      archived: await this.readTasks(paths.tasksArchiveDir, 'tasks.archived', warnings),
      backlog: await this.readTasks(paths.tasksBacklogDir, 'tasks.backlog', warnings),
    };
    await this.validateTaskMigrationInputs(paths, tasks, warnings);

    const config = await this.readJsonFile<AppConfig>(paths.configFile, 'settings', warnings);
    const taskTemplates = await this.readMatterDirectory<TaskTemplate>(
      paths.taskTemplatesDir,
      'taskTemplates',
      warnings
    );
    const promptTemplates = await this.readMatterDirectory<PromptTemplate>(
      paths.promptTemplatesDir,
      'promptTemplates',
      warnings
    );
    const promptVersions = await this.readMatterDirectory<PromptVersion>(
      paths.promptVersionsDir,
      'promptVersions',
      warnings
    );
    const promptUsage = await this.readJsonDirectory<PromptUsage>(
      paths.promptUsageDir,
      'promptUsage',
      warnings
    );
    const activities =
      (await this.readJsonFile<Activity[]>(paths.activityFile, 'activity', warnings)) ?? [];
    const statusHistory =
      (await this.readJsonFile<StatusHistoryEntry[]>(
        paths.statusHistoryFile,
        'statusHistory',
        warnings
      )) ?? [];
    const telemetry = await this.readTelemetry(paths.telemetryDir, warnings);
    const workflows = await this.readWorkflows(paths.workflowsDir, warnings);
    const workflowRuns = await this.readWorkflowRuns(
      paths.workflowRunsDir,
      paths.workflowsDir,
      warnings
    );
    const { chatSessions, squadMessages } = await this.readChats(paths.chatsDir, tasks, warnings);

    return {
      tasks,
      config,
      taskTemplates: taskTemplates.filter((template) =>
        this.hasStringId(template, 'taskTemplates', warnings)
      ),
      promptTemplates: promptTemplates.filter((template) =>
        this.hasStringId(template, 'promptTemplates', warnings)
      ),
      promptVersions: promptVersions.filter((version) =>
        this.hasStringId(version, 'promptVersions', warnings)
      ),
      promptUsage: promptUsage.filter((usage) => this.hasStringId(usage, 'promptUsage', warnings)),
      activities: Array.isArray(activities) ? activities : [],
      statusHistory: Array.isArray(statusHistory) ? statusHistory : [],
      telemetry,
      workflows,
      workflowRuns,
      chatSessions,
      squadMessages,
    };
  }

  private buildLegacyCounts(
    legacy: LegacyData,
    forcedWritten?: number
  ): SqlitePortabilityEntityCount[] {
    const count = (
      entity: SqlitePortabilityEntity,
      scanned: number
    ): SqlitePortabilityEntityCount => ({
      entity,
      scanned,
      written: forcedWritten ?? scanned,
      skipped: 0,
    });

    return [
      count('tasks.active', legacy.tasks.active.length),
      count('tasks.archived', legacy.tasks.archived.length),
      count('tasks.backlog', legacy.tasks.backlog.length),
      count('settings', legacy.config ? 1 : 0),
      count('taskTemplates', legacy.taskTemplates.length),
      count('promptTemplates', legacy.promptTemplates.length),
      count('promptVersions', legacy.promptVersions.length),
      count('promptUsage', legacy.promptUsage.length),
      count('activity', legacy.activities.length),
      count('statusHistory', legacy.statusHistory.length),
      count('telemetry', legacy.telemetry.length),
      count('workflows', legacy.workflows.length),
      count('workflowRuns', legacy.workflowRuns.length),
      count('chatSessions', legacy.chatSessions.length),
      count('squadMessages', legacy.squadMessages.length),
    ];
  }

  private async writeLegacyData(database: SqliteDatabase, legacy: LegacyData): Promise<void> {
    const taskRepository = new SqliteTaskRepository(database);

    for (const task of legacy.tasks.active) {
      await taskRepository.replaceActive(task);
    }

    for (const task of legacy.tasks.archived) {
      await taskRepository.replaceActive(task);
      await taskRepository.archive(task.id);
    }

    for (const task of legacy.tasks.backlog) {
      await taskRepository.replaceActive(task);
      await taskRepository.moveToBacklog(task.id);
    }

    if (legacy.config) {
      const settings = new SqliteSettingsRepository(database, {
        defaultConfig: createDefaultConfig(),
        normalizeConfig: normalizeAppConfig,
      });
      await settings.saveConfig(legacy.config);
    }

    this.writeTaskTemplates(database, legacy.taskTemplates);
    this.writePromptRegistry(
      database,
      legacy.promptTemplates,
      legacy.promptVersions,
      legacy.promptUsage
    );
    this.writeActivities(database, legacy.activities);
    this.writeStatusHistory(database, legacy.statusHistory);
    this.writeTelemetry(database, legacy.telemetry);
    this.writeWorkflows(database, legacy.workflows);
    this.writeWorkflowRuns(database, legacy.workflowRuns);
    this.writeChatSessions(database, legacy.chatSessions);
    this.writeSquadMessages(database, legacy.squadMessages);
  }

  private async createPreMigrationBackup(
    paths: LegacyPaths,
    backupDir: string | undefined,
    warnings: SqlitePortabilityWarning[]
  ): Promise<string> {
    const backupRoot =
      backupDir ??
      path.join(
        paths.runtimeDir,
        'backups',
        `sqlite-migration-${new Date().toISOString().replace(/[:.]/g, '-')}`
      );

    await fs.mkdir(backupRoot, { recursive: true });

    const included: string[] = [];
    await this.copyBackupSource(
      path.join(paths.sourceRoot, 'tasks'),
      path.join(backupRoot, 'tasks'),
      included,
      warnings
    );
    await this.copyRuntimeBackup(
      paths.runtimeDir,
      path.join(backupRoot, '.veritas-kanban'),
      included,
      warnings
    );

    await this.writeJson(path.join(backupRoot, 'backup-manifest.json'), {
      createdAt: new Date().toISOString(),
      sourceRoot: paths.sourceRoot,
      included,
    });

    return backupRoot;
  }

  private async copyRuntimeBackup(
    runtimeDir: string,
    targetDir: string,
    included: string[],
    warnings: SqlitePortabilityWarning[]
  ): Promise<void> {
    if (!(await this.exists(runtimeDir))) {
      return;
    }

    const entries = await fs.readdir(runtimeDir, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.name === 'backups' ||
        entry.name === 'sqlite-migration-journal.json' ||
        entry.name === 'veritas.db' ||
        entry.name === 'veritas.db-shm' ||
        entry.name === 'veritas.db-wal'
      ) {
        continue;
      }

      const source = path.join(runtimeDir, entry.name);
      const target = path.join(targetDir, entry.name);
      await this.copyBackupSource(source, target, included, warnings);
    }
  }

  private async copyBackupSource(
    source: string,
    target: string,
    included: string[],
    warnings: SqlitePortabilityWarning[]
  ): Promise<void> {
    if (!(await this.exists(source))) {
      return;
    }

    try {
      await fs.cp(source, target, { recursive: true });
      included.push(source);
    } catch (error) {
      warnings.push({
        entity: 'backup',
        source,
        message: error instanceof Error ? error.message : 'Failed to copy backup source',
      });
    }
  }

  private async promoteTempDatabase(tempSqlitePath: string, sqlitePath: string): Promise<void> {
    await fs.rename(tempSqlitePath, sqlitePath);
    await this.cleanupTempDatabase(tempSqlitePath);
  }

  private async cleanupTempDatabase(tempSqlitePath: string): Promise<void> {
    await fs.rm(tempSqlitePath, { force: true }).catch(() => {});
    await fs.rm(`${tempSqlitePath}-wal`, { force: true }).catch(() => {});
    await fs.rm(`${tempSqlitePath}-shm`, { force: true }).catch(() => {});
  }

  private resolveMigrationJournalPath(paths: LegacyPaths, journalPath?: string): string {
    return path.resolve(
      journalPath ?? path.join(paths.runtimeDir, 'sqlite-migration-journal.json')
    );
  }

  private createMigrationJournal(input: {
    startedAt: string;
    sourceRoot: string;
    sqlitePath: string;
    journalPath?: string;
    counts: SqlitePortabilityEntityCount[];
    warnings: SqlitePortabilityWarning[];
  }): SqliteMigrationJournal {
    const recovery = this.buildRecoveryPlan({
      status: 'running',
      sourceRoot: input.sourceRoot,
      sqlitePath: input.sqlitePath,
      journalPath: input.journalPath,
      failureStage: 'scan-source',
    });

    return {
      formatVersion: 1,
      operation: 'file-to-sqlite',
      status: 'running',
      startedAt: input.startedAt,
      updatedAt: input.startedAt,
      sourceRoot: input.sourceRoot,
      sqlitePath: input.sqlitePath,
      currentStage: 'scan-source',
      completedStages: [],
      counts: input.counts,
      warnings: input.warnings,
      recovery,
    };
  }

  private async writeMigrationJournal(
    journalPath: string,
    journal: SqliteMigrationJournal,
    completedStage: SqliteMigrationStage,
    options: { completeStage?: boolean } = {}
  ): Promise<SqliteMigrationJournal> {
    const nextCompleted = new Set(journal.completedStages);
    if (completedStage !== 'failed' && options.completeStage !== false) {
      nextCompleted.add(completedStage);
    }

    const nextJournal: SqliteMigrationJournal = {
      ...journal,
      updatedAt: new Date().toISOString(),
      currentStage: completedStage,
      completedStages: Array.from(nextCompleted),
      recovery: this.buildRecoveryPlan({
        status: journal.status,
        sourceRoot: journal.sourceRoot,
        sqlitePath: journal.sqlitePath,
        backupPath: journal.backupPath,
        journalPath,
        failureStage: completedStage,
      }),
    };

    await this.writeJson(journalPath, nextJournal);
    return nextJournal;
  }

  private async completeMigrationJournal(
    journalPath: string,
    journal: SqliteMigrationJournal,
    report: SqlitePortabilityReport
  ): Promise<void> {
    const completed: SqliteMigrationJournal = {
      ...journal,
      status: 'completed',
      updatedAt: report.completedAt,
      backupPath: report.backupPath,
      tempSqlitePath: undefined,
      currentStage: 'completed',
      completedStages: Array.from(new Set([...journal.completedStages, 'completed'])),
      counts: report.counts,
      warnings: report.warnings,
      failure: undefined,
      recovery: this.buildRecoveryPlan({
        status: 'completed',
        sourceRoot: journal.sourceRoot,
        sqlitePath: journal.sqlitePath,
        backupPath: report.backupPath,
        journalPath,
        failureStage: 'completed',
      }),
    };

    await this.writeJson(journalPath, completed);
  }

  private async failMigrationJournal(
    journalPath: string,
    journal: SqliteMigrationJournal,
    error: unknown
  ): Promise<void> {
    const failure = {
      stage: journal.currentStage,
      name: error instanceof Error ? error.name : 'Error',
      message: error instanceof Error ? error.message : String(error),
    };
    const failed: SqliteMigrationJournal = {
      ...journal,
      status: 'failed',
      updatedAt: new Date().toISOString(),
      currentStage: 'failed',
      completedStages: Array.from(new Set([...journal.completedStages, 'failed'])),
      failure,
      recovery: this.buildRecoveryPlan({
        status: 'failed',
        sourceRoot: journal.sourceRoot,
        sqlitePath: journal.sqlitePath,
        backupPath: journal.backupPath,
        tempSqlitePath: journal.tempSqlitePath,
        journalPath,
        failureStage: failure.stage,
      }),
    };

    await this.writeJson(journalPath, failed);
  }

  private buildRecoveryPlan(input: {
    status: SqliteMigrationJournal['status'];
    sourceRoot: string;
    sqlitePath?: string;
    backupPath?: string;
    tempSqlitePath?: string;
    journalPath?: string;
    failureStage: SqliteMigrationStage;
  }): SqliteMigrationJournal['recovery'] {
    if (input.status === 'completed') {
      return {
        safeMode: 'normal',
        nextActions: [
          'Continue with SQLite storage after verifying the migrated database.',
          'Keep the pre-migration backup until the v5 upgrade is accepted.',
        ],
        preserveArtifacts: [input.backupPath, input.sqlitePath].filter(
          (artifact): artifact is string => Boolean(artifact)
        ),
      };
    }

    if (input.status === 'restored') {
      return {
        safeMode: 'file-readonly',
        nextActions: [
          'Boot with file storage and verify the restored project before retrying migration.',
          'Preserve the failed SQLite database and migration journal for support review.',
        ],
        preserveArtifacts: [input.backupPath, input.sqlitePath, input.tempSqlitePath].filter(
          (artifact): artifact is string => Boolean(artifact)
        ),
      };
    }

    return {
      safeMode: 'file-readonly',
      nextActions: [
        'Boot with file storage in read-only recovery mode.',
        input.backupPath
          ? 'Offer restore from the pre-migration backup or export the failed SQLite artifacts.'
          : 'Create a manual file-system backup before retrying migration.',
        'Retry migration only after preserving the failed journal and target database.',
      ],
      preserveArtifacts: [
        input.backupPath,
        input.sqlitePath,
        input.tempSqlitePath,
        input.journalPath ??
          path.join(input.sourceRoot, '.veritas-kanban', 'sqlite-migration-journal.json'),
      ].filter((artifact): artifact is string => Boolean(artifact)),
    };
  }

  private async readBackupManifest(backupPath: string): Promise<{ sourceRoot: string }> {
    const manifestPath = path.join(backupPath, 'backup-manifest.json');
    if (!(await this.exists(manifestPath))) {
      throw new Error(`Pre-migration backup manifest not found: ${manifestPath}`);
    }

    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8')) as {
      sourceRoot?: unknown;
    };
    if (typeof manifest.sourceRoot !== 'string' || !manifest.sourceRoot.trim()) {
      throw new Error(`Pre-migration backup manifest is missing sourceRoot: ${manifestPath}`);
    }

    return { sourceRoot: manifest.sourceRoot };
  }

  private async assertRestoreTargetIsClear(target: string): Promise<void> {
    if (!(await this.exists(target))) {
      return;
    }

    const entries = await fs.readdir(target);
    if (entries.length > 0) {
      throw new Error(
        `Restore target is not empty: ${target}. Rerun with replaceExisting=true to overwrite.`
      );
    }
  }

  private async countRecursiveFiles(root: string): Promise<number> {
    if (!(await this.exists(root))) {
      return 0;
    }

    const entries = await fs.readdir(root, { withFileTypes: true });
    let count = 0;
    for (const entry of entries) {
      const fullPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        count += await this.countRecursiveFiles(fullPath);
      } else if (entry.isFile()) {
        count++;
      }
    }

    return count;
  }

  private async canOpenSqlite(sqlitePath: string): Promise<boolean> {
    if (!(await this.exists(sqlitePath))) {
      return false;
    }

    const database = new SqliteDatabase({ databasePath: sqlitePath, applyMigrations: false });
    try {
      database.open();
      return true;
    } catch {
      return false;
    } finally {
      database.close();
    }
  }

  private async validateTaskMigrationInputs(
    paths: LegacyPaths,
    tasks: ParsedTaskSet,
    warnings: SqlitePortabilityWarning[]
  ): Promise<void> {
    const seen = new Map<string, SqlitePortabilityEntity>();
    const groups: Array<{
      entity: Extract<SqlitePortabilityEntity, `tasks.${string}`>;
      tasks: Task[];
    }> = [
      { entity: 'tasks.active', tasks: tasks.active },
      { entity: 'tasks.archived', tasks: tasks.archived },
      { entity: 'tasks.backlog', tasks: tasks.backlog },
    ];

    for (const group of groups) {
      for (const task of group.tasks) {
        const previousEntity = seen.get(task.id);
        if (previousEntity) {
          warnings.push({
            entity: group.entity,
            source: task.id,
            message: `Duplicate task id already seen in ${previousEntity}`,
          });
        } else {
          seen.set(task.id, group.entity);
        }

        await this.validateTaskAttachments(paths.sourceRoot, group.entity, task, warnings);
      }
    }
  }

  private async validateTaskAttachments(
    sourceRoot: string,
    entity: Extract<SqlitePortabilityEntity, `tasks.${string}`>,
    task: Task,
    warnings: SqlitePortabilityWarning[]
  ): Promise<void> {
    for (const attachment of task.attachments ?? []) {
      const storagePath =
        typeof attachment.storagePath === 'string' && attachment.storagePath.trim()
          ? attachment.storagePath
          : path.join('tasks', 'attachments', task.id, attachment.filename);
      const attachmentPath = path.isAbsolute(storagePath)
        ? storagePath
        : path.join(sourceRoot, storagePath);

      if (!(await this.exists(attachmentPath))) {
        warnings.push({
          entity,
          source: attachmentPath,
          message: `Attachment file not found for task ${task.id}: ${attachment.filename}`,
        });
      }
    }
  }

  private async readTasks(
    dir: string,
    entity: Extract<SqlitePortabilityEntity, `tasks.${string}`>,
    warnings: SqlitePortabilityWarning[]
  ): Promise<Task[]> {
    const files = await this.listFiles(dir, (file) => file.endsWith('.md'));
    const tasks: Task[] = [];

    for (const file of files) {
      const fullPath = path.join(dir, file);
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        const task = this.parseTaskMarkdown(content, file);
        if (!task) {
          warnings.push({ entity, source: fullPath, message: 'Skipped malformed task markdown' });
          continue;
        }
        tasks.push(task);
      } catch (error) {
        warnings.push({
          entity,
          source: fullPath,
          message: error instanceof Error ? error.message : 'Failed to read task file',
        });
      }
    }

    return tasks;
  }

  private parseTaskMarkdown(content: string, filename: string): Task | null {
    const { data, content: markdown } = matter(content);
    const id = typeof data.id === 'string' && data.id.trim() ? data.id : filename.split('-')[0];

    if (!TASK_ID_REGEX.test(id)) {
      return null;
    }

    const reviewSection = markdown.indexOf('## Review Comments');
    const description = reviewSection === -1 ? markdown : markdown.slice(0, reviewSection);

    return {
      id,
      title: typeof data.title === 'string' && data.title.trim() ? data.title : 'Untitled',
      description: description.trim(),
      type: typeof data.type === 'string' ? data.type : 'code',
      status: typeof data.status === 'string' ? (data.status as Task['status']) : 'todo',
      priority: typeof data.priority === 'string' ? (data.priority as Task['priority']) : 'medium',
      project: data.project,
      sprint: data.sprint,
      agent: data.agent,
      agents: data.agents,
      created: typeof data.created === 'string' ? data.created : new Date().toISOString(),
      updated: typeof data.updated === 'string' ? data.updated : new Date().toISOString(),
      git: data.git,
      github: data.github,
      attempt: data.attempt,
      attempts: data.attempts,
      reviewComments: data.reviewComments ?? [],
      reviewScores: data.reviewScores,
      review: data.review,
      subtasks: data.subtasks,
      autoCompleteOnSubtasks: data.autoCompleteOnSubtasks,
      verificationSteps: data.verificationSteps,
      dependencies: data.dependencies,
      blockedBy: data.blockedBy,
      blockedReason: data.blockedReason,
      timeTracking: data.timeTracking,
      comments: data.comments,
      observations: data.observations,
      attachments: data.attachments,
      deliverables: data.deliverables,
      position: data.position,
      costPrediction: data.costPrediction,
      actualCost: data.actualCost,
      lessonsLearned: data.lessonsLearned,
      lessonTags: data.lessonTags,
      checkpoint: data.checkpoint,
      runMode: data.runMode,
      qaGate: data.qaGate,
    };
  }

  private async readMatterDirectory<T>(
    dir: string,
    entity: SqlitePortabilityEntity,
    warnings: SqlitePortabilityWarning[]
  ): Promise<T[]> {
    const files = await this.listFiles(dir, (file) => file.endsWith('.md'));
    const records: T[] = [];

    for (const file of files) {
      const fullPath = path.join(dir, file);
      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        records.push(matter(content).data as T);
      } catch (error) {
        warnings.push({
          entity,
          source: fullPath,
          message: error instanceof Error ? error.message : 'Failed to parse markdown frontmatter',
        });
      }
    }

    return records;
  }

  private async readJsonDirectory<T>(
    dir: string,
    entity: SqlitePortabilityEntity,
    warnings: SqlitePortabilityWarning[]
  ): Promise<T[]> {
    const files = await this.listFiles(dir, (file) => file.endsWith('.json'));
    const records: T[] = [];

    for (const file of files) {
      const fullPath = path.join(dir, file);
      const record = await this.readJsonFile<T>(fullPath, entity, warnings);
      if (record) {
        records.push(record);
      }
    }

    return records;
  }

  private async readJsonFile<T>(
    file: string,
    entity: SqlitePortabilityEntity,
    warnings: SqlitePortabilityWarning[]
  ): Promise<T | null> {
    if (!(await this.exists(file))) {
      return null;
    }

    try {
      return JSON.parse(await fs.readFile(file, 'utf-8')) as T;
    } catch (error) {
      warnings.push({
        entity,
        source: file,
        message: error instanceof Error ? error.message : 'Failed to parse JSON',
      });
      return null;
    }
  }

  private async readTelemetry(
    telemetryDir: string,
    warnings: SqlitePortabilityWarning[]
  ): Promise<AnyTelemetryEvent[]> {
    const files = await this.listFiles(telemetryDir, (file) =>
      /^events-\d{4}-\d{2}-\d{2}\.ndjson(\.gz)?$/.test(file)
    );
    const events: AnyTelemetryEvent[] = [];

    for (const file of files) {
      const fullPath = path.join(telemetryDir, file);
      try {
        await this.readNdjson(fullPath, (line, lineNumber) => {
          try {
            events.push(JSON.parse(line) as AnyTelemetryEvent);
          } catch (error) {
            warnings.push({
              entity: 'telemetry',
              source: `${fullPath}:${lineNumber}`,
              message: error instanceof Error ? error.message : 'Malformed telemetry event',
            });
          }
        });
      } catch (error) {
        warnings.push({
          entity: 'telemetry',
          source: fullPath,
          message: error instanceof Error ? error.message : 'Failed to read telemetry file',
        });
      }
    }

    return events;
  }

  private async readWorkflows(
    workflowsDir: string,
    warnings: SqlitePortabilityWarning[]
  ): Promise<WorkflowDefinition[]> {
    try {
      return await new WorkflowService({ workflowsDir, storageType: 'file' }).listWorkflows();
    } catch (error) {
      warnings.push({
        entity: 'workflows',
        source: workflowsDir,
        message: error instanceof Error ? error.message : 'Failed to read workflows',
      });
      return [];
    }
  }

  private async readWorkflowRuns(
    runsDir: string,
    workflowsDir: string,
    warnings: SqlitePortabilityWarning[]
  ): Promise<WorkflowRun[]> {
    try {
      const workflowService = new WorkflowService({ workflowsDir, storageType: 'file' });
      return await new WorkflowRunService({
        runsDir,
        workflowService,
        storageType: 'file',
      }).listRuns();
    } catch (error) {
      warnings.push({
        entity: 'workflowRuns',
        source: runsDir,
        message: error instanceof Error ? error.message : 'Failed to read workflow runs',
      });
      return [];
    }
  }

  private async readChats(
    chatsDir: string,
    tasks: ParsedTaskSet,
    warnings: SqlitePortabilityWarning[]
  ): Promise<{ chatSessions: ChatSession[]; squadMessages: SquadMessage[] }> {
    try {
      const service = new ChatService({ chatsDir, storageType: 'file' });
      const sessions = await service.listSessions();
      const allTasks = [...tasks.active, ...tasks.archived, ...tasks.backlog];

      for (const task of allTasks) {
        const session = await service.getSessionForTask(task.id);
        if (session) {
          sessions.push(session);
        }
      }

      return {
        chatSessions: sessions,
        squadMessages: await service.getSquadMessages({ includeSystem: true }),
      };
    } catch (error) {
      warnings.push({
        entity: 'chatSessions',
        source: chatsDir,
        message: error instanceof Error ? error.message : 'Failed to read chats',
      });
      return { chatSessions: [], squadMessages: [] };
    }
  }

  private writeTaskTemplates(database: SqliteDatabase, templates: TaskTemplate[]): void {
    const db = database.getConnection();
    const statement = db.prepare(
      `
        INSERT INTO task_templates (id, name, category, template_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          category = excluded.category,
          template_json = excluded.template_json,
          updated_at = excluded.updated_at
      `
    );

    for (const template of templates.map((template) => this.normalizeTaskTemplate(template))) {
      statement.run(
        template.id,
        template.name,
        template.category ?? null,
        JSON.stringify(template),
        template.created,
        template.updated
      );
    }
  }

  private normalizeTaskTemplate(template: TaskTemplate): TaskTemplate {
    if (template.version === 1) {
      return template;
    }

    return {
      id: template.id,
      name: template.name,
      description: template.description,
      version: 1,
      taskDefaults: {
        type: template.taskDefaults?.type,
        priority: template.taskDefaults?.priority,
        project: template.taskDefaults?.project,
        descriptionTemplate: template.taskDefaults?.descriptionTemplate,
      },
      created: template.created,
      updated: template.updated,
    };
  }

  private writePromptRegistry(
    database: SqliteDatabase,
    templates: PromptTemplate[],
    versions: PromptVersion[],
    usage: PromptUsage[]
  ): void {
    const db = database.getConnection();
    const now = new Date().toISOString();

    const templateStatement = db.prepare(
      `
        INSERT INTO prompt_templates (
          id, name, category, current_version_id, template_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          category = excluded.category,
          current_version_id = excluded.current_version_id,
          template_json = excluded.template_json,
          updated_at = excluded.updated_at
      `
    );
    const versionStatement = db.prepare(
      `
        INSERT OR REPLACE INTO prompt_versions (
          id, template_id, version_number, version_json, created_at
        )
        VALUES (?, ?, ?, ?, ?)
      `
    );
    const usageStatement = db.prepare(
      `
        INSERT OR REPLACE INTO prompt_usage (id, template_id, used_at, used_by, model, usage_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `
    );

    for (const template of templates) {
      templateStatement.run(
        template.id,
        template.name,
        template.category ?? 'general',
        template.currentVersionId,
        JSON.stringify(template),
        template.created ?? now,
        template.updated ?? now
      );
    }

    for (const version of versions) {
      versionStatement.run(
        version.id,
        version.templateId,
        version.versionNumber,
        JSON.stringify(version),
        version.createdAt ?? now
      );
    }

    for (const record of usage) {
      usageStatement.run(
        record.id,
        record.templateId,
        record.usedAt ?? now,
        record.usedBy ?? null,
        record.model ?? null,
        JSON.stringify(record)
      );
    }
  }

  private writeActivities(database: SqliteDatabase, activities: Activity[]): void {
    const statement = database.getConnection().prepare(
      `
        INSERT OR REPLACE INTO activity_events (
          id, workspace_id, type, task_id, task_title, agent, details_json, activity_json, created_at
        )
        VALUES (?, 'local', ?, ?, ?, ?, ?, ?, ?)
      `
    );

    for (const activity of activities) {
      statement.run(
        activity.id,
        activity.type,
        activity.taskId,
        activity.taskTitle,
        activity.agent ?? null,
        activity.details ? JSON.stringify(activity.details) : null,
        JSON.stringify(activity),
        activity.timestamp
      );
    }
  }

  private writeStatusHistory(database: SqliteDatabase, entries: StatusHistoryEntry[]): void {
    const statement = database.getConnection().prepare(
      `
        INSERT OR REPLACE INTO status_history (
          id,
          workspace_id,
          previous_status,
          new_status,
          task_id,
          task_title,
          sub_agent_count,
          duration_ms,
          entry_json,
          created_at
        )
        VALUES (?, 'local', ?, ?, ?, ?, ?, ?, ?, ?)
      `
    );

    for (const entry of entries) {
      statement.run(
        entry.id,
        entry.previousStatus,
        entry.newStatus,
        entry.taskId ?? null,
        entry.taskTitle ?? null,
        entry.subAgentCount ?? null,
        entry.durationMs ?? null,
        JSON.stringify(entry),
        entry.timestamp
      );
    }
  }

  private writeTelemetry(database: SqliteDatabase, events: AnyTelemetryEvent[]): void {
    const statement = database.getConnection().prepare(
      `
        INSERT OR REPLACE INTO telemetry_events (
          id,
          workspace_id,
          type,
          task_id,
          project_id,
          agent,
          model,
          attempt_id,
          success,
          duration_ms,
          exit_code,
          input_tokens,
          output_tokens,
          cache_tokens,
          total_tokens,
          cost,
          error,
          stack_trace,
          session_key,
          payload_json,
          created_at
        )
        VALUES (?, 'local', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    );

    for (const event of events) {
      const fields = event as unknown as Record<string, unknown>;
      statement.run(
        event.id,
        event.type,
        event.taskId ?? null,
        event.project ?? null,
        this.optionalString(fields.agent),
        this.optionalString(fields.model),
        this.optionalString(fields.attemptId),
        typeof fields.success === 'boolean' ? (fields.success ? 1 : 0) : null,
        this.optionalNumber(fields.durationMs),
        this.optionalNumber(fields.exitCode),
        this.optionalNumber(fields.inputTokens),
        this.optionalNumber(fields.outputTokens),
        this.optionalNumber(fields.cacheTokens),
        this.optionalNumber(fields.totalTokens),
        this.optionalNumber(fields.cost),
        this.optionalString(fields.error),
        this.optionalString(fields.stackTrace),
        this.optionalString(fields.sessionKey),
        JSON.stringify(event),
        event.timestamp
      );
    }
  }

  private writeWorkflows(database: SqliteDatabase, workflows: WorkflowDefinition[]): void {
    const repository = new SqliteWorkflowDefinitionRepository(database);
    for (const workflow of workflows) {
      repository.save(workflow);
    }
  }

  private writeWorkflowRuns(database: SqliteDatabase, runs: WorkflowRun[]): void {
    const statement = database.getConnection().prepare(
      `
        INSERT OR REPLACE INTO workflow_runs (
          id,
          workspace_id,
          workflow_id,
          workflow_version,
          task_id,
          status,
          current_step,
          run_json,
          started_at,
          completed_at,
          last_checkpoint,
          error
        )
        VALUES (?, 'local', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    );

    for (const run of runs) {
      statement.run(
        run.id,
        run.workflowId,
        run.workflowVersion,
        run.taskId ?? null,
        run.status,
        run.currentStep ?? null,
        JSON.stringify(run),
        run.startedAt,
        run.completedAt ?? null,
        run.lastCheckpoint ?? null,
        run.error ?? null
      );
    }
  }

  private writeChatSessions(database: SqliteDatabase, sessions: ChatSession[]): void {
    const repository = new SqliteChatRepository(database);
    const seen = new Set<string>();
    for (const session of sessions) {
      if (seen.has(session.id)) continue;
      seen.add(session.id);
      repository.saveSession(session);
    }
  }

  private writeSquadMessages(database: SqliteDatabase, messages: SquadMessage[]): void {
    const statement = database.getConnection().prepare(
      `
        INSERT OR REPLACE INTO squad_messages (
          id,
          workspace_id,
          agent,
          display_name,
          message,
          tags_json,
          timestamp,
          model,
          is_system,
          event,
          task_title,
          duration,
          card_json,
          message_json
        )
        VALUES (?, 'local', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    );

    for (const message of messages) {
      statement.run(
        message.id,
        message.agent,
        message.displayName ?? null,
        message.message,
        message.tags ? JSON.stringify(message.tags) : null,
        message.timestamp,
        message.model ?? null,
        message.system ? 1 : 0,
        message.event ?? null,
        message.taskTitle ?? null,
        message.duration ?? null,
        message.card ? JSON.stringify(message.card) : null,
        JSON.stringify(message)
      );
    }
  }

  private readSqliteSnapshots(
    database: SqliteDatabase,
    warnings: SqlitePortabilityWarning[],
    workspaceId?: string
  ): TableSnapshot[] {
    const snapshots: TableSnapshot[] = [];

    for (const table of SQLITE_BACKUP_TABLES) {
      if (!this.tableExists(database, table)) {
        warnings.push({
          entity: `table.${table}`,
          message: 'Table not present in source database',
        });
        continue;
      }

      const query = this.buildSnapshotQuery(database, table, workspaceId);
      const rows = database
        .getConnection()
        .prepare(query.sql)
        .all(...query.params) as unknown as Record<string, unknown>[];
      snapshots.push({ table, rows });
    }

    return snapshots;
  }

  private buildSnapshotQuery(
    database: SqliteDatabase,
    table: SqliteBackupTable,
    workspaceId?: string
  ): { sql: string; params: SQLInputValue[] } {
    const tableName = this.quoteIdentifier(table);

    if (!workspaceId) {
      return { sql: `SELECT * FROM ${tableName}`, params: [] };
    }

    if (table === 'workspaces') {
      return { sql: `SELECT * FROM ${tableName} WHERE id = ?`, params: [workspaceId] };
    }

    if (table === 'users') {
      return {
        sql: `
          SELECT *
          FROM ${tableName}
          WHERE id IN (
            SELECT user_id
            FROM workspace_memberships
            WHERE workspace_id = ?
          )
        `,
        params: [workspaceId],
      };
    }

    if (this.tableHasColumn(database, table, 'workspace_id')) {
      return {
        sql: `SELECT * FROM ${tableName} WHERE workspace_id = ?`,
        params: [workspaceId],
      };
    }

    return { sql: `SELECT * FROM ${tableName} WHERE 1 = 0`, params: [] };
  }

  private async readBundleSnapshots(
    dataDir: string,
    warnings: SqlitePortabilityWarning[]
  ): Promise<TableSnapshot[]> {
    const snapshots: TableSnapshot[] = [];

    for (const table of SQLITE_BACKUP_TABLES) {
      const file = path.join(dataDir, `${table}.json`);
      if (!(await this.exists(file))) {
        warnings.push({
          entity: `table.${table}`,
          source: file,
          message: 'Backup table file missing',
        });
        continue;
      }

      const rows = await this.readJsonFile<Record<string, unknown>[]>(
        file,
        `table.${table}`,
        warnings
      );
      snapshots.push({ table, rows: Array.isArray(rows) ? rows : [] });
    }

    return snapshots;
  }

  private assertImportTargetIsEmpty(
    database: SqliteDatabase,
    warnings: SqlitePortabilityWarning[]
  ): void {
    for (const table of SQLITE_BACKUP_TABLES) {
      if (!this.tableExists(database, table)) continue;
      if (table === 'workspaces' || table === 'users' || table === 'workspace_memberships') {
        continue;
      }
      const row = database
        .getConnection()
        .prepare(`SELECT COUNT(*) AS count FROM ${this.quoteIdentifier(table)}`)
        .get() as { count: number } | undefined;

      if ((row?.count ?? 0) > 0) {
        warnings.push({
          entity: `table.${table}`,
          message: 'Target table already has rows; rerun with replaceExisting=true to overwrite',
        });
        throw new Error(`SQLite import target is not empty: ${table}`);
      }
    }
  }

  private insertRows(
    database: SqliteDatabase,
    table: SqliteBackupTable,
    rows: Record<string, unknown>[],
    replace: boolean
  ): void {
    if (rows.length === 0) return;

    const db = database.getConnection();
    const tableName = this.quoteIdentifier(table);
    const columns = Object.keys(rows[0]);
    const columnSql = columns.map((column) => this.quoteIdentifier(column)).join(', ');
    const placeholderSql = columns.map(() => '?').join(', ');
    const command = replace ? 'INSERT OR REPLACE' : 'INSERT';
    const statement = db.prepare(
      `${command} INTO ${tableName} (${columnSql}) VALUES (${placeholderSql})`
    );

    for (const row of rows) {
      statement.run(...columns.map((column) => this.toSqlValue(row[column])));
    }
  }

  private rebuildSearchIndexes(database: SqliteDatabase): void {
    const db = database.getConnection();
    if (this.tableExists(database, 'task_search')) {
      db.prepare('DELETE FROM task_search').run();
      const tasks = db
        .prepare(
          `
            SELECT id, title, description
            FROM tasks
            WHERE storage_state = 'active'
              AND deleted_at IS NULL
          `
        )
        .all() as unknown as Array<{ id: string; title: string; description: string }>;

      const insertTaskSearch = db.prepare(
        'INSERT INTO task_search (task_id, title, description) VALUES (?, ?, ?)'
      );
      for (const task of tasks) {
        insertTaskSearch.run(task.id, task.title, task.description ?? '');
      }
    }

    if (this.tableExists(database, 'work_product_search')) {
      db.prepare('DELETE FROM work_product_search').run();
      const products = db
        .prepare(
          `
            SELECT id, title, render_json
            FROM work_products
            WHERE status = 'active'
              AND deleted_at IS NULL
          `
        )
        .all() as unknown as Array<{ id: string; title: string; render_json: string }>;

      const insertWorkProductSearch = db.prepare(
        'INSERT INTO work_product_search (product_id, title, body) VALUES (?, ?, ?)'
      );
      for (const product of products) {
        insertWorkProductSearch.run(
          product.id,
          product.title,
          this.renderToSearchText(JSON.parse(product.render_json) as WorkProductRender)
        );
      }
    }
  }

  private async writeHumanReadableBundle(
    database: SqliteDatabase,
    bundleDir: string,
    warnings: SqlitePortabilityWarning[],
    workspaceId?: string
  ): Promise<void> {
    const taskQuery = workspaceId
      ? {
          sql: 'SELECT storage_state, task_json FROM tasks WHERE workspace_id = ? ORDER BY updated_at DESC',
          params: [workspaceId],
        }
      : {
          sql: 'SELECT storage_state, task_json FROM tasks ORDER BY updated_at DESC',
          params: [],
        };
    const tasks = database
      .getConnection()
      .prepare(taskQuery.sql)
      .all(...taskQuery.params) as unknown as Array<{ storage_state: string; task_json: string }>;

    for (const row of tasks) {
      try {
        const task = JSON.parse(row.task_json) as Task;
        const stateDir = row.storage_state === 'archived' ? 'archive' : row.storage_state;
        const dir = path.join(bundleDir, 'tasks', stateDir);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(
          path.join(dir, `${task.id}-${this.slugify(task.title)}.md`),
          this.taskToMarkdown(task)
        );
      } catch (error) {
        warnings.push({
          entity: 'tasks.active',
          message: error instanceof Error ? error.message : 'Failed to write task markdown export',
        });
      }
    }

    const configRow = workspaceId
      ? undefined
      : (database
          .getConnection()
          .prepare("SELECT document_json FROM app_config_documents WHERE key = 'app_config'")
          .get() as { document_json: string } | undefined);
    if (configRow) {
      await this.writeJson(
        path.join(bundleDir, 'settings', 'config.json'),
        JSON.parse(configRow.document_json)
      );
    }

    const workflowQuery = workspaceId
      ? this.tableHasColumn(database, 'workflow_definitions', 'workspace_id')
        ? {
            sql: 'SELECT workflow_json FROM workflow_definitions WHERE workspace_id = ? ORDER BY id ASC',
            params: [workspaceId],
          }
        : null
      : {
          sql: 'SELECT workflow_json FROM workflow_definitions ORDER BY id ASC',
          params: [],
        };
    const workflows = workflowQuery
      ? (database
          .getConnection()
          .prepare(workflowQuery.sql)
          .all(...workflowQuery.params) as unknown as Array<{ workflow_json: string }>)
      : [];
    for (const row of workflows) {
      const workflow = JSON.parse(row.workflow_json) as WorkflowDefinition;
      const dir = path.join(bundleDir, 'workflows');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, `${workflow.id}.yml`), yaml.stringify(workflow), 'utf-8');
    }
  }

  private tableExists(database: SqliteDatabase, table: string): boolean {
    const row = database
      .getConnection()
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?")
      .get(table) as { name: string } | undefined;
    return row !== undefined;
  }

  private tableHasColumn(database: SqliteDatabase, table: string, column: string): boolean {
    const rows = database
      .getConnection()
      .prepare(`PRAGMA table_info(${this.quoteIdentifier(table)})`)
      .all() as unknown as Array<{ name: string }>;
    return rows.some((row) => row.name === column);
  }

  private async readNdjson(
    file: string,
    callback: (line: string, lineNumber: number) => void
  ): Promise<void> {
    const stream = file.endsWith('.gz')
      ? createReadStream(file).pipe(createGunzip())
      : createReadStream(file);
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let lineNumber = 0;

    for await (const rawLine of rl) {
      lineNumber++;
      const line = rawLine.trim();
      if (line) {
        callback(line, lineNumber);
      }
    }
  }

  private taskToMarkdown(task: Task): string {
    const { description, ...frontmatter } = task;
    return matter.stringify(
      description || '',
      this.removeUndefined(frontmatter) as Record<string, unknown>
    );
  }

  private removeUndefined(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.removeUndefined(item));
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, entryValue]) => entryValue !== undefined)
          .map(([key, entryValue]) => [key, this.removeUndefined(entryValue)])
      );
    }
    return value;
  }

  private renderToSearchText(render: WorkProductRender): string {
    switch (render.kind) {
      case 'text':
        return render.text;
      case 'markdown':
        return render.markdown;
      case 'summary':
        return [
          render.summary,
          ...(render.keyPoints ?? []),
          ...(render.sections ?? []).map((section) => `${section.heading}\n${section.body}`),
        ].join('\n');
      case 'checklist':
        return render.items.map((item) => `${item.label}\n${item.notes ?? ''}`).join('\n');
      case 'report':
        return [
          render.summary,
          ...render.sections.map((section) => `${section.heading}\n${section.body}`),
        ].join('\n');
      case 'table':
        return [
          render.columns.map((column) => column.label).join(' '),
          ...render.rows.map((row) => Object.values(row).join(' ')),
        ].join('\n');
      case 'dashboard':
        return render.widgets
          .map((widget) => `${widget.title} ${widget.value ?? ''} ${widget.description ?? ''}`)
          .join('\n');
      default: {
        const _exhaustive: never = render;
        return _exhaustive;
      }
    }
  }

  private quoteIdentifier(identifier: string): string {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
      throw new Error(`Unsafe SQLite identifier: ${identifier}`);
    }
    return `"${identifier}"`;
  }

  private toSqlValue(value: unknown): string | number | bigint | null | Uint8Array {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
      return value;
    }
    if (value instanceof Uint8Array) return value;
    return JSON.stringify(value);
  }

  private optionalString(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
  }

  private optionalNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private hasStringId(
    value: unknown,
    entity: SqlitePortabilityEntity,
    warnings: SqlitePortabilityWarning[]
  ): boolean {
    if (
      value &&
      typeof value === 'object' &&
      typeof (value as Record<string, unknown>).id === 'string'
    ) {
      return true;
    }

    warnings.push({ entity, message: 'Skipped record without string id' });
    return false;
  }

  private async listFiles(dir: string, filter: (file: string) => boolean): Promise<string[]> {
    try {
      return (await fs.readdir(dir)).filter(filter).sort();
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  private async exists(file: string): Promise<boolean> {
    try {
      await fs.access(file);
      return true;
    } catch {
      return false;
    }
  }

  private async writeJson(file: string, value: unknown): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50);
  }
}

let sqlitePortabilityService: SqlitePortabilityService | null = null;

export function getSqlitePortabilityService(): SqlitePortabilityService {
  if (!sqlitePortabilityService) {
    sqlitePortabilityService = new SqlitePortabilityService();
  }
  return sqlitePortabilityService;
}
