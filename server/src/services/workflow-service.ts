/**
 * WorkflowService — YAML loading, validation, CRUD operations on workflow definitions
 * Phase 1: Core Engine
 */

import fs from 'fs/promises';
import path from 'path';
import yaml from 'yaml';
import type { WorkflowDefinition, WorkflowACL, WorkflowAuditEvent } from '../types/workflow.js';
import { ValidationError } from '../types/workflow.js';
import { getWorkflowsDir } from '../utils/paths.js';
import { createLogger } from '../lib/logger.js';

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
  private workflowsDir: string;
  private cache: Map<string, WorkflowDefinition> = new Map();

  constructor(workflowsDir?: string) {
    this.workflowsDir = workflowsDir || getWorkflowsDir();
    this.ensureDirectories();
  }

  private async ensureDirectories(): Promise<void> {
    await fs.mkdir(this.workflowsDir, { recursive: true });
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

    const filePath = path.join(this.workflowsDir, `${normalizedId}.yml`);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const workflow = yaml.parse(content) as WorkflowDefinition;

      // Validate schema
      this.validateWorkflow(workflow);

      // Cache it
      this.cache.set(normalizedId, workflow);

      log.info({ workflowId: normalizedId, version: workflow.version }, 'Workflow loaded');
      return workflow;
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
        log.debug({ workflowId: normalizedId }, 'Workflow not found');
        return null;
      }
      log.error({ workflowId: normalizedId, err }, 'Failed to load workflow');
      const message = err instanceof Error ? err.message : 'Unknown error';
      throw new ValidationError(`Invalid workflow YAML: ${message}`);
    }
  }

  /**
   * List all available workflows (full definitions)
   */
  async listWorkflows(): Promise<WorkflowDefinition[]> {
    const files = await fs.readdir(this.workflowsDir).catch(() => []);
    const workflows: WorkflowDefinition[] = [];

    for (const file of files) {
      if (!file.endsWith('.yml') && !file.endsWith('.yaml')) continue;

      const id = file.replace(/\.(yml|yaml)$/, '');
      const workflow = await this.loadWorkflow(id);
      if (workflow) {
        workflows.push(workflow);
      }
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
    const files = await fs.readdir(this.workflowsDir).catch(() => []);
    const metadata: Array<Pick<WorkflowDefinition, 'id' | 'name' | 'version' | 'description'>> = [];

    for (const file of files) {
      if (!file.endsWith('.yml') && !file.endsWith('.yaml')) continue;

      const id = file.replace(/\.(yml|yaml)$/, '');
      const filePath = path.join(this.workflowsDir, file);

      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const workflow = yaml.parse(content) as WorkflowDefinition;

        metadata.push({
          id: workflow.id,
          name: workflow.name,
          version: workflow.version,
          description: workflow.description,
        });
      } catch (err: unknown) {
        log.warn({ workflowId: id, err }, 'Failed to read workflow metadata');
        continue;
      }
    }

    log.info({ count: metadata.length }, 'Listed workflow metadata');
    return metadata;
  }

  /**
   * Save a workflow definition
   */
  async saveWorkflow(workflow: WorkflowDefinition): Promise<void> {
    this.validateWorkflow(workflow);

    const normalizedId = this.normalizeWorkflowId(workflow.id);
    const filePath = path.join(this.workflowsDir, `${normalizedId}.yml`);

    // Check if this is a new workflow (not an update)
    try {
      await fs.access(filePath);
      // File exists, this is an update
    } catch {
      // New workflow - check count limit
      const files = await fs.readdir(this.workflowsDir).catch(() => []);
      const workflowCount = files.filter((f) => f.endsWith('.yml') || f.endsWith('.yaml')).length;

      if (workflowCount >= MAX_WORKFLOWS) {
        throw new ValidationError(
          `Maximum workflow limit (${MAX_WORKFLOWS}) reached. Delete unused workflows before creating new ones.`
        );
      }
    }

    const content = yaml.stringify(workflow);
    await fs.writeFile(filePath, content, 'utf-8');

    // Update cache
    this.cache.set(normalizedId, workflow);

    log.info({ workflowId: normalizedId, version: workflow.version }, 'Workflow saved');
  }

  /**
   * Delete a workflow definition
   */
  async deleteWorkflow(id: string): Promise<void> {
    const normalizedId = this.normalizeWorkflowId(id);
    const filePath = path.join(this.workflowsDir, `${normalizedId}.yml`);
    await fs.unlink(filePath);
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
    }

    for (const step of workflow.steps) {
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
    const aclPath = path.join(this.workflowsDir, '.acl.json');

    try {
      const content = await fs.readFile(aclPath, 'utf-8');
      const acls = JSON.parse(content) as Record<string, WorkflowACL>;
      return acls[workflowId] || null;
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') return null;
      throw err;
    }
  }

  /**
   * Save workflow ACL
   */
  async saveACL(acl: WorkflowACL): Promise<void> {
    const aclPath = path.join(this.workflowsDir, '.acl.json');

    let acls: Record<string, WorkflowACL> = {};

    try {
      const content = await fs.readFile(aclPath, 'utf-8');
      acls = JSON.parse(content);
    } catch (err: unknown) {
      if (!(err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT')) throw err;
    }

    acls[acl.workflowId] = acl;

    await fs.writeFile(aclPath, JSON.stringify(acls, null, 2), 'utf-8');

    log.info({ workflowId: acl.workflowId }, 'Workflow ACL saved');
  }

  /**
   * Audit workflow changes
   */
  async auditChange(event: WorkflowAuditEvent): Promise<void> {
    const auditPath = path.join(this.workflowsDir, '.audit.jsonl');
    const line = JSON.stringify(event) + '\n';
    await fs.appendFile(auditPath, line, 'utf-8');

    log.info({ event }, 'Workflow audit event logged');
  }

  /**
   * Clear the cache (useful for tests)
   */
  clearCache(): void {
    this.cache.clear();
  }
}

// Singleton
let workflowServiceInstance: WorkflowService | null = null;

export function getWorkflowService(): WorkflowService {
  if (!workflowServiceInstance) {
    workflowServiceInstance = new WorkflowService();
  }
  return workflowServiceInstance;
}
