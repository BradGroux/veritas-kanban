/**
 * ToolPolicyService — Role-based tool access policies for agents
 * GitHub Issue: #110
 *
 * Defines which tools each agent role can access. When a workflow step
 * specifies a role, that role's tool policy is applied to the agent session.
 */

import fs from 'fs/promises';
import path from 'path';
import type { ToolPolicy } from '../types/workflow.js';
import { ValidationError } from '../types/workflow.js';
import { getToolPoliciesDir } from '../utils/paths.js';
import { createLogger } from '../lib/logger.js';
import { SqliteDatabase, type SqliteConnectionOptions } from '../storage/sqlite/database.js';
import { SqliteToolPolicyRepository } from '../storage/sqlite/audit-policy-repositories.js';

const log = createLogger('tool-policy-service');

// Default policies (cannot be deleted)
const DEFAULT_ROLES = new Set(['planner', 'developer', 'reviewer', 'tester', 'deployer']);

// Validation limits
const MAX_POLICIES = 50;
const MAX_TOOLS_PER_POLICY = 100;
const MAX_ROLE_NAME_LENGTH = 50;
const MAX_DESCRIPTION_LENGTH = 500;

/**
 * Default tool policies for standard roles
 */
const DEFAULT_POLICIES: ToolPolicy[] = [
  {
    role: 'planner',
    allowed: ['Read', 'web_search', 'web_fetch', 'browser', 'image', 'nodes'],
    denied: ['Write', 'Edit', 'exec', 'message'],
    description:
      'Read-only access for planning and analysis. Can search and browse, but cannot modify files or execute commands.',
  },
  {
    role: 'developer',
    allowed: ['*'], // Full access
    denied: [],
    description:
      'Full access to all tools. Can read, write, execute commands, and use all available capabilities.',
  },
  {
    role: 'reviewer',
    allowed: ['Read', 'exec', 'web_search', 'web_fetch', 'browser', 'image', 'nodes'],
    denied: ['Write', 'Edit', 'message'],
    description:
      'Read and execute access for code review. Can run tests and checks, but cannot modify the code being reviewed.',
  },
  {
    role: 'tester',
    allowed: ['Read', 'exec', 'browser', 'web_search', 'web_fetch', 'image', 'nodes'],
    denied: ['Write', 'Edit', 'message'],
    description:
      'Read, execute, and browser access for testing. Can run tests and interact with UIs, but cannot modify source code.',
  },
  {
    role: 'deployer',
    allowed: ['*'], // Full access (needed for deployment operations)
    denied: [],
    description:
      'Full access for deployment operations. Can execute deployment scripts, modify configs, and interact with production systems.',
  },
  {
    role: 'researcher',
    allowed: ['Read', 'web_search', 'web_fetch', 'browser', 'image', 'memory_search', 'memory_get'],
    denied: ['Write', 'Edit', 'exec', 'message', 'cron', 'nodes'],
    description:
      'Research-focused access. Can read files, search the web, browse pages, and query memory. Cannot modify files, run commands, or send messages.',
  },
  {
    role: 'orchestrator',
    allowed: [
      'Read',
      'web_search',
      'web_fetch',
      'browser',
      'image',
      'message',
      'cron',
      'memory_search',
      'memory_get',
      'sessions_spawn',
      'sessions_send',
      'sessions_list',
      'sessions_history',
      'session_status',
      'nodes',
    ],
    denied: ['Write', 'Edit', 'exec'],
    description:
      'PM/orchestrator role. Can read, search, communicate, spawn sub-agents, and manage schedules. Cannot directly write code or execute commands — delegates to workers.',
  },
  {
    role: 'content-writer',
    allowed: [
      'Read',
      'Write',
      'Edit',
      'web_search',
      'web_fetch',
      'browser',
      'image',
      'memory_search',
      'memory_get',
      'tts',
    ],
    denied: ['exec', 'message', 'cron', 'nodes'],
    description:
      'Content creation access. Can read, write, and edit files, search the web, and generate speech. Cannot execute commands, send messages, or manage infrastructure.',
  },
  {
    role: 'intern',
    allowed: ['Read', 'web_search', 'web_fetch', 'image', 'memory_search', 'memory_get'],
    denied: ['Write', 'Edit', 'exec', 'browser', 'message', 'cron', 'nodes', 'tts'],
    description:
      'Observation-only access. Can read files, search the web, and query memory. Cannot write, execute, browse interactively, or communicate. Ideal for learning agents or sandboxed analysis.',
  },
];

export class ToolPolicyService {
  private policiesDir: string;
  private cache: Map<string, ToolPolicy> = new Map();
  private initPromise: Promise<void> | null = null;
  private readonly repository: SqliteToolPolicyRepository | null = null;
  private readonly sqliteDatabase: SqliteDatabase | null = null;
  private readonly ownsSqliteDatabase: boolean = false;

  constructor(options: string | ToolPolicyServiceOptions = {}) {
    const resolvedOptions = typeof options === 'string' ? { policiesDir: options } : options;
    this.policiesDir = resolvedOptions.policiesDir || getToolPoliciesDir();
    const storageType =
      resolvedOptions.storageType ?? (process.env.VERITAS_STORAGE === 'sqlite' ? 'sqlite' : 'file');

    if (storageType === 'sqlite') {
      this.sqliteDatabase =
        resolvedOptions.sqliteDatabase ??
        new SqliteDatabase(resolvedOptions.sqliteConnectionOptions);
      this.ownsSqliteDatabase = !resolvedOptions.sqliteDatabase;
      this.sqliteDatabase.open();
      this.repository = new SqliteToolPolicyRepository(this.sqliteDatabase);
    }

    // Load defaults into cache synchronously (no I/O)
    this.loadDefaultsToCache();
    // Initialize async operations (directory creation, file persistence)
    this.initPromise = this.initializeAsync();
  }

  /**
   * Load default policies into in-memory cache (synchronous)
   * This ensures policies are immediately available even before disk persistence completes
   */
  private loadDefaultsToCache(): void {
    for (const policy of DEFAULT_POLICIES) {
      this.cache.set(policy.role, policy);
    }
  }

  /**
   * Initialize async operations: create directories and persist default policies
   * Called from constructor, completes in background
   */
  private async initializeAsync(): Promise<void> {
    try {
      if (this.repository) {
        for (const policy of DEFAULT_POLICIES) {
          if (!this.repository.get(policy.role)) {
            this.repository.save(policy);
          }
        }
        this.loadRepositoryPoliciesToCache();
        return;
      }

      // Ensure directory exists
      await fs.mkdir(this.policiesDir, { recursive: true });

      // Persist default policies to disk if they don't exist
      for (const policy of DEFAULT_POLICIES) {
        const filePath = path.join(this.policiesDir, `${policy.role}.json`);
        try {
          await fs.access(filePath);
        } catch {
          // File doesn't exist, create it
          await fs.writeFile(filePath, JSON.stringify(policy, null, 2), 'utf-8');
          log.info({ role: policy.role }, 'Created default policy file');
        }
      }
    } catch (err) {
      log.error({ err }, 'Failed to initialize tool policy service directories');
      throw err;
    }
  }

  /**
   * Wait for async initialization to complete (useful for tests)
   */
  async waitForInit(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
    }
  }

  /**
   * Get policy for a specific role
   */
  async getToolPolicy(role: string): Promise<ToolPolicy | null> {
    await this.waitForInit();

    const normalizedRole = role.trim().toLowerCase();

    // Check cache first
    if (this.cache.has(normalizedRole)) {
      const cachedPolicy = this.cache.get(normalizedRole);
      if (cachedPolicy) return cachedPolicy;
    }

    if (this.repository) {
      const policy = this.repository.get(normalizedRole);
      if (policy) {
        this.cache.set(normalizedRole, policy);
      }
      return policy;
    }

    // Try loading from disk
    const filePath = path.join(this.policiesDir, `${normalizedRole}.json`);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const policy = JSON.parse(content) as ToolPolicy;

      this.validatePolicy(policy);

      // Cache it
      this.cache.set(normalizedRole, policy);

      log.info({ role: normalizedRole }, 'Tool policy loaded');
      return policy;
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
        log.debug({ role: normalizedRole }, 'Tool policy not found');
        return null;
      }
      log.error({ role: normalizedRole, err }, 'Failed to load tool policy');
      const message = err instanceof Error ? err.message : 'Unknown error';
      throw new ValidationError(`Invalid tool policy: ${message}`);
    }
  }

  /**
   * List all tool policies
   */
  async listPolicies(): Promise<ToolPolicy[]> {
    await this.waitForInit();

    if (this.repository) {
      const policies = this.repository.list();
      log.info({ count: policies.length }, 'Listed tool policies');
      return policies;
    }

    const files = await fs.readdir(this.policiesDir).catch(() => []);
    const policies: ToolPolicy[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const role = file.replace('.json', '');
      const policy = await this.getToolPolicy(role);
      if (policy) {
        policies.push(policy);
      }
    }

    log.info({ count: policies.length }, 'Listed tool policies');
    return policies;
  }

  /**
   * Create or update a custom tool policy
   *
   * @param policy - The tool policy to save
   * @throws ValidationError if policy validation fails or policy limit is reached
   */
  async savePolicy(policy: ToolPolicy): Promise<void> {
    await this.waitForInit();
    this.validatePolicy(policy);

    const normalizedRole = policy.role.trim().toLowerCase();

    // Check if we're at the limit for custom policies
    if (!this.cache.has(normalizedRole)) {
      const policyCount = this.repository
        ? this.repository.list().length
        : (await fs.readdir(this.policiesDir).catch(() => [])).filter((f) => f.endsWith('.json'))
            .length;

      if (policyCount >= MAX_POLICIES) {
        throw new ValidationError(
          `Maximum policy limit (${MAX_POLICIES}) reached. Delete unused policies before creating new ones.`
        );
      }
    }

    if (this.repository) {
      this.repository.save(policy);
    } else {
      const filePath = path.join(this.policiesDir, `${normalizedRole}.json`);
      await fs.writeFile(filePath, JSON.stringify(policy, null, 2), 'utf-8');
    }

    // Update cache
    this.cache.set(normalizedRole, policy);

    log.info({ role: normalizedRole }, 'Tool policy saved');
  }

  /**
   * Delete a custom tool policy (cannot delete defaults)
   *
   * @param role - The role name of the policy to delete
   * @throws ValidationError if attempting to delete a default policy
   */
  async deletePolicy(role: string): Promise<void> {
    await this.waitForInit();
    const normalizedRole = role.trim().toLowerCase();

    // Prevent deletion of default policies
    if (DEFAULT_ROLES.has(normalizedRole)) {
      throw new ValidationError(
        `Cannot delete default policy: ${normalizedRole}. Default policies can only be modified, not deleted.`
      );
    }

    if (this.repository) {
      this.repository.delete(normalizedRole);
    } else {
      const filePath = path.join(this.policiesDir, `${normalizedRole}.json`);
      await fs.unlink(filePath);
    }
    this.cache.delete(normalizedRole);

    log.info({ role: normalizedRole }, 'Tool policy deleted');
  }

  /**
   * Validate tool access for a role
   * Returns true if the tool is allowed, false if denied
   *
   * Security Note: This method follows a fail-open pattern. When no policy exists
   * for a role, all tools are allowed. This design choice enables:
   * 1. Backward compatibility with workflows that don't specify roles
   * 2. Graceful degradation if a custom role is deleted
   * 3. Developer-friendly defaults (restrictive policies must be explicit)
   *
   * To enforce restrictive-by-default security:
   * 1. Always specify agent roles in workflow definitions
   * 2. Ensure all custom roles have policies defined
   * 3. Monitor logs for "No policy found" warnings
   */
  async validateToolAccess(role: string, tool: string): Promise<boolean> {
    const policy = await this.getToolPolicy(role);

    if (!policy) {
      // No policy defined for this role - allow all tools (fail-open pattern)
      // This enables backward compatibility and graceful degradation
      log.warn(
        { role, tool },
        'No policy found for role - allowing all tools (fail-open). Define a policy for this role to enforce restrictions.'
      );
      return true;
    }

    // Denied list takes precedence over allowed list
    if (policy.denied.includes(tool)) {
      log.debug({ role, tool }, 'Tool access denied by policy');
      return false;
    }

    // Check allowed list
    // '*' means all tools allowed
    if (policy.allowed.includes('*')) {
      return true;
    }

    // Explicit allow
    const allowed = policy.allowed.includes(tool);
    if (!allowed) {
      log.debug({ role, tool, allowedTools: policy.allowed }, 'Tool not in allowed list');
    }
    return allowed;
  }

  /**
   * Get the OpenClaw tool filter configuration for a role
   * Returns the allowed/denied tool names that can be passed to OpenClaw sessions API
   *
   * @param role - The agent role to get the tool filter for
   * @returns Object with optional `allowed` and `denied` arrays. Empty object if no restrictions.
   */
  async getToolFilterForRole(role: string): Promise<{ allowed?: string[]; denied?: string[] }> {
    const policy = await this.getToolPolicy(role);

    if (!policy) {
      // No policy - no restrictions
      return {};
    }

    const filter: { allowed?: string[]; denied?: string[] } = {};

    if (policy.denied.length > 0) {
      filter.denied = policy.denied;
    }

    // Only set allowed if it's not '*' (which means all tools)
    if (policy.allowed.length > 0 && !policy.allowed.includes('*')) {
      filter.allowed = policy.allowed;
    }

    return filter;
  }

  /**
   * Validate policy structure and constraints
   */
  private validatePolicy(policy: ToolPolicy): void {
    if (!policy.role || typeof policy.role !== 'string') {
      throw new ValidationError('Policy must have a role name');
    }

    if (policy.role.length > MAX_ROLE_NAME_LENGTH) {
      throw new ValidationError(
        `Role name exceeds maximum length of ${MAX_ROLE_NAME_LENGTH} characters`
      );
    }

    if (!Array.isArray(policy.allowed)) {
      throw new ValidationError('Policy must have an "allowed" array');
    }

    if (!Array.isArray(policy.denied)) {
      throw new ValidationError('Policy must have a "denied" array');
    }

    if (policy.allowed.length > MAX_TOOLS_PER_POLICY) {
      throw new ValidationError(
        `Allowed tools list exceeds maximum of ${MAX_TOOLS_PER_POLICY} tools`
      );
    }

    if (policy.denied.length > MAX_TOOLS_PER_POLICY) {
      throw new ValidationError(
        `Denied tools list exceeds maximum of ${MAX_TOOLS_PER_POLICY} tools`
      );
    }

    if (policy.description && policy.description.length > MAX_DESCRIPTION_LENGTH) {
      throw new ValidationError(
        `Description exceeds maximum length of ${MAX_DESCRIPTION_LENGTH} characters`
      );
    }

    // Check for overlap between allowed and denied
    const allowedSet = new Set(policy.allowed);
    const deniedSet = new Set(policy.denied);
    const overlap = [...allowedSet].filter((tool) => deniedSet.has(tool));

    if (overlap.length > 0) {
      throw new ValidationError(`Tools cannot be both allowed and denied: ${overlap.join(', ')}`);
    }
  }

  /**
   * Clear the cache and reload defaults (useful for tests)
   */
  clearCache(): void {
    this.cache.clear();
    this.loadDefaultsToCache();
    if (this.repository) {
      this.loadRepositoryPoliciesToCache();
    }
  }

  dispose(): void {
    if (this.ownsSqliteDatabase) {
      this.sqliteDatabase?.close();
    }
  }

  private loadRepositoryPoliciesToCache(): void {
    for (const policy of this.repository?.list() ?? []) {
      this.cache.set(policy.role.trim().toLowerCase(), policy);
    }
  }
}

export interface ToolPolicyServiceOptions {
  policiesDir?: string;
  storageType?: 'file' | 'sqlite';
  sqliteDatabase?: SqliteDatabase;
  sqliteConnectionOptions?: SqliteConnectionOptions;
}

// Singleton
let toolPolicyServiceInstance: ToolPolicyService | null = null;

export function getToolPolicyService(): ToolPolicyService {
  if (!toolPolicyServiceInstance) {
    toolPolicyServiceInstance = new ToolPolicyService();
  }
  return toolPolicyServiceInstance;
}
