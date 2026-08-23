/**
 * Delegation Service
 *
 * Manages approval delegation (vacation mode) — allows humans to temporarily
 * delegate task approval authority to a designated agent.
 */

import { nanoid } from 'nanoid';
import { createLogger } from '../lib/logger.js';
import type { DelegationSettings, DelegationScope, TaskPriority } from '@veritas-kanban/shared';
import type { DelegationApproval } from '@veritas-kanban/shared';
import {
  FileDelegationRepository,
  type DelegationRepository,
} from '../storage/delegation-repository.js';

const log = createLogger('delegation');

export class DelegationService {
  constructor(private readonly repository: DelegationRepository = new FileDelegationRepository()) {}

  /**
   * Load delegation settings from disk
   */
  private async loadSettings(): Promise<DelegationSettings | null> {
    const settings = await this.repository.readSettings();
    if (settings?.enabled && new Date(settings.expires) < new Date()) {
      log.info({ expires: settings.expires }, 'Delegation expired on load, disabling');
      return this.repository.updateSettings((current) => {
        if (
          current?.enabled &&
          current.createdAt === settings.createdAt &&
          current.expires === settings.expires
        ) {
          return { ...current, enabled: false };
        }
        return current;
      });
    }
    return settings;
  }

  /**
   * Get current delegation settings (auto-expires if needed)
   */
  async getDelegation(): Promise<DelegationSettings | null> {
    return this.loadSettings();
  }

  /**
   * Set delegation settings
   */
  async setDelegation(params: {
    delegateAgent: string;
    expires: string; // ISO timestamp
    scope: DelegationScope;
    excludePriorities?: TaskPriority[];
    excludeTags?: string[];
    createdBy: string;
  }): Promise<DelegationSettings> {
    const now = new Date().toISOString();

    const settings: DelegationSettings = {
      enabled: true,
      delegateAgent: params.delegateAgent,
      expires: params.expires,
      scope: params.scope,
      excludePriorities: params.excludePriorities,
      excludeTags: params.excludeTags,
      createdAt: now,
      createdBy: params.createdBy,
    };

    await this.repository.writeSettings(settings);

    log.info(
      {
        delegateAgent: settings.delegateAgent,
        expires: settings.expires,
        scope: settings.scope,
      },
      'Delegation enabled'
    );

    return settings;
  }

  /**
   * Revoke delegation immediately
   */
  async revokeDelegation(): Promise<boolean> {
    const current = await this.repository.updateSettings((settings) =>
      settings ? { ...settings, enabled: false } : null
    );
    if (!current) return false;

    log.info({ delegateAgent: current.delegateAgent }, 'Delegation revoked');
    return true;
  }

  /**
   * Check if a specific agent can approve a task under current delegation
   */
  async canApprove(
    agent: string,
    task: {
      id: string;
      priority?: TaskPriority;
      project?: string;
      tags?: string[];
    }
  ): Promise<{ allowed: boolean; reason?: string }> {
    const delegation = await this.loadSettings();

    if (!delegation || !delegation.enabled) {
      return { allowed: false, reason: 'No active delegation' };
    }

    // Check expiry
    if (new Date(delegation.expires) < new Date()) {
      return { allowed: false, reason: 'Delegation has expired' };
    }

    // Check agent match
    if (delegation.delegateAgent !== agent) {
      return { allowed: false, reason: 'Agent is not the delegate' };
    }

    // Check exclusions
    if (delegation.excludePriorities && task.priority) {
      if (delegation.excludePriorities.includes(task.priority)) {
        return {
          allowed: false,
          reason: `Priority "${task.priority}" is excluded from delegation`,
        };
      }
    }

    const excludedTags = delegation.excludeTags;
    if (excludedTags && task.tags) {
      const excluded = task.tags.find((tag) => excludedTags.includes(tag));
      if (excluded) {
        return { allowed: false, reason: `Task has excluded tag: ${excluded}` };
      }
    }

    // Check scope
    switch (delegation.scope.type) {
      case 'all':
        return { allowed: true };

      case 'project':
        if (!task.project) {
          return { allowed: false, reason: 'Task has no project' };
        }
        if (!delegation.scope.projectIds?.includes(task.project)) {
          return { allowed: false, reason: `Project "${task.project}" not in delegation scope` };
        }
        return { allowed: true };

      case 'priority':
        if (!task.priority) {
          return { allowed: false, reason: 'Task has no priority' };
        }
        if (!delegation.scope.priorities?.includes(task.priority)) {
          return { allowed: false, reason: `Priority "${task.priority}" not in delegation scope` };
        }
        return { allowed: true };

      default:
        return { allowed: false, reason: 'Unknown scope type' };
    }
  }

  /**
   * Log a delegated approval
   */
  async logApproval(params: {
    taskId: string;
    taskTitle: string;
    agent: string;
  }): Promise<DelegationApproval> {
    const delegation = await this.loadSettings();
    const delegationRef = delegation
      ? `${delegation.delegateAgent}_${delegation.createdAt}`
      : 'unknown';

    const approval: DelegationApproval = {
      id: `approval_${nanoid(8)}`,
      taskId: params.taskId,
      taskTitle: params.taskTitle,
      agent: params.agent,
      delegated: true,
      timestamp: new Date().toISOString(),
      originalDelegation: delegationRef,
    };

    await this.repository.updateLog((delegationLog) => ({
      approvals: [...delegationLog.approvals, approval].slice(-1000),
    }));

    log.info(
      { taskId: params.taskId, agent: params.agent, delegationRef },
      'Delegated approval logged'
    );

    return approval;
  }

  /**
   * Get delegation approval log
   */
  async getApprovalLog(params?: {
    taskId?: string;
    agent?: string;
    limit?: number;
  }): Promise<DelegationApproval[]> {
    const delegationLog = await this.repository.readLog();
    let approvals = [...delegationLog.approvals];

    if (params?.taskId) {
      approvals = approvals.filter((a) => a.taskId === params.taskId);
    }

    if (params?.agent) {
      approvals = approvals.filter((a) => a.agent === params.agent);
    }

    // Sort newest first
    approvals.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    if (params?.limit) {
      approvals = approvals.slice(0, params.limit);
    }

    return approvals;
  }
}

// Singleton instance
let delegationService: DelegationService | null = null;

export function getDelegationService(): DelegationService {
  if (!delegationService) {
    delegationService = new DelegationService();
  }
  return delegationService;
}
