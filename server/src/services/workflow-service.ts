/**
 * WorkflowService — YAML loading, validation, CRUD operations on workflow definitions
 * Phase 1: Core Engine
 */

import { PHASE_NAMES, type PhaseName } from '@veritas-kanban/shared';
import type { WorkflowDefinition, WorkflowACL, WorkflowAuditEvent } from '../types/workflow.js';
import { ValidationError } from '../types/workflow.js';
import { getWorkflowsDir } from '../utils/paths.js';
import { createLogger } from '../lib/logger.js';
import { SqliteDatabase, type SqliteConnectionOptions } from '../storage/sqlite/database.js';
import { SqliteWorkflowDefinitionRepository } from '../storage/sqlite/workflow-repositories.js';
import { FileWorkflowDefinitionRepository } from '../storage/workflow-definition-repository.js';
import { evaluateCodexCommandPolicy, isCodexWorkflowAgent } from '../utils/codex-command-policy.js';

const log = createLogger('workflow-service');
const WORKFLOW_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;

// Validation limits
const MAX_WORKFLOWS = 200;
const MAX_WORKFLOW_NAME_LENGTH = 200;
const MAX_WORKFLOW_DESCRIPTION_LENGTH = 2000;
const MAX_AGENTS_PER_WORKFLOW = 20;
const MAX_STEPS_PER_WORKFLOW = 50;
const MAX_TOOLS_PER_AGENT = 50;
const MAX_RETRY_DELAY_MS = 300000; // 5 minutes max delay

export class WorkflowService {
  private cache: Map<string, WorkflowDefinition> = new Map();
  private readonly fileRepository: FileWorkflowDefinitionRepository | null = null;
  private readonly repository: SqliteWorkflowDefinitionRepository | null = null;
  private readonly sqliteDatabase: SqliteDatabase | null = null;
  private readonly ownsSqliteDatabase: boolean = false;

  constructor(options: string | WorkflowServiceOptions = {}) {
    const resolvedOptions = typeof options === 'string' ? { workflowsDir: options } : options;
    const workflowsDir = resolvedOptions.workflowsDir || getWorkflowsDir();
    const storageType =
      resolvedOptions.storageType ?? (process.env.VERITAS_STORAGE === 'sqlite' ? 'sqlite' : 'file');

    if (storageType === 'sqlite') {
      this.sqliteDatabase =
        resolvedOptions.sqliteDatabase ??
        new SqliteDatabase(resolvedOptions.sqliteConnectionOptions);
      this.ownsSqliteDatabase = !resolvedOptions.sqliteDatabase;
      this.sqliteDatabase.open();
      this.repository = new SqliteWorkflowDefinitionRepository(this.sqliteDatabase);
    }

    if (!this.repository) {
      this.fileRepository = new FileWorkflowDefinitionRepository(workflowsDir);
    }
  }

  private normalizeWorkflowId(id: string): string {
    const trimmed = (id ?? '').trim();
    if (!trimmed) {
      throw new ValidationError('Workflow ID is required');
    }

    if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) {
      throw new ValidationError('Workflow ID contains illegal path characters');
    }

    if (!WORKFLOW_ID_PATTERN.test(trimmed)) {
      throw new ValidationError(
        'Workflow ID must start with an alphanumeric character and may only contain letters, numbers, hyphen, or underscore'
      );
    }

    return trimmed;
  }

  /**
   * Load and parse a workflow YAML file
   */
  async loadWorkflow(id: string): Promise<WorkflowDefinition | null> {
    const normalizedId = this.normalizeWorkflowId(id);

    // Check cache first
    if (this.cache.has(normalizedId)) {
      return this.cache.get(normalizedId)!;
    }

    if (this.repository) {
      const workflow = this.repository.get(normalizedId);
      if (workflow) {
        this.validateWorkflow(workflow);
        this.cache.set(normalizedId, workflow);
        log.info({ workflowId: normalizedId, version: workflow.version }, 'Workflow loaded');
      }
      return workflow;
    }

    try {
      const workflow = await this.getFileRepository().get(normalizedId);
      if (!workflow) {
        log.debug({ workflowId: normalizedId }, 'Workflow not found');
        return null;
      }

      // Validate schema
      this.validateWorkflow(workflow);

      // Cache it
      this.cache.set(normalizedId, workflow);

      log.info({ workflowId: normalizedId, version: workflow.version }, 'Workflow loaded');
      return workflow;
    } catch (err: unknown) {
      log.error({ workflowId: normalizedId, err }, 'Failed to load workflow');
      const message = err instanceof Error ? err.message : 'Unknown error';
      throw new ValidationError(`Invalid workflow YAML: ${message}`);
    }
  }

  /**
   * List all available workflows (full definitions)
   */
  async listWorkflows(): Promise<WorkflowDefinition[]> {
    if (this.repository) {
      const workflows = this.repository.list();
      for (const workflow of workflows) {
        this.cache.set(workflow.id, workflow);
      }
      log.info({ count: workflows.length }, 'Listed workflows');
      return workflows;
    }

    const workflows = await this.getFileRepository().list();
    for (const workflow of workflows) {
      this.validateWorkflow(workflow);
      this.cache.set(workflow.id, workflow);
    }

    log.info({ count: workflows.length }, 'Listed workflows');
    return workflows;
  }

  /**
   * List workflow metadata only (efficient for list endpoints)
   * Returns only: id, name, version, description
   */
  async listWorkflowsMetadata(): Promise<
    Array<Pick<WorkflowDefinition, 'id' | 'name' | 'version' | 'description'>>
  > {
    if (this.repository) {
      const metadata = this.repository.listMetadata();
      log.info({ count: metadata.length }, 'Listed workflow metadata');
      return metadata;
    }

    const metadata = await this.getFileRepository().listMetadata();

    log.info({ count: metadata.length }, 'Listed workflow metadata');
    return metadata;
  }

  /**
   * Save a workflow definition
   */
  async saveWorkflow(workflow: WorkflowDefinition): Promise<void> {
    this.validateWorkflow(workflow);

    const normalizedId = this.normalizeWorkflowId(workflow.id);

    if (this.repository) {
      if (!this.repository.get(normalizedId) && this.repository.count() >= MAX_WORKFLOWS) {
        throw new ValidationError(
          `Maximum workflow limit (${MAX_WORKFLOWS}) reached. Delete unused workflows before creating new ones.`
        );
      }

      this.repository.save(workflow);
      this.cache.set(normalizedId, workflow);
      log.info({ workflowId: normalizedId, version: workflow.version }, 'Workflow saved');
      return;
    }

    const fileRepository = this.getFileRepository();
    if (
      !(await fileRepository.get(normalizedId)) &&
      (await fileRepository.count()) >= MAX_WORKFLOWS
    ) {
      throw new ValidationError(
        `Maximum workflow limit (${MAX_WORKFLOWS}) reached. Delete unused workflows before creating new ones.`
      );
    }
    await fileRepository.save(workflow);

    // Update cache
    this.cache.set(normalizedId, workflow);

    log.info({ workflowId: normalizedId, version: workflow.version }, 'Workflow saved');
  }

  /**
   * Delete a workflow definition
   */
  async deleteWorkflow(id: string): Promise<void> {
    const normalizedId = this.normalizeWorkflowId(id);
    if (this.repository) {
      this.repository.delete(normalizedId);
      this.cache.delete(normalizedId);
      log.info({ workflowId: normalizedId }, 'Workflow deleted');
      return;
    }

    await this.getFileRepository().delete(normalizedId);
    this.cache.delete(normalizedId);

    log.info({ workflowId: normalizedId }, 'Workflow deleted');
  }

  /**
   * Validate workflow definition against schema
   */
  private validateWorkflow(workflow: WorkflowDefinition): void {
    // Required fields
    if (!workflow.id || !workflow.name || workflow.version === undefined) {
      throw new ValidationError('Workflow must have id, name, and version');
    }

    // Enforce safe ID characters (prevents path traversal)
    const normalizedId = this.normalizeWorkflowId(workflow.id);
    if (workflow.id !== normalizedId) {
      throw new ValidationError('Workflow ID contains invalid characters');
    }

    // Size limit validation
    if (workflow.name.length > MAX_WORKFLOW_NAME_LENGTH) {
      throw new ValidationError(
        `Workflow name exceeds maximum length of ${MAX_WORKFLOW_NAME_LENGTH} characters`
      );
    }

    if (workflow.description && workflow.description.length > MAX_WORKFLOW_DESCRIPTION_LENGTH) {
      throw new ValidationError(
        `Workflow description exceeds maximum length of ${MAX_WORKFLOW_DESCRIPTION_LENGTH} characters`
      );
    }

    // At least one agent
    if (!workflow.agents || workflow.agents.length === 0) {
      throw new ValidationError('Workflow must define at least one agent');
    }

    // Agent count limit
    if (workflow.agents.length > MAX_AGENTS_PER_WORKFLOW) {
      throw new ValidationError(`Workflow exceeds maximum of ${MAX_AGENTS_PER_WORKFLOW} agents`);
    }

    // At least one step
    if (!workflow.steps || workflow.steps.length === 0) {
      throw new ValidationError('Workflow must define at least one step');
    }

    // Step count limit
    if (workflow.steps.length > MAX_STEPS_PER_WORKFLOW) {
      throw new ValidationError(`Workflow exceeds maximum of ${MAX_STEPS_PER_WORKFLOW} steps`);
    }

    // Check for duplicate agent IDs
    const agentIds = workflow.agents.map((a) => a.id);
    const uniqueAgentIds = new Set(agentIds);
    if (agentIds.length !== uniqueAgentIds.size) {
      const duplicates = agentIds.filter((id, index) => agentIds.indexOf(id) !== index);
      throw new ValidationError(`Duplicate agent IDs found: ${duplicates.join(', ')}`);
    }

    // Check for duplicate step IDs
    const stepIds = workflow.steps.map((s) => s.id);
    const uniqueStepIds = new Set(stepIds);
    if (stepIds.length !== uniqueStepIds.size) {
      const duplicates = stepIds.filter((id, index) => stepIds.indexOf(id) !== index);
      throw new ValidationError(`Duplicate step IDs found: ${duplicates.join(', ')}`);
    }

    const agentIdSet = new Set(agentIds);
    const stepIdSet = new Set(stepIds);

    // Validate agent-specific constraints
    for (const agent of workflow.agents) {
      // Tools array size validation
      if (agent.tools && agent.tools.length > MAX_TOOLS_PER_AGENT) {
        throw new ValidationError(
          `Agent ${agent.id} exceeds maximum of ${MAX_TOOLS_PER_AGENT} tools (has ${agent.tools.length})`
        );
      }

      if (isCodexWorkflowAgent(agent)) {
        const commandPolicy = evaluateCodexCommandPolicy(agent.command);
        if (!commandPolicy.allowed) {
          throw new ValidationError(
            `Agent ${agent.id} has unsafe Codex command override: ${commandPolicy.reason}`
          );
        }
      }
    }

    for (const step of workflow.steps) {
      if (step.phase !== undefined && !PHASE_NAMES.includes(step.phase as PhaseName)) {
        throw new ValidationError(
          `Step ${step.id} phase must be one of: ${PHASE_NAMES.join(', ')}`
        );
      }

      // Agent steps must reference a valid agent
      if ((step.type === 'agent' || step.type === 'loop') && !agentIdSet.has(step.agent!)) {
        throw new ValidationError(`Step ${step.id} references unknown agent ${step.agent}`);
      }

      // retry_step must reference a valid step
      if (step.on_fail?.retry_step && !stepIdSet.has(step.on_fail.retry_step)) {
        throw new ValidationError(
          `Step ${step.id} retry_step references unknown step ${step.on_fail.retry_step}`
        );
      }

      // Loop verify_step must reference a valid step
      if (step.loop?.verify_step && !stepIdSet.has(step.loop.verify_step)) {
        throw new ValidationError(
          `Step ${step.id} verify_step references unknown step ${step.loop.verify_step}`
        );
      }

      // Validate retry_delay_ms bounds
      if (step.on_fail?.retry_delay_ms !== undefined) {
        if (step.on_fail.retry_delay_ms < 0) {
          throw new ValidationError(
            `Step ${step.id} retry_delay_ms cannot be negative (got ${step.on_fail.retry_delay_ms})`
          );
        }
        if (step.on_fail.retry_delay_ms > MAX_RETRY_DELAY_MS) {
          throw new ValidationError(
            `Step ${step.id} retry_delay_ms exceeds maximum of ${MAX_RETRY_DELAY_MS}ms (5 minutes)`
          );
        }
      }
    }
  }

  /**
   * Load workflow ACL (access control list)
   */
  async loadACL(workflowId: string): Promise<WorkflowACL | null> {
    if (this.repository) {
      return this.repository.getAcl(workflowId);
    }

    return this.getFileRepository().getAcl(workflowId);
  }

  /**
   * Save workflow ACL
   */
  async saveACL(acl: WorkflowACL): Promise<void> {
    if (this.repository) {
      this.repository.saveAcl(acl);
      log.info({ workflowId: acl.workflowId }, 'Workflow ACL saved');
      return;
    }

    await this.getFileRepository().saveAcl(acl);

    log.info({ workflowId: acl.workflowId }, 'Workflow ACL saved');
  }

  /**
   * Audit workflow changes
   */
  async auditChange(event: WorkflowAuditEvent): Promise<void> {
    if (this.repository) {
      this.repository.appendAuditEvent(event);
      log.info({ event }, 'Workflow audit event logged');
      return;
    }

    await this.getFileRepository().appendAuditEvent(event);

    log.info({ event }, 'Workflow audit event logged');
  }

  /**
   * Clear the cache (useful for tests)
   */
  clearCache(): void {
    this.cache.clear();
  }

  private getFileRepository(): FileWorkflowDefinitionRepository {
    if (!this.fileRepository) {
      throw new Error('File workflow repository is not configured');
    }
    return this.fileRepository;
  }

  dispose(): void {
    if (this.ownsSqliteDatabase) {
      this.sqliteDatabase?.close();
    }
  }
}

export interface WorkflowServiceOptions {
  workflowsDir?: string;
  storageType?: 'file' | 'sqlite';
  sqliteDatabase?: SqliteDatabase;
  sqliteConnectionOptions?: SqliteConnectionOptions;
}

// Singleton
let workflowServiceInstance: WorkflowService | null = null;

export function getWorkflowService(): WorkflowService {
  if (!workflowServiceInstance) {
    workflowServiceInstance = new WorkflowService();
  }
  return workflowServiceInstance;
}

/** Dispose and reset the singleton (useful for tests and shutdown). */
export function disposeWorkflowService(): void {
  if (workflowServiceInstance) {
    workflowServiceInstance.dispose();
    workflowServiceInstance = null;
  }
}
