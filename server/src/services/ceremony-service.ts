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
import { ConflictError, NotFoundError } from '../middleware/error-handler.js';
import { validatePathSegment } from '../utils/sanitize.js';
import { getRuntimeDir } from '../utils/paths.js';
import {
  FileCeremonyStateRepository,
  InMemoryCeremonyStateRepository,
  type CeremonyState,
  type CeremonyStateRepository,
} from '../storage/ceremony-state-repository.js';

const MAX_REQUIREMENTS = 1000;

export interface CeremonyServiceOptions {
  storageDir?: string;
  persist?: boolean;
  audit?: (event: AuditEvent) => Promise<void>;
  governanceTraceService?: GovernanceTraceService;
  repository?: CeremonyStateRepository;
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
  private readonly audit: (event: AuditEvent) => Promise<void>;
  private readonly governanceTraceService: GovernanceTraceService;
  private readonly repository: CeremonyStateRepository;

  constructor(options: CeremonyServiceOptions = {}) {
    this.audit = options.audit ?? auditLog;
    this.governanceTraceService = options.governanceTraceService ?? getGovernanceTraceService();
    const persist = options.persist ?? process.env.VITEST !== 'true';
    this.repository =
      options.repository ??
      (persist
        ? new FileCeremonyStateRepository(
            options.storageDir ?? path.join(getRuntimeDir(), 'ceremonies')
          )
        : new InMemoryCeremonyStateRepository());
  }

  async list(filters: CeremonyListFilters = {}): Promise<CeremonyRequirement[]> {
    const state = await this.repository.read();
    const limit = Math.max(1, Math.min(Math.floor(filters.limit ?? 100), MAX_REQUIREMENTS));
    return state.requirements
      .filter((requirement) => !filters.status || requirement.status === filters.status)
      .filter((requirement) => !filters.kind || requirement.kind === filters.kind)
      .filter((requirement) => !filters.taskId || requirement.target.taskId === filters.taskId)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, limit);
  }

  async create(input: CreateCeremonyRequirementInput): Promise<CeremonyRequirement> {
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
    let selected = requirement;
    await this.repository.update((state) => {
      const existing = this.findOpenRequirement(
        state,
        input.kind,
        input.target.taskId,
        input.target.runId
      );
      if (existing) {
        selected = existing;
        return state;
      }
      return {
        ...state,
        requirements: [...state.requirements, requirement].slice(-MAX_REQUIREMENTS),
      };
    });
    if (selected !== requirement) return selected;
    await this.auditChange('ceremony.created', requirement);
    return requirement;
  }

  async complete(
    id: string,
    input: CompleteCeremonyRequirementInput
  ): Promise<CeremonyRequirement> {
    validatePathSegment(id);
    const timestamp = nowIso();
    let completed: CeremonyRequirement | undefined;
    await this.repository.update((state) => {
      const requirement = this.findById(state, id);
      if (!requirement) throw new NotFoundError('Ceremony requirement not found');
      if (requirement.status !== 'pending') {
        throw new ConflictError('Ceremony requirement is not pending');
      }
      const completedRequirement: CeremonyRequirement = {
        ...requirement,
        status: 'completed',
        completedAt: timestamp,
        completedBy: input.completedBy,
        updatedAt: timestamp,
        artifacts: [
          ...requirement.artifacts,
          ...(input.artifacts ?? []).map<CeremonyArtifact>((artifact) => ({
            ...artifact,
            createdAt: artifact.createdAt ?? timestamp,
          })),
        ],
        actionItems: [
          ...requirement.actionItems,
          ...(input.actionItems ?? []).map<CeremonyActionItem>((item) => ({
            ...item,
            createdAt: item.createdAt ?? timestamp,
          })),
        ],
      };
      completed = completedRequirement;
      return {
        ...state,
        requirements: state.requirements.map((candidate) =>
          candidate.id === id ? completedRequirement : candidate
        ),
      };
    });
    if (!completed) throw new NotFoundError('Ceremony requirement not found');
    await this.auditChange('ceremony.completed', completed);
    return completed;
  }

  async evaluateTaskCompletion(
    task: Task,
    enforcement?: Partial<EnforcementSettings>
  ): Promise<CeremonyEvaluationResult> {
    const state = await this.repository.read();
    const required: CeremonyRequirement[] = [];

    const designMode = enforcement?.ceremonyDesignReview ?? 'off';
    if (
      designMode !== 'off' &&
      this.taskNeedsDesignReview(task) &&
      !this.hasCompletedRequirement(state, 'design_review', task.id)
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
      !this.hasCompletedRequirement(state, 'failure_retrospective', task.id)
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
    state: CeremonyState,
    kind: CeremonyKind,
    taskId?: string,
    runId?: string
  ): CeremonyRequirement | undefined {
    return state.requirements.find(
      (requirement) =>
        requirement.kind === kind &&
        requirement.status === 'pending' &&
        requirement.target.taskId === taskId &&
        requirement.target.runId === runId
    );
  }

  private hasCompletedRequirement(
    state: CeremonyState,
    kind: CeremonyKind,
    taskId?: string,
    runId?: string
  ): boolean {
    return state.requirements.some(
      (requirement) =>
        requirement.kind === kind &&
        requirement.status === 'completed' &&
        requirement.target.taskId === taskId &&
        requirement.target.runId === runId
    );
  }

  private findById(state: CeremonyState, id: string): CeremonyRequirement | undefined {
    return state.requirements.find((requirement) => requirement.id === id);
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
