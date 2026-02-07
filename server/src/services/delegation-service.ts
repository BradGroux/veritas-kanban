/**
 * Delegation Service
 *
 * Manages approval delegation (vacation mode) — allows humans to temporarily
 * delegate task approval authority to a designated agent.
 */

import fs from 'fs/promises';
import path from 'path';
import { nanoid } from 'nanoid';
import { createLogger } from '../lib/logger.js';
import { withFileLock } from './file-lock.js';
import type { DelegationSettings, DelegationScope, TaskPriority } from '@veritas-kanban/shared';
import type { DelegationApproval, DelegationLog } from '@veritas-kanban/shared';

const log = createLogger('delegation');

// Storage paths
const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const DELEGATION_DIR = path.join(PROJECT_ROOT, '.veritas-kanban');
const SETTINGS_FILE = path.join(DELEGATION_DIR, 'delegation.json');
const LOG_FILE = path.join(DELEGATION_DIR, 'delegation-log.json');

export class DelegationService {
  private settings: DelegationSettings | null = null;
  private log: DelegationLog = { approvals: [] };
  private settingsLoaded = false;
  private logLoaded = false;

  constructor() {
    this.ensureDir();
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(DELEGATION_DIR, { recursive: true });
  }

  /**
   * Load delegation settings from disk
   */
  private async loadSettings(): Promise<DelegationSettings | null> {
    if (this.settingsLoaded && this.settings) {
      // Check if delegation has expired
      if (this.settings.enabled && new Date(this.settings.expires) < new Date()) {
        log.info({ expires: this.settings.expires }, 'Delegation has expired, auto-disabling');
        this.settings.enabled = false;
        await this.saveSettings();
        // Could emit WebSocket event here
      }
      return this.settings;
    }

    try {
      const content = await fs.readFile(SETTINGS_FILE, 'utf-8');
      this.settings = JSON.parse(content) as DelegationSettings;
      this.settingsLoaded = true;

      // Check expiry on load
      if (this.settings.enabled && new Date(this.settings.expires) < new Date()) {
        log.info({ expires: this.settings.expires }, 'Delegation expired on load, disabling');
        this.settings.enabled = false;
        await this.saveSettings();
      }

      return this.settings;
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        this.settingsLoaded = true;
        return null;
      }
      throw err;
    }
  }

  /**
   * Save delegation settings to disk
   */
  private async saveSettings(): Promise<void> {
    await this.ensureDir();
    await withFileLock(SETTINGS_FILE, async () => {
      const content = JSON.stringify(this.settings, null, 2);
      await fs.writeFile(SETTINGS_FILE, content, 'utf-8');
    });
  }

  /**
   * Load delegation log from disk
   */
  private async loadLog(): Promise<DelegationLog> {
    if (this.logLoaded) return this.log;

    try {
      const content = await fs.readFile(LOG_FILE, 'utf-8');
      this.log = JSON.parse(content) as DelegationLog;
      this.logLoaded = true;
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        this.log = { approvals: [] };
        this.logLoaded = true;
      } else {
        throw err;
      }
    }

    return this.log;
  }

  /**
   * Save delegation log to disk
   */
  private async saveLog(): Promise<void> {
    await this.ensureDir();
    await withFileLock(LOG_FILE, async () => {
      const content = JSON.stringify(this.log, null, 2);
      await fs.writeFile(LOG_FILE, content, 'utf-8');
    });
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

    this.settings = {
      enabled: true,
      delegateAgent: params.delegateAgent,
      expires: params.expires,
      scope: params.scope,
      excludePriorities: params.excludePriorities,
      excludeTags: params.excludeTags,
      createdAt: now,
      createdBy: params.createdBy,
    };

    await this.saveSettings();

    log.info(
      {
        delegateAgent: this.settings.delegateAgent,
        expires: this.settings.expires,
        scope: this.settings.scope,
      },
      'Delegation enabled'
    );

    return this.settings;
  }

  /**
   * Revoke delegation immediately
   */
  async revokeDelegation(): Promise<boolean> {
    const current = await this.loadSettings();
    if (!current) return false;

    this.settings = { ...current, enabled: false };
    await this.saveSettings();

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

    if (delegation.excludeTags && task.tags) {
      const excluded = task.tags.find((tag) => delegation.excludeTags!.includes(tag));
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
    await this.loadLog();

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

    this.log.approvals.push(approval);

    // Keep only last 1000 approvals
    if (this.log.approvals.length > 1000) {
      this.log.approvals = this.log.approvals.slice(-1000);
    }

    await this.saveLog();

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
    await this.loadLog();

    let approvals = [...this.log.approvals];

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
