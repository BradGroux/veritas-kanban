import { createHash } from 'node:crypto';
import {
  AUTOMATION_ACTIVATION_PREVIEW_SCHEMA_VERSION,
  AUTOMATION_BINDING_SCHEMA_VERSION,
  AUTOMATION_RUN_CLAIM_SCHEMA_VERSION,
  AUTOMATION_VERSION_SCHEMA_VERSION,
  EXECUTABLE_AGENT_PROVIDERS,
  type AutomationActivationPreview,
  type AutomationActivationResult,
  type AutomationBinding,
  type AutomationBindingStatus,
  type AutomationDraft,
  type AutomationRunClaim,
  type AutomationVersion,
  type AutomationVersionListResponse,
  type ExecutableAgentProvider,
  type RunApprovalRequest,
  type TaskTemplate,
  type WorkflowDefinition,
} from '@veritas-kanban/shared';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/error-handler.js';
import {
  FileSchedulerStateRepository,
  type SchedulerStateRepository,
} from '../storage/scheduler-state-repository.js';
import { getCommunicationAdapterService } from './communication-adapter-service.js';
import { getOutboundIntegrationService } from './outbound-integration-service.js';
import {
  AutomationDraftService,
  getAutomationDraftService,
  nextAutomationRunAt,
} from './automation-draft-service.js';
import {
  getRunApprovalBrokerService,
  type RunApprovalBrokerService,
} from './run-approval-broker-service.js';
import { getWorkflowService, type WorkflowService } from './workflow-service.js';
import { getToolPolicyService } from './tool-policy-service.js';
import { getStorage } from '../storage/index.js';

const DEFAULT_APPROVAL_TTL_MS = 15 * 60_000;
const MAX_CLAIMS = 1_000;
const MAX_EVENTS = 200;

export interface AutomationActivationServiceOptions {
  stateRepository?: SchedulerStateRepository;
  drafts?: Pick<AutomationDraftService, 'get'>;
  workflows?: Pick<WorkflowService, 'loadWorkflow'> &
    Partial<Pick<WorkflowService, 'saveWorkflow'>>;
  templates?: { getTemplate(id: string): Promise<TaskTemplate | null> };
  approvals?: Pick<RunApprovalBrokerService, 'request' | 'get'>;
  integrationEvidence?: (
    ids: string[]
  ) => Promise<Array<{ id: string; ready: boolean; evidenceDigest?: string }>>;
  toolPolicyEvidence?: (roles: string[]) => Promise<Record<string, unknown>>;
  now?: () => Date;
}

export interface AutomationActivationApplyInput {
  draftId: string;
  revision?: number;
  requestId: string;
  expectedRequestRevision: string;
  approvalId?: string;
  approvalTtlMs?: number;
}

export interface AutomationRunClaimResult {
  claim: AutomationRunClaim;
  version: AutomationVersion;
  binding: AutomationBinding;
  replayed: boolean;
}

export class AutomationActivationService {
  private readonly stateRepository: SchedulerStateRepository;
  private readonly drafts: Pick<AutomationDraftService, 'get'>;
  private readonly workflows: Pick<WorkflowService, 'loadWorkflow'> &
    Partial<Pick<WorkflowService, 'saveWorkflow'>>;
  private readonly templates: { getTemplate(id: string): Promise<TaskTemplate | null> };
  private readonly approvals: Pick<RunApprovalBrokerService, 'request' | 'get'>;
  private readonly integrationEvidence: (
    ids: string[]
  ) => Promise<Array<{ id: string; ready: boolean; evidenceDigest?: string }>>;
  private readonly toolPolicyEvidence: (roles: string[]) => Promise<Record<string, unknown>>;
  private readonly now: () => Date;

  constructor(options: AutomationActivationServiceOptions = {}) {
    this.stateRepository = options.stateRepository ?? new FileSchedulerStateRepository();
    this.drafts = options.drafts ?? getAutomationDraftService();
    this.workflows = options.workflows ?? getWorkflowService();
    this.templates =
      options.templates ??
      ({
        getTemplate: async (id: string) => getStorage().templates.getTemplate(id),
      } satisfies AutomationActivationServiceOptions['templates']);
    this.approvals = options.approvals ?? getRunApprovalBrokerService();
    this.integrationEvidence = options.integrationEvidence ?? currentIntegrationEvidence;
    this.toolPolicyEvidence = options.toolPolicyEvidence ?? currentToolPolicyEvidence;
    this.now = options.now ?? (() => new Date());
  }

  async preview(
    draftId: string,
    requestId: string,
    revision?: number
  ): Promise<AutomationActivationPreview> {
    const draft = await this.drafts.get(draftId, revision);
    assertResolvedDraft(draft);
    const provider = required(draft.execution.provider.value, 'execution.provider');
    const { workflow, sourceTarget } = await this.resolveExecutionTarget(draft, provider);
    const integrations = await this.integrationEvidence(
      draft.standingScope.value?.integrationIds ?? []
    );
    const toolPolicies = await this.toolPolicyEvidence(
      [...new Set(workflow.agents.map((agent) => agent.role))].sort()
    );
    const blockers = integrations
      .filter((candidate) => !candidate.ready)
      .map((candidate) => `Integration ${candidate.id} is unavailable or disabled.`);
    if (!EXECUTABLE_AGENT_PROVIDERS.includes(provider as ExecutableAgentProvider)) {
      blockers.push(`Provider ${provider} is not executable.`);
    }
    if (provider !== 'openclaw' && provider !== 'codex-sdk') {
      blockers.push(`Provider ${provider} has no workflow execution adapter.`);
    }
    if (workflow.agents.some((agent) => agent.provider && agent.provider !== provider)) {
      blockers.push('Workflow agent provider evidence conflicts with the requested provider.');
    }

    const schedule = {
      expression: required(draft.schedule.expression.value, 'schedule.expression'),
      timezone: required(draft.schedule.timezone.value, 'schedule.timezone'),
      ...(draft.schedule.startAt.value ? { startAt: draft.schedule.startAt.value } : {}),
      expiresAt: required(draft.schedule.expiresAt.value, 'schedule.expiresAt'),
      overlapPolicy: required(draft.schedule.overlapPolicy.value, 'schedule.overlapPolicy'),
      retry: required(draft.schedule.retry.value, 'schedule.retry'),
      nextRunAt: nextAutomationRunAt(
        required(draft.schedule.expression.value, 'schedule.expression'),
        required(draft.schedule.timezone.value, 'schedule.timezone'),
        this.now(),
        draft.schedule.expiresAt.value
      ),
    };
    const standingScope = required(draft.standingScope.value, 'standingScope');
    const evidenceBase = {
      sourceTarget,
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      workflowDigest: digest(workflow),
      provider,
      providerEvidenceDigest: digest({
        provider,
        executable: blockers.length === 0,
        workflowAgents: workflow.agents.map((agent) => ({
          id: agent.id,
          provider: agent.provider,
          command: agent.command,
        })),
      }),
      toolCatalogDigest: digest({ requested: [...standingScope.toolIds].sort(), toolPolicies }),
      integrationEvidenceDigest: digest(integrations),
      policyDigest: digest({
        workspaceId: draft.source.workspaceId.value,
        standingScope,
        perRunBudget: draft.perRunBudget.value,
        aggregateBudget: draft.aggregateBudget.value,
        output: draft.output,
        stopConditions: draft.stopConditions.value,
      }),
      enforceable: blockers.length === 0,
      blockers,
    };
    const base = {
      schemaVersion: AUTOMATION_ACTIVATION_PREVIEW_SCHEMA_VERSION,
      draftId: draft.id,
      draftRevision: draft.revision,
      draftDigest: draft.digest,
      requestId,
      workspaceId: required(draft.source.workspaceId.value, 'source.workspaceId'),
      ...(draft.source.taskId.value ? { sourceTaskId: draft.source.taskId.value } : {}),
      objective: required(draft.objective.value, 'objective'),
      schedule,
      output: {
        destination: required(draft.output.destination.value, 'output.destination'),
        expectedDeliverables: required(
          draft.output.expectedDeliverables.value,
          'output.expectedDeliverables'
        ),
      },
      standingScope,
      perRunBudget: required(draft.perRunBudget.value, 'perRunBudget'),
      aggregateBudget: required(draft.aggregateBudget.value, 'aggregateBudget'),
      stopConditions: required(draft.stopConditions.value, 'stopConditions'),
      effectiveRunAccess: {
        reads: [...standingScope.reads],
        writes: [...standingScope.writes],
        sends: [...standingScope.sends],
        externalTargets: [...standingScope.externalTargets],
        artifactDestinations: [...standingScope.artifactDestinations],
        tools: [...standingScope.toolIds],
        integrations: integrations.filter((candidate) => candidate.ready).map(({ id }) => id),
        approvalRequiredActions: [...standingScope.approvalRequiredActions],
      },
      evidence: evidenceBase,
      approval: {
        required: true as const,
        riskClass: 'critical' as const,
        expiresInMs: DEFAULT_APPROVAL_TTL_MS,
      },
    };
    return { ...base, requestRevision: digest(base) };
  }

  private async resolveExecutionTarget(
    draft: AutomationDraft,
    provider: string
  ): Promise<{
    workflow: WorkflowDefinition;
    sourceTarget: AutomationActivationPreview['evidence']['sourceTarget'];
  }> {
    if (draft.execution.workflowId.value) {
      const workflow = await this.workflows.loadWorkflow(draft.execution.workflowId.value);
      if (!workflow) {
        throw new NotFoundError(`Workflow ${draft.execution.workflowId.value} not found.`);
      }
      return {
        workflow,
        sourceTarget: {
          kind: 'workflow',
          id: workflow.id,
          version: workflow.version,
          digest: digest(workflow),
        },
      };
    }
    const templateId = required(draft.execution.taskTemplateId.value, 'execution.taskTemplateId');
    const template = await this.templates.getTemplate(templateId);
    if (!template) throw new NotFoundError(`Task template ${templateId} not found.`);
    return {
      workflow: taskTemplateWorkflow(template, provider, draft),
      sourceTarget: {
        kind: 'task-template',
        id: template.id,
        version: template.version,
        digest: digest(template),
      },
    };
  }

  async apply(input: AutomationActivationApplyInput): Promise<AutomationActivationResult> {
    const preview = await this.preview(input.draftId, input.requestId, input.revision);
    if (preview.requestRevision !== input.expectedRequestRevision) {
      throw new ConflictError('Automation activation preview is stale.', {
        expectedRequestRevision: input.expectedRequestRevision,
        currentRequestRevision: preview.requestRevision,
      });
    }
    if (!preview.evidence.enforceable) {
      throw new ValidationError(
        `Automation activation is blocked: ${preview.evidence.blockers.join(' ')}`
      );
    }

    const approval = await this.requestApproval(preview, input.approvalTtlMs);
    if (!input.approvalId) {
      return { preview, approvalId: approval.id, approvalStatus: 'pending' };
    }
    if (input.approvalId !== approval.id) {
      throw new ConflictError('Approval does not match this exact automation activation.', {
        expectedApprovalId: approval.id,
        receivedApprovalId: input.approvalId,
      });
    }
    const resolved = await this.approvals.get(input.approvalId, preview.workspaceId);
    if (resolved.status !== 'approved' || !resolved.resolution) {
      throw new ConflictError('Automation activation approval is not approved.', {
        approvalId: resolved.id,
        status: resolved.status,
      });
    }
    const resolution = resolved.resolution;

    if (preview.evidence.sourceTarget.kind === 'task-template') {
      const draft = await this.drafts.get(preview.draftId, preview.draftRevision);
      const { workflow } = await this.resolveExecutionTarget(draft, preview.evidence.provider);
      if (digest(workflow) !== preview.evidence.workflowDigest) {
        throw new ConflictError('Derived task-template workflow changed before activation.');
      }
      if (!this.workflows.saveWorkflow) {
        throw new ValidationError('Task-template activation cannot persist its derived workflow.');
      }
      await this.workflows.saveWorkflow(workflow);
    }

    let version: AutomationVersion | undefined;
    let binding: AutomationBinding | undefined;
    await this.stateRepository.update((state) => {
      const replay = Object.values(state.automationVersions).find(
        (candidate) => candidate.requestRevision === preview.requestRevision
      );
      if (replay) {
        version = replay;
        binding = Object.values(state.automationBindings).find(
          (candidate) => candidate.automationVersionId === replay.id
        );
        return state;
      }
      const now = this.now().toISOString();
      const versionNumber =
        Object.values(state.automationVersions).filter(
          (candidate) => candidate.draftId === preview.draftId
        ).length + 1;
      const versionId = `automation_version_${hex(preview.requestRevision).slice(0, 24)}`;
      const unsignedVersion = {
        schemaVersion: AUTOMATION_VERSION_SCHEMA_VERSION,
        id: versionId,
        version: versionNumber,
        draftId: preview.draftId,
        draftRevision: preview.draftRevision,
        draftDigest: preview.draftDigest,
        requestRevision: preview.requestRevision,
        workspaceId: preview.workspaceId,
        ...(preview.sourceTaskId ? { sourceTaskId: preview.sourceTaskId } : {}),
        objective: preview.objective,
        workflowId: preview.evidence.workflowId,
        workflowVersion: preview.evidence.workflowVersion,
        provider: preview.evidence.provider,
        schedule: preview.schedule,
        output: preview.output,
        standingScope: preview.standingScope,
        perRunBudget: preview.perRunBudget,
        aggregateBudget: preview.aggregateBudget,
        stopConditions: preview.stopConditions,
        evidence: preview.evidence,
        approval: {
          id: resolved.id,
          revision: resolved.revision,
          actionHash: resolved.actionHash,
          approvedBy: resolution.actor.id,
          approvedAt: resolution.decidedAt,
        },
        activatedAt: now,
      };
      version = { ...unsignedVersion, digest: digest(unsignedVersion) };
      const bindingId = `automation_binding_${hex(digest(versionId)).slice(0, 24)}`;
      const supersededEvents = Object.values(state.automationBindings).flatMap((candidate) => {
        const candidateVersion = state.automationVersions[candidate.automationVersionId];
        if (
          candidateVersion?.draftId !== preview.draftId ||
          candidate.status === 'revoked' ||
          candidate.status === 'expired'
        ) {
          return [];
        }
        const revoked = {
          ...candidate,
          status: 'revoked' as const,
          statusReason: `Superseded by immutable automation version ${versionId}.`,
          revision: candidate.revision + 1,
          updatedAt: now,
        };
        state.automationBindings[candidate.id] = revoked;
        return [automationEvent(revoked, 'revoke', 'success', revoked.statusReason, now)];
      });
      binding = {
        schemaVersion: AUTOMATION_BINDING_SCHEMA_VERSION,
        id: bindingId,
        revision: 1,
        automationVersionId: versionId,
        automationVersion: versionNumber,
        status: 'active',
        nextRunAt: preview.schedule.nextRunAt,
        acceptedRuns: 0,
        failedRuns: 0,
        aggregateUsage: { runs: 0, costUsd: 0, tokens: 0, durationMinutes: 0 },
        statusReason: 'Activated with exact human approval.',
        createdAt: now,
        updatedAt: now,
      };
      state.automationVersions[versionId] = version;
      state.automationBindings[bindingId] = binding;
      state.events = [
        ...state.events,
        ...supersededEvents,
        automationEvent(
          binding,
          'activate',
          'success',
          'Immutable automation version activated.',
          now
        ),
      ].slice(-MAX_EVENTS);
      return state;
    });
    if (!version || !binding) throw new Error('Automation activation persistence failed.');
    return { preview, approvalId: resolved.id, approvalStatus: 'approved', version, binding };
  }

  async list(): Promise<AutomationVersionListResponse> {
    const state = await this.stateRepository.read();
    return {
      generatedAt: this.now().toISOString(),
      versions: Object.values(state.automationVersions).sort((a, b) =>
        b.activatedAt.localeCompare(a.activatedAt)
      ),
      bindings: Object.values(state.automationBindings).sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt)
      ),
      recentClaims: [...state.automationClaims].slice(-100).reverse(),
    };
  }

  async getVersion(versionId: string): Promise<AutomationVersion> {
    const version = (await this.stateRepository.read()).automationVersions[versionId];
    if (!version) throw new NotFoundError(`Automation version ${versionId} not found.`);
    return version;
  }

  async updateBinding(
    bindingId: string,
    expectedRevision: number,
    status: Extract<AutomationBindingStatus, 'active' | 'paused' | 'revoked'>,
    reason: string
  ): Promise<AutomationBinding> {
    let result: AutomationBinding | undefined;
    await this.stateRepository.update((state) => {
      const current = state.automationBindings[bindingId];
      if (!current) throw new NotFoundError(`Automation binding ${bindingId} not found.`);
      if (current.revision !== expectedRevision) {
        throw new ConflictError('Automation binding compare-and-set was rejected.', {
          expectedRevision,
          currentRevision: current.revision,
        });
      }
      if (current.status === 'revoked') {
        throw new ConflictError('Revoked automation bindings cannot be resumed.');
      }
      result = {
        ...current,
        status,
        statusReason: reason,
        revision: current.revision + 1,
        updatedAt: this.now().toISOString(),
      };
      state.automationBindings[bindingId] = result;
      state.events = [
        ...state.events,
        automationEvent(
          result,
          status === 'active' ? 'resume' : status === 'paused' ? 'pause' : 'revoke',
          'success',
          reason,
          result.updatedAt
        ),
      ].slice(-MAX_EVENTS);
      return state;
    });
    return required(result, 'binding');
  }

  async claimRun(
    bindingId: string,
    trigger: 'due-run' | 'manual-run',
    now = this.now()
  ): Promise<AutomationRunClaimResult> {
    const snapshot = await this.stateRepository.read();
    const snapshotBinding = snapshot.automationBindings[bindingId];
    if (!snapshotBinding) throw new NotFoundError(`Automation binding ${bindingId} not found.`);
    const snapshotVersion = snapshot.automationVersions[snapshotBinding.automationVersionId];
    if (!snapshotVersion) {
      throw new NotFoundError(
        `Automation version ${snapshotBinding.automationVersionId} not found.`
      );
    }
    const driftBlocker = await this.runtimeDriftBlocker(snapshotVersion);
    let result: AutomationRunClaimResult | undefined;
    await this.stateRepository.update((state) => {
      let binding = state.automationBindings[bindingId];
      if (!binding) throw new NotFoundError(`Automation binding ${bindingId} not found.`);
      const version = state.automationVersions[binding.automationVersionId];
      if (!version)
        throw new NotFoundError(`Automation version ${binding.automationVersionId} not found.`);
      if (
        binding.revision !== snapshotBinding.revision ||
        version.digest !== snapshotVersion.digest
      ) {
        throw new ConflictError('Automation binding changed during run admission.', {
          expectedBindingRevision: snapshotBinding.revision,
          currentBindingRevision: binding.revision,
        });
      }
      const dueWindow = trigger === 'due-run' ? binding.nextRunAt : minuteWindow(now);
      if (!dueWindow) throw new ValidationError('Automation has no due run window.');
      const requestId = `automation:${version.id}:${trigger}:${dueWindow}`;
      const existing = state.automationClaims.find((claim) => claim.requestId === requestId);
      if (existing) {
        result = { claim: existing, version, binding, replayed: true };
        return state;
      }
      const blocker = bindingBlocker(binding, version, now) ?? driftBlocker;
      const claimId = `automation_claim_${hex(digest(requestId)).slice(0, 24)}`;
      const timestamp = now.toISOString();
      const claim: AutomationRunClaim = {
        schemaVersion: AUTOMATION_RUN_CLAIM_SCHEMA_VERSION,
        id: claimId,
        requestId,
        automationVersionId: version.id,
        bindingId,
        dueWindow,
        trigger,
        status: blocker ? 'blocked' : 'accepted',
        ...(blocker ? { reason: blocker } : {}),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      if (blocker) {
        binding = {
          ...binding,
          status: Date.parse(version.schedule.expiresAt) <= now.getTime() ? 'expired' : 'blocked',
          statusReason: blocker,
          revision: binding.revision + 1,
          updatedAt: timestamp,
        };
      } else {
        binding = {
          ...binding,
          acceptedRuns: binding.acceptedRuns + 1,
          aggregateUsage: {
            ...binding.aggregateUsage,
            runs: binding.aggregateUsage.runs + 1,
          },
          lastRunAt: timestamp,
          nextRunAt: nextAutomationRunAt(
            version.schedule.expression,
            version.schedule.timezone,
            now,
            version.schedule.expiresAt
          ),
          revision: binding.revision + 1,
          updatedAt: timestamp,
        };
      }
      state.automationBindings[bindingId] = binding;
      state.automationClaims = [...state.automationClaims, claim].slice(-MAX_CLAIMS);
      result = { claim, version, binding, replayed: false };
      return state;
    });
    return required(result, 'claim result');
  }

  private async runtimeDriftBlocker(version: AutomationVersion): Promise<string | undefined> {
    if (version.evidence.sourceTarget.kind === 'task-template') {
      const template = await this.templates.getTemplate(version.evidence.sourceTarget.id);
      if (
        !template ||
        template.version !== version.evidence.sourceTarget.version ||
        digest(template) !== version.evidence.sourceTarget.digest
      ) {
        return `Task template ${version.evidence.sourceTarget.id} changed after automation activation.`;
      }
    }
    const workflow = await this.workflows.loadWorkflow(version.workflowId);
    if (!workflow) return `Workflow ${version.workflowId} is unavailable.`;
    if (
      workflow.version !== version.workflowVersion ||
      digest(workflow) !== version.evidence.workflowDigest
    ) {
      return `Workflow ${version.workflowId} changed after automation activation.`;
    }
    const integrations = await this.integrationEvidence(version.standingScope.integrationIds);
    if (integrations.some((candidate) => !candidate.ready)) {
      return 'One or more required integrations are unavailable or disabled.';
    }
    if (digest(integrations) !== version.evidence.integrationEvidenceDigest) {
      return 'Required integration evidence changed after automation activation.';
    }
    const toolPolicies = await this.toolPolicyEvidence(
      [...new Set(workflow.agents.map((agent) => agent.role))].sort()
    );
    if (
      digest({ requested: [...version.standingScope.toolIds].sort(), toolPolicies }) !==
      version.evidence.toolCatalogDigest
    ) {
      return 'Workflow tool policy changed after automation activation.';
    }
    if (
      digest({
        provider: version.provider,
        executable: true,
        workflowAgents: workflow.agents.map((agent) => ({
          id: agent.id,
          provider: agent.provider,
          command: agent.command,
        })),
      }) !== version.evidence.providerEvidenceDigest
    ) {
      return 'Provider evidence changed after automation activation.';
    }
    if (!EXECUTABLE_AGENT_PROVIDERS.includes(version.provider as ExecutableAgentProvider)) {
      return `Provider ${version.provider} is no longer executable.`;
    }
    return undefined;
  }

  async markRunStarted(claimId: string, workflowRunId: string): Promise<AutomationRunClaim> {
    return this.updateClaim(claimId, 'started', { workflowRunId });
  }

  async markRunFailed(claimId: string, reason: string): Promise<AutomationRunClaim> {
    return this.updateClaim(claimId, 'failed', { reason });
  }

  async markRunCompleted(
    claimId: string,
    usage: { costUsd: number; tokens: number; durationMinutes: number }
  ): Promise<AutomationRunClaim> {
    let result: AutomationRunClaim | undefined;
    await this.stateRepository.update((state) => {
      const index = state.automationClaims.findIndex((claim) => claim.id === claimId);
      if (index < 0) throw new NotFoundError(`Automation run claim ${claimId} not found.`);
      const current = state.automationClaims[index];
      if (current.status === 'completed') {
        result = current;
        return state;
      }
      if (current.status !== 'started') {
        throw new ConflictError('Only a started automation claim can complete.', {
          claimId,
          status: current.status,
        });
      }
      result = { ...current, status: 'completed', updatedAt: this.now().toISOString() };
      state.automationClaims[index] = result;
      const binding = state.automationBindings[current.bindingId];
      const version = binding ? state.automationVersions[binding.automationVersionId] : undefined;
      if (binding && version) {
        const aggregateUsage = {
          runs: binding.aggregateUsage.runs,
          costUsd: binding.aggregateUsage.costUsd + Math.max(0, usage.costUsd),
          tokens: binding.aggregateUsage.tokens + Math.max(0, Math.trunc(usage.tokens)),
          durationMinutes:
            binding.aggregateUsage.durationMinutes + Math.max(0, usage.durationMinutes),
        };
        const exhaustion = aggregateBudgetBlocker(version, aggregateUsage);
        state.automationBindings[binding.id] = {
          ...binding,
          aggregateUsage,
          failedRuns: 0,
          ...(exhaustion ? { status: 'blocked' as const, statusReason: exhaustion } : {}),
          revision: binding.revision + 1,
          updatedAt: this.now().toISOString(),
        };
      }
      return state;
    });
    return required(result, 'claim');
  }

  private async updateClaim(
    claimId: string,
    status: Extract<AutomationRunClaim['status'], 'started' | 'failed'>,
    update: Pick<AutomationRunClaim, 'workflowRunId' | 'reason'>
  ): Promise<AutomationRunClaim> {
    let result: AutomationRunClaim | undefined;
    await this.stateRepository.update((state) => {
      const index = state.automationClaims.findIndex((claim) => claim.id === claimId);
      if (index < 0) throw new NotFoundError(`Automation run claim ${claimId} not found.`);
      const current = state.automationClaims[index];
      if (current.status === status) {
        result = current;
        return state;
      }
      if (
        current.status !== 'accepted' &&
        !(status === 'failed' && current.status === 'started') &&
        current.status !== status
      ) {
        throw new ConflictError('Automation run claim is already terminal.', {
          claimId,
          status: current.status,
        });
      }
      result = {
        ...current,
        status,
        ...(update.workflowRunId ? { workflowRunId: update.workflowRunId } : {}),
        ...(update.reason ? { reason: update.reason } : {}),
        updatedAt: this.now().toISOString(),
      };
      state.automationClaims[index] = result;
      if (status === 'failed') {
        const binding = state.automationBindings[current.bindingId];
        if (binding) {
          const version = state.automationVersions[binding.automationVersionId];
          const failedRuns = binding.failedRuns + 1;
          const retryLimit = version?.schedule.retry.maxAttempts ?? 0;
          state.automationBindings[current.bindingId] = {
            ...binding,
            failedRuns,
            ...(failedRuns >= retryLimit
              ? {
                  status: 'blocked' as const,
                  statusReason: `Retry limit reached: ${update.reason ?? 'launch failed'}`,
                }
              : {}),
            revision: binding.revision + 1,
            updatedAt: this.now().toISOString(),
          };
        }
      }
      return state;
    });
    return required(result, 'claim');
  }

  private async requestApproval(
    preview: AutomationActivationPreview,
    ttlMs?: number
  ): Promise<RunApprovalRequest> {
    const provider = preview.evidence.provider as ExecutableAgentProvider;
    return this.approvals.request({
      workspaceId: preview.workspaceId,
      taskId: preview.sourceTaskId ?? preview.draftId,
      attemptId: `activation-${hex(preview.requestRevision).slice(0, 24)}`,
      provider,
      agentId: 'scheduler',
      requestKind: 'approval',
      actionClass: 'workflow',
      action: `Activate immutable automation ${preview.draftId} revision ${preview.draftRevision}`,
      exactAction: preview,
      details: 'Grants bounded standing authority until the exact version expires or is revoked.',
      resourceScope: [
        ...preview.standingScope.reads,
        ...preview.standingScope.writes,
        ...preview.standingScope.sends,
        ...preview.standingScope.externalTargets,
      ],
      riskClass: 'critical',
      policyReason: 'Recurring execution requires exact human approval of standing authority.',
      evidenceRevision: preview.requestRevision,
      providerRequestId: preview.requestId,
      mobileSafe: false,
      ttlMs: ttlMs ?? DEFAULT_APPROVAL_TTL_MS,
    });
  }
}

function assertResolvedDraft(draft: AutomationDraft): void {
  if (!draft.validation.valid) {
    throw new ValidationError('Automation draft is not valid for activation.', {
      blockers: draft.validation.issues.filter((issue) => issue.severity === 'blocker'),
    });
  }
}

function taskTemplateWorkflow(
  template: TaskTemplate,
  provider: string,
  draft: AutomationDraft
): WorkflowDefinition {
  const templateDigest = digest(template);
  const workflowId = `automation-template-${hex(templateDigest).slice(0, 24)}`;
  const objective = required(draft.objective.value, 'objective');
  const destination = required(draft.output.destination.value, 'output.destination');
  const tools = required(draft.standingScope.value, 'standingScope').toolIds;
  return {
    id: workflowId,
    name: `Automation: ${template.name}`,
    version: 1,
    description: `Immutable workflow derived from task template ${template.id} version ${template.version}.`,
    agents: [
      {
        id: 'automation-template-agent',
        name: template.name,
        role: 'orchestrator',
        provider,
        command: provider === 'codex-sdk' ? 'codex' : 'openclaw',
        description: template.description ?? `Execute task template ${template.id}.`,
        tools: [...tools],
      },
    ],
    steps: [
      {
        id: 'execute-template',
        name: template.name,
        type: 'agent',
        agent: 'automation-template-agent',
        input: `${objective}\n\nApply task template ${template.id} version ${template.version}. Write the reviewed deliverables to ${destination}.`,
        acceptance_criteria: required(
          draft.output.expectedDeliverables.value,
          'output.expectedDeliverables'
        ),
      },
    ],
    variables: {
      automationTemplate: {
        id: template.id,
        version: template.version,
        digest: templateDigest,
      },
    },
    createdBy: 'automation-activation',
    updatedBy: 'automation-activation',
  };
}

function bindingBlocker(
  binding: AutomationBinding,
  version: AutomationVersion,
  now: Date
): string | undefined {
  if (binding.status !== 'active') return `Automation binding is ${binding.status}.`;
  if (Date.parse(version.schedule.expiresAt) <= now.getTime()) return 'Automation version expired.';
  const budgetBlocker = aggregateBudgetBlocker(version, binding.aggregateUsage);
  if (budgetBlocker) return budgetBlocker;
  return undefined;
}

function aggregateBudgetBlocker(
  version: AutomationVersion,
  usage: AutomationBinding['aggregateUsage']
): string | undefined {
  if (usage.runs >= version.aggregateBudget.maxRuns) {
    return 'Automation aggregate run budget is exhausted.';
  }
  if (
    version.aggregateBudget.maxCostUsd !== undefined &&
    usage.costUsd >= version.aggregateBudget.maxCostUsd
  ) {
    return 'Automation aggregate cost budget is exhausted.';
  }
  if (
    version.aggregateBudget.maxTokens !== undefined &&
    usage.tokens >= version.aggregateBudget.maxTokens
  ) {
    return 'Automation aggregate token budget is exhausted.';
  }
  if (
    version.aggregateBudget.maxDurationMinutes !== undefined &&
    usage.durationMinutes >= version.aggregateBudget.maxDurationMinutes
  ) {
    return 'Automation aggregate duration budget is exhausted.';
  }
  return undefined;
}

async function currentIntegrationEvidence(
  ids: string[]
): Promise<Array<{ id: string; ready: boolean; evidenceDigest?: string }>> {
  if (ids.length === 0) return [];
  const [endpoints, adapters] = await Promise.all([
    getOutboundIntegrationService().listEndpoints(),
    getCommunicationAdapterService().listAdapters(),
  ]);
  return [...new Set(ids)].sort().map((id) => {
    const endpoint = endpoints.find((candidate) => candidate.id === id);
    const adapter = adapters.find((candidate) => candidate.id === id);
    return {
      id,
      ready: Boolean(endpoint?.enabled && endpoint.validation.valid) || Boolean(adapter?.enabled),
      evidenceDigest: digest(
        endpoint
          ? {
              id: endpoint.id,
              type: endpoint.type,
              enabled: endpoint.enabled,
              validation: endpoint.validation,
              updatedAt: endpoint.updatedAt,
            }
          : adapter
            ? {
                id: adapter.id,
                kind: adapter.kind,
                enabled: adapter.enabled,
                deliveryMode: adapter.deliveryMode,
                destinationType: adapter.destinationType,
                updatedAt: adapter.updatedAt,
              }
            : { id, missing: true }
      ),
    };
  });
}

async function currentToolPolicyEvidence(roles: string[]): Promise<Record<string, unknown>> {
  const service = getToolPolicyService();
  return Object.fromEntries(
    await Promise.all(
      roles.map(async (role) => [role, await service.getToolFilterForRole(role)] as const)
    )
  );
}

function required<T>(value: T | undefined, path: string): T {
  if (value === undefined) throw new ValidationError(`Automation field ${path} is unresolved.`);
  return value;
}

function minuteWindow(now: Date): string {
  return new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString();
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`;
}

function hex(value: string): string {
  return value.replace(/^[^:]+:/, '');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, candidate]) => candidate !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, candidate]) => `${JSON.stringify(key)}:${stableJson(candidate)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function automationEvent(
  binding: AutomationBinding,
  type: 'activate' | 'pause' | 'resume' | 'revoke',
  status: 'success',
  summary: string,
  runAt: string
) {
  return {
    id: `sched_evt_${hex(digest({ bindingId: binding.id, revision: binding.revision, type })).slice(0, 10)}`,
    itemId: `automation:${binding.id}`,
    sourceId: binding.id,
    kind: 'automation' as const,
    type,
    status,
    summary,
    runAt,
    nextRunAt: binding.nextRunAt,
  };
}

let instance: AutomationActivationService | undefined;

export function getAutomationActivationService(): AutomationActivationService {
  instance ??= new AutomationActivationService();
  return instance;
}

export function resetAutomationActivationServiceForTests(): void {
  instance = undefined;
}
