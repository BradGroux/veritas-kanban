import yaml from 'yaml';
import { nanoid } from 'nanoid';
import type {
  AppConfig,
  CreateTaskInput,
  Task,
  WorkspaceCapabilityDiscoveryResult,
  WorkspaceCapabilityExportResult,
  WorkspaceCapabilityFormat,
  WorkspaceCapabilityManifest,
  WorkspaceCapabilityRegistrationResult,
  WorkspaceCapabilityValidationResult,
  WorkspaceDelegatedWorkIntakeInput,
  WorkspaceDelegatedWorkIntakeResult,
  WorkspaceDelegationRecord,
} from '@veritas-kanban/shared';
import { getConfigService, type ConfigService } from './config-service.js';
import { getTaskService, type TaskService } from './task-service.js';
import { WorkspaceCapabilityManifestSchema } from '../schemas/workspace-capability-schemas.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../middleware/error-handler.js';

const SECRET_KEY_PATTERN = /(?:secret|token|password|api[-_]?key|private[-_]?key)/i;

interface ImportManifestInput {
  content?: string;
  format?: WorkspaceCapabilityFormat;
  source?: string;
  manifest?: unknown;
}

type WorkspaceCapabilityConfigStore = Pick<ConfigService, 'getConfig' | 'saveConfig'>;
type WorkspaceCapabilityTaskStore = Pick<
  TaskService,
  'createTask' | 'getTask' | 'updateTask' | 'listTasks'
>;

export class WorkspaceCapabilityService {
  constructor(
    private readonly configService: WorkspaceCapabilityConfigStore = getConfigService(),
    private readonly taskService: WorkspaceCapabilityTaskStore = getTaskService()
  ) {}

  async getLocalManifest(): Promise<WorkspaceCapabilityManifest | null> {
    const config = await this.configService.getConfig();
    return config.workspaceCapability ?? null;
  }

  async saveLocalManifest(
    manifest: WorkspaceCapabilityManifest
  ): Promise<WorkspaceCapabilityManifest> {
    const parsed = this.requireValidManifest(manifest);
    const config = await this.configService.getConfig();
    const next = this.stampManifest(parsed, parsed.metadata?.source);
    config.workspaceCapability = next;
    await this.configService.saveConfig(config);
    return next;
  }

  async importLocalManifest(input: ImportManifestInput): Promise<WorkspaceCapabilityManifest> {
    const manifest = this.requireValidManifest(this.readManifestInput(input));
    return this.saveLocalManifest(
      this.stampManifest(manifest, input.source ?? manifest.metadata?.source)
    );
  }

  async exportLocalManifest(
    format: WorkspaceCapabilityFormat
  ): Promise<WorkspaceCapabilityExportResult> {
    const manifest = await this.getLocalManifest();
    if (!manifest) throw new BadRequestError('Workspace capability manifest is not configured');
    return {
      id: manifest.id,
      format,
      content: this.stringifyManifest(manifest, format),
    };
  }

  async listTrustedManifests(): Promise<WorkspaceCapabilityManifest[]> {
    const config = await this.configService.getConfig();
    return (config.trustedWorkspaceCapabilities ?? []).map((manifest) =>
      this.redactManifest(manifest)
    );
  }

  async registerTrustedManifest(
    input: ImportManifestInput
  ): Promise<WorkspaceCapabilityRegistrationResult> {
    const manifest = this.stampManifest(
      this.requireValidManifest(this.readManifestInput(input)),
      input.source
    );
    const config = await this.configService.getConfig();
    const existing = config.trustedWorkspaceCapabilities ?? [];
    const created = !existing.some((candidate) => candidate.workspaceId === manifest.workspaceId);
    config.trustedWorkspaceCapabilities = [
      ...existing.filter((candidate) => candidate.workspaceId !== manifest.workspaceId),
      manifest,
    ].sort((a, b) => a.name.localeCompare(b.name));
    await this.configService.saveConfig(config);
    return { manifest: this.redactManifest(manifest), created };
  }

  async removeTrustedManifest(workspaceId: string): Promise<boolean> {
    const config = await this.configService.getConfig();
    const existing = config.trustedWorkspaceCapabilities ?? [];
    const next = existing.filter((candidate) => candidate.workspaceId !== workspaceId);
    if (next.length === existing.length) return false;
    config.trustedWorkspaceCapabilities = next;
    await this.configService.saveConfig(config);
    return true;
  }

  async discover(): Promise<WorkspaceCapabilityDiscoveryResult> {
    const config = await this.configService.getConfig();
    return {
      local: config.workspaceCapability ? this.redactManifest(config.workspaceCapability) : null,
      trusted: (config.trustedWorkspaceCapabilities ?? []).map((manifest) =>
        this.redactManifest(manifest)
      ),
    };
  }

  validateManifest(manifest: unknown): WorkspaceCapabilityValidationResult {
    const sensitiveIssues = this.findSensitiveFieldIssues(manifest);
    const parsed = WorkspaceCapabilityManifestSchema.safeParse(manifest);
    if (!parsed.success) {
      return {
        valid: false,
        issues: [
          ...sensitiveIssues,
          ...parsed.error.issues.map((issue) => ({
            path: issue.path.length ? `$.${issue.path.join('.')}` : '$',
            message: issue.message,
          })),
        ],
      };
    }
    if (sensitiveIssues.length > 0) {
      return { valid: false, issues: sensitiveIssues };
    }
    return { valid: true, manifest: parsed.data as WorkspaceCapabilityManifest, issues: [] };
  }

  validateInput(input: ImportManifestInput): WorkspaceCapabilityValidationResult {
    try {
      return this.validateManifest(this.readManifestInput(input));
    } catch (error) {
      return {
        valid: false,
        issues: [{ path: '$', message: error instanceof Error ? error.message : String(error) }],
      };
    }
  }

  async listDelegations(): Promise<WorkspaceDelegationRecord[]> {
    const config = await this.configService.getConfig();
    return config.workspaceDelegations ?? [];
  }

  async intake(
    input: WorkspaceDelegatedWorkIntakeInput
  ): Promise<WorkspaceDelegatedWorkIntakeResult> {
    const config = await this.configService.getConfig();
    const local = config.workspaceCapability;
    if (!local?.enabled) {
      throw new BadRequestError('Workspace capability manifest is not configured or enabled');
    }

    this.assertTrustedSource(config, input.source.workspaceId, local);
    const capability = local.capabilities.find((candidate) => candidate.id === input.capabilityId);
    if (!capability) {
      throw new BadRequestError(
        `Capability is not published by this workspace: ${input.capabilityId}`
      );
    }
    if (!(capability.intakeTargets ?? ['task']).includes(input.createAs ?? 'task')) {
      throw new BadRequestError(`Capability does not accept ${input.createAs ?? 'task'} intake`);
    }
    if ((input.createAs ?? 'task') === 'github-issue') {
      throw new BadRequestError('GitHub issue intake is not configured; use createAs=task');
    }

    const taskType =
      input.type ?? capability.defaultTaskType ?? capability.acceptedTaskTypes[0] ?? 'code';
    if (
      capability.acceptedTaskTypes.length > 0 &&
      !capability.acceptedTaskTypes.includes(taskType)
    ) {
      throw new BadRequestError(
        `Capability ${capability.id} does not accept task type: ${taskType}`
      );
    }
    this.assertRequiredContext(input, capability.requiredContextFields ?? []);

    const labels = [
      ...(local.defaultLabels ?? []),
      ...(capability.defaultLabels ?? []),
      ...(input.labels ?? []),
    ].filter((label, index, list) => list.indexOf(label) === index);

    const existing = this.findMatchingDelegation(config, input, capability.id, local.workspaceId);
    if (existing?.target.taskId) {
      const existingTask = await this.taskService.getTask(existing.target.taskId);
      if (existingTask) {
        await this.attachDelegationToSourceTask(input.source.taskId, existing);
        return { record: existing, taskId: existingTask.id, taskUrl: existing.target.url };
      }
    }

    if (existing && !existing.target.taskId) {
      const recoveredTask = await this.findTaskForDelegation(existing.id);
      if (recoveredTask) {
        const recovered = this.finalizeDelegationRecord(
          existing,
          input,
          local,
          labels,
          recoveredTask
        );
        await this.saveDelegationRecord(config, recovered);
        await this.attachDelegationToSourceTask(input.source.taskId, recovered);
        return { record: recovered, taskId: recoveredTask.id, taskUrl: recovered.target.url };
      }
    }

    const now = new Date().toISOString();
    const pendingRecord: WorkspaceDelegationRecord = {
      id: existing?.id ?? this.generateDelegationId(),
      capabilityId: capability.id,
      title: input.title,
      status: 'blocked',
      latestState: 'pending-intake',
      labels,
      source: input.source,
      target: {
        type: 'task',
        workspaceId: local.workspaceId,
        workspaceName: local.name,
        url: input.backlinkUrl,
      },
      requestedBy: input.requestedBy,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.saveDelegationRecord(config, pendingRecord);

    const task = await this.taskService.createTask({
      title: input.title,
      description: this.buildDelegatedTaskDescription(input, labels, pendingRecord.id),
      type: taskType,
      priority: input.priority ?? capability.defaultPriority ?? local.defaultPriority ?? 'medium',
      project: input.project ?? capability.defaultProject ?? local.defaultProject,
      createdBy: input.requestedBy ?? `workspace:${input.source.workspaceId}`,
      updatedBy: input.requestedBy ?? `workspace:${input.source.workspaceId}`,
    } satisfies CreateTaskInput);

    const record = this.finalizeDelegationRecord(pendingRecord, input, local, labels, task);

    await this.saveDelegationRecord(config, record);
    await this.attachDelegationToSourceTask(input.source.taskId, record);
    return { record, taskId: task.id, taskUrl: record.target.url };
  }

  async refreshDelegation(id: string): Promise<WorkspaceDelegationRecord> {
    const config = await this.configService.getConfig();
    const existing = (config.workspaceDelegations ?? []).find((record) => record.id === id);
    if (!existing) throw new NotFoundError(`Workspace delegation not found: ${id}`);

    let next = { ...existing, updatedAt: new Date().toISOString() };
    if (existing.target.type === 'task' && existing.target.taskId) {
      const task = await this.taskService.getTask(existing.target.taskId);
      next = task
        ? {
            ...next,
            latestState: task.status,
            status: task.status === 'done' ? 'closed' : 'linked',
          }
        : { ...next, status: 'blocked', latestState: 'target task missing' };
    }

    await this.saveDelegationRecord(config, next);
    await this.attachDelegationToSourceTask(next.source.taskId, next);
    return next;
  }

  private requireValidManifest(manifest: unknown): WorkspaceCapabilityManifest {
    const validation = this.validateManifest(manifest);
    if (!validation.valid || !validation.manifest) {
      const firstIssue = validation.issues[0];
      throw new BadRequestError(
        firstIssue
          ? `${firstIssue.path}: ${firstIssue.message}`
          : 'Invalid workspace capability manifest'
      );
    }
    return validation.manifest;
  }

  private readManifestInput(input: ImportManifestInput): unknown {
    if (input.manifest) return input.manifest;
    if (!input.content) throw new BadRequestError('Manifest content is required');
    if (input.format === 'json') return JSON.parse(input.content);
    if (input.format === 'yaml') return yaml.parse(input.content);
    try {
      return JSON.parse(input.content);
    } catch {
      return yaml.parse(input.content);
    }
  }

  private stringifyManifest(
    manifest: WorkspaceCapabilityManifest,
    format: WorkspaceCapabilityFormat
  ): string {
    return format === 'json' ? `${JSON.stringify(manifest, null, 2)}\n` : yaml.stringify(manifest);
  }

  private stampManifest(
    manifest: WorkspaceCapabilityManifest,
    source?: string
  ): WorkspaceCapabilityManifest {
    const now = new Date().toISOString();
    return {
      ...manifest,
      metadata: {
        ...manifest.metadata,
        source: source ?? manifest.metadata?.source,
        importedAt: manifest.metadata?.importedAt ?? now,
        updatedAt: now,
      },
    };
  }

  private redactManifest(manifest: WorkspaceCapabilityManifest): WorkspaceCapabilityManifest {
    const { metadata, ...rest } = manifest;
    return {
      ...rest,
      metadata: metadata
        ? {
            importedAt: metadata.importedAt,
            updatedAt: metadata.updatedAt,
          }
        : undefined,
    };
  }

  private assertTrustedSource(
    config: AppConfig,
    sourceWorkspaceId: string,
    local: WorkspaceCapabilityManifest
  ): void {
    if (sourceWorkspaceId === local.workspaceId) return;
    if (local.trustedSourceWorkspaceIds?.includes(sourceWorkspaceId)) return;
    const trustedManifest = (config.trustedWorkspaceCapabilities ?? []).find(
      (manifest) => manifest.workspaceId === sourceWorkspaceId && manifest.enabled
    );
    if (!trustedManifest) {
      throw new ForbiddenError(
        `Workspace is not trusted for delegated intake: ${sourceWorkspaceId}`
      );
    }
  }

  private assertRequiredContext(
    input: WorkspaceDelegatedWorkIntakeInput,
    requiredFields: string[]
  ): void {
    const fields = input.contextFields ?? {};
    const missing = requiredFields.filter((field) => !fields[field]?.trim());
    if (missing.length > 0) {
      throw new BadRequestError(`Missing required delegation context: ${missing.join(', ')}`);
    }
  }

  private buildDelegatedTaskDescription(
    input: WorkspaceDelegatedWorkIntakeInput,
    labels: string[],
    delegationId?: string
  ): string {
    const contextFields = Object.entries(input.contextFields ?? {})
      .map(([key, value]) => `- ${key}: ${value}`)
      .join('\n');
    const lines = [
      input.context.trim(),
      '',
      '## Delegated Intake',
      `- Source workspace: ${input.source.workspaceName ?? input.source.workspaceId}`,
      input.source.taskId ? `- Source task: ${input.source.taskId}` : undefined,
      input.source.taskUrl ? `- Source task URL: ${input.source.taskUrl}` : undefined,
      input.source.repository ? `- Source repository: ${input.source.repository}` : undefined,
      input.source.issueUrl ? `- Source issue: ${input.source.issueUrl}` : undefined,
      delegationId ? `- Delegation ID: ${delegationId}` : undefined,
      labels.length > 0 ? `- Labels: ${labels.join(', ')}` : undefined,
      input.requestedBy ? `- Requested by: ${input.requestedBy}` : undefined,
      contextFields ? `\n### Required Context\n${contextFields}` : undefined,
    ];
    return lines.filter(Boolean).join('\n');
  }

  private findMatchingDelegation(
    config: AppConfig,
    input: WorkspaceDelegatedWorkIntakeInput,
    capabilityId: string,
    targetWorkspaceId: string
  ): WorkspaceDelegationRecord | undefined {
    return (config.workspaceDelegations ?? []).find((record) => {
      if (record.capabilityId !== capabilityId || record.target.workspaceId !== targetWorkspaceId) {
        return false;
      }
      if (record.source.workspaceId !== input.source.workspaceId || record.title !== input.title) {
        return false;
      }
      if (record.source.taskId || input.source.taskId)
        return record.source.taskId === input.source.taskId;
      if (record.source.issueUrl || input.source.issueUrl) {
        return record.source.issueUrl === input.source.issueUrl;
      }
      return true;
    });
  }

  private async findTaskForDelegation(delegationId: string): Promise<Task | null> {
    const tasks = await this.taskService.listTasks();
    return (
      tasks.find((task) => task.description.includes(`Delegation ID: ${delegationId}`)) ?? null
    );
  }

  private finalizeDelegationRecord(
    base: WorkspaceDelegationRecord,
    input: WorkspaceDelegatedWorkIntakeInput,
    local: WorkspaceCapabilityManifest,
    labels: string[],
    task: Task
  ): WorkspaceDelegationRecord {
    return {
      ...base,
      title: input.title,
      status: 'created',
      latestState: task.status,
      labels,
      source: input.source,
      target: {
        type: 'task',
        workspaceId: local.workspaceId,
        workspaceName: local.name,
        taskId: task.id,
        url: input.backlinkUrl ?? `/tasks/${task.id}`,
      },
      requestedBy: input.requestedBy,
      updatedAt: new Date().toISOString(),
    };
  }

  private async saveDelegationRecord(
    config: AppConfig,
    record: WorkspaceDelegationRecord
  ): Promise<void> {
    config.workspaceDelegations = [
      record,
      ...(config.workspaceDelegations ?? []).filter((candidate) => candidate.id !== record.id),
    ].slice(0, 500);
    await this.configService.saveConfig(config);
  }

  private async attachDelegationToSourceTask(
    sourceTaskId: string | undefined,
    record: WorkspaceDelegationRecord
  ): Promise<void> {
    if (!sourceTaskId) return;
    const sourceTask: Task | null = await this.taskService.getTask(sourceTaskId);
    if (!sourceTask) return;

    await this.taskService.updateTask(sourceTask.id, {
      delegatedWork: [
        {
          id: record.id,
          sourceWorkspaceId: record.source.workspaceId,
          targetWorkspaceId: record.target.workspaceId,
          targetType: record.target.type,
          capabilityId: record.capabilityId,
          targetId: record.target.taskId ?? record.target.issueNumber?.toString(),
          targetUrl: record.target.url,
          status: record.status,
          latestState: record.latestState,
          requestedAt: record.createdAt,
          updatedAt: record.updatedAt,
        },
        ...(sourceTask.delegatedWork ?? []).filter((link) => link.id !== record.id),
      ],
    });
  }

  private generateDelegationId(): string {
    return `delegation_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${nanoid(6)}`;
  }

  private findSensitiveFieldIssues(
    value: unknown,
    path: (string | number)[] = []
  ): WorkspaceCapabilityValidationResult['issues'] {
    if (!value || typeof value !== 'object') return [];
    if (Array.isArray(value)) {
      return value.flatMap((entry, index) =>
        this.findSensitiveFieldIssues(entry, [...path, index])
      );
    }

    return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => {
      const nextPath = [...path, key];
      const issue = SECRET_KEY_PATTERN.test(key)
        ? [
            {
              path: nextPath.length ? `$.${nextPath.join('.')}` : '$',
              message: `Sensitive field is not allowed in capability manifests: ${key}`,
            },
          ]
        : [];
      return [...issue, ...this.findSensitiveFieldIssues(nested, nextPath)];
    });
  }
}

let workspaceCapabilityService: WorkspaceCapabilityService | null = null;

export function getWorkspaceCapabilityService(): WorkspaceCapabilityService {
  if (!workspaceCapabilityService) {
    workspaceCapabilityService = new WorkspaceCapabilityService();
  }
  return workspaceCapabilityService;
}
