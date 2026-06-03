import path from 'path';
import type {
  AgentPolicy,
  CreateGovernanceTraceInput,
  GovernanceTraceRule,
  PolicyEvaluationMatch,
  PolicyEvaluationRequest,
  PolicyEvaluationResult,
  PolicyResponseAction,
} from '@veritas-kanban/shared';
import { fileExists, mkdir, readFile, readdir, unlink, writeFile } from '../storage/fs-helpers.js';
import { createLogger } from '../lib/logger.js';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/error-handler.js';
import { policySchema } from '../schemas/policy-schemas.js';
import { getPoliciesDir } from '../utils/paths.js';
import { SqliteDatabase, type SqliteConnectionOptions } from '../storage/sqlite/database.js';
import { SqliteAgentPolicyRepository } from '../storage/sqlite/audit-policy-repositories.js';
import { getOutboundIntegrationService } from './outbound-integration-service.js';

const log = createLogger('policy-service');
const PRESET_TIMESTAMP = new Date().toISOString();

const DEFAULT_PRESET_POLICIES: AgentPolicy[] = [
  {
    id: 'strict-high-risk-block',
    name: 'Strict Pack',
    type: 'risk-threshold',
    enabled: true,
    scope: {},
    responseAction: 'block',
    description: 'Blocks high-risk actions across all agents and projects.',
    preset: 'strict',
    config: {
      threshold: 85,
      comparator: 'gte',
    },
    createdAt: PRESET_TIMESTAMP,
    updatedAt: PRESET_TIMESTAMP,
  },
  {
    id: 'balanced-high-risk-approval',
    name: 'Balanced Pack',
    type: 'risk-threshold',
    enabled: true,
    scope: {},
    responseAction: 'require-approval',
    description: 'Requires approval when an action crosses a moderate-to-high risk threshold.',
    preset: 'balanced',
    config: {
      threshold: 65,
      comparator: 'gte',
    },
    createdAt: PRESET_TIMESTAMP,
    updatedAt: PRESET_TIMESTAMP,
  },
  {
    id: 'permissive-burst-warning',
    name: 'Permissive Pack',
    type: 'rate-limit',
    enabled: true,
    scope: {},
    responseAction: 'warn',
    description: 'Warns when the same actor bursts a large number of actions in a short window.',
    preset: 'permissive',
    config: {
      maxAttempts: 20,
      windowMs: 60 * 60 * 1000,
      scopeKey: 'agent',
    },
    createdAt: PRESET_TIMESTAMP,
    updatedAt: PRESET_TIMESTAMP,
  },
];

const RESPONSE_PRIORITY: Record<PolicyResponseAction, number> = {
  warn: 1,
  'require-approval': 2,
  block: 3,
};

const DECISION_PRIORITY: Record<PolicyEvaluationResult['decision'], number> = {
  allow: 0,
  warn: 1,
  'require-approval': 2,
  block: 3,
};

export class PolicyService {
  private readonly policiesDir: string;
  private readonly repository: SqliteAgentPolicyRepository | null = null;
  private readonly sqliteDatabase: SqliteDatabase | null = null;
  private readonly ownsSqliteDatabase: boolean = false;
  private readonly cache = new Map<string, AgentPolicy>();
  private readonly rateLimitState = new Map<string, number[]>();
  private initPromise: Promise<void> | null = null;

  constructor(options: string | PolicyServiceOptions = {}) {
    const resolvedOptions = typeof options === 'string' ? { policiesDir: options } : options;
    this.policiesDir = resolvedOptions.policiesDir ?? getPoliciesDir();
    const storageType =
      resolvedOptions.storageType ?? (process.env.VERITAS_STORAGE === 'sqlite' ? 'sqlite' : 'file');

    if (storageType === 'sqlite') {
      this.sqliteDatabase =
        resolvedOptions.sqliteDatabase ??
        new SqliteDatabase(resolvedOptions.sqliteConnectionOptions);
      this.ownsSqliteDatabase = !resolvedOptions.sqliteDatabase;
      this.sqliteDatabase.open();
      this.repository = new SqliteAgentPolicyRepository(this.sqliteDatabase);
    }

    this.initPromise = this.init();
  }

  async init(): Promise<void> {
    if (this.repository) {
      for (const policy of DEFAULT_PRESET_POLICIES) {
        if (!this.repository.get(policy.id)) {
          this.repository.save(policy);
        }
      }
      this.loadPoliciesFromRepository();
      return;
    }

    await mkdir(this.policiesDir, { recursive: true });

    const files = (await readdir(this.policiesDir)).filter((file) => file.endsWith('.json'));
    if (files.length === 0) {
      for (const policy of DEFAULT_PRESET_POLICIES) {
        await this.writePolicy(policy);
      }
    }

    await this.loadPoliciesFromDisk();
  }

  async waitForInit(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
    }
  }

  async listPolicies(): Promise<AgentPolicy[]> {
    await this.waitForInit();
    return Array.from(this.cache.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  async getPolicy(id: string): Promise<AgentPolicy | null> {
    await this.waitForInit();

    const cached = this.cache.get(id);
    if (cached) {
      return cached;
    }

    if (this.repository) {
      this.validatePolicyId(id);
      const policy = this.repository.get(id);
      if (policy) {
        this.cache.set(policy.id, policy);
      }
      return policy;
    }

    const filePath = this.getPolicyFilePath(id);
    if (!(await fileExists(filePath))) {
      return null;
    }

    const content = await readFile(filePath, 'utf8');
    const parsed = policySchema.parse(JSON.parse(content)) as AgentPolicy;
    this.cache.set(parsed.id, parsed);
    return parsed;
  }

  async createPolicy(policy: AgentPolicy): Promise<AgentPolicy> {
    await this.waitForInit();

    const normalized = this.normalizePolicy(policy, true);
    if (this.cache.has(normalized.id)) {
      throw new ConflictError(`Policy already exists: ${normalized.id}`);
    }
    await this.writePolicy(normalized);
    this.cache.set(normalized.id, normalized);
    return normalized;
  }

  async updatePolicy(id: string, policy: AgentPolicy): Promise<AgentPolicy> {
    await this.waitForInit();

    if (id !== policy.id) {
      throw new ValidationError('Policy id in URL must match policy id in request body');
    }

    if (!this.cache.has(id)) {
      throw new NotFoundError(`Policy not found: ${id}`);
    }

    const existing = this.cache.get(id);
    const normalized = this.normalizePolicy(
      {
        ...policy,
        createdAt: existing?.createdAt || policy.createdAt,
      },
      false
    );

    await this.writePolicy(normalized);
    this.cache.set(normalized.id, normalized);
    return normalized;
  }

  async deletePolicy(id: string): Promise<void> {
    await this.waitForInit();

    if (!this.cache.has(id)) {
      throw new NotFoundError(`Policy not found: ${id}`);
    }

    if (this.repository) {
      this.repository.delete(id);
    } else {
      const filePath = this.getPolicyFilePath(id);
      if (await fileExists(filePath)) {
        await unlink(filePath);
      }
    }

    this.cache.delete(id);
    for (const key of Array.from(this.rateLimitState.keys())) {
      if (key.startsWith(`${id}:`)) {
        this.rateLimitState.delete(key);
      }
    }
  }

  async evaluatePolicies(input: PolicyEvaluationRequest): Promise<PolicyEvaluationResult> {
    return (await this.evaluatePoliciesWithTrace(input)).result;
  }

  async evaluatePoliciesWithTrace(input: PolicyEvaluationRequest): Promise<{
    result: PolicyEvaluationResult;
    trace: CreateGovernanceTraceInput;
  }> {
    await this.waitForInit();

    const policies = await this.listPolicies();
    const matches: PolicyEvaluationMatch[] = [];
    const evaluatedRules: GovernanceTraceRule[] = [];
    let decision: PolicyEvaluationResult['decision'] = 'allow';

    for (const policy of policies) {
      if (!policy.enabled) {
        evaluatedRules.push({
          id: policy.id,
          label: policy.name,
          type: policy.type,
          status: 'skipped',
          message: `${policy.name} is disabled.`,
        });
        continue;
      }

      if (!this.scopeMatches(policy, input)) {
        evaluatedRules.push({
          id: policy.id,
          label: policy.name,
          type: policy.type,
          status: 'not-matched',
          message: `${policy.name} did not match the actor, project, or action scope.`,
          details: {
            scope: policy.scope,
            agent: input.agent,
            project: input.project,
            actionType: input.actionType,
          },
        });
        continue;
      }

      const evaluation = await this.evaluatePolicy(policy, input);
      if (!evaluation) {
        evaluatedRules.push({
          id: policy.id,
          label: policy.name,
          type: policy.type,
          status: 'not-matched',
          message: `${policy.name} was in scope but its condition did not trigger.`,
          details: {
            policyType: policy.type,
            actionType: input.actionType,
            riskScore: input.riskScore,
          },
        });
        continue;
      }

      matches.push(evaluation);
      evaluatedRules.push({
        id: policy.id,
        label: policy.name,
        type: policy.type,
        status: 'matched',
        outcome: this.traceOutcomeForDecision(this.toDecision(evaluation.responseAction)),
        message: evaluation.message,
        details: evaluation.details,
      });
      if (RESPONSE_PRIORITY[evaluation.responseAction] > DECISION_PRIORITY[decision]) {
        decision = this.toDecision(evaluation.responseAction);
      }
    }

    const result: PolicyEvaluationResult = {
      decision,
      matches,
      warnings: matches
        .filter((match) => match.responseAction === 'warn')
        .map((match) => match.message),
      blockedBy: matches
        .filter((match) => match.responseAction === 'block')
        .map((match) => match.policyId),
      approvalRequiredBy: matches
        .filter((match) => match.responseAction === 'require-approval')
        .map((match) => match.policyId),
    };
    const outcome = this.traceOutcomeForDecision(decision);

    return {
      result,
      trace: {
        kind: 'policy',
        outcome,
        title: `Policy evaluation: ${input.actionType}`,
        summary: this.policyTraceSummary(result),
        remediation: this.policyTraceRemediation(result),
        subject: {
          agentId: input.agent,
          actorId: input.agent,
          project: input.project,
          actionType: input.actionType,
        },
        evaluatedRules,
        matchedRules: evaluatedRules.filter((rule) => rule.status === 'matched'),
        steps: [
          {
            id: 'scope',
            label: 'Scope evaluation',
            status: evaluatedRules.some((rule) => rule.status === 'matched') ? 'matched' : 'info',
            message: `${evaluatedRules.length} policy rule(s) evaluated for ${input.actionType}.`,
          },
          {
            id: 'outcome',
            label: 'Outcome',
            status: matches.length > 0 ? 'matched' : 'info',
            message: this.policyTraceSummary(result),
          },
        ],
        raw: {
          input,
          result,
        },
      },
    };
  }

  private async loadPoliciesFromDisk(): Promise<void> {
    const files = (await readdir(this.policiesDir)).filter((file) => file.endsWith('.json'));
    this.cache.clear();

    for (const fileName of files) {
      const filePath = path.join(this.policiesDir, fileName);
      const content = await readFile(filePath, 'utf8');
      const parsed = policySchema.parse(JSON.parse(content)) as AgentPolicy;
      this.cache.set(parsed.id, parsed);
    }
  }

  private loadPoliciesFromRepository(): void {
    this.cache.clear();
    for (const policy of this.repository?.list() ?? []) {
      this.cache.set(policy.id, policy);
    }
  }

  private normalizePolicy(policy: AgentPolicy, isCreate: boolean): AgentPolicy {
    const now = new Date().toISOString();
    const normalized = policySchema.parse({
      ...policy,
      id: policy.id.trim(),
      name: policy.name.trim(),
      description: policy.description?.trim() || undefined,
      scope: {
        agents: [...new Set(policy.scope.agents ?? [])],
        projects: [...new Set(policy.scope.projects ?? [])],
        actionTypes: [...new Set(policy.scope.actionTypes ?? [])],
      },
      createdAt: isCreate ? now : policy.createdAt,
      updatedAt: now,
    }) as AgentPolicy;

    return normalized;
  }

  private async writePolicy(policy: AgentPolicy): Promise<void> {
    if (this.repository) {
      this.repository.save(policy);
      log.info({ policyId: policy.id, type: policy.type }, 'Policy saved');
      return;
    }

    const filePath = this.getPolicyFilePath(policy.id);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(policy, null, 2)}\n`, 'utf8');
    log.info({ policyId: policy.id, type: policy.type }, 'Policy saved');
  }

  private getPolicyFilePath(id: string): string {
    this.validatePolicyId(id);
    return path.join(this.policiesDir, `${id}.json`);
  }

  private validatePolicyId(id: string): void {
    if (!/^[a-z0-9][a-z0-9-_]*$/.test(id)) {
      throw new ValidationError('Invalid policy id');
    }
  }

  private scopeMatches(policy: AgentPolicy, input: PolicyEvaluationRequest): boolean {
    const { agents = [], projects = [], actionTypes = [] } = policy.scope;

    if (agents.length > 0 && (!input.agent || !agents.includes(input.agent))) {
      return false;
    }

    if (projects.length > 0 && (!input.project || !projects.includes(input.project))) {
      return false;
    }

    if (actionTypes.length > 0 && !actionTypes.includes(input.actionType)) {
      return false;
    }

    return true;
  }

  private async evaluatePolicy(
    policy: AgentPolicy,
    input: PolicyEvaluationRequest
  ): Promise<PolicyEvaluationMatch | null> {
    switch (policy.type) {
      case 'risk-threshold': {
        if (typeof input.riskScore !== 'number') {
          return null;
        }

        const { threshold, comparator = 'gte' } = policy.config;
        const triggered = this.compareRisk(input.riskScore, threshold, comparator);
        if (!triggered) return null;

        return {
          policyId: policy.id,
          policyName: policy.name,
          policyType: policy.type,
          responseAction: policy.responseAction,
          message: `${policy.name} matched risk score ${input.riskScore} against threshold ${threshold}.`,
          details: {
            threshold,
            comparator,
            riskScore: input.riskScore,
          },
        };
      }

      case 'require-approval':
        return {
          policyId: policy.id,
          policyName: policy.name,
          policyType: policy.type,
          responseAction: policy.responseAction,
          message: policy.config.reason || `${policy.name} requires approval before continuing.`,
          details: {
            approvers: policy.config.approvers ?? [],
          },
        };

      case 'block-action-type':
        if (!policy.config.actionTypes.includes(input.actionType)) {
          return null;
        }

        return {
          policyId: policy.id,
          policyName: policy.name,
          policyType: policy.type,
          responseAction: policy.responseAction,
          message: `${policy.name} matched blocked action type "${input.actionType}".`,
          details: {
            actionType: input.actionType,
          },
        };

      case 'rate-limit': {
        const key = this.getRateLimitKey(policy, input);
        const now = Date.now();
        const windowStart = now - policy.config.windowMs;
        const history = (this.rateLimitState.get(key) ?? []).filter(
          (timestamp) => timestamp >= windowStart
        );
        const triggered = history.length >= policy.config.maxAttempts;

        if (!input.preview) {
          history.push(now);
          this.rateLimitState.set(key, history);
        }

        if (!triggered) {
          return null;
        }

        return {
          policyId: policy.id,
          policyName: policy.name,
          policyType: policy.type,
          responseAction: policy.responseAction,
          message: `${policy.name} exceeded ${policy.config.maxAttempts} action(s) in ${policy.config.windowMs}ms.`,
          details: {
            maxAttempts: policy.config.maxAttempts,
            windowMs: policy.config.windowMs,
            key,
            recentCount: history.length,
          },
        };
      }

      case 'webhook-check': {
        const webhookResult = await this.runWebhookCheck(policy, input);
        if (!webhookResult.triggered) {
          return null;
        }

        return {
          policyId: policy.id,
          policyName: policy.name,
          policyType: policy.type,
          responseAction: policy.responseAction,
          message: webhookResult.message,
          details: webhookResult.details,
        };
      }
    }
  }

  private compareRisk(
    score: number,
    threshold: number,
    comparator: 'gte' | 'gt' | 'lte' | 'lt'
  ): boolean {
    switch (comparator) {
      case 'gt':
        return score > threshold;
      case 'lte':
        return score <= threshold;
      case 'lt':
        return score < threshold;
      case 'gte':
      default:
        return score >= threshold;
    }
  }

  private getRateLimitKey(
    policy: Extract<AgentPolicy, { type: 'rate-limit' }>,
    input: PolicyEvaluationRequest
  ): string {
    const scopeKey = policy.config.scopeKey ?? 'global';
    let scopeValue = 'global';

    if (scopeKey === 'agent') {
      scopeValue = input.agent || 'unknown-agent';
    } else if (scopeKey === 'project') {
      scopeValue = input.project || 'unknown-project';
    } else if (scopeKey === 'action-type') {
      scopeValue = input.actionType;
    }

    return `${policy.id}:${scopeKey}:${scopeValue}`;
  }

  private async runWebhookCheck(
    policy: Extract<AgentPolicy, { type: 'webhook-check' }>,
    input: PolicyEvaluationRequest
  ): Promise<{ triggered: boolean; message: string; details: Record<string, unknown> }> {
    const body = policy.config.sendContext === false ? undefined : JSON.stringify(input);

    try {
      const delivery = await getOutboundIntegrationService().deliver(
        {
          id: `policy.${policy.id}`,
          type: 'policy-webhook',
          displayName: `${policy.name} webhook check`,
          url: policy.config.url,
          enabled: policy.enabled,
          owner: { source: 'policy', resourceId: policy.id },
        },
        {
          method: policy.config.method ?? 'POST',
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          body,
          timeoutMs: policy.config.timeoutMs ?? 5_000,
          responseBodyLimit: 200,
        }
      );

      if (delivery.status === 'blocked') {
        throw new Error('Webhook URL blocked by outbound URL policy');
      }
      if (delivery.status === 'timeout') {
        throw new Error('Webhook check timed out');
      }
      if (!delivery.responseStatus) {
        throw new Error(delivery.error || 'Webhook delivery failed');
      }

      const text = delivery.responseText || '';
      const statusMatches = delivery.responseStatus === (policy.config.expectedStatus ?? 200);
      const bodyMatches = policy.config.expectedBodyContains
        ? text.includes(policy.config.expectedBodyContains)
        : true;
      const success = statusMatches && bodyMatches;
      const triggerOn = policy.config.triggerOn ?? 'failure';
      const triggered = triggerOn === 'success' ? success : !success;

      return {
        triggered,
        message: triggered
          ? `${policy.name} webhook ${triggerOn === 'success' ? 'succeeded' : 'failed'} with status ${delivery.responseStatus}.`
          : '',
        details: {
          status: delivery.responseStatus,
          expectedStatus: policy.config.expectedStatus ?? 200,
          bodySnippet: text.slice(0, 200),
          deliveryAttemptId: delivery.attemptId,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown webhook failure';
      const triggered = (policy.config.triggerOn ?? 'failure') === 'failure';
      return {
        triggered,
        message: triggered ? `${policy.name} webhook check failed: ${message}.` : '',
        details: {
          error: message,
        },
      };
    }
  }

  private toDecision(action: PolicyResponseAction): PolicyEvaluationResult['decision'] {
    if (action === 'block') return 'block';
    if (action === 'require-approval') return 'require-approval';
    if (action === 'warn') return 'warn';
    return 'allow';
  }

  private traceOutcomeForDecision(
    decision: PolicyEvaluationResult['decision']
  ): CreateGovernanceTraceInput['outcome'] {
    if (decision === 'block') return 'blocked';
    if (decision === 'require-approval') return 'approval-required';
    if (decision === 'warn') return 'warned';
    return 'allowed';
  }

  private policyTraceSummary(result: PolicyEvaluationResult): string {
    if (result.decision === 'allow') return 'No enabled policy blocked or warned on this action.';
    if (result.decision === 'warn') return result.warnings.join(' ') || 'Policy warning matched.';
    if (result.decision === 'require-approval') {
      return `Approval is required by ${result.approvalRequiredBy.join(', ')}.`;
    }
    return `Action is blocked by ${result.blockedBy.join(', ')}.`;
  }

  private policyTraceRemediation(result: PolicyEvaluationResult): string | undefined {
    if (result.decision === 'allow') return undefined;
    if (result.decision === 'warn') {
      return 'Review the matched warning before continuing or adjust the policy scope.';
    }
    if (result.decision === 'require-approval') {
      return 'Request approval from an authorized reviewer or change the matched policy.';
    }
    return 'Change the action, lower the risk, or update the matched blocking policy.';
  }

  dispose(): void {
    if (this.ownsSqliteDatabase) {
      this.sqliteDatabase?.close();
    }
  }
}

export interface PolicyServiceOptions {
  policiesDir?: string;
  storageType?: 'file' | 'sqlite';
  sqliteDatabase?: SqliteDatabase;
  sqliteConnectionOptions?: SqliteConnectionOptions;
}

let policyService: PolicyService | null = null;

export function getPolicyService(): PolicyService {
  if (!policyService) {
    policyService = new PolicyService();
  }
  return policyService;
}
