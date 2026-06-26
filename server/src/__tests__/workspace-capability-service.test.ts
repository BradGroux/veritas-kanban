import { describe, expect, it, vi } from 'vitest';
import type {
  AppConfig,
  Task,
  WorkspaceCapabilityManifest,
  WorkspaceDelegatedWorkIntakeInput,
} from '@veritas-kanban/shared';
import { WorkspaceCapabilityService } from '../services/workspace-capability-service';

const localManifest: WorkspaceCapabilityManifest = {
  id: 'local-board',
  schemaVersion: 'workspace-capability/v1',
  workspaceId: 'local',
  name: 'Local Board',
  enabled: true,
  defaultLabels: ['delegated'],
  capabilities: [
    {
      id: 'docs',
      name: 'Documentation',
      acceptedTaskTypes: ['docs'],
      defaultLabels: ['docs'],
      defaultProject: 'handbook',
      defaultPriority: 'medium',
      requiredContextFields: ['acceptance'],
      intakeTargets: ['task'],
    },
  ],
};

const trustedManifest: WorkspaceCapabilityManifest = {
  id: 'source-board',
  schemaVersion: 'workspace-capability/v1',
  workspaceId: 'source',
  name: 'Source Board',
  enabled: true,
  capabilities: [
    {
      id: 'ops',
      name: 'Ops',
      acceptedTaskTypes: ['feature'],
      intakeTargets: ['task'],
    },
  ],
  metadata: {
    source: '/tmp/source.yaml',
    importedAt: '2026-06-26T00:00:00.000Z',
    updatedAt: '2026-06-26T00:00:00.000Z',
  },
};

function serviceWithConfig(config: AppConfig, sourceTask?: Task) {
  const createdTasks: Task[] = [];
  const updateTask = vi.fn(async (_id: string, input: Partial<Task>) => ({
    ...(sourceTask as Task),
    ...input,
  }));
  const service = new WorkspaceCapabilityService(
    {
      getConfig: async () => config,
      saveConfig: async (next: AppConfig) => {
        Object.assign(config, next);
      },
    } as never,
    {
      createTask: async (input) => {
        const task = {
          id: 'task_20260626_target',
          title: input.title,
          description: input.description ?? '',
          type: input.type ?? 'code',
          status: input.status ?? 'todo',
          priority: input.priority ?? 'medium',
          project: input.project,
          created: '2026-06-26T00:00:00.000Z',
          updated: '2026-06-26T00:00:00.000Z',
          revision: 1,
        } satisfies Task;
        createdTasks.push(task);
        return task;
      },
      getTask: async (id) => (sourceTask?.id === id ? sourceTask : null),
      updateTask,
    } as never
  );
  return { service, createdTasks, updateTask };
}

function intakeInput(overrides: Partial<WorkspaceDelegatedWorkIntakeInput> = {}) {
  return {
    source: {
      workspaceId: 'source',
      workspaceName: 'Source Board',
      taskId: 'task_20260626_source',
      taskUrl: 'https://source.example/tasks/task_20260626_source',
    },
    capabilityId: 'docs',
    title: 'Write operator docs',
    context: 'Document the queue handoff flow.',
    contextFields: { acceptance: 'Docs include handoff and rollback steps' },
    type: 'docs',
    labels: ['urgent-docs'],
    requestedBy: 'user:brad',
    ...overrides,
  } satisfies WorkspaceDelegatedWorkIntakeInput;
}

describe('WorkspaceCapabilityService', () => {
  it('validates duplicate capabilities and rejects sensitive manifest fields', () => {
    const { service } = serviceWithConfig({ repos: [], agents: [], defaultAgent: 'codex' });

    const duplicate = service.validateManifest({
      ...localManifest,
      capabilities: [localManifest.capabilities[0], localManifest.capabilities[0]],
    });

    expect(duplicate.valid).toBe(false);
    expect(duplicate.issues.map((issue) => issue.message)).toContain(
      'Duplicate capability ID: docs'
    );

    const sensitive = service.validateManifest({
      ...localManifest,
      apiToken: 'should-not-be-present',
    });
    expect(sensitive.valid).toBe(false);
    expect(sensitive.issues.some((issue) => issue.message.includes('Sensitive field'))).toBe(true);
  });

  it('registers trusted manifests and redacts import source during discovery', async () => {
    const config: AppConfig = {
      repos: [],
      agents: [],
      defaultAgent: 'codex',
      workspaceCapability: localManifest,
    };
    const { service } = serviceWithConfig(config);

    const result = await service.registerTrustedManifest({ manifest: trustedManifest });
    expect(result.created).toBe(true);
    expect(config.trustedWorkspaceCapabilities?.[0].metadata?.source).toBe('/tmp/source.yaml');

    const discovery = await service.discover();
    expect(discovery.trusted[0].workspaceId).toBe('source');
    expect(discovery.trusted[0].metadata?.source).toBeUndefined();
  });

  it('fails closed for untrusted sources and missing required context', async () => {
    const config: AppConfig = {
      repos: [],
      agents: [],
      defaultAgent: 'codex',
      workspaceCapability: localManifest,
    };
    const { service } = serviceWithConfig(config);

    await expect(service.intake(intakeInput())).rejects.toThrow(
      'Workspace is not trusted for delegated intake: source'
    );

    config.trustedWorkspaceCapabilities = [trustedManifest];
    await expect(service.intake(intakeInput({ contextFields: {} }))).rejects.toThrow(
      'Missing required delegation context: acceptance'
    );
  });

  it('creates a target task, stores a delegation record, and updates a local source task link', async () => {
    const sourceTask: Task = {
      id: 'task_20260626_source',
      title: 'Source task',
      description: '',
      type: 'feature',
      status: 'todo',
      priority: 'medium',
      created: '2026-06-26T00:00:00.000Z',
      updated: '2026-06-26T00:00:00.000Z',
    };
    const config: AppConfig = {
      repos: [],
      agents: [],
      defaultAgent: 'codex',
      workspaceCapability: localManifest,
      trustedWorkspaceCapabilities: [trustedManifest],
    };
    const { service, createdTasks, updateTask } = serviceWithConfig(config, sourceTask);

    const result = await service.intake(intakeInput());

    expect(createdTasks[0]).toMatchObject({
      title: 'Write operator docs',
      type: 'docs',
      priority: 'medium',
      project: 'handbook',
    });
    expect(createdTasks[0].description).toContain('## Delegated Intake');
    expect(result.record.labels).toEqual(['delegated', 'docs', 'urgent-docs']);
    expect(config.workspaceDelegations).toHaveLength(1);
    expect(updateTask).toHaveBeenCalledWith(
      sourceTask.id,
      expect.objectContaining({
        delegatedWork: [
          expect.objectContaining({
            targetWorkspaceId: 'local',
            targetId: 'task_20260626_target',
            latestState: 'todo',
          }),
        ],
      })
    );
  });
});
