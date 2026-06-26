import fs from 'fs/promises';
import path from 'path';
import { nanoid } from 'nanoid';
import type {
  CeremonyActionItem,
  CeremonyArtifact,
  CeremonyArtifactKind,
  CeremonyEnforcementMode,
  CeremonyEvaluationResult,
  CeremonyKind,
  CeremonyParticipant,
  CeremonyRequirement,
  CeremonyStatus,
  CompleteCeremonyRequirementInput,
  CreateCeremonyRequirementInput,
  EnforcementSettings,
  Task,
} from '@veritas-kanban/shared';
import { auditLog, type AuditEvent } from './audit-service.js';
import {
  getGovernanceTraceService,
  type GovernanceTraceService,
} from './governance-trace-service.js';
import { withFileLock } from './file-lock.js';
import { ConflictError, NotFoundError } from '../middleware/error-handler.js';
import { ensureWithinBase, validatePathSegment } from '../utils/sanitize.js';
import { getRuntimeDir } from '../utils/paths.js';

const MAX_REQUIREMENTS = 1000;

interface CeremonyState {
  version: 1;
  requirements: CeremonyRequirement[];
  updatedAt: string;
}

export interface CeremonyServiceOptions {
  storageDir?: string;
  persist?: boolean;
  audit?: (event: AuditEvent) => Promise<void>;
  governanceTraceService?: GovernanceTraceService;
}

export interface CeremonyListFilters {
  status?: CeremonyStatus;
  kind?: CeremonyKind;
  taskId?: string;
  limit?: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function defaultParticipants(kind: CeremonyKind): CeremonyParticipant[] {
  if (kind === 'design_review') {
    return [
      { role: 'coordinator' },
      { role: 'implementer' },
      { role: 'reviewer' },
      { role: 'qa-owner' },
    ];
  }
  return [{ role: 'coordinator' }, { role: 'implementer' }, { role: 'reviewer' }];
}

function defaultArtifacts(kind: CeremonyKind): CeremonyArtifactKind[] {
  return kind === 'design_review'
    ? ['decision-packet', 'risk-list', 'action-items']
    : ['retrospective', 'action-items'];
}

function defaultTitle(kind: CeremonyKind): string {
  return kind === 'design_review' ? 'Design review required' : 'Failure retrospective required';
}

function normalizeMode(mode?: CeremonyEnforcementMode): CeremonyEnforcementMode {
  return mode ?? 'warn';
}

function dueInHours(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

export class CeremonyService {
  private readonly storageDir: string;
  private readonly persist: boolean;
  private readonly audit: (event: AuditEvent) => Promise<void>;
  private readonly governanceTraceService: GovernanceTraceService;
  private loaded = false;
  private state: CeremonyState = this.emptyState();

  constructor(options: CeremonyServiceOptions = {}) {
    this.storageDir = options.storageDir ?? path.join(getRuntimeDir(), 'ceremonies');
    this.persist = options.persist ?? process.env.VITEST !== 'true';
    this.audit = options.audit ?? auditLog;
    this.governanceTraceService = options.governanceTraceService ?? getGovernanceTraceService();
  }

  async list(filters: CeremonyListFilters = {}): Promise<CeremonyRequirement[]> {
    await this.ensureLoaded();
    const limit = Math.max(1, Math.min(Math.floor(filters.limit ?? 100), MAX_REQUIREMENTS));
    return this.state.requirements
      .filter((requirement) => !filters.status || requirement.status === filters.status)
      .filter((requirement) => !filters.kind || requirement.kind === filters.kind)
      .filter((requirement) => !filters.taskId || requirement.target.taskId === filters.taskId)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, limit);
  }

  async create(input: CreateCeremonyRequirementInput): Promise<CeremonyRequirement> {
    await this.ensureLoaded();
    const existing = this.findOpenRequirement(input.kind, input.target.taskId, input.target.runId);
    if (existing) return existing;

    const timestamp = nowIso();
    const requirement: CeremonyRequirement = {
      id: `ceremony_${Date.now()}_${nanoid(6)}`,
      kind: input.kind,
      status: 'pending',
      enforcementMode: normalizeMode(input.enforcementMode),
      title: input.title ?? defaultTitle(input.kind),
      reason: input.reason,
      target: input.target,
      trigger: input.trigger,
      dueAt: input.dueAt,
      participants: input.participants ?? defaultParticipants(input.kind),
      requiredArtifacts: input.requiredArtifacts ?? defaultArtifacts(input.kind),
      artifacts: [],
      actionItems: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.state.requirements.push(requirement);
    if (this.state.requirements.length > MAX_REQUIREMENTS) {
      this.state.requirements = this.state.requirements.slice(-MAX_REQUIREMENTS);
    }
    await this.saveState();
    await this.auditChange('ceremony.created', requirement);
    return requirement;
  }

  async complete(
    id: string,
    input: CompleteCeremonyRequirementInput
  ): Promise<CeremonyRequirement> {
    validatePathSegment(id);
    await this.ensureLoaded();
    const requirement = this.findById(id);
    if (!requirement) throw new NotFoundError('Ceremony requirement not found');
    if (requirement.status !== 'pending') {
      throw new ConflictError('Ceremony requirement is not pending');
    }

    const timestamp = nowIso();
    requirement.status = 'completed';
    requirement.completedAt = timestamp;
    requirement.completedBy = input.completedBy;
    requirement.updatedAt = timestamp;
    requirement.artifacts = [
      ...requirement.artifacts,
      ...(input.artifacts ?? []).map<CeremonyArtifact>((artifact) => ({
        ...artifact,
        createdAt: artifact.createdAt ?? timestamp,
      })),
    ];
    requirement.actionItems = [
      ...requirement.actionItems,
      ...(input.actionItems ?? []).map<CeremonyActionItem>((item) => ({
        ...item,
        createdAt: item.createdAt ?? timestamp,
      })),
    ];

    await this.saveState();
    await this.auditChange('ceremony.completed', requirement);
    return requirement;
  }

  async evaluateTaskCompletion(
    task: Task,
    enforcement?: Partial<EnforcementSettings>
  ): Promise<CeremonyEvaluationResult> {
    await this.ensureLoaded();
    const required: CeremonyRequirement[] = [];

    const designMode = enforcement?.ceremonyDesignReview ?? 'off';
    if (
      designMode !== 'off' &&
      this.taskNeedsDesignReview(task) &&
      !this.hasCompletedRequirement('design_review', task.id)
    ) {
      required.push(
        await this.create({
          kind: 'design_review',
          enforcementMode: designMode,
          title: 'Design review required before completion',
          reason: 'Task is high-risk, multi-agent, or review-mode work.',
          target: { taskId: task.id },
          trigger: 'task.completion',
          dueAt: dueInHours(24),
        })
      );
    }

    const retroMode = enforcement?.ceremonyFailureRetrospective ?? 'off';
    if (
      retroMode !== 'off' &&
      this.taskNeedsFailureRetrospective(task) &&
      !this.hasCompletedRequirement('failure_retrospective', task.id)
    ) {
      required.push(
        await this.create({
          kind: 'failure_retrospective',
          enforcementMode: retroMode,
          title: 'Failure retrospective required before completion',
          reason: 'Task has blocked status or failed run attempts.',
          target: { taskId: task.id },
          trigger: 'task.completion',
          dueAt: dueInHours(24),
        })
      );
    }

    const pending = required.filter((requirement) => requirement.status === 'pending');
    const blocking = pending.filter((requirement) => requirement.enforcementMode === 'block');
    const warnings = pending
      .filter((requirement) => requirement.enforcementMode === 'warn')
      .map((requirement) => `${requirement.title}: ${requirement.reason}`);
    const blockedReasons = blocking.map(
      (requirement) => `${requirement.title}: ${requirement.reason}`
    );
    const mode: CeremonyEnforcementMode =
      blocking.length > 0 ? 'block' : warnings.length > 0 ? 'warn' : 'off';

    if (pending.length > 0) {
      await this.recordEvaluationTrace(task, pending, mode);
    }

    return {
      allowed: blocking.length === 0,
      mode,
      pending,
      warnings,
      blockedReasons,
    };
  }

  private taskNeedsDesignReview(task: Task): boolean {
    return (
      (task.agents?.length ?? 0) > 1 ||
      task.priority === 'critical' ||
      task.runMode === 'strategy' ||
      task.runMode === 'eng-review' ||
      task.runMode === 'paranoid-review'
    );
  }

  private taskNeedsFailureRetrospective(task: Task): boolean {
    return (
      task.status === 'blocked' ||
      Boolean(task.blockedReason?.note) ||
      task.attempt?.status === 'failed' ||
      (task.attempts ?? []).some((attempt) => attempt.status === 'failed')
    );
  }

  private async recordEvaluationTrace(
    task: Task,
    pending: CeremonyRequirement[],
    mode: CeremonyEnforcementMode
  ): Promise<void> {
    await this.governanceTraceService.record({
      kind: 'ceremony',
      outcome: mode === 'block' ? 'blocked' : 'warned',
      title: mode === 'block' ? 'Ceremony gate blocked completion' : 'Ceremony gate warned',
      summary: `${pending.length} ceremony requirement(s) pending for ${task.id}.`,
      remediation: 'Complete the required ceremony artifacts or change enforcement mode.',
      subject: { taskId: task.id, actionType: 'task.complete' },
      evaluatedRules: pending.map((requirement) => ({
        id: requirement.id,
        label: requirement.title,
        type: requirement.kind,
        status: 'matched',
        outcome: requirement.enforcementMode === 'block' ? 'blocked' : 'warned',
        message: requirement.reason,
      })),
      matchedRules: pending.map((requirement) => ({
        id: requirement.id,
        label: requirement.title,
        type: requirement.kind,
        status: 'matched',
        outcome: requirement.enforcementMode === 'block' ? 'blocked' : 'warned',
        message: requirement.reason,
      })),
      steps: pending.map((requirement) => ({
        id: requirement.id,
        label: requirement.title,
        status: 'matched',
        message: requirement.reason,
        details: {
          kind: requirement.kind,
          enforcementMode: requirement.enforcementMode,
          requiredArtifacts: requirement.requiredArtifacts,
        },
      })),
    });
  }

  private findOpenRequirement(
    kind: CeremonyKind,
    taskId?: string,
    runId?: string
  ): CeremonyRequirement | undefined {
    return this.state.requirements.find(
      (requirement) =>
        requirement.kind === kind &&
        requirement.status === 'pending' &&
        requirement.target.taskId === taskId &&
        requirement.target.runId === runId
    );
  }

  private hasCompletedRequirement(kind: CeremonyKind, taskId?: string, runId?: string): boolean {
    return this.state.requirements.some(
      (requirement) =>
        requirement.kind === kind &&
        requirement.status === 'completed' &&
        requirement.target.taskId === taskId &&
        requirement.target.runId === runId
    );
  }

  private findById(id: string): CeremonyRequirement | undefined {
    return this.state.requirements.find((requirement) => requirement.id === id);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (!this.persist) {
      this.loaded = true;
      return;
    }

    await fs.mkdir(this.storageDir, { recursive: true });
    try {
      const raw = await fs.readFile(this.statePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<CeremonyState>;
      this.state = {
        version: 1,
        requirements: Array.isArray(parsed.requirements)
          ? (parsed.requirements as CeremonyRequirement[])
          : [],
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : nowIso(),
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      this.state = this.emptyState();
    }
    this.loaded = true;
  }

  private async saveState(): Promise<void> {
    this.state.updatedAt = nowIso();
    if (!this.persist) return;
    await fs.mkdir(this.storageDir, { recursive: true });
    await withFileLock(this.statePath, async () => {
      await fs.writeFile(this.statePath, JSON.stringify(this.state, null, 2), 'utf-8');
    });
  }

  private get statePath(): string {
    const filePath = path.join(this.storageDir, 'requirements.json');
    ensureWithinBase(this.storageDir, filePath);
    return filePath;
  }

  private emptyState(): CeremonyState {
    return { version: 1, requirements: [], updatedAt: nowIso() };
  }

  private async auditChange(action: string, requirement: CeremonyRequirement): Promise<void> {
    await this.audit({
      action,
      actor: requirement.completedBy ?? 'system',
      resource: requirement.id,
      details: {
        kind: requirement.kind,
        status: requirement.status,
        enforcementMode: requirement.enforcementMode,
        target: requirement.target,
        requiredArtifacts: requirement.requiredArtifacts,
        actionItems: requirement.actionItems.map((item) => ({
          title: item.title,
          taskId: item.taskId,
          issueUrl: item.issueUrl,
          assignee: item.assignee,
          priority: item.priority,
          dueAt: item.dueAt,
        })),
      },
    });
  }
}

let ceremonyService: CeremonyService | null = null;

export function getCeremonyService(): CeremonyService {
  ceremonyService ??= new CeremonyService();
  return ceremonyService;
}

export function resetCeremonyServiceForTests(): void {
  ceremonyService = null;
}
