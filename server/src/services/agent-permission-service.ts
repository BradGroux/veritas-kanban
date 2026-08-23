/**
 * Agent Permission Service
 *
 * Manages agent permission levels (Intern / Specialist / Lead)
 * controlling autonomy, action restrictions, and approval workflows.
 *
 * Levels:
 * - Intern: Needs approval. Tasks go to review, restricted API access.
 * - Specialist: Independent within domain. Full task lifecycle.
 * - Lead: Full autonomy. Can create tasks, delegate, approve intern work.
 */

import { createLogger } from '../lib/logger.js';
import type { CreateGovernanceTraceInput } from '@veritas-kanban/shared';
import {
  FileAgentPermissionRepository,
  type AgentPermissionRepository,
} from '../storage/agent-permission-repository.js';

const log = createLogger('agent-permissions');

// ─── Types ───────────────────────────────────────────────────────

export type PermissionLevel = 'intern' | 'specialist' | 'lead';

export interface AgentPermissionConfig {
  agentId: string;
  level: PermissionLevel;
  /** Domains/capabilities this agent is trusted in (specialist+) */
  trustedDomains?: string[];
  /** Whether this agent can create new tasks */
  canCreateTasks: boolean;
  /** Whether this agent can delegate to other agents */
  canDelegate: boolean;
  /** Whether this agent can approve intern work */
  canApprove: boolean;
  /** Whether completed tasks auto-move to done (false = goes to review) */
  autoComplete: boolean;
  /** Custom restrictions (endpoint patterns to block) */
  restrictions?: string[];
  updatedAt: string;
}

export interface ApprovalRequest {
  id: string;
  /** Agent requesting approval */
  agentId: string;
  /** What they want to do */
  action: string;
  /** Task context */
  taskId?: string;
  /** Additional details */
  details?: string;
  /** Status */
  status: 'pending' | 'approved' | 'rejected';
  /** Who approved/rejected */
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
}

// ─── Default Permissions ─────────────────────────────────────────

const DEFAULT_PERMISSIONS: Record<
  PermissionLevel,
  Omit<AgentPermissionConfig, 'agentId' | 'updatedAt'>
> = {
  intern: {
    level: 'intern',
    canCreateTasks: false,
    canDelegate: false,
    canApprove: false,
    autoComplete: false, // Tasks go to review
  },
  specialist: {
    level: 'specialist',
    canCreateTasks: true,
    canDelegate: false,
    canApprove: false,
    autoComplete: true,
  },
  lead: {
    level: 'lead',
    canCreateTasks: true,
    canDelegate: true,
    canApprove: true,
    autoComplete: true,
  },
};

// ─── Service ─────────────────────────────────────────────────────

export class AgentPermissionService {
  constructor(
    private readonly repository: AgentPermissionRepository = new FileAgentPermissionRepository()
  ) {}

  /**
   * Get permission config for an agent. Returns default specialist if not configured.
   */
  async getPermissions(agentId: string): Promise<AgentPermissionConfig> {
    const normalizedAgentId = agentId.toLowerCase();
    const permissions = await this.repository.readPermissions();
    return (
      permissions.find((config) => config.agentId === normalizedAgentId) ??
      this.defaultPermissions(normalizedAgentId)
    );
  }

  /**
   * Set permission level for an agent.
   */
  async setLevel(agentId: string, level: PermissionLevel): Promise<AgentPermissionConfig> {
    const normalizedAgentId = agentId.toLowerCase();
    const config = await this.repository.mutatePermissions((permissions) => {
      const index = permissions.findIndex((candidate) => candidate.agentId === normalizedAgentId);
      const existing = index >= 0 ? permissions[index] : undefined;
      const updated: AgentPermissionConfig = {
        ...(existing || { agentId: normalizedAgentId }),
        ...DEFAULT_PERMISSIONS[level],
        agentId: normalizedAgentId,
        trustedDomains: existing?.trustedDomains,
        restrictions: existing?.restrictions,
        updatedAt: new Date().toISOString(),
      };
      const next = [...permissions];
      if (index >= 0) next[index] = updated;
      else next.push(updated);
      return { values: next, result: updated };
    });

    log.info({ agentId, level }, 'Agent permission level updated');
    return config;
  }

  /**
   * Update specific permission fields for an agent.
   */
  async updatePermissions(
    agentId: string,
    update: Partial<
      Pick<
        AgentPermissionConfig,
        | 'trustedDomains'
        | 'canCreateTasks'
        | 'canDelegate'
        | 'canApprove'
        | 'autoComplete'
        | 'restrictions'
      >
    >
  ): Promise<AgentPermissionConfig> {
    const normalizedAgentId = agentId.toLowerCase();
    return this.repository.mutatePermissions((permissions) => {
      const index = permissions.findIndex((candidate) => candidate.agentId === normalizedAgentId);
      const current = index >= 0 ? permissions[index] : this.defaultPermissions(normalizedAgentId);
      const updated: AgentPermissionConfig = {
        ...current,
        ...update,
        updatedAt: new Date().toISOString(),
      };
      const next = [...permissions];
      if (index >= 0) next[index] = updated;
      else next.push(updated);
      return { values: next, result: updated };
    });
  }

  /**
   * List all configured agent permissions.
   */
  async listPermissions(): Promise<AgentPermissionConfig[]> {
    return this.repository.readPermissions();
  }

  /**
   * Check if an agent can perform an action.
   */
  async checkPermission(
    agentId: string,
    action: string
  ): Promise<{
    allowed: boolean;
    reason?: string;
    requiresApproval?: boolean;
  }> {
    return (await this.checkPermissionWithTrace(agentId, action)).result;
  }

  async checkPermissionWithTrace(
    agentId: string,
    action: string
  ): Promise<{
    result: {
      allowed: boolean;
      reason?: string;
      requiresApproval?: boolean;
    };
    trace: CreateGovernanceTraceInput;
  }> {
    const config = await this.getPermissions(agentId);
    let result: {
      allowed: boolean;
      reason?: string;
      requiresApproval?: boolean;
    };

    switch (action) {
      case 'create_task':
        result = config.canCreateTasks
          ? { allowed: true }
          : { allowed: false, reason: 'Intern agents cannot create tasks', requiresApproval: true };
        break;

      case 'delegate':
        result = config.canDelegate
          ? { allowed: true }
          : { allowed: false, reason: 'Only lead agents can delegate', requiresApproval: true };
        break;

      case 'approve':
        result = config.canApprove
          ? { allowed: true }
          : { allowed: false, reason: 'Only lead agents can approve work' };
        break;

      case 'complete_task':
        if (config.autoComplete) {
          result = { allowed: true };
        } else {
          result = {
            allowed: true,
            reason: 'Task will go to review instead of done',
            requiresApproval: false,
          };
        }
        break;

      case 'delete_task':
        result =
          config.level === 'lead'
            ? { allowed: true }
            : {
                allowed: false,
                reason: 'Only lead agents can delete tasks',
                requiresApproval: true,
              };
        break;

      default:
        // Check custom restrictions
        if (config.restrictions?.some((r) => action.includes(r))) {
          result = { allowed: false, reason: `Action restricted for ${config.level} agents` };
        } else {
          result = { allowed: true };
        }
    }

    return {
      result,
      trace: this.buildPermissionTrace(config, action, result),
    };
  }

  /**
   * Submit an approval request (for intern agents).
   */
  async requestApproval(params: {
    agentId: string;
    action: string;
    taskId?: string;
    details?: string;
  }): Promise<ApprovalRequest> {
    const request: ApprovalRequest = {
      id: `approval_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      agentId: params.agentId.toLowerCase(),
      action: params.action,
      taskId: params.taskId,
      details: params.details,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    await this.repository.mutateApprovals((approvals) => ({
      values: [...approvals, request],
      result: request,
    }));

    log.info(
      { requestId: request.id, agentId: params.agentId, action: params.action },
      'Approval requested'
    );
    return request;
  }

  /**
   * Review an approval request (lead agents only).
   */
  async reviewApproval(
    requestId: string,
    decision: 'approved' | 'rejected',
    reviewedBy: string
  ): Promise<ApprovalRequest | null> {
    const request = await this.repository.mutateApprovals((approvals) => {
      const index = approvals.findIndex((candidate) => candidate.id === requestId);
      if (index === -1) {
        return { values: approvals, result: null as ApprovalRequest | null };
      }
      const updated: ApprovalRequest = {
        ...approvals[index],
        status: decision,
        reviewedBy,
        reviewedAt: new Date().toISOString(),
      };
      const next = [...approvals];
      next[index] = updated;
      return { values: next, result: updated as ApprovalRequest | null };
    });
    if (!request) return null;
    log.info({ requestId, decision, reviewedBy }, 'Approval reviewed');
    return request;
  }

  /**
   * Get pending approval requests.
   */
  async getPendingApprovals(filters?: { agentId?: string }): Promise<ApprovalRequest[]> {
    let results = (await this.repository.readApprovals()).filter(
      (approval) => approval.status === 'pending'
    );
    if (filters?.agentId) {
      const agentId = filters.agentId.toLowerCase();
      results = results.filter((approval) => approval.agentId === agentId);
    }
    return results.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  private defaultPermissions(agentId: string): AgentPermissionConfig {
    return {
      agentId,
      ...DEFAULT_PERMISSIONS.specialist,
      updatedAt: new Date().toISOString(),
    };
  }

  private buildPermissionTrace(
    config: AgentPermissionConfig,
    action: string,
    result: { allowed: boolean; reason?: string; requiresApproval?: boolean }
  ): CreateGovernanceTraceInput {
    const outcome: CreateGovernanceTraceInput['outcome'] = result.allowed
      ? result.requiresApproval
        ? 'approval-required'
        : 'allowed'
      : result.requiresApproval
        ? 'approval-required'
        : 'blocked';

    return {
      kind: 'agent-permission',
      outcome,
      title: `Agent permission: ${config.agentId} -> ${action}`,
      summary: result.allowed
        ? result.reason || `${config.agentId} can perform ${action}.`
        : result.reason || `${config.agentId} cannot perform ${action}.`,
      remediation: result.allowed
        ? undefined
        : result.requiresApproval
          ? 'Request approval from a lead agent or promote the agent permission level.'
          : 'Change the agent level, remove a restriction, or delegate the action to an authorized agent.',
      subject: { agentId: config.agentId, actionType: action },
      evaluatedRules: [
        {
          id: `agent-permission:${config.level}`,
          label: `${config.level} permissions`,
          type: 'agent-permission',
          status: 'matched',
          outcome,
          message: result.reason || `${config.level} permissions evaluated for ${action}.`,
          details: {
            level: config.level,
            canCreateTasks: config.canCreateTasks,
            canDelegate: config.canDelegate,
            canApprove: config.canApprove,
            autoComplete: config.autoComplete,
            restrictions: config.restrictions ?? [],
          },
        },
      ],
      matchedRules: [
        {
          id: `agent-permission:${config.level}`,
          label: `${config.level} permissions`,
          type: 'agent-permission',
          status: 'matched',
          outcome,
          message: result.reason || `${config.level} permissions evaluated for ${action}.`,
        },
      ],
      steps: [
        {
          id: 'level',
          label: 'Permission level',
          status: 'info',
          message: `${config.agentId} is configured as ${config.level}.`,
        },
        {
          id: 'outcome',
          label: 'Outcome',
          status: result.allowed ? 'matched' : 'not-matched',
          message: result.reason || (result.allowed ? 'Action allowed.' : 'Action blocked.'),
        },
      ],
      raw: { config, action, result },
    };
  }
}

// Singleton
let instance: AgentPermissionService | null = null;

export function getAgentPermissionService(): AgentPermissionService {
  if (!instance) {
    instance = new AgentPermissionService();
  }
  return instance;
}
