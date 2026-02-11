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
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getRuntimeDir } from '../utils/paths.js';
import { migrateLegacyFiles } from '../utils/migrate-legacy-files.js';
const DATA_DIR = getRuntimeDir();
const LEGACY_DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), '..', '.veritas-kanban');
let migrationChecked = false;

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

class AgentPermissionService {
  private permissions = new Map<string, AgentPermissionConfig>();
  private approvals: ApprovalRequest[] = [];
  private loaded = false;

  private get permissionsPath(): string {
    return path.join(DATA_DIR, 'agent-permissions.json');
  }

  private get approvalsPath(): string {
    return path.join(DATA_DIR, 'approval-requests.json');
  }

  private async ensureLoaded(): Promise<void> {
    if (!migrationChecked) {
      migrationChecked = true;
      await migrateLegacyFiles(
        LEGACY_DATA_DIR,
        DATA_DIR,
        ['agent-permissions.json', 'approval-requests.json'],
        'agent permission'
      );
    }

    if (this.loaded) return;
    try {
      const data = await fs.readFile(this.permissionsPath, 'utf-8');
      const arr: AgentPermissionConfig[] = JSON.parse(data);
      for (const p of arr) {
        this.permissions.set(p.agentId, p);
      }
    } catch {
      // No saved permissions
    }
    try {
      const data = await fs.readFile(this.approvalsPath, 'utf-8');
      this.approvals = JSON.parse(data);
    } catch {
      this.approvals = [];
    }
    this.loaded = true;
  }

  private async savePermissions(): Promise<void> {
    const arr = Array.from(this.permissions.values());
    await fs.writeFile(this.permissionsPath, JSON.stringify(arr, null, 2));
  }

  private async saveApprovals(): Promise<void> {
    await fs.writeFile(this.approvalsPath, JSON.stringify(this.approvals, null, 2));
  }

  /**
   * Get permission config for an agent. Returns default specialist if not configured.
   */
  async getPermissions(agentId: string): Promise<AgentPermissionConfig> {
    await this.ensureLoaded();
    return (
      this.permissions.get(agentId.toLowerCase()) || {
        agentId: agentId.toLowerCase(),
        ...DEFAULT_PERMISSIONS.specialist,
        updatedAt: new Date().toISOString(),
      }
    );
  }

  /**
   * Set permission level for an agent.
   */
  async setLevel(agentId: string, level: PermissionLevel): Promise<AgentPermissionConfig> {
    await this.ensureLoaded();

    const existing = this.permissions.get(agentId.toLowerCase());
    const config: AgentPermissionConfig = {
      ...(existing || { agentId: agentId.toLowerCase() }),
      ...DEFAULT_PERMISSIONS[level],
      agentId: agentId.toLowerCase(),
      trustedDomains: existing?.trustedDomains,
      restrictions: existing?.restrictions,
      updatedAt: new Date().toISOString(),
    };

    this.permissions.set(agentId.toLowerCase(), config);
    await this.savePermissions();

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
    await this.ensureLoaded();

    const current = await this.getPermissions(agentId);
    const updated: AgentPermissionConfig = {
      ...current,
      ...update,
      updatedAt: new Date().toISOString(),
    };

    this.permissions.set(agentId.toLowerCase(), updated);
    await this.savePermissions();
    return updated;
  }

  /**
   * List all configured agent permissions.
   */
  async listPermissions(): Promise<AgentPermissionConfig[]> {
    await this.ensureLoaded();
    return Array.from(this.permissions.values());
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
    const config = await this.getPermissions(agentId);

    switch (action) {
      case 'create_task':
        return config.canCreateTasks
          ? { allowed: true }
          : { allowed: false, reason: 'Intern agents cannot create tasks', requiresApproval: true };

      case 'delegate':
        return config.canDelegate
          ? { allowed: true }
          : { allowed: false, reason: 'Only lead agents can delegate', requiresApproval: true };

      case 'approve':
        return config.canApprove
          ? { allowed: true }
          : { allowed: false, reason: 'Only lead agents can approve work' };

      case 'complete_task':
        if (config.autoComplete) {
          return { allowed: true };
        }
        return {
          allowed: true,
          reason: 'Task will go to review instead of done',
          requiresApproval: false,
        };

      case 'delete_task':
        return config.level === 'lead'
          ? { allowed: true }
          : { allowed: false, reason: 'Only lead agents can delete tasks', requiresApproval: true };

      default:
        // Check custom restrictions
        if (config.restrictions?.some((r) => action.includes(r))) {
          return { allowed: false, reason: `Action restricted for ${config.level} agents` };
        }
        return { allowed: true };
    }
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
    await this.ensureLoaded();

    const request: ApprovalRequest = {
      id: `approval_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      agentId: params.agentId.toLowerCase(),
      action: params.action,
      taskId: params.taskId,
      details: params.details,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    this.approvals.push(request);
    await this.saveApprovals();

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
    await this.ensureLoaded();

    const request = this.approvals.find((a) => a.id === requestId);
    if (!request) return null;

    request.status = decision;
    request.reviewedBy = reviewedBy;
    request.reviewedAt = new Date().toISOString();

    await this.saveApprovals();
    log.info({ requestId, decision, reviewedBy }, 'Approval reviewed');
    return request;
  }

  /**
   * Get pending approval requests.
   */
  async getPendingApprovals(filters?: { agentId?: string }): Promise<ApprovalRequest[]> {
    await this.ensureLoaded();

    let results = this.approvals.filter((a) => a.status === 'pending');
    if (filters?.agentId) {
      results = results.filter((a) => a.agentId === filters.agentId!.toLowerCase());
    }
    return results.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
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
