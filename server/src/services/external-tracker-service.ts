import fs from 'fs/promises';
import path from 'path';
import { nanoid } from 'nanoid';
import type {
  ExternalTrackerConnectionInput,
  ExternalTrackerConnectionRecord,
  ExternalTrackerCreateWorkItemInput,
  ExternalTrackerCreateWorkItemResult,
  ExternalTrackerDryRunCreateInput,
  ExternalTrackerDryRunCreateResult,
  ExternalTrackerField,
  ExternalTrackerMappedPayload,
  ExternalTrackerMappingProfile,
  ExternalTrackerMappingProfileInput,
  ExternalTrackerPlanningPath,
  ExternalTrackerProvider,
  ExternalTrackerSchema,
  ExternalTrackerSyncAudit,
  ExternalTrackerValidationIssue,
  ExternalTrackerValidationResult,
  ExternalWorkItemLink,
  Task,
  UpdateTaskInput,
} from '@veritas-kanban/shared';
import { auditLog, type AuditEvent } from './audit-service.js';
import { activityService, type ActivityService } from './activity-service.js';
import { withFileLock } from './file-lock.js';
import { getTaskService } from './task-service.js';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/error-handler.js';
import { getRuntimeDir } from '../utils/paths.js';
import { stripHtml, validatePathSegment } from '../utils/sanitize.js';

const STATE_FILE = 'state.json';
const DEFAULT_PROFILE_ID = 'default-mock-profile';
const DEFAULT_PROVIDER: ExternalTrackerProvider = 'mock';
const MAX_AUDIT_EVENTS = 500;

interface ExternalTrackerState {
  version: 1;
  connection?: ExternalTrackerConnectionRecord;
  schemas: Partial<Record<ExternalTrackerProvider, ExternalTrackerSchema>>;
  profiles: ExternalTrackerMappingProfile[];
  audits: ExternalTrackerSyncAudit[];
  updatedAt: string;
}

export interface ExternalTrackerTaskService {
  getTask(id: string): Promise<Task | null>;
  updateTask(id: string, input: UpdateTaskInput): Promise<Task | null>;
}

interface ExternalTrackerAdapter {
  provider: ExternalTrackerProvider;
  introspect(connection?: ExternalTrackerConnectionRecord): Promise<ExternalTrackerSchema>;
  buildCreatePayload(
    task: Task,
    profile: ExternalTrackerMappingProfile,
    schema: ExternalTrackerSchema
  ): ExternalTrackerMappedPayload;
  createWorkItem(input: {
    payload: ExternalTrackerMappedPayload;
    task: Task;
    profile: ExternalTrackerMappingProfile;
    approvedBy: string;
  }): Promise<{ externalId: string; externalUrl: string; status: string }>;
}

export interface ExternalTrackerServiceOptions {
  storageDir?: string;
  persist?: boolean;
  audit?: (event: AuditEvent) => Promise<void>;
  taskService?: ExternalTrackerTaskService;
  activity?: ActivityService;
  adapters?: ExternalTrackerAdapter[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function cleanText(value: string | undefined, fallback = ''): string {
  return stripHtml(String(value ?? fallback)).trim();
}

function safeTaskValue(task: Task, source: string, literalValue?: string): string | number | null {
  switch (source) {
    case 'id':
      return task.id;
    case 'title':
      return task.title;
    case 'description':
      return task.description;
    case 'type':
      return task.type;
    case 'status':
      return task.status;
    case 'priority':
      return task.priority;
    case 'project':
      return task.project ?? null;
    case 'sprint':
      return task.sprint ?? null;
    case 'github.url':
      return task.github?.url ?? null;
    case 'literal':
      return literalValue ?? null;
    default:
      return null;
  }
}

function issue(
  severity: ExternalTrackerValidationIssue['severity'],
  code: string,
  message: string,
  fieldId?: string,
  path?: string
): ExternalTrackerValidationIssue {
  return { severity, code, message, fieldId, path };
}

function validationResult(
  issues: ExternalTrackerValidationIssue[] = []
): ExternalTrackerValidationResult {
  const errors = issues.filter((item) => item.severity === 'error');
  const warnings = issues.filter((item) => item.severity === 'warning');
  return { valid: errors.length === 0, errors, warnings };
}

function findByPath(paths: ExternalTrackerPlanningPath[], value?: string): boolean {
  if (!value) return true;
  return paths.some((entry) => entry.path === value || entry.id === value);
}

function fieldById(
  schema: ExternalTrackerSchema,
  fieldId: string
): ExternalTrackerField | undefined {
  return schema.fields.find((field) => field.id === fieldId);
}

function defaultConnection(timestamp = nowIso()): ExternalTrackerConnectionRecord {
  return {
    provider: DEFAULT_PROVIDER,
    displayName: 'Mock Tracker',
    status: 'connected',
    baseUrl: 'https://tracker.example.test',
    organization: 'Veritas',
    project: 'Veritas Kanban',
    hasCredential: false,
    credentialRedacted: true,
    updatedAt: timestamp,
    updatedBy: 'system',
  };
}

function defaultValueMappings(): NonNullable<ExternalTrackerMappingProfile['valueMappings']> {
  return {
    priority: {
      low: 4,
      medium: 3,
      high: 2,
      critical: 1,
    },
    status: {
      todo: 'New',
      'in-progress': 'Active',
      blocked: 'Active',
      done: 'Closed',
      cancelled: 'Closed',
    },
    type: {
      feature: 'Feature',
      bug: 'Bug',
      chore: 'Task',
      task: 'Task',
      code: 'Task',
    },
  };
}

function defaultProfile(
  schema: ExternalTrackerSchema,
  timestamp = nowIso()
): ExternalTrackerMappingProfile {
  return {
    id: DEFAULT_PROFILE_ID,
    name: 'Default Mock Tracker Mapping',
    provider: schema.provider,
    enabled: true,
    project: schema.projects[0]?.path,
    defaultWorkItemType: 'Task',
    defaultProjectPath: schema.projects[0]?.path,
    defaultAreaPath: schema.areaPaths[0]?.path,
    defaultTeamPath: schema.teams[0]?.path,
    defaultIterationPath: schema.iterationPaths[0]?.path,
    fieldMappings: [
      { trackerFieldId: 'System.Title', source: 'title', required: true },
      { trackerFieldId: 'System.Description', source: 'description' },
      { trackerFieldId: 'Microsoft.VSTS.Common.Priority', source: 'priority' },
      { trackerFieldId: 'System.State', source: 'status' },
      { trackerFieldId: 'System.Tags', source: 'literal', literalValue: 'veritas' },
    ],
    valueMappings: defaultValueMappings(),
    backlinkFieldId: 'Custom.VeritasBacklink',
    createdAt: timestamp,
    updatedAt: timestamp,
    updatedBy: 'system',
  };
}

class MockExternalTrackerAdapter implements ExternalTrackerAdapter {
  provider: ExternalTrackerProvider = DEFAULT_PROVIDER;

  async introspect(connection?: ExternalTrackerConnectionRecord): Promise<ExternalTrackerSchema> {
    const status = connection?.status ?? 'connected';
    const hasCredential = connection?.hasCredential ?? false;
    const project = connection?.project || 'Veritas Kanban';
    const areaRoot = `${project}\\Platform`;
    return {
      provider: this.provider,
      providerLabel: 'Mock Tracker',
      schemaVersion: 'mock-2026-06-26',
      introspectedAt: nowIso(),
      workItemTypes: [
        { id: 'Bug', name: 'Bug', description: 'Defect or regression work item.' },
        { id: 'Feature', name: 'Feature', description: 'User-facing capability or enhancement.' },
        { id: 'Task', name: 'Task', description: 'Implementation or operations work item.' },
      ],
      fields: [
        {
          id: 'System.Title',
          name: 'Title',
          type: 'string',
          required: true,
          description: 'Work item title.',
        },
        {
          id: 'System.Description',
          name: 'Description',
          type: 'string',
          required: false,
          description: 'Work item details.',
        },
        {
          id: 'System.WorkItemType',
          name: 'Work Item Type',
          type: 'picklist',
          required: true,
          allowedValues: ['Bug', 'Feature', 'Task'],
        },
        {
          id: 'System.AreaPath',
          name: 'Area Path',
          type: 'picklist',
          required: true,
          allowedValues: [areaRoot, `${project}\\Product`, `${project}\\Operations`],
        },
        {
          id: 'System.IterationPath',
          name: 'Iteration Path',
          type: 'picklist',
          required: false,
          allowedValues: [project, `${project}\\Next`, `${project}\\Later`],
        },
        {
          id: 'System.State',
          name: 'State',
          type: 'picklist',
          required: false,
          allowedValues: ['New', 'Active', 'Resolved', 'Closed'],
        },
        {
          id: 'Microsoft.VSTS.Common.Priority',
          name: 'Priority',
          type: 'number',
          required: false,
          allowedValues: [1, 2, 3, 4],
        },
        {
          id: 'System.AssignedTo',
          name: 'Assigned To',
          type: 'identity',
          required: false,
          allowedValues: ['brad@example.test', 'team@example.test'],
        },
        {
          id: 'System.Tags',
          name: 'Tags',
          type: 'tags',
          required: false,
          allowedValues: ['feature', 'bug', 'ops', 'veritas'],
        },
        {
          id: 'Custom.VeritasBacklink',
          name: 'Veritas Backlink',
          type: 'url',
          required: false,
          description: 'Link back to the source Veritas task.',
        },
      ],
      projects: [{ id: 'project-default', name: project, path: project, kind: 'project' }],
      areaPaths: [
        { id: 'area-platform', name: 'Platform', path: areaRoot, kind: 'area' },
        { id: 'area-product', name: 'Product', path: `${project}\\Product`, kind: 'area' },
        { id: 'area-ops', name: 'Operations', path: `${project}\\Operations`, kind: 'area' },
      ],
      iterationPaths: [
        { id: 'iteration-root', name: project, path: project, kind: 'iteration' },
        { id: 'iteration-next', name: 'Next', path: `${project}\\Next`, kind: 'iteration' },
        { id: 'iteration-later', name: 'Later', path: `${project}\\Later`, kind: 'iteration' },
      ],
      teams: [
        { id: 'team-core', name: 'Core', path: `${project}\\Core`, kind: 'team' },
        { id: 'team-ops', name: 'Ops', path: `${project}\\Ops`, kind: 'team' },
      ],
      priorities: [1, 2, 3, 4],
      states: ['New', 'Active', 'Resolved', 'Closed'],
      tags: ['feature', 'bug', 'ops', 'veritas'],
      assignees: ['brad@example.test', 'team@example.test'],
      capabilities: {
        canCreate: true,
        canUpdate: true,
        requiresApproval: true,
        supportsDryRun: true,
      },
      connectionPosture: {
        status,
        hasCredential,
        credentialRedacted: true,
      },
    };
  }

  buildCreatePayload(
    task: Task,
    profile: ExternalTrackerMappingProfile,
    schema: ExternalTrackerSchema
  ): ExternalTrackerMappedPayload {
    const fields: ExternalTrackerMappedPayload['fields'] = {
      'System.WorkItemType':
        profile.valueMappings?.type?.[task.type] ?? profile.defaultWorkItemType,
      'System.AreaPath': profile.defaultAreaPath ?? null,
    };

    if (profile.defaultIterationPath) {
      fields['System.IterationPath'] = profile.defaultIterationPath;
    }

    for (const mapping of profile.fieldMappings) {
      const field = fieldById(schema, mapping.trackerFieldId);
      if (!field || field.readOnly) continue;
      let value = safeTaskValue(task, mapping.source, mapping.literalValue);

      if (mapping.source === 'priority') {
        value = profile.valueMappings?.priority?.[task.priority] ?? value;
      } else if (mapping.source === 'status') {
        value = profile.valueMappings?.status?.[task.status] ?? value;
      } else if (mapping.source === 'type') {
        value = profile.valueMappings?.type?.[task.type] ?? value;
      }

      if (field.type === 'tags' && typeof value === 'string') {
        fields[mapping.trackerFieldId] = value ? [value] : [];
      } else {
        fields[mapping.trackerFieldId] = value;
      }
    }

    const backlinkUrl = `veritas-kanban://tasks/${encodeURIComponent(task.id)}`;
    if (profile.backlinkFieldId && fieldById(schema, profile.backlinkFieldId)) {
      fields[profile.backlinkFieldId] = backlinkUrl;
    }

    return {
      provider: profile.provider,
      workItemType: String(fields['System.WorkItemType'] ?? profile.defaultWorkItemType),
      projectPath: profile.defaultProjectPath,
      areaPath: profile.defaultAreaPath,
      teamPath: profile.defaultTeamPath,
      iterationPath: profile.defaultIterationPath,
      fields,
      backlinkUrl,
    };
  }

  async createWorkItem(_input: {
    payload: ExternalTrackerMappedPayload;
    task: Task;
    profile: ExternalTrackerMappingProfile;
    approvedBy: string;
  }): Promise<{ externalId: string; externalUrl: string; status: string }> {
    const externalId = `MOCK-${Date.now().toString(36).toUpperCase()}-${nanoid(4).toUpperCase()}`;
    return {
      externalId,
      externalUrl: `https://tracker.example.test/work-items/${encodeURIComponent(externalId)}`,
      status: 'created',
    };
  }
}

export class ExternalTrackerService {
  private readonly storageDir: string;
  private readonly persist: boolean;
  private readonly audit: (event: AuditEvent) => Promise<void>;
  private readonly taskService: ExternalTrackerTaskService;
  private readonly activity: ActivityService;
  private readonly adapters: Map<ExternalTrackerProvider, ExternalTrackerAdapter>;
  private loaded = false;
  private state: ExternalTrackerState = this.emptyState();

  constructor(options: ExternalTrackerServiceOptions = {}) {
    this.storageDir = options.storageDir ?? path.join(getRuntimeDir(), 'external-trackers');
    this.persist = options.persist ?? process.env.VITEST !== 'true';
    this.audit = options.audit ?? auditLog;
    this.taskService = options.taskService ?? getTaskService();
    this.activity = options.activity ?? activityService;
    const adapters = options.adapters ?? [new MockExternalTrackerAdapter()];
    this.adapters = new Map(adapters.map((adapter) => [adapter.provider, adapter]));
  }

  async getConnection(): Promise<ExternalTrackerConnectionRecord> {
    await this.ensureLoaded();
    return this.state.connection ?? defaultConnection();
  }

  async saveConnection(
    input: ExternalTrackerConnectionInput,
    actor = 'operator'
  ): Promise<ExternalTrackerConnectionRecord> {
    await this.ensureLoaded();
    this.requireAdapter(input.provider);
    const timestamp = nowIso();
    const record: ExternalTrackerConnectionRecord = {
      provider: input.provider,
      displayName: cleanText(input.displayName, 'Mock Tracker') || 'Mock Tracker',
      status: 'connected',
      baseUrl: cleanText(input.baseUrl, 'https://tracker.example.test') || undefined,
      organization: cleanText(input.organization, 'Veritas') || undefined,
      project: cleanText(input.project, 'Veritas Kanban') || undefined,
      hasCredential: Boolean(input.token?.trim()) || this.state.connection?.hasCredential || false,
      credentialRedacted: true,
      updatedAt: timestamp,
      updatedBy: cleanText(actor, 'operator') || 'operator',
    };
    this.state.connection = record;
    this.state.updatedAt = timestamp;
    await this.saveState();
    await this.audit({
      action: 'external_tracker.connection.saved',
      actor: record.updatedBy ?? 'operator',
      resource: record.provider,
      details: {
        provider: record.provider,
        status: record.status,
        hasCredential: record.hasCredential,
      },
    });
    return record;
  }

  async introspect(
    input: Partial<ExternalTrackerConnectionInput> = {},
    actor = 'operator'
  ): Promise<ExternalTrackerSchema> {
    await this.ensureLoaded();
    const provider = input.provider ?? this.state.connection?.provider ?? DEFAULT_PROVIDER;
    const adapter = this.requireAdapter(provider);
    if (input.provider || input.baseUrl || input.project || input.organization || input.token) {
      await this.saveConnection({ ...input, provider }, actor);
    }
    const connection = this.state.connection ?? defaultConnection();
    const schema = await adapter.introspect(connection);
    this.state.schemas[provider] = schema;
    this.ensureDefaultProfile(schema, actor);
    this.state.updatedAt = nowIso();
    await this.saveState();
    await this.audit({
      action: 'external_tracker.schema.introspected',
      actor,
      resource: provider,
      details: {
        provider,
        workItemTypes: schema.workItemTypes.length,
        fields: schema.fields.length,
        areaPaths: schema.areaPaths.length,
      },
    });
    return schema;
  }

  async getSchema(
    provider: ExternalTrackerProvider = DEFAULT_PROVIDER
  ): Promise<ExternalTrackerSchema> {
    await this.ensureLoaded();
    const existing = this.state.schemas[provider];
    if (existing) return existing;
    return this.introspect({ provider }, 'system');
  }

  async listProfiles(): Promise<ExternalTrackerMappingProfile[]> {
    await this.ensureLoaded();
    if (this.state.profiles.length === 0) {
      const schema = await this.getSchema(DEFAULT_PROVIDER);
      this.ensureDefaultProfile(schema, 'system');
      await this.saveState();
    }
    return [...this.state.profiles].sort((a, b) => a.name.localeCompare(b.name));
  }

  async getProfile(id: string): Promise<ExternalTrackerMappingProfile> {
    validatePathSegment(id);
    await this.ensureLoaded();
    const profile = this.state.profiles.find((item) => item.id === id);
    if (!profile) throw new NotFoundError('External tracker mapping profile not found');
    return profile;
  }

  async saveProfile(
    input: ExternalTrackerMappingProfileInput,
    actor = 'operator'
  ): Promise<ExternalTrackerMappingProfile> {
    await this.ensureLoaded();
    this.requireAdapter(input.provider);
    const schema = await this.getSchema(input.provider);
    const existing = input.id
      ? this.state.profiles.find((profile) => profile.id === input.id)
      : undefined;
    const timestamp = nowIso();
    const profile: ExternalTrackerMappingProfile = {
      id: input.id ? validatePathSegment(input.id) : `tracker_profile_${nanoid(8)}`,
      name: cleanText(input.name, 'External Tracker Mapping') || 'External Tracker Mapping',
      provider: input.provider,
      enabled: input.enabled ?? true,
      workspaceId: cleanText(input.workspaceId) || undefined,
      project: cleanText(input.project) || input.defaultProjectPath,
      defaultWorkItemType: cleanText(input.defaultWorkItemType),
      defaultProjectPath: cleanText(input.defaultProjectPath) || undefined,
      defaultAreaPath: cleanText(input.defaultAreaPath) || undefined,
      defaultTeamPath: cleanText(input.defaultTeamPath) || undefined,
      defaultIterationPath: cleanText(input.defaultIterationPath) || undefined,
      fieldMappings: input.fieldMappings.map((mapping) => ({
        trackerFieldId: cleanText(mapping.trackerFieldId),
        source: mapping.source,
        literalValue: cleanText(mapping.literalValue) || undefined,
        required: mapping.required,
      })),
      valueMappings: input.valueMappings,
      backlinkFieldId: cleanText(input.backlinkFieldId) || undefined,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      updatedBy: cleanText(actor, 'operator') || 'operator',
    };
    const validation = this.validateProfileAgainstSchema(profile, schema);
    if (!validation.valid) {
      await this.recordSyncAudit({
        provider: profile.provider,
        profileId: profile.id,
        operation: 'validate',
        status: 'failed',
        validation,
        actor: profile.updatedBy ?? 'operator',
      });
      throw new ValidationError('External tracker mapping is invalid', validation.errors);
    }

    const index = this.state.profiles.findIndex((item) => item.id === profile.id);
    if (index === -1) {
      this.state.profiles.push(profile);
    } else {
      this.state.profiles[index] = profile;
    }
    this.state.updatedAt = timestamp;
    await this.saveState();
    await this.audit({
      action: 'external_tracker.profile.saved',
      actor: profile.updatedBy ?? 'operator',
      resource: profile.id,
      details: {
        provider: profile.provider,
        enabled: profile.enabled,
        workItemType: profile.defaultWorkItemType,
      },
    });
    return profile;
  }

  async validateProfile(
    profileId: string,
    actor = 'operator'
  ): Promise<ExternalTrackerValidationResult> {
    const profile = await this.getProfile(profileId);
    const schema = await this.getSchema(profile.provider);
    const validation = this.validateProfileAgainstSchema(profile, schema);
    await this.recordSyncAudit({
      provider: profile.provider,
      profileId: profile.id,
      operation: 'validate',
      status: validation.valid ? 'success' : 'failed',
      validation,
      actor,
    });
    return validation;
  }

  async dryRunCreate(
    input: ExternalTrackerDryRunCreateInput,
    actor = 'operator'
  ): Promise<ExternalTrackerDryRunCreateResult> {
    const { task, profile, schema, payload, validation } = await this.prepareCreate(input);
    await this.recordSyncAudit({
      provider: profile.provider,
      profileId: profile.id,
      operation: 'dry-run-create',
      status: validation.valid ? 'success' : 'failed',
      taskId: task.id,
      workItemType: payload.workItemType,
      validation,
      actor,
    });
    return {
      externalWrite: false,
      profile,
      schema,
      payload,
      validation,
    };
  }

  async createWorkItem(
    input: ExternalTrackerCreateWorkItemInput
  ): Promise<ExternalTrackerCreateWorkItemResult> {
    const approvedBy = cleanText(input.approvedBy);
    if (!approvedBy) {
      throw new ValidationError('External tracker creates require explicit approval');
    }
    const { task, profile, schema, payload, validation } = await this.prepareCreate(input);
    if (!validation.valid) {
      await this.recordSyncAudit({
        provider: profile.provider,
        profileId: profile.id,
        operation: 'create',
        status: 'blocked',
        taskId: task.id,
        workItemType: payload.workItemType,
        validation,
        actor: approvedBy,
      });
      throw new ConflictError('External tracker payload is invalid', validation.errors);
    }

    const adapter = this.requireAdapter(profile.provider);
    const created = await adapter.createWorkItem({ payload, task, profile, approvedBy });
    const timestamp = nowIso();
    const link: ExternalWorkItemLink = {
      id: `external_work_${nanoid(8)}`,
      provider: profile.provider,
      profileId: profile.id,
      externalId: created.externalId,
      externalUrl: created.externalUrl,
      workItemType: payload.workItemType,
      status: created.status,
      title: task.title,
      backlinkUrl: payload.backlinkUrl,
      createdAt: timestamp,
      createdBy: approvedBy,
      lastSyncAt: timestamp,
    };
    const existingLinks = task.externalWorkItems ?? [];
    await this.taskService.updateTask(task.id, {
      externalWorkItems: [...existingLinks, link],
      comments: [
        ...(task.comments ?? []),
        {
          id: `comment_${Date.now()}_${nanoid(6)}`,
          author: approvedBy,
          text: `Linked external tracker item ${created.externalId}.`,
          timestamp,
        },
      ],
    });
    await this.activity.logActivity(
      'agent_event',
      task.id,
      task.title,
      {
        event: 'external_tracker.work_item_created',
        provider: profile.provider,
        profileId: profile.id,
        externalId: created.externalId,
        externalUrl: created.externalUrl,
        workItemType: payload.workItemType,
      },
      undefined,
      approvedBy
    );
    await this.recordSyncAudit({
      provider: profile.provider,
      profileId: profile.id,
      operation: 'create',
      status: 'success',
      taskId: task.id,
      externalId: created.externalId,
      workItemType: payload.workItemType,
      validation,
      actor: approvedBy,
    });
    await this.audit({
      action: 'external_tracker.work_item.created',
      actor: approvedBy,
      resource: task.id,
      details: {
        provider: profile.provider,
        profileId: profile.id,
        externalId: created.externalId,
        workItemType: payload.workItemType,
      },
    });

    return {
      externalWrite: true,
      link,
      profile,
      schema,
      payload,
      validation,
    };
  }

  async listAudits(limit = 50): Promise<ExternalTrackerSyncAudit[]> {
    await this.ensureLoaded();
    return this.state.audits.slice(0, Math.max(1, Math.min(limit, MAX_AUDIT_EVENTS)));
  }

  private async prepareCreate(input: ExternalTrackerDryRunCreateInput): Promise<{
    task: Task;
    profile: ExternalTrackerMappingProfile;
    schema: ExternalTrackerSchema;
    payload: ExternalTrackerMappedPayload;
    validation: ExternalTrackerValidationResult;
  }> {
    const profile = await this.getProfile(input.profileId);
    const schema = await this.getSchema(profile.provider);
    const task = await this.resolveTask(input);
    const profileValidation = this.validateProfileAgainstSchema(profile, schema);
    const adapter = this.requireAdapter(profile.provider);
    const payload = adapter.buildCreatePayload(task, profile, schema);
    const payloadValidation = this.validatePayload(payload, schema);
    const validation = validationResult([
      ...profileValidation.errors,
      ...profileValidation.warnings,
      ...payloadValidation.errors,
      ...payloadValidation.warnings,
    ]);
    return { task, profile, schema, payload, validation };
  }

  private async resolveTask(input: ExternalTrackerDryRunCreateInput): Promise<Task> {
    if (input.task) return input.task;
    if (!input.taskId) {
      throw new ValidationError('A taskId or task payload is required');
    }
    validatePathSegment(input.taskId);
    const task = await this.taskService.getTask(input.taskId);
    if (!task) throw new NotFoundError('Task not found');
    return task;
  }

  private validateProfileAgainstSchema(
    profile: ExternalTrackerMappingProfile,
    schema: ExternalTrackerSchema
  ): ExternalTrackerValidationResult {
    const issues: ExternalTrackerValidationIssue[] = [];
    const fields = new Set(schema.fields.map((field) => field.id));
    const workItemTypes = new Set(schema.workItemTypes.map((type) => type.id));

    if (!profile.name.trim()) {
      issues.push(issue('error', 'PROFILE_NAME_REQUIRED', 'Mapping profile name is required'));
    }
    if (!workItemTypes.has(profile.defaultWorkItemType)) {
      issues.push(
        issue(
          'error',
          'INVALID_WORK_ITEM_TYPE',
          `Work item type ${profile.defaultWorkItemType || '(empty)'} is not available`,
          'System.WorkItemType'
        )
      );
    }
    if (!findByPath(schema.projects, profile.defaultProjectPath)) {
      issues.push(
        issue(
          'error',
          'INVALID_PROJECT_PATH',
          `Project path ${profile.defaultProjectPath} is not available`,
          undefined,
          'defaultProjectPath'
        )
      );
    }
    if (!findByPath(schema.areaPaths, profile.defaultAreaPath)) {
      issues.push(
        issue(
          'error',
          'INVALID_AREA_PATH',
          `Area path ${profile.defaultAreaPath} is not available`,
          'System.AreaPath',
          'defaultAreaPath'
        )
      );
    }
    if (!findByPath(schema.iterationPaths, profile.defaultIterationPath)) {
      issues.push(
        issue(
          'error',
          'INVALID_ITERATION_PATH',
          `Iteration path ${profile.defaultIterationPath} is not available`,
          'System.IterationPath',
          'defaultIterationPath'
        )
      );
    }
    if (profile.backlinkFieldId && !fields.has(profile.backlinkFieldId)) {
      issues.push(
        issue(
          'error',
          'INVALID_BACKLINK_FIELD',
          `Backlink field ${profile.backlinkFieldId} is not available`,
          profile.backlinkFieldId
        )
      );
    }

    for (const mapping of profile.fieldMappings) {
      if (!fields.has(mapping.trackerFieldId)) {
        issues.push(
          issue(
            'error',
            'INVALID_FIELD_MAPPING',
            `Tracker field ${mapping.trackerFieldId} is not available`,
            mapping.trackerFieldId
          )
        );
      }
      if (mapping.source === 'literal' && !mapping.literalValue) {
        issues.push(
          issue(
            'warning',
            'EMPTY_LITERAL_MAPPING',
            `Literal mapping for ${mapping.trackerFieldId} has no value`,
            mapping.trackerFieldId
          )
        );
      }
    }

    const mappedFields = new Set(profile.fieldMappings.map((mapping) => mapping.trackerFieldId));
    for (const field of schema.fields.filter((item) => item.required)) {
      const hasDefault =
        (field.id === 'System.WorkItemType' && profile.defaultWorkItemType) ||
        (field.id === 'System.AreaPath' && profile.defaultAreaPath) ||
        (field.id === 'System.IterationPath' && profile.defaultIterationPath);
      if (!hasDefault && !mappedFields.has(field.id)) {
        issues.push(
          issue(
            'error',
            'REQUIRED_FIELD_UNMAPPED',
            `Required field ${field.name} is not mapped or configured`,
            field.id
          )
        );
      }
    }

    return validationResult(issues);
  }

  private validatePayload(
    payload: ExternalTrackerMappedPayload,
    schema: ExternalTrackerSchema
  ): ExternalTrackerValidationResult {
    const issues: ExternalTrackerValidationIssue[] = [];
    for (const field of schema.fields) {
      const value = payload.fields[field.id];
      const empty =
        value === undefined ||
        value === null ||
        value === '' ||
        (Array.isArray(value) && value.length === 0);
      if (field.required && empty) {
        issues.push(
          issue('error', 'REQUIRED_FIELD_EMPTY', `Required field ${field.name} is empty`, field.id)
        );
        continue;
      }
      if (empty || !field.allowedValues?.length) continue;
      const values = Array.isArray(value) ? value : [value];
      const invalidValues = values.filter((item) => !field.allowedValues?.includes(item));
      if (invalidValues.length > 0) {
        issues.push(
          issue(
            'error',
            'INVALID_FIELD_VALUE',
            `${field.name} has invalid value ${invalidValues.join(', ')}`,
            field.id
          )
        );
      }
    }
    return validationResult(issues);
  }

  private async recordSyncAudit(input: Omit<ExternalTrackerSyncAudit, 'id' | 'createdAt'>) {
    await this.ensureLoaded();
    const event: ExternalTrackerSyncAudit = {
      id: `tracker_audit_${nanoid(8)}`,
      createdAt: nowIso(),
      ...input,
    };
    this.state.audits = [event, ...this.state.audits].slice(0, MAX_AUDIT_EVENTS);
    this.state.updatedAt = event.createdAt;
    await this.saveState();
  }

  private ensureDefaultProfile(schema: ExternalTrackerSchema, actor = 'system'): void {
    if (this.state.profiles.some((profile) => profile.provider === schema.provider)) return;
    const profile = defaultProfile(schema);
    profile.updatedBy = cleanText(actor, 'system') || 'system';
    this.state.profiles.push(profile);
  }

  private requireAdapter(provider: ExternalTrackerProvider): ExternalTrackerAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter)
      throw new ValidationError(`External tracker provider ${provider} is not supported`);
    return adapter;
  }

  private emptyState(): ExternalTrackerState {
    return {
      version: 1,
      schemas: {},
      profiles: [],
      audits: [],
      updatedAt: nowIso(),
    };
  }

  private get stateFile(): string {
    return path.join(this.storageDir, STATE_FILE);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (!this.persist) {
      this.state = this.emptyState();
      const schema = await this.requireAdapter(DEFAULT_PROVIDER).introspect(defaultConnection());
      this.state.schemas[DEFAULT_PROVIDER] = schema;
      this.ensureDefaultProfile(schema);
      this.loaded = true;
      return;
    }
    await fs.mkdir(this.storageDir, { recursive: true });
    try {
      const content = await fs.readFile(this.stateFile, 'utf8');
      this.state = { ...this.emptyState(), ...JSON.parse(content) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.state = this.emptyState();
      const schema = await this.requireAdapter(DEFAULT_PROVIDER).introspect(defaultConnection());
      this.state.schemas[DEFAULT_PROVIDER] = schema;
      this.ensureDefaultProfile(schema);
      await this.saveState();
    }
    this.loaded = true;
  }

  private async saveState(): Promise<void> {
    if (!this.persist) return;
    await fs.mkdir(this.storageDir, { recursive: true });
    await withFileLock(this.stateFile, async () => {
      await fs.writeFile(this.stateFile, JSON.stringify(this.state, null, 2), 'utf8');
    });
  }
}

let externalTrackerServiceInstance: ExternalTrackerService | null = null;

export function getExternalTrackerService(): ExternalTrackerService {
  if (!externalTrackerServiceInstance) {
    externalTrackerServiceInstance = new ExternalTrackerService();
  }
  return externalTrackerServiceInstance;
}

export function disposeExternalTrackerService(): void {
  externalTrackerServiceInstance = null;
}
