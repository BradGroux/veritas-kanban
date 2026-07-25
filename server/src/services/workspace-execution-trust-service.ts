import { nanoid } from 'nanoid';
import {
  WORKSPACE_EXECUTION_TRUST_DECISION_SCHEMA_VERSION,
  WORKSPACE_EXECUTION_TRUST_POLICY_VERSION,
  WORKSPACE_EXECUTION_TRUST_SCHEMA_VERSION,
  type RunLaunchWorkspaceTrust,
  type WorkspaceExecutionTrustDecision,
  type WorkspaceExecutionTrustDecisionInput,
  type WorkspaceExecutionTrustEvaluation,
  type WorkspaceExecutionTrustInventory,
  type WorkspaceExecutionTrustProjectMaximum,
  type WorkspaceExecutionTrustRestrictionCheck,
  type WorkspaceExecutionTrustRevokeInput,
  type WorkspaceExecutionTrustScanResult,
} from '@veritas-kanban/shared';
import { ConflictError, ValidationError } from '../middleware/error-handler.js';
import {
  workspaceExecutionTrustDecisionInputSchema,
  workspaceExecutionTrustDecisionSchema,
  workspaceExecutionTrustEvaluationSchema,
  workspaceExecutionTrustRevokeInputSchema,
} from '../schemas/workspace-execution-trust-schemas.js';
import {
  FileWorkspaceExecutionTrustRepository,
  type WorkspaceExecutionTrustRepository,
} from '../storage/index.js';
import { auditLog, type AuditEvent } from './audit-service.js';

export interface WorkspaceExecutionTrustLaunchConstraints {
  sandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access';
  networkAccessEnabled: boolean;
  taskCredentialReferences: string[];
  filesystemEnforcement: 'enforced' | 'native' | 'advisory' | 'unavailable';
  selectedToolServerCount: number;
  externalMutationAllowed: boolean;
  projectExecutableConfigurationBlocked: boolean;
}

export interface WorkspaceExecutionTrustServiceOptions {
  repository?: WorkspaceExecutionTrustRepository;
  audit?: (event: AuditEvent) => Promise<void>;
  now?: () => Date;
}

const TRUST_RANK: Record<WorkspaceExecutionTrustProjectMaximum, number> = {
  denied: 0,
  restricted: 1,
  trusted: 2,
};

export class WorkspaceExecutionTrustService {
  private readonly repository: WorkspaceExecutionTrustRepository;
  private readonly audit: (event: AuditEvent) => Promise<void>;
  private readonly now: () => Date;

  constructor(options: WorkspaceExecutionTrustServiceOptions = {}) {
    this.repository = options.repository ?? new FileWorkspaceExecutionTrustRepository();
    this.audit = options.audit ?? auditLog;
    this.now = options.now ?? (() => new Date());
  }

  async scan(workspacePath: string): Promise<WorkspaceExecutionTrustScanResult> {
    const inventory = await this.repository.inspect(workspacePath);
    const currentDecision = await this.currentDecision(inventory.identity.digest);
    return {
      inventory,
      ...(currentDecision ? { currentDecision } : {}),
    };
  }

  async evaluateForLaunch(input: {
    workspacePath: string;
    constraints: WorkspaceExecutionTrustLaunchConstraints;
  }): Promise<WorkspaceExecutionTrustEvaluation> {
    const { inventory, currentDecision } = await this.scan(input.workspacePath);
    const activeEntries = inventory.entries.filter((entry) => entry.posture !== 'declarative-only');
    const containsExecutable = activeEntries.some((entry) => entry.posture === 'executable');
    const restrictionChecks = this.restrictionChecks(input.constraints);
    const restrictionsSatisfied = restrictionChecks.every((check) => check.satisfied);
    const projectMaximum = inventory.projectPolicy.maximumTrust;

    if (currentDecision?.mode === 'denied') {
      return this.evaluation({
        inventory,
        decision: currentDecision,
        restrictionChecks,
        status: 'untrusted',
        source: 'An active operator distrust decision blocks this workspace.',
        requiresExplicitDecision: false,
      });
    }

    if (activeEntries.length === 0) {
      if (projectMaximum === 'denied') {
        return this.evaluation({
          inventory,
          decision: currentDecision,
          restrictionChecks,
          status: 'untrusted',
          source:
            inventory.projectPolicy.diagnostic ??
            'The project trust policy denies execution in this workspace.',
          requiresExplicitDecision: false,
        });
      }
      return this.evaluation({
        inventory,
        decision: currentDecision,
        restrictionChecks,
        status: 'not-required',
        source:
          'The current scan found no repository-controlled model or executable configuration. This provisional allow is rescanned before every launch.',
        requiresExplicitDecision: false,
      });
    }

    const decisionIsCurrent =
      currentDecision &&
      currentDecision.mode !== 'revoked' &&
      currentDecision.inventoryDigest === inventory.digest;
    if (currentDecision && !decisionIsCurrent && currentDecision.mode !== 'revoked') {
      return this.evaluation({
        inventory,
        decision: currentDecision,
        restrictionChecks,
        status: 'untrusted',
        source:
          'The repository-controlled configuration changed after the recorded trust decision. Review the new inventory and record a new decision.',
        requiresExplicitDecision: true,
      });
    }

    if (decisionIsCurrent && currentDecision && currentDecision.mode !== 'revoked') {
      const effectiveMaximum =
        TRUST_RANK[projectMaximum] < TRUST_RANK[currentDecision.mode]
          ? projectMaximum
          : currentDecision.mode;
      if (effectiveMaximum === 'denied') {
        return this.evaluation({
          inventory,
          decision: currentDecision,
          restrictionChecks,
          status: 'untrusted',
          source:
            inventory.projectPolicy.diagnostic ??
            'The effective project and operator trust policy denies execution.',
          requiresExplicitDecision: false,
        });
      }
      if (effectiveMaximum === 'trusted') {
        return this.evaluation({
          inventory,
          decision: currentDecision,
          restrictionChecks,
          status: 'trusted',
          source: 'The exact scanned inventory is covered by an active operator trust decision.',
          requiresExplicitDecision: false,
        });
      }
      if (restrictionsSatisfied) {
        return this.evaluation({
          inventory,
          decision: currentDecision,
          restrictionChecks,
          status: 'restricted',
          source:
            'The exact scanned inventory is authorized only under the enforced restricted launch profile.',
          requiresExplicitDecision: false,
        });
      }
      return this.evaluation({
        inventory,
        decision: currentDecision,
        restrictionChecks,
        status: 'untrusted',
        source:
          'The workspace is authorized only in restricted mode, but the selected launch does not enforce every restricted-mode boundary.',
        requiresExplicitDecision: false,
      });
    }

    if (!containsExecutable && projectMaximum !== 'denied' && restrictionsSatisfied) {
      return this.evaluation({
        inventory,
        decision: currentDecision,
        restrictionChecks,
        status: 'restricted',
        source:
          'Only model-influencing repository instructions were found, and the launch satisfies the provisional restricted profile.',
        requiresExplicitDecision: false,
      });
    }

    return this.evaluation({
      inventory,
      decision: currentDecision,
      restrictionChecks,
      status: 'untrusted',
      source: containsExecutable
        ? 'Repository-controlled executable configuration requires an explicit decision before non-interactive launch.'
        : 'Repository-controlled model instructions require either explicit trust or an enforceable restricted launch profile.',
      requiresExplicitDecision: containsExecutable,
    });
  }

  async recordDecision(
    workspacePath: string,
    input: WorkspaceExecutionTrustDecisionInput,
    actor: string
  ): Promise<WorkspaceExecutionTrustDecision> {
    const parsed = workspaceExecutionTrustDecisionInputSchema.parse(input);
    const inventory = await this.repository.inspect(workspacePath);
    if (inventory.digest !== parsed.inventoryDigest) {
      throw new ConflictError('Workspace execution configuration changed after it was reviewed.', {
        expectedInventoryDigest: parsed.inventoryDigest,
        currentInventoryDigest: inventory.digest,
      });
    }
    if (parsed.mode === 'trusted' && inventory.projectPolicy.maximumTrust !== 'trusted') {
      throw new ConflictError(
        'Project policy can narrow workspace trust and does not permit a trusted decision.',
        {
          projectMaximumTrust: inventory.projectPolicy.maximumTrust,
        }
      );
    }
    if (parsed.mode === 'restricted' && inventory.projectPolicy.maximumTrust === 'denied') {
      throw new ConflictError('Project policy denies execution in this workspace.');
    }
    const now = this.now();
    if (parsed.expiresAt && Date.parse(parsed.expiresAt) <= now.getTime()) {
      throw new ValidationError('Workspace trust expiry must be in the future.');
    }
    const previous = await this.currentDecision(inventory.identity.digest);
    const decision = workspaceExecutionTrustDecisionSchema.parse({
      schemaVersion: WORKSPACE_EXECUTION_TRUST_DECISION_SCHEMA_VERSION,
      id: `workspace_trust_${nanoid(12)}`,
      identityDigest: inventory.identity.digest,
      inventoryDigest: inventory.digest,
      mode: parsed.mode,
      actor: actor.trim() || 'operator',
      reason: parsed.reason,
      policyVersion: WORKSPACE_EXECUTION_TRUST_POLICY_VERSION,
      createdAt: now.toISOString(),
      ...(parsed.expiresAt ? { expiresAt: parsed.expiresAt } : {}),
      ...(previous ? { supersedesDecisionId: previous.id } : {}),
    });
    const saved = await this.repository.appendDecision(decision);
    await this.audit({
      action: 'workspace_execution_trust.decision_recorded',
      actor: saved.actor,
      resource: saved.identityDigest,
      details: {
        decisionId: saved.id,
        mode: saved.mode,
        inventoryDigest: saved.inventoryDigest,
        expiresAt: saved.expiresAt,
      },
    });
    return saved;
  }

  async revoke(
    workspacePath: string,
    input: WorkspaceExecutionTrustRevokeInput,
    actor: string
  ): Promise<WorkspaceExecutionTrustDecision> {
    const parsed = workspaceExecutionTrustRevokeInputSchema.parse(input);
    const inventory = await this.repository.inspect(workspacePath);
    if (inventory.digest !== parsed.inventoryDigest) {
      throw new ConflictError(
        'Workspace execution configuration changed after the revoke request was prepared.',
        {
          expectedInventoryDigest: parsed.inventoryDigest,
          currentInventoryDigest: inventory.digest,
        }
      );
    }
    const current = await this.currentDecision(inventory.identity.digest);
    if (!current || current.mode === 'revoked') {
      throw new ConflictError('No active workspace execution trust decision exists to revoke.');
    }
    const decision = workspaceExecutionTrustDecisionSchema.parse({
      schemaVersion: WORKSPACE_EXECUTION_TRUST_DECISION_SCHEMA_VERSION,
      id: `workspace_trust_${nanoid(12)}`,
      identityDigest: inventory.identity.digest,
      inventoryDigest: inventory.digest,
      mode: 'revoked',
      actor: actor.trim() || 'operator',
      reason: parsed.reason,
      policyVersion: WORKSPACE_EXECUTION_TRUST_POLICY_VERSION,
      createdAt: this.now().toISOString(),
      supersedesDecisionId: current.id,
    });
    const saved = await this.repository.appendDecision(decision);
    await this.audit({
      action: 'workspace_execution_trust.decision_revoked',
      actor: saved.actor,
      resource: saved.identityDigest,
      details: {
        decisionId: saved.id,
        supersedesDecisionId: saved.supersedesDecisionId,
        inventoryDigest: saved.inventoryDigest,
      },
    });
    return saved;
  }

  async assertFresh(workspacePath: string, expected: RunLaunchWorkspaceTrust): Promise<void> {
    if (!('schemaVersion' in expected)) {
      throw new ConflictError(
        'Legacy launch evidence does not contain workspace execution trust inventory.'
      );
    }
    const inventory = await this.repository.inspect(workspacePath);
    if (
      inventory.identity.digest !== expected.identityDigest ||
      inventory.digest !== expected.inventoryDigest
    ) {
      throw new ConflictError(
        'Workspace execution trust evidence changed before provider activation.',
        {
          expectedIdentityDigest: expected.identityDigest,
          currentIdentityDigest: inventory.identity.digest,
          expectedInventoryDigest: expected.inventoryDigest,
          currentInventoryDigest: inventory.digest,
        }
      );
    }
    const current = await this.currentDecision(inventory.identity.digest);
    if (current?.id !== expected.decisionId || current?.mode !== expected.decisionMode) {
      throw new ConflictError(
        'Workspace execution trust decision changed before provider activation.',
        {
          expectedDecisionId: expected.decisionId,
          currentDecisionId: current?.id,
          expectedDecisionMode: expected.decisionMode,
          currentDecisionMode: current?.mode,
        }
      );
    }
  }

  private evaluation(input: {
    inventory: WorkspaceExecutionTrustInventory;
    decision?: WorkspaceExecutionTrustDecision;
    restrictionChecks: WorkspaceExecutionTrustRestrictionCheck[];
    status: WorkspaceExecutionTrustEvaluation['status'];
    source: string;
    requiresExplicitDecision: boolean;
  }): WorkspaceExecutionTrustEvaluation {
    return workspaceExecutionTrustEvaluationSchema.parse({
      schemaVersion: WORKSPACE_EXECUTION_TRUST_SCHEMA_VERSION,
      status: input.status,
      source: input.source,
      requiresExplicitDecision: input.requiresExplicitDecision,
      identity: input.inventory.identity,
      inventory: input.inventory,
      ...(input.decision ? { decision: input.decision } : {}),
      restrictionChecks: input.restrictionChecks,
    });
  }

  private restrictionChecks(
    constraints: WorkspaceExecutionTrustLaunchConstraints
  ): WorkspaceExecutionTrustRestrictionCheck[] {
    return [
      {
        id: 'filesystem-read-only',
        satisfied: constraints.sandboxMode === 'read-only',
        detail: 'Restricted mode requires a read-only workspace sandbox.',
      },
      {
        id: 'filesystem-enforced',
        satisfied:
          constraints.filesystemEnforcement === 'enforced' ||
          constraints.filesystemEnforcement === 'native',
        detail:
          'Restricted mode requires an enforceable host or provider-native filesystem boundary.',
      },
      {
        id: 'network-disabled',
        satisfied: !constraints.networkAccessEnabled,
        detail: 'Restricted mode disables provider network access.',
      },
      {
        id: 'task-credentials-blocked',
        satisfied: constraints.taskCredentialReferences.length === 0,
        detail: 'Restricted mode exposes no raw task-integration credential references.',
      },
      {
        id: 'project-tool-servers-blocked',
        satisfied: constraints.selectedToolServerCount === 0,
        detail: 'Restricted mode loads no project-scoped tool servers.',
      },
      {
        id: 'project-executable-configuration-blocked',
        satisfied: constraints.projectExecutableConfigurationBlocked,
        detail:
          'Restricted mode denies repository-controlled executable configuration to the provider.',
      },
      {
        id: 'external-mutation-blocked',
        satisfied: !constraints.externalMutationAllowed,
        detail: 'Restricted mode disables external mutations.',
      },
    ];
  }

  private async currentDecision(
    identityDigest: string
  ): Promise<WorkspaceExecutionTrustDecision | undefined> {
    const decisions = await this.repository.listDecisions(identityDigest);
    const latest = decisions.at(-1);
    if (!latest || latest.mode === 'revoked') return latest;
    if (latest.expiresAt && Date.parse(latest.expiresAt) <= this.now().getTime()) return undefined;
    return latest;
  }
}

let singleton: WorkspaceExecutionTrustService | null = null;

export function getWorkspaceExecutionTrustService(): WorkspaceExecutionTrustService {
  singleton ??= new WorkspaceExecutionTrustService();
  return singleton;
}

export function resetWorkspaceExecutionTrustServiceForTests(): void {
  singleton = null;
}
