import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import type {
  CreatePromptTemplateInput,
  CreateTemplateInput,
  FeatureSettings,
  Task,
} from '@veritas-kanban/shared';
import { ChatService } from '../../services/chat-service.js';
import { TaskService } from '../../services/task-service.js';
import { TelemetryService } from '../../services/telemetry-service.js';
import { WorkflowRunService } from '../../services/workflow-run-service.js';
import { WorkflowService } from '../../services/workflow-service.js';
import {
  FileStorageProvider,
  SqliteDatabase,
  SqliteStorageProvider,
  type FileStorageOptions,
  type StorageProvider,
} from '../../storage/index.js';
import type { WorkflowDefinition, WorkflowRun } from '../../types/workflow.js';

type StorageMode = 'file' | 'sqlite';

interface DualStorageFixture {
  version: number;
  timestamps: {
    created: string;
    updated: string;
    completed: string;
  };
  task: Omit<Task, 'id' | 'created' | 'updated'>;
  settingsPatch: Partial<FeatureSettings>;
  taskTemplate: CreateTemplateInput;
  promptTemplate: CreatePromptTemplateInput;
  workflow: WorkflowDefinition;
  chatMessages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    agent?: string;
    model?: string;
  }>;
}

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/dual-storage-parity/v5-rich-metadata.json'
);

const cleanupTasks: Array<() => Promise<void>> = [];

afterEach(async () => {
  const tasks = cleanupTasks.splice(0);
  await Promise.allSettled(tasks.map((cleanup) => cleanup()));
});

describe('dual-storage parity', () => {
  it('keeps rich task, settings, template, prompt, activity, status, and telemetry data aligned', async () => {
    const fixture = await loadFixture();

    await expectStorageParity((mode) => collectProviderSnapshot(mode, fixture));
  });

  it('keeps archive lifecycle semantics aligned', async () => {
    const fixture = await loadFixture();

    await expectStorageParity((mode) => collectArchiveSnapshot(mode, fixture));
  });

  it('keeps task-scoped chat history aligned', async () => {
    const fixture = await loadFixture();

    await expectStorageParity((mode) => collectChatSnapshot(mode, fixture));
  });

  it('keeps workflow definitions and a completed workflow run aligned', async () => {
    const fixture = await loadFixture();

    await expectStorageParity((mode) => collectWorkflowSnapshot(mode, fixture));
  });
});

async function expectStorageParity<T>(collector: (mode: StorageMode) => Promise<T>) {
  const fileSnapshot = await collector('file');
  const sqliteSnapshot = await collector('sqlite');

  expect(sqliteSnapshot).toEqual(fileSnapshot);
}

async function collectProviderSnapshot(mode: StorageMode, fixture: DualStorageFixture) {
  const harness = await createProviderHarness(mode);

  try {
    const created = await harness.provider.tasks.create({
      id: 'task_v5_parity_seed',
      title: fixture.task.title,
      description: fixture.task.description,
      type: fixture.task.type,
      status: 'todo',
      priority: fixture.task.priority,
      project: fixture.task.project,
      sprint: fixture.task.sprint,
      created: fixture.timestamps.created,
      updated: fixture.timestamps.created,
    });

    await harness.provider.tasks.update(created.id, fixture.task);
    await harness.reopen();

    const task = await harness.provider.tasks.findById(created.id);
    const searchResults = await harness.provider.tasks.search('parity-rich');
    const settings = await harness.provider.settings.update(fixture.settingsPatch);
    const taskTemplate = await harness.provider.templates.createTemplate(fixture.taskTemplate);
    const promptTemplate = await harness.provider.promptRegistry.createTemplate(
      fixture.promptTemplate
    );
    const promptPreview = await harness.provider.promptRegistry.renderPreview({
      templateId: promptTemplate.id,
      sampleVariables: {
        task_title: fixture.task.title,
        project: fixture.task.project ?? '',
      },
    });

    await harness.provider.promptRegistry.recordUsage(
      promptTemplate.id,
      'codex',
      promptPreview.renderedPrompt,
      'gpt-5',
      42,
      24
    );
    const promptUsage = await harness.provider.promptRegistry.getUsageRecords(promptTemplate.id);
    const promptStats = await harness.provider.promptRegistry.getStats(promptTemplate.id);

    const activity = await harness.provider.activities.logActivity(
      'comment_added',
      created.id,
      fixture.task.title,
      { comments: fixture.task.comments?.length ?? 0 },
      'codex'
    );
    const status = await harness.provider.statusHistory.logStatusChange(
      'idle',
      'working',
      created.id,
      fixture.task.title,
      fixture.task.agents?.length
    );
    await harness.provider.telemetry.emit({
      type: 'task.created',
      taskId: created.id,
      project: fixture.task.project,
      status: 'todo',
      timestamp: fixture.timestamps.created,
    });
    await harness.provider.telemetry.emit({
      type: 'run.completed',
      taskId: created.id,
      project: fixture.task.project,
      agent: 'codex',
      success: true,
      durationMs: 1500,
      timestamp: fixture.timestamps.completed,
    });
    const telemetry = (await harness.provider.telemetry.getTaskEvents(created.id)).filter((event) =>
      [fixture.timestamps.created, fixture.timestamps.completed].includes(event.timestamp)
    );

    return {
      task: normalizeTask(task),
      search: searchResults.map((result) => normalizeTask(result)),
      settings: normalizeSettings(settings),
      taskTemplate: normalizeTaskTemplate(taskTemplate),
      promptTemplate: {
        name: promptTemplate.name,
        description: promptTemplate.description,
        category: promptTemplate.category,
        content: promptTemplate.content,
        variables: promptTemplate.variables,
        preview: promptPreview,
        usage: promptUsage.map((usage) => ({
          templateId: '<prompt>',
          usedBy: usage.usedBy,
          renderedPrompt: usage.renderedPrompt,
          model: usage.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        })),
        stats: promptStats
          ? {
              totalUsages: promptStats.totalUsages,
              totalVersions: promptStats.totalVersions,
              lastUsed: Boolean(promptStats.lastUsedAt),
              mostFrequentUser: promptStats.mostFrequentUser,
              averageTokensPerUsage: promptStats.averageTokensPerUsage,
            }
          : null,
      },
      activity: {
        type: activity.type,
        taskId: '<task>',
        taskTitle: activity.taskTitle,
        agent: activity.agent,
        details: activity.details,
      },
      status: {
        previousStatus: status.previousStatus,
        newStatus: status.newStatus,
        taskId: '<task>',
        taskTitle: status.taskTitle,
        subAgentCount: status.subAgentCount,
      },
      telemetry: telemetry
        .map((event) => ({
          type: event.type,
          taskId: '<task>',
          project: event.project,
          timestamp: event.timestamp,
          status: 'status' in event ? event.status : undefined,
          agent: 'agent' in event ? event.agent : undefined,
          success: 'success' in event ? event.success : undefined,
          durationMs: 'durationMs' in event ? event.durationMs : undefined,
        }))
        .sort((a, b) => a.type.localeCompare(b.type)),
    };
  } finally {
    await harness.dispose();
  }
}

async function collectArchiveSnapshot(mode: StorageMode, fixture: DualStorageFixture) {
  const root = await createTempRoot(mode);
  const telemetryService = new TelemetryService({
    telemetryDir: path.join(root, '.veritas-kanban', 'telemetry'),
    config: { enabled: true },
  });
  const taskService = new TaskService({
    tasksDir: path.join(root, 'tasks', 'active'),
    archiveDir: path.join(root, 'tasks', 'archive'),
    telemetryService,
    storageType: mode,
    sqliteConnectionOptions:
      mode === 'sqlite'
        ? { databasePath: path.join(root, '.veritas-kanban', 'archive.db') }
        : undefined,
  });

  try {
    const created = await taskService.createTask({
      title: fixture.task.title,
      description: fixture.task.description,
      type: fixture.task.type,
      priority: fixture.task.priority,
      project: fixture.task.project,
      sprint: fixture.task.sprint,
      agent: fixture.task.agent,
      subtasks: fixture.task.subtasks,
      blockedBy: fixture.task.blockedBy,
    });
    await taskService.updateTask(created.id, fixture.task);

    expect(await taskService.archiveTask(created.id)).toBe(true);

    const activeTask = await taskService.getTask(created.id);
    const archivedTasks = await taskService.listArchivedTasks();
    const archivedTask = await taskService.getArchivedTask(created.id);

    return {
      activeTask,
      archivedTasks: archivedTasks.map((task) => normalizeTask(task)),
      archivedTask: normalizeTask(archivedTask),
    };
  } finally {
    taskService.dispose();
    telemetryService.dispose();
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  }
}

async function collectChatSnapshot(mode: StorageMode, fixture: DualStorageFixture) {
  const root = await createTempRoot(mode);
  const sqliteDatabase = createOptionalSqlite(mode, root, 'chat.db');
  const service = new ChatService({
    chatsDir: path.join(root, '.veritas-kanban', 'chats'),
    storageType: mode,
    sqliteDatabase,
  });

  try {
    const session = await service.createSession({
      taskId: 'task_v5_parity_chat',
      agent: 'codex',
      mode: 'build',
    });

    for (const message of fixture.chatMessages) {
      await service.addMessage(session.id, message);
    }

    const fetched = await service.getSessionForTask('task_v5_parity_chat');
    const listed = await service.listSessions();

    return {
      session: normalizeChatSession(fetched),
      listed: listed.map(normalizeChatSession),
    };
  } finally {
    service.dispose();
    sqliteDatabase?.close();
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  }
}

async function collectWorkflowSnapshot(mode: StorageMode, fixture: DualStorageFixture) {
  const root = await createTempRoot(mode);
  const sqliteDatabase = createOptionalSqlite(mode, root, 'workflow.db');
  const workflowService = new WorkflowService({
    workflowsDir: path.join(root, '.veritas-kanban', 'workflows'),
    storageType: mode,
    sqliteDatabase,
  });
  const runService = new WorkflowRunService({
    runsDir: path.join(root, '.veritas-kanban', 'workflow-runs'),
    workflowService,
    storageType: mode,
    sqliteDatabase,
  });

  try {
    await workflowService.saveWorkflow(fixture.workflow);
    const started = await runService.startRun(fixture.workflow.id, undefined, {
      fixtureVersion: fixture.version,
    });
    const completed = await waitForRun(runService, started.id);
    const workflows = await workflowService.listWorkflowsMetadata();
    const runs = await runService.listRunsMetadata({ workflowId: fixture.workflow.id });

    return {
      workflows,
      run: normalizeWorkflowRun(completed),
      runs: runs.map((run) => ({
        workflowId: run.workflowId,
        workflowVersion: run.workflowVersion,
        taskId: run.taskId,
        status: run.status,
        error: run.error,
      })),
    };
  } finally {
    runService.dispose();
    workflowService.dispose();
    sqliteDatabase?.close();
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  }
}

async function waitForRun(service: WorkflowRunService, runId: string): Promise<WorkflowRun> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const run = await service.getRun(runId);
    if (run && run.status !== 'running') {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error(`Workflow run ${runId} did not finish`);
}

function normalizeWorkflowRun(run: WorkflowRun) {
  return {
    workflowId: run.workflowId,
    workflowVersion: run.workflowVersion,
    status: run.status,
    currentStep: run.currentStep,
    context: {
      ready: run.context.ready,
      fixtureVersion: run.context.fixtureVersion,
    },
    steps: run.steps.map((step) => ({
      stepId: step.stepId,
      status: step.status,
      retries: step.retries,
      hasOutput: Boolean(step.output),
      error: step.error,
    })),
    error: run.error,
  };
}

function normalizeChatSession(session: Awaited<ReturnType<ChatService['getSessionForTask']>>) {
  if (!session) {
    return null;
  }

  return {
    id: session.taskId ? 'task_<task>' : '<session>',
    taskId: session.taskId ? '<task>' : undefined,
    title: session.taskId ? 'Task <task>' : session.title,
    agent: session.agent,
    model: session.model,
    mode: session.mode,
    messages: session.messages.map((message) => ({
      role: message.role,
      content: message.content,
      agent: message.agent,
      model: message.model,
    })),
  };
}

function normalizeSettings(settings: FeatureSettings) {
  return {
    board: {
      showDashboard: settings.board.showDashboard,
      cardDensity: settings.board.cardDensity,
      showPriorityIndicators: settings.board.showPriorityIndicators,
    },
    tasks: {
      enableDependencies: settings.tasks.enableDependencies,
      enableAttachments: settings.tasks.enableAttachments,
      enableComments: settings.tasks.enableComments,
      defaultPriority: settings.tasks.defaultPriority,
      requireDeliverableForDone: settings.tasks.requireDeliverableForDone,
    },
    telemetry: settings.telemetry,
    enforcement: {
      reviewGate: settings.enforcement.reviewGate,
      closingComments: settings.enforcement.closingComments,
      autoTelemetry: settings.enforcement.autoTelemetry,
      autoTimeTracking: settings.enforcement.autoTimeTracking,
    },
  };
}

function normalizeTaskTemplate(template: Awaited<StorageProvider['templates']['createTemplate']>) {
  return {
    name: template.name,
    description: template.description,
    category: template.category,
    version: template.version,
    taskDefaults: template.taskDefaults,
    subtaskTemplates: template.subtaskTemplates,
    blueprint: template.blueprint,
  };
}

function normalizeTask(task: Task | null) {
  if (!task) {
    return null;
  }

  return {
    title: task.title,
    description: task.description,
    type: task.type,
    status: task.status,
    priority: task.priority,
    project: task.project,
    sprint: task.sprint,
    agent: task.agent,
    agents: task.agents,
    git: normalizeGit(task.git),
    github: task.github,
    attempt: task.attempt,
    attempts: task.attempts,
    reviewScores: task.reviewScores,
    review: task.review,
    subtasks: task.subtasks,
    autoCompleteOnSubtasks: task.autoCompleteOnSubtasks,
    verificationSteps: task.verificationSteps,
    dependencies: task.dependencies,
    blockedBy: task.blockedBy,
    blockedReason: task.blockedReason,
    automation: task.automation,
    timeTracking: task.timeTracking,
    comments: task.comments,
    observations: task.observations,
    attachments: task.attachments,
    deliverables: task.deliverables,
    position: task.position,
    costPrediction: task.costPrediction,
    actualCost: task.actualCost,
    lessonsLearned: task.lessonsLearned,
    lessonTags: task.lessonTags,
    checkpoint: task.checkpoint,
    runMode: task.runMode,
    qaGate: task.qaGate,
  };
}

function normalizeGit(git: Task['git']) {
  if (!git) {
    return undefined;
  }

  return {
    ...git,
    worktreePath: '<worktree>',
  };
}

async function createProviderHarness(mode: StorageMode) {
  const root = await createTempRoot(mode);
  let provider = await openProvider(mode, root);

  return {
    get provider() {
      return provider;
    },
    async reopen() {
      await provider.shutdown();
      provider = await openProvider(mode, root);
    },
    async dispose() {
      await provider.shutdown().catch(() => {});
      await fs.rm(root, { recursive: true, force: true }).catch(() => {});
    },
  };
}

async function openProvider(mode: StorageMode, root: string): Promise<StorageProvider> {
  const provider =
    mode === 'file'
      ? new FileStorageProvider(fileStorageOptionsFor(root))
      : new SqliteStorageProvider({
          database: {
            databasePath: path.join(root, '.veritas-kanban', 'provider.db'),
          },
        });

  await provider.initialize();
  return provider;
}

function fileStorageOptionsFor(root: string): FileStorageOptions {
  const runtimeDir = path.join(root, '.veritas-kanban');

  return {
    taskServiceOptions: {
      tasksDir: path.join(root, 'tasks', 'active'),
      archiveDir: path.join(root, 'tasks', 'archive'),
    },
    configServiceOptions: {
      configDir: runtimeDir,
      configFile: path.join(runtimeDir, 'config.json'),
    },
    telemetryServiceOptions: {
      telemetryDir: path.join(runtimeDir, 'telemetry'),
      config: { enabled: true },
    },
    activityServiceOptions: {
      activityFile: path.join(runtimeDir, 'activity.json'),
    },
    statusHistoryServiceOptions: {
      historyFile: path.join(runtimeDir, 'status-history.json'),
    },
    templateServiceOptions: {
      templatesDir: path.join(runtimeDir, 'templates'),
    },
    promptRegistryServiceOptions: {
      templatesDir: path.join(runtimeDir, 'prompt-templates'),
      versionsDir: path.join(runtimeDir, 'prompt-versions'),
      usageDir: path.join(runtimeDir, 'prompt-usage'),
    },
  };
}

function createOptionalSqlite(mode: StorageMode, root: string, filename: string) {
  if (mode !== 'sqlite') {
    return undefined;
  }

  return new SqliteDatabase({
    databasePath: path.join(root, '.veritas-kanban', filename),
  });
}

async function createTempRoot(mode: StorageMode) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `veritas-${mode}-parity-`));
  cleanupTasks.push(() => fs.rm(root, { recursive: true, force: true }).catch(() => {}));
  return root;
}

async function loadFixture(): Promise<DualStorageFixture> {
  return JSON.parse(await fs.readFile(fixturePath, 'utf-8')) as DualStorageFixture;
}
