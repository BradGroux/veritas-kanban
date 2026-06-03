import yaml from 'yaml';
import {
  buildWorkflowPipelineSummary,
  type WorkflowPipelineSummary,
  type WorkflowSkillAuditSummary,
} from '@veritas-kanban/shared';
import type {
  ToolPolicy,
  WorkflowDefinition,
  WorkflowOutputTarget,
  WorkflowOutputTargetType,
  WorkflowSchedule,
  WorkflowStep,
} from '../types/workflow.js';
import { getToolPolicyService, type ToolPolicyService } from './tool-policy-service.js';
import { getSkillSecurityService, type SkillSecurityService } from './skill-security-service.js';

export type WorkflowRecipeInputType = 'text' | 'textarea' | 'select' | 'boolean';
export type WorkflowLintSeverity = 'error' | 'warning' | 'info';
export type WorkflowLintCategory =
  | 'definition'
  | 'input'
  | 'context'
  | 'permission'
  | 'policy'
  | 'secret'
  | 'skill'
  | 'pipeline'
  | 'client'
  | 'output'
  | 'schedule';

export interface WorkflowRecipeInput {
  id: string;
  label: string;
  type: WorkflowRecipeInputType;
  required: boolean;
  defaultValue?: string | boolean;
  placeholder?: string;
  helpText?: string;
  options?: Array<{ value: string; label: string }>;
}

export interface WorkflowRecipe {
  id: string;
  name: string;
  description: string;
  tags: string[];
  inputs: WorkflowRecipeInput[];
  defaultOutputTargets: WorkflowOutputTarget[];
  schedule?: WorkflowSchedule;
}

interface WorkflowRecipeDefinition extends WorkflowRecipe {
  build: (inputs: WorkflowRecipeInputValues) => WorkflowDefinition;
}

export interface WorkflowRecipeInputValues {
  [key: string]: unknown;
}

export interface WorkflowRecipeMaterialization {
  recipe: WorkflowRecipe;
  workflow: WorkflowDefinition;
  yaml: string;
  missingInputs: string[];
  lint: WorkflowLintResult;
  preview: {
    steps: Array<{ id: string; name: string; type: WorkflowStep['type']; agent?: string }>;
    pipeline?: WorkflowPipelineSummary;
    outputTargets: WorkflowOutputTarget[];
    schedule?: WorkflowSchedule;
  };
}

export interface WorkflowDryRunContext {
  taskId?: string;
  clientMode?: 'local' | 'remote' | 'cloud';
  permissions?: string[];
  availableSecrets?: string[];
  now?: string;
}

export interface WorkflowLintMessage {
  id: string;
  severity: WorkflowLintSeverity;
  category: WorkflowLintCategory;
  path: string;
  message: string;
  remediation: string;
}

export interface WorkflowLintResult {
  ok: boolean;
  yaml?: string;
  messages: WorkflowLintMessage[];
  pipelineSummary?: WorkflowPipelineSummary;
  summary: {
    errors: number;
    warnings: number;
    info: number;
  };
}

export interface WorkflowDryRunCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

export interface WorkflowDryRunResult extends WorkflowLintResult {
  status: 'ready' | 'attention' | 'blocked';
  canRun: boolean;
  checks: WorkflowDryRunCheck[];
  skillAudit?: WorkflowSkillAuditSummary;
  pipelineSummary?: WorkflowPipelineSummary;
  workflow?: WorkflowDefinition;
}

export interface WorkflowAuthoringInput {
  workflow?: WorkflowDefinition;
  yaml?: string;
  context?: WorkflowDryRunContext;
}

const OUTPUT_TARGET_TYPES: WorkflowOutputTargetType[] = [
  'task-update',
  'work-product',
  'completion-packet',
  'notification',
  'dashboard-queue-item',
  'scheduled-snapshot',
];

const STEP_TYPES: WorkflowStep['type'][] = ['agent', 'loop', 'gate', 'parallel'];
const SCHEDULED_MODES = new Set(['daily', 'weekly', 'biweekly', 'monthly', 'custom']);

const SECRET_PATTERNS = [
  /\{\{\s*secrets\.([A-Z][A-Z0-9_]*)\s*\}\}/g,
  /\$\{\{\s*secrets\.([A-Z][A-Z0-9_]*)\s*\}\}/g,
  /\bprocess\.env\.([A-Z][A-Z0-9_]*)\b/g,
  /\benv\.([A-Z][A-Z0-9_]*)\b/g,
];

function publicRecipe(recipe: WorkflowRecipeDefinition): WorkflowRecipe {
  const { build: _build, ...rest } = recipe;
  return rest;
}

function inputString(inputs: WorkflowRecipeInputValues, key: string, fallback = ''): string {
  const value = inputs[key];
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function inputBoolean(inputs: WorkflowRecipeInputValues, key: string, fallback = false): boolean {
  const value = inputs[key];
  return typeof value === 'boolean' ? value : fallback;
}

function workflowId(value: string, fallback: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
  return slug || fallback;
}

function workflowName(inputs: WorkflowRecipeInputValues, fallback: string): string {
  return inputString(inputs, 'workflowName', fallback) || fallback;
}

function targetPath(inputs: WorkflowRecipeInputValues, fallback: string): string {
  return inputString(inputs, 'outputPath', fallback) || fallback;
}

function manualSchedule(): WorkflowSchedule {
  return { mode: 'manual', enabled: false };
}

function outputTarget(
  type: WorkflowOutputTargetType,
  label: string,
  extra = {}
): WorkflowOutputTarget {
  return { type, label, ...extra };
}

function stepPreview(step: WorkflowStep) {
  return {
    id: step.id,
    name: step.name,
    type: step.type,
    agent: step.agent,
  };
}

function message(
  severity: WorkflowLintSeverity,
  category: WorkflowLintCategory,
  path: string,
  text: string,
  remediation: string
): WorkflowLintMessage {
  return {
    id: `${category}:${path}:${text}`
      .toLowerCase()
      .replace(/[^a-z0-9:.-]+/g, '-')
      .slice(0, 140),
    severity,
    category,
    path,
    message: text,
    remediation,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOutputTargetType(value: unknown): value is WorkflowOutputTargetType {
  return (
    typeof value === 'string' && OUTPUT_TARGET_TYPES.includes(value as WorkflowOutputTargetType)
  );
}

function hasPermission(permissions: string[] | undefined, permission: string): boolean {
  if (!permissions) return true;
  return permissions.includes('*') || permissions.includes(permission);
}

function toArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function duplicateValues(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function collectText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(collectText).join('\n');
  if (!isRecord(value)) return '';
  return Object.values(value).map(collectText).join('\n');
}

function referencedSecrets(workflow: WorkflowDefinition): string[] {
  const content = collectText(workflow);
  const secrets = new Set<string>();
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content))) {
      secrets.add(match[1]);
    }
  }
  return [...secrets].sort();
}

function parseDate(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

const RECIPES: WorkflowRecipeDefinition[] = [
  {
    id: 'task-implementation',
    name: 'Task Implementation',
    description: 'Plan, implement, review, and package a task with inspectable work products.',
    tags: ['task', 'implementation', 'review'],
    inputs: [
      {
        id: 'workflowName',
        label: 'Workflow name',
        type: 'text',
        required: true,
        defaultValue: 'Task Implementation Workflow',
      },
      {
        id: 'taskId',
        label: 'Task ID',
        type: 'text',
        required: false,
        placeholder: 'task_123',
        helpText: 'Optional now; required before running against a task-update output.',
      },
      {
        id: 'outputPath',
        label: 'Work product path',
        type: 'text',
        required: true,
        defaultValue: 'work-products/implementation-summary.md',
      },
    ],
    defaultOutputTargets: [
      outputTarget('task-update', 'Task update', { required: true, taskField: 'notes' }),
      outputTarget('work-product', 'Implementation summary', {
        required: true,
        path: 'work-products/implementation-summary.md',
      }),
      outputTarget('completion-packet', 'Completion packet'),
    ],
    schedule: manualSchedule(),
    build: (inputs) => {
      const name = workflowName(inputs, 'Task Implementation Workflow');
      return {
        id: workflowId(inputString(inputs, 'workflowId', name), 'task-implementation'),
        name,
        version: 1,
        description: 'Plan, implement, review, and package a task into stable outputs.',
        schedule: manualSchedule(),
        variables: {
          taskId: inputString(inputs, 'taskId'),
          recipe: 'task-implementation',
        },
        outputTargets: [
          outputTarget('task-update', 'Task update', { required: true, taskField: 'notes' }),
          outputTarget('work-product', 'Implementation summary', {
            required: true,
            path: targetPath(inputs, 'work-products/implementation-summary.md'),
          }),
          outputTarget('completion-packet', 'Completion packet'),
        ],
        agents: [
          {
            id: 'planner',
            name: 'Planner',
            role: 'planner',
            description: 'Reads the task and turns it into an implementation plan.',
            tools: ['Read', 'web_search'],
          },
          {
            id: 'developer',
            name: 'Developer',
            role: 'developer',
            description: 'Makes the scoped implementation changes and records proof.',
            tools: ['Read', 'Edit', 'exec'],
          },
          {
            id: 'reviewer',
            name: 'Reviewer',
            role: 'reviewer',
            description: 'Checks the diff, risks, and verification before completion.',
            tools: ['Read', 'exec'],
          },
        ],
        steps: [
          {
            id: 'plan',
            name: 'Plan implementation',
            type: 'agent',
            agent: 'planner',
            input: 'Inspect task {{ task.id }} and produce a scoped implementation plan.',
            output: { file: 'plan.md' },
          },
          {
            id: 'implement',
            name: 'Implement changes',
            type: 'agent',
            agent: 'developer',
            input: 'Use the plan and task context to implement the requested change.',
            output: { file: 'implementation-summary.md' },
          },
          {
            id: 'review',
            name: 'Review and package',
            type: 'agent',
            agent: 'reviewer',
            input: 'Review the implementation, verification output, and completion packet.',
            output: { file: 'completion-packet.md' },
          },
        ],
      };
    },
  },
  {
    id: 'openclaw-audit',
    name: '.openclaw Audit',
    description:
      'Delegate an OpenClaw configuration audit across scoped subagents and reconcile the findings.',
    tags: ['openclaw', 'audit', 'orchestrator', 'subagents'],
    inputs: [
      {
        id: 'workflowName',
        label: 'Workflow name',
        type: 'text',
        required: true,
        defaultValue: '.openclaw Audit Workflow',
      },
      {
        id: 'scope',
        label: 'Audit scope',
        type: 'textarea',
        required: true,
        defaultValue:
          '.openclaw config, gateway routing, storage retention, session cache, docs, and task follow-ups',
      },
      {
        id: 'outputPath',
        label: 'Audit report path',
        type: 'text',
        required: true,
        defaultValue: 'work-products/openclaw-audit.md',
      },
    ],
    defaultOutputTargets: [
      outputTarget('dashboard-queue-item', 'OpenClaw audit queue item', { required: true }),
      outputTarget('work-product', 'OpenClaw audit report', {
        required: true,
        path: 'work-products/openclaw-audit.md',
      }),
      outputTarget('completion-packet', 'Completion packet'),
    ],
    schedule: manualSchedule(),
    build: (inputs) => {
      const name = workflowName(inputs, '.openclaw Audit Workflow');
      const scope = inputString(
        inputs,
        'scope',
        '.openclaw config, gateway routing, storage retention, session cache, docs, and task follow-ups'
      );
      return {
        id: workflowId(inputString(inputs, 'workflowId', name), 'openclaw-audit'),
        name,
        version: 1,
        description:
          'Fan out an OpenClaw audit to scoped subagents, reconcile evidence, and create follow-up tasks.',
        pipeline: {
          mode: 'orchestrated',
          parentAgent: 'orchestrator',
          completion: 'all-required',
          handoff:
            'Subagents return findings, evidence, task suggestions, and blockers to the orchestrator for reconciliation.',
          roles: [
            {
              id: 'config-auditor',
              label: 'Config Auditor',
              agent: 'config-auditor',
              scope: '.openclaw config, gateway, and channel routing settings.',
              taskBrief:
                'Inspect documented config paths and report drift, missing keys, or unsafe defaults.',
              deliverable: 'Config findings with source file references and remediation notes.',
              verification: [
                'Config keys are source-backed.',
                'No secret values are copied into findings.',
              ],
              telemetry: { timeBudgetMinutes: 20, tokenBudget: 12000 },
            },
            {
              id: 'storage-auditor',
              label: 'Storage Auditor',
              agent: 'storage-auditor',
              scope: 'Persistence, retention, cache, and backup behavior.',
              taskBrief: 'Review storage lifecycle, cache cleanup, and backup portability notes.',
              deliverable: 'Storage risk table with retained, cleanup, and blocked states.',
              verification: [
                'Retention claims cite code or docs.',
                'Data deletion is not performed.',
              ],
              telemetry: { timeBudgetMinutes: 20, tokenBudget: 10000 },
            },
            {
              id: 'security-auditor',
              label: 'Security Auditor',
              agent: 'security-auditor',
              scope: 'Auth, permissions, tokens, logs, and remote gateway exposure.',
              taskBrief:
                'Find security regressions and secret leakage risks in the OpenClaw surface.',
              deliverable: 'Security blockers first, followed by warnings and mitigations.',
              verification: [
                'Secrets are redacted.',
                'Findings include affected route, config, or log surface.',
              ],
              telemetry: { timeBudgetMinutes: 25, tokenBudget: 14000 },
            },
            {
              id: 'docs-auditor',
              label: 'Docs Auditor',
              agent: 'docs-auditor',
              scope: 'README, SOP, config reference, and troubleshooting docs.',
              taskBrief:
                'Compare docs against the inspected runtime and list stale or missing guidance.',
              deliverable: 'Docs freshness findings and suggested patch targets.',
              verification: [
                'Each docs issue names a source doc.',
                'No external vendor references are invented.',
              ],
              telemetry: { timeBudgetMinutes: 15, tokenBudget: 8000 },
            },
            {
              id: 'task-creator',
              label: 'Follow-up Task Creator',
              agent: 'task-creator',
              scope: 'Confirmed audit findings only.',
              taskBrief:
                'Turn confirmed blockers and high-confidence warnings into actionable Veritas tasks.',
              deliverable:
                'Candidate task list with title, owner surface, priority, and acceptance criteria.',
              verification: [
                'Every task traces to a finding.',
                'Duplicate tasks are called out instead of recreated.',
              ],
              dependsOn: ['config-auditor', 'storage-auditor', 'security-auditor', 'docs-auditor'],
              telemetry: { timeBudgetMinutes: 15, tokenBudget: 8000 },
            },
          ],
        },
        schedule: manualSchedule(),
        variables: {
          scope,
          recipe: 'openclaw-audit',
        },
        outputTargets: [
          outputTarget('dashboard-queue-item', 'OpenClaw audit queue item', { required: true }),
          outputTarget('work-product', 'OpenClaw audit report', {
            required: true,
            path: targetPath(inputs, 'work-products/openclaw-audit.md'),
          }),
          outputTarget('completion-packet', 'Completion packet'),
        ],
        agents: [
          {
            id: 'orchestrator',
            name: 'Orchestrator',
            role: 'planner',
            description: 'Owns scope, delegation, synthesis, and final handoff.',
            tools: ['Read', 'web_search'],
          },
          {
            id: 'config-auditor',
            name: 'Config Auditor',
            role: 'reviewer',
            description: 'Reviews OpenClaw config and gateway routing.',
            tools: ['Read', 'exec', 'web_search'],
          },
          {
            id: 'storage-auditor',
            name: 'Storage Auditor',
            role: 'reviewer',
            description: 'Reviews storage lifecycle, cache, and backup behavior.',
            tools: ['Read', 'exec', 'web_search'],
          },
          {
            id: 'security-auditor',
            name: 'Security Auditor',
            role: 'reviewer',
            description: 'Reviews auth, permissions, remote exposure, and redaction risks.',
            tools: ['Read', 'exec', 'web_search'],
          },
          {
            id: 'docs-auditor',
            name: 'Docs Auditor',
            role: 'reviewer',
            description: 'Checks docs freshness against runtime behavior.',
            tools: ['Read', 'web_search'],
          },
          {
            id: 'task-creator',
            name: 'Task Creator',
            role: 'planner',
            description: 'Creates issue-ready follow-up task candidates.',
            tools: ['Read', 'web_search'],
          },
        ],
        steps: [
          {
            id: 'brief',
            name: 'Prepare delegation brief',
            type: 'agent',
            agent: 'orchestrator',
            input: 'Prepare scoped audit briefs for {{ workflow.variables.scope }}.',
            output: { file: 'openclaw-audit-brief.md' },
          },
          {
            id: 'delegated-audit',
            name: 'Run delegated audit',
            type: 'parallel',
            parallel: {
              completion: 'all',
              fail_fast: false,
              timeout: 1800,
              steps: [
                {
                  id: 'config-audit',
                  agent: 'config-auditor',
                  input:
                    'Use the audit brief to inspect OpenClaw config and gateway routing. Return findings, evidence, verification, and blockers.',
                },
                {
                  id: 'storage-audit',
                  agent: 'storage-auditor',
                  input:
                    'Use the audit brief to inspect storage retention, caches, backups, and cleanup behavior. Return findings, evidence, verification, and blockers.',
                },
                {
                  id: 'security-audit',
                  agent: 'security-auditor',
                  input:
                    'Use the audit brief to inspect auth, permissions, remote exposure, and redaction risks. Return blockers first.',
                },
                {
                  id: 'docs-audit',
                  agent: 'docs-auditor',
                  input:
                    'Use the audit brief to inspect docs freshness and troubleshooting coverage. Return stale, missing, or risky guidance.',
                },
              ],
            },
            output: { file: 'delegated-audit-results.json' },
            acceptance_criteria: ['completed'],
          },
          {
            id: 'follow-up-tasks',
            name: 'Prepare follow-up tasks',
            type: 'agent',
            agent: 'task-creator',
            input:
              'Read delegated audit results and produce issue-ready tasks only for confirmed findings.',
            output: { file: 'openclaw-follow-up-tasks.md' },
          },
          {
            id: 'reconcile',
            name: 'Reconcile completion packet',
            type: 'agent',
            agent: 'orchestrator',
            input:
              'Reconcile subagent findings, evidence, follow-up tasks, verification, and blockers into the final audit report and completion packet.',
            output: { file: 'openclaw-audit.md' },
          },
        ],
      };
    },
  },
  {
    id: 'review-and-qa',
    name: 'Review and QA',
    description: 'Run review and QA agents against a task or work product before completion.',
    tags: ['review', 'qa', 'verification'],
    inputs: [
      {
        id: 'workflowName',
        label: 'Workflow name',
        type: 'text',
        required: true,
        defaultValue: 'Review and QA Workflow',
      },
      {
        id: 'outputPath',
        label: 'QA report path',
        type: 'text',
        required: true,
        defaultValue: 'work-products/qa-report.md',
      },
    ],
    defaultOutputTargets: [
      outputTarget('work-product', 'QA report', {
        required: true,
        path: 'work-products/qa-report.md',
      }),
      outputTarget('completion-packet', 'Completion packet'),
    ],
    schedule: manualSchedule(),
    build: (inputs) => {
      const name = workflowName(inputs, 'Review and QA Workflow');
      return {
        id: workflowId(inputString(inputs, 'workflowId', name), 'review-and-qa'),
        name,
        version: 1,
        description: 'Review a change, execute QA checks, and produce an inspectable report.',
        schedule: manualSchedule(),
        outputTargets: [
          outputTarget('work-product', 'QA report', {
            required: true,
            path: targetPath(inputs, 'work-products/qa-report.md'),
          }),
          outputTarget('completion-packet', 'Completion packet'),
        ],
        agents: [
          {
            id: 'reviewer',
            name: 'Reviewer',
            role: 'reviewer',
            description: 'Inspects code and risk.',
            tools: ['Read', 'exec'],
          },
          {
            id: 'tester',
            name: 'Tester',
            role: 'tester',
            description: 'Runs targeted checks and records proof.',
            tools: ['Read', 'exec', 'browser'],
          },
        ],
        steps: [
          {
            id: 'review',
            name: 'Review diff and risk',
            type: 'agent',
            agent: 'reviewer',
            input: 'Review the available change context and list blockers first.',
            output: { file: 'review-findings.md' },
          },
          {
            id: 'qa',
            name: 'Run QA checks',
            type: 'agent',
            agent: 'tester',
            input: 'Run focused QA checks for the reviewed change and summarize proof.',
            output: { file: 'qa-report.md' },
          },
        ],
      };
    },
  },
  {
    id: 'weekly-snapshot',
    name: 'Weekly Snapshot',
    description:
      'Create a scheduled weekly snapshot with stable dashboard and work-product output.',
    tags: ['scheduled', 'snapshot', 'report'],
    inputs: [
      {
        id: 'workflowName',
        label: 'Workflow name',
        type: 'text',
        required: true,
        defaultValue: 'Weekly Snapshot Workflow',
      },
      {
        id: 'timezone',
        label: 'Timezone',
        type: 'text',
        required: true,
        defaultValue: 'America/Chicago',
      },
      {
        id: 'cronExpr',
        label: 'Cron expression',
        type: 'text',
        required: true,
        defaultValue: '0 9 * * 1',
      },
      {
        id: 'notify',
        label: 'Notify after snapshot',
        type: 'boolean',
        required: false,
        defaultValue: true,
      },
    ],
    defaultOutputTargets: [
      outputTarget('scheduled-snapshot', 'Stable weekly snapshot', {
        required: true,
        retentionDays: 90,
      }),
      outputTarget('work-product', 'Weekly report', {
        required: true,
        path: 'work-products/weekly-snapshot.md',
      }),
      outputTarget('notification', 'Snapshot notification', { channel: 'dashboard' }),
    ],
    schedule: {
      mode: 'weekly',
      enabled: true,
      cronExpr: '0 9 * * 1',
      timezone: 'America/Chicago',
      snapshotRetention: 90,
    },
    build: (inputs) => {
      const name = workflowName(inputs, 'Weekly Snapshot Workflow');
      const notify = inputBoolean(inputs, 'notify', true);
      const outputTargets: WorkflowOutputTarget[] = [
        outputTarget('scheduled-snapshot', 'Stable weekly snapshot', {
          required: true,
          retentionDays: 90,
        }),
        outputTarget('work-product', 'Weekly report', {
          required: true,
          path: targetPath(inputs, 'work-products/weekly-snapshot.md'),
        }),
      ];
      if (notify) {
        outputTargets.push(
          outputTarget('notification', 'Snapshot notification', { channel: 'dashboard' })
        );
      }
      return {
        id: workflowId(inputString(inputs, 'workflowId', name), 'weekly-snapshot'),
        name,
        version: 1,
        description: 'Collect weekly board state and write stable snapshot outputs.',
        schedule: {
          mode: 'weekly',
          enabled: true,
          cronExpr: inputString(inputs, 'cronExpr', '0 9 * * 1'),
          timezone: inputString(inputs, 'timezone', 'America/Chicago'),
          snapshotRetention: 90,
        },
        outputTargets,
        agents: [
          {
            id: 'writer',
            name: 'Snapshot Writer',
            role: 'content-writer',
            description: 'Produces concise weekly status and stable work products.',
            tools: ['Read', 'Write'],
          },
        ],
        steps: [
          {
            id: 'collect',
            name: 'Collect state',
            type: 'agent',
            agent: 'writer',
            input: 'Collect weekly task, workflow, notification, and risk state.',
            output: { file: 'weekly-snapshot-source.md' },
          },
          {
            id: 'publish',
            name: 'Publish snapshot',
            type: 'agent',
            agent: 'writer',
            input: 'Write the stable weekly snapshot and summary work product.',
            output: { file: 'weekly-snapshot.md' },
          },
        ],
      };
    },
  },
  {
    id: 'policy-audit',
    name: 'Policy Audit',
    description: 'Inspect workflow policy gates, tool access, and drift before risky execution.',
    tags: ['policy', 'audit', 'risk'],
    inputs: [
      {
        id: 'workflowName',
        label: 'Workflow name',
        type: 'text',
        required: true,
        defaultValue: 'Policy Audit Workflow',
      },
      {
        id: 'scope',
        label: 'Audit scope',
        type: 'textarea',
        required: true,
        defaultValue: 'Workflow policies, tools, schedules, and output targets',
      },
    ],
    defaultOutputTargets: [
      outputTarget('dashboard-queue-item', 'Dashboard queue item', { required: true }),
      outputTarget('work-product', 'Policy audit report', {
        required: true,
        path: 'work-products/policy-audit.md',
      }),
    ],
    schedule: manualSchedule(),
    build: (inputs) => {
      const name = workflowName(inputs, 'Policy Audit Workflow');
      return {
        id: workflowId(inputString(inputs, 'workflowId', name), 'policy-audit'),
        name,
        version: 1,
        description: 'Audit workflow policy gates, tools, schedules, and outputs before execution.',
        schedule: manualSchedule(),
        variables: {
          scope: inputString(
            inputs,
            'scope',
            'Workflow policies, tools, schedules, and output targets'
          ),
        },
        outputTargets: [
          outputTarget('dashboard-queue-item', 'Dashboard queue item', { required: true }),
          outputTarget('work-product', 'Policy audit report', {
            required: true,
            path: targetPath(inputs, 'work-products/policy-audit.md'),
          }),
        ],
        agents: [
          {
            id: 'auditor',
            name: 'Auditor',
            role: 'reviewer',
            description: 'Runs read-only policy and configuration checks.',
            tools: ['Read', 'exec'],
          },
        ],
        steps: [
          {
            id: 'audit',
            name: 'Audit policies',
            type: 'agent',
            agent: 'auditor',
            input: 'Audit {{ workflow.variables.scope }} and return blockers first.',
            output: { file: 'policy-audit.md' },
          },
        ],
      };
    },
  },
];

export class WorkflowAuthoringService {
  constructor(
    private readonly toolPolicyService: ToolPolicyService = getToolPolicyService(),
    private readonly skillSecurityService: SkillSecurityService = getSkillSecurityService()
  ) {}

  listRecipes(): WorkflowRecipe[] {
    return RECIPES.map(publicRecipe);
  }

  getRecipe(id: string): WorkflowRecipe | null {
    const recipe = RECIPES.find((candidate) => candidate.id === id);
    return recipe ? publicRecipe(recipe) : null;
  }

  async materializeRecipe(
    id: string,
    inputs: WorkflowRecipeInputValues = {},
    context: WorkflowDryRunContext = {}
  ): Promise<WorkflowRecipeMaterialization | null> {
    const recipe = RECIPES.find((candidate) => candidate.id === id);
    if (!recipe) return null;

    const mergedInputs: WorkflowRecipeInputValues = {};
    for (const input of recipe.inputs) {
      mergedInputs[input.id] = inputs[input.id] ?? input.defaultValue ?? '';
    }
    mergedInputs.workflowId =
      inputString(inputs, 'workflowId') ||
      workflowId(inputString(mergedInputs, 'workflowName'), recipe.id);

    const missingInputs = recipe.inputs
      .filter((input) => input.required && !inputString(mergedInputs, input.id))
      .map((input) => input.id);

    const workflow = recipe.build(mergedInputs);
    const lint = await this.lintWorkflow(workflow, {
      ...context,
      taskId: context.taskId || inputString(mergedInputs, 'taskId') || undefined,
    });

    return {
      recipe: publicRecipe(recipe),
      workflow,
      yaml: this.toYaml(workflow),
      missingInputs,
      lint,
      preview: {
        steps: workflow.steps.map(stepPreview),
        pipeline: lint.pipelineSummary,
        outputTargets: workflow.outputTargets ?? [],
        schedule: workflow.schedule,
      },
    };
  }

  async lint(input: WorkflowAuthoringInput): Promise<WorkflowLintResult> {
    const parsed = this.parseWorkflowInput(input);
    if (!parsed.workflow) {
      return this.resultFromMessages([
        message(
          'error',
          'definition',
          'yaml',
          parsed.error ?? 'Workflow definition is required',
          'Provide a workflow definition or valid YAML.'
        ),
      ]);
    }
    return this.lintWorkflow(parsed.workflow, input.context ?? {});
  }

  async dryRun(input: WorkflowAuthoringInput): Promise<WorkflowDryRunResult> {
    const parsed = this.parseWorkflowInput(input);
    if (!parsed.workflow) {
      const lint = this.resultFromMessages([
        message(
          'error',
          'definition',
          'yaml',
          parsed.error ?? 'Workflow definition is required',
          'Provide a workflow definition or valid YAML.'
        ),
      ]);
      return {
        ...lint,
        status: 'blocked',
        canRun: false,
        checks: this.buildChecks(lint.messages),
      };
    }

    const lint = await this.lintWorkflow(parsed.workflow, input.context ?? {});
    const status =
      lint.summary.errors > 0 ? 'blocked' : lint.summary.warnings > 0 ? 'attention' : 'ready';
    return {
      ...lint,
      status,
      canRun: lint.summary.errors === 0,
      checks: this.buildChecks(lint.messages),
      skillAudit: lint.skillAudit,
      pipelineSummary: lint.pipelineSummary,
      workflow: parsed.workflow,
    };
  }

  toYaml(workflow: WorkflowDefinition): string {
    return yaml.stringify(workflow);
  }

  parseWorkflowYaml(content: string): WorkflowDefinition {
    return yaml.parse(content) as WorkflowDefinition;
  }

  private async lintWorkflow(
    workflow: WorkflowDefinition,
    context: WorkflowDryRunContext
  ): Promise<
    WorkflowLintResult & {
      skillAudit?: WorkflowSkillAuditSummary;
      pipelineSummary?: WorkflowPipelineSummary;
    }
  > {
    const messages: WorkflowLintMessage[] = [];

    this.lintDefinition(workflow, messages);
    const pipelineSummary = this.lintPipeline(workflow, messages);
    await this.lintToolPolicies(workflow, messages);
    const skillAudit = await this.lintSkillAudit(workflow, context, messages);
    this.lintSecrets(workflow, context, messages);
    this.lintClientMode(workflow, context, messages);
    this.lintOutputTargets(workflow, context, messages);
    this.lintSchedule(workflow, messages);
    this.lintPermissions(context, messages);

    return {
      ...this.resultFromMessages(messages),
      yaml: this.toYaml(workflow),
      skillAudit,
      pipelineSummary,
    };
  }

  private parseWorkflowInput(input: WorkflowAuthoringInput): {
    workflow?: WorkflowDefinition;
    error?: string;
  } {
    if (input.yaml && input.yaml.trim()) {
      try {
        const parsed = this.parseWorkflowYaml(input.yaml);
        if (!isRecord(parsed)) {
          return { error: 'YAML must parse to a workflow object' };
        }
        return { workflow: parsed };
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Invalid YAML' };
      }
    }
    if (input.workflow && isRecord(input.workflow)) {
      return { workflow: input.workflow };
    }
    return { error: 'Workflow definition is required' };
  }

  private resultFromMessages(messages: WorkflowLintMessage[]): WorkflowLintResult {
    const summary = {
      errors: messages.filter((item) => item.severity === 'error').length,
      warnings: messages.filter((item) => item.severity === 'warning').length,
      info: messages.filter((item) => item.severity === 'info').length,
    };
    return {
      ok: summary.errors === 0,
      messages,
      summary,
    };
  }

  private lintDefinition(workflow: WorkflowDefinition, messages: WorkflowLintMessage[]): void {
    if (!workflow.id) {
      messages.push(
        message(
          'error',
          'definition',
          'id',
          'Workflow ID is required.',
          'Add a stable workflow id before saving.'
        )
      );
    }
    if (!workflow.name) {
      messages.push(
        message(
          'error',
          'definition',
          'name',
          'Workflow name is required.',
          'Add a user-facing workflow name.'
        )
      );
    }
    if (workflow.version === undefined) {
      messages.push(
        message(
          'error',
          'definition',
          'version',
          'Workflow version is required.',
          'Set version to 1 for new workflows.'
        )
      );
    }

    const agents = toArray(workflow.agents);
    const steps = toArray(workflow.steps);
    if (agents.length === 0) {
      messages.push(
        message(
          'error',
          'definition',
          'agents',
          'At least one agent is required.',
          'Add an agent role before saving.'
        )
      );
    }
    if (steps.length === 0) {
      messages.push(
        message(
          'error',
          'definition',
          'steps',
          'At least one step is required.',
          'Add a supported workflow step.'
        )
      );
    }

    for (const duplicate of duplicateValues(agents.map((agent) => agent.id).filter(Boolean))) {
      messages.push(
        message(
          'error',
          'definition',
          `agents.${duplicate}`,
          `Duplicate agent ID ${duplicate}.`,
          'Use unique agent IDs.'
        )
      );
    }
    for (const duplicate of duplicateValues(steps.map((step) => step.id).filter(Boolean))) {
      messages.push(
        message(
          'error',
          'definition',
          `steps.${duplicate}`,
          `Duplicate step ID ${duplicate}.`,
          'Use unique step IDs.'
        )
      );
    }

    const agentIds = new Set(agents.map((agent) => agent.id));
    const stepIds = new Set(steps.map((step) => step.id));
    for (const [index, agent] of agents.entries()) {
      if (!agent.id) {
        messages.push(
          message(
            'error',
            'definition',
            `agents[${index}].id`,
            'Agent ID is required.',
            'Add a stable agent ID.'
          )
        );
      }
      if (!agent.role) {
        messages.push(
          message(
            'warning',
            'policy',
            `agents[${index}].role`,
            `Agent ${agent.id || index} has no role.`,
            'Assign a role so tool policies can be evaluated.'
          )
        );
      }
    }

    for (const [index, step] of steps.entries()) {
      const path = `steps[${index}]`;
      if (!step.id) {
        messages.push(
          message(
            'error',
            'definition',
            `${path}.id`,
            'Step ID is required.',
            'Add a stable step ID.'
          )
        );
      }
      if (!STEP_TYPES.includes(step.type)) {
        messages.push(
          message(
            'error',
            'definition',
            `${path}.type`,
            `Unsupported step type ${String(step.type)}.`,
            'Choose agent, loop, gate, or parallel.'
          )
        );
      }
      if (
        (step.type === 'agent' || step.type === 'loop') &&
        (!step.agent || !agentIds.has(step.agent))
      ) {
        messages.push(
          message(
            'error',
            'definition',
            `${path}.agent`,
            `Step ${step.id || index} references a missing agent.`,
            'Select an existing agent for this step.'
          )
        );
      }
      if (step.type === 'loop' && !step.loop?.over) {
        messages.push(
          message(
            'error',
            'definition',
            `${path}.loop.over`,
            `Loop step ${step.id || index} has no iterator.`,
            'Set loop.over to the collection expression.'
          )
        );
      }
      if (step.type === 'gate' && !step.condition) {
        messages.push(
          message(
            'error',
            'definition',
            `${path}.condition`,
            `Gate step ${step.id || index} has no condition.`,
            'Add the gate condition expression.'
          )
        );
      }
      if (step.type === 'gate' && !step.on_false) {
        messages.push(
          message(
            'warning',
            'definition',
            `${path}.on_false`,
            `Gate step ${step.id || index} has no false-path policy.`,
            'Add on_false so failed gates have clear remediation.'
          )
        );
      }
      if (step.type === 'parallel' && (!step.parallel?.steps || step.parallel.steps.length === 0)) {
        messages.push(
          message(
            'error',
            'definition',
            `${path}.parallel.steps`,
            `Parallel step ${step.id || index} has no substeps.`,
            'Add at least one parallel substep.'
          )
        );
      }
      if (step.type === 'parallel' && step.parallel?.steps) {
        for (const duplicate of duplicateValues(
          step.parallel.steps.map((subStep) => subStep.id).filter(Boolean)
        )) {
          messages.push(
            message(
              'error',
              'definition',
              `${path}.parallel.steps.${duplicate}`,
              `Parallel step ${step.id || index} has duplicate substep ID ${duplicate}.`,
              'Use unique parallel substep IDs.'
            )
          );
        }
        for (const [subIndex, subStep] of step.parallel.steps.entries()) {
          if (!subStep.agent || !agentIds.has(subStep.agent)) {
            messages.push(
              message(
                'error',
                'definition',
                `${path}.parallel.steps[${subIndex}].agent`,
                `Parallel substep ${subStep.id || subIndex} references a missing agent.`,
                'Select an existing agent for this parallel substep.'
              )
            );
          }
        }
      }
      if (step.on_fail?.retry_step && !stepIds.has(step.on_fail.retry_step)) {
        messages.push(
          message(
            'error',
            'definition',
            `${path}.on_fail.retry_step`,
            `Step ${step.id || index} retries a missing step.`,
            'Point retry_step at an existing step ID.'
          )
        );
      }
      if (step.loop?.verify_step && !stepIds.has(step.loop.verify_step)) {
        messages.push(
          message(
            'error',
            'definition',
            `${path}.loop.verify_step`,
            `Loop step ${step.id || index} verifies with a missing step.`,
            'Point verify_step at an existing step ID.'
          )
        );
      }
    }
  }

  private lintPipeline(
    workflow: WorkflowDefinition,
    messages: WorkflowLintMessage[]
  ): WorkflowPipelineSummary | undefined {
    const pipeline = workflow.pipeline;
    if (!pipeline) return undefined;

    if (pipeline.mode !== 'single-agent' && pipeline.mode !== 'orchestrated') {
      messages.push(
        message(
          'error',
          'pipeline',
          'pipeline.mode',
          `Unsupported pipeline mode ${String(pipeline.mode)}.`,
          'Choose single-agent or orchestrated.'
        )
      );
      return buildWorkflowPipelineSummary(workflow);
    }

    if (pipeline.mode === 'single-agent') {
      return buildWorkflowPipelineSummary(workflow);
    }

    const agentIds = new Set(toArray(workflow.agents).map((agent) => agent.id));
    const stepAgentIds = new Set(
      toArray(workflow.steps).flatMap((step) => [
        ...(step.agent ? [step.agent] : []),
        ...(step.parallel?.steps ?? []).map((subStep) => subStep.agent),
      ])
    );
    const roles = pipeline.roles ?? [];

    if (!pipeline.parentAgent || !agentIds.has(pipeline.parentAgent)) {
      messages.push(
        message(
          'error',
          'pipeline',
          'pipeline.parentAgent',
          'Orchestrated pipeline references a missing parent agent.',
          'Set pipeline.parentAgent to an existing workflow agent.'
        )
      );
    }

    if (roles.length === 0) {
      messages.push(
        message(
          'error',
          'pipeline',
          'pipeline.roles',
          'Orchestrated pipeline has no subagent roles.',
          'Add scoped subagent roles with briefs, deliverables, and verification steps.'
        )
      );
    }

    for (const duplicate of duplicateValues(roles.map((role) => role.id).filter(Boolean))) {
      messages.push(
        message(
          'error',
          'pipeline',
          `pipeline.roles.${duplicate}`,
          `Duplicate pipeline role ID ${duplicate}.`,
          'Use unique role IDs so handoffs and telemetry can be reconciled.'
        )
      );
    }

    const roleIds = new Set(roles.map((role) => role.id));
    for (const [index, role] of roles.entries()) {
      const path = `pipeline.roles[${index}]`;
      if (!role.id) {
        messages.push(
          message(
            'error',
            'pipeline',
            `${path}.id`,
            'Pipeline role ID is required.',
            'Add a stable role ID.'
          )
        );
      }
      if (!role.label) {
        messages.push(
          message(
            'warning',
            'pipeline',
            `${path}.label`,
            `Pipeline role ${role.id || index} has no label.`,
            'Add a user-facing role label for run views.'
          )
        );
      }
      if (!role.agent || !agentIds.has(role.agent)) {
        messages.push(
          message(
            'error',
            'pipeline',
            `${path}.agent`,
            `Pipeline role ${role.id || index} references a missing agent.`,
            'Attach each subagent role to an existing workflow agent.'
          )
        );
      } else if (!stepAgentIds.has(role.agent)) {
        messages.push(
          message(
            'warning',
            'pipeline',
            `${path}.agent`,
            `Pipeline role ${role.id || index} is not used by a workflow step.`,
            'Add an agent or parallel substep that delegates work to this role.'
          )
        );
      }
      if (!role.scope) {
        messages.push(
          message(
            'error',
            'pipeline',
            `${path}.scope`,
            `Pipeline role ${role.id || index} has no scope.`,
            'Define the subagent scope so the orchestrator can delegate safely.'
          )
        );
      }
      if (!role.taskBrief) {
        messages.push(
          message(
            'error',
            'pipeline',
            `${path}.taskBrief`,
            `Pipeline role ${role.id || index} has no task brief.`,
            'Add the brief template the subagent receives.'
          )
        );
      }
      if (role.required !== false && !role.deliverable) {
        messages.push(
          message(
            'error',
            'pipeline',
            `${path}.deliverable`,
            `Required pipeline role ${role.id || index} has no deliverable contract.`,
            'Describe the output the orchestrator must reconcile.'
          )
        );
      }
      if (role.required !== false && (!role.verification || role.verification.length === 0)) {
        messages.push(
          message(
            'error',
            'pipeline',
            `${path}.verification`,
            `Required pipeline role ${role.id || index} has no verification steps.`,
            'Add at least one verification step for the role output.'
          )
        );
      }
      for (const dependency of role.dependsOn ?? []) {
        if (!roleIds.has(dependency)) {
          messages.push(
            message(
              'error',
              'pipeline',
              `${path}.dependsOn`,
              `Pipeline role ${role.id || index} depends on missing role ${dependency}.`,
              'Point dependencies at existing pipeline role IDs.'
            )
          );
        }
      }
    }

    return buildWorkflowPipelineSummary(workflow);
  }

  private async lintToolPolicies(
    workflow: WorkflowDefinition,
    messages: WorkflowLintMessage[]
  ): Promise<void> {
    for (const [index, agent] of toArray(workflow.agents).entries()) {
      if (!agent.role) continue;
      const policy = await this.toolPolicyService.getToolPolicy(agent.role);
      if (!policy) {
        messages.push(
          message(
            'warning',
            'policy',
            `agents[${index}].role`,
            `No tool policy exists for role ${agent.role}.`,
            'Create a tool policy or choose an existing role before execution.'
          )
        );
        continue;
      }
      for (const tool of agent.tools ?? []) {
        if (!this.isToolAllowed(policy, tool)) {
          messages.push(
            message(
              'error',
              'policy',
              `agents[${index}].tools`,
              `Tool ${tool} is denied for role ${agent.role}.`,
              'Remove the tool or update the role policy intentionally.'
            )
          );
        }
      }
    }
  }

  private isToolAllowed(policy: ToolPolicy, tool: string): boolean {
    if (policy.denied.includes(tool)) return false;
    return policy.allowed.includes('*') || policy.allowed.includes(tool);
  }

  private lintSecrets(
    workflow: WorkflowDefinition,
    context: WorkflowDryRunContext,
    messages: WorkflowLintMessage[]
  ): void {
    const available = new Set(context.availableSecrets ?? []);
    for (const secret of referencedSecrets(workflow)) {
      if (!available.has(secret) && !process.env[secret]) {
        messages.push(
          message(
            'error',
            'secret',
            'secrets',
            `Secret ${secret} is referenced but unavailable.`,
            'Add the secret to the runtime environment before execution.'
          )
        );
      }
    }
  }

  private lintClientMode(
    workflow: WorkflowDefinition,
    context: WorkflowDryRunContext,
    messages: WorkflowLintMessage[]
  ): void {
    const clientMode = context.clientMode ?? 'local';
    for (const [index, agent] of toArray(workflow.agents).entries()) {
      const provider = agent.provider ?? '';
      const command = agent.command ?? '';
      if (
        (clientMode === 'remote' || clientMode === 'cloud') &&
        (provider === 'codex-cli' || command.includes('codex'))
      ) {
        messages.push(
          message(
            'warning',
            'client',
            `agents[${index}].provider`,
            `Agent ${agent.id} uses a local client in ${clientMode} mode.`,
            'Use a remote-capable provider or run this workflow in local client mode.'
          )
        );
      }
      if (clientMode === 'local' && provider === 'codex-cloud') {
        messages.push(
          message(
            'info',
            'client',
            `agents[${index}].provider`,
            `Agent ${agent.id} targets Codex Cloud.`,
            'Confirm this workflow is intended to leave local execution.'
          )
        );
      }
    }
  }

  private lintOutputTargets(
    workflow: WorkflowDefinition,
    context: WorkflowDryRunContext,
    messages: WorkflowLintMessage[]
  ): void {
    const targets = toArray(workflow.outputTargets);
    if (targets.length === 0) {
      messages.push(
        message(
          'warning',
          'output',
          'outputTargets',
          'Workflow has no expected output targets.',
          'Declare task update, work product, completion packet, notification, dashboard queue item, or scheduled snapshot outputs.'
        )
      );
      return;
    }

    const stepOutputs = toArray(workflow.steps).flatMap((step) =>
      step.output?.file ? [step.output.file] : []
    );
    for (const [index, target] of targets.entries()) {
      const path = `outputTargets[${index}]`;
      if (!isOutputTargetType(target.type)) {
        messages.push(
          message(
            'error',
            'output',
            `${path}.type`,
            `Unsupported output target ${String(target.type)}.`,
            `Choose one of: ${OUTPUT_TARGET_TYPES.join(', ')}.`
          )
        );
        continue;
      }
      if (target.type === 'task-update' && !context.taskId && !workflow.variables?.taskId) {
        messages.push(
          message(
            'error',
            'context',
            path,
            'Task update output requires task context.',
            'Provide a taskId before dry-run or run.'
          )
        );
      }
      if (target.type === 'work-product' && !target.path && stepOutputs.length === 0) {
        messages.push(
          message(
            'warning',
            'output',
            path,
            'Work product output has no path or step output file.',
            'Set outputTargets[].path or add step output files.'
          )
        );
      }
      if (target.type === 'notification' && !target.channel) {
        messages.push(
          message(
            'warning',
            'output',
            `${path}.channel`,
            'Notification output has no channel.',
            'Set the notification channel or dashboard destination.'
          )
        );
      }
      if (target.type === 'scheduled-snapshot' && !this.isScheduled(workflow.schedule)) {
        messages.push(
          message(
            'error',
            'schedule',
            path,
            'Scheduled snapshot output requires an enabled schedule.',
            'Enable a schedule or remove the scheduled snapshot target.'
          )
        );
      }
    }
  }

  private lintSchedule(workflow: WorkflowDefinition, messages: WorkflowLintMessage[]): void {
    const schedule = workflow.schedule;
    if (!this.isScheduled(schedule)) return;

    const targets = toArray(workflow.outputTargets);
    if (schedule.mode === 'custom' && !schedule.cronExpr) {
      messages.push(
        message(
          'error',
          'schedule',
          'schedule.cronExpr',
          'Custom schedule is missing a cron expression.',
          'Add cronExpr or choose a standard schedule mode.'
        )
      );
    }
    if (!schedule.timezone) {
      messages.push(
        message(
          'warning',
          'schedule',
          'schedule.timezone',
          'Scheduled workflow has no timezone.',
          'Set timezone so recurring runs are stable.'
        )
      );
    }
    if (!targets.some((target) => target.type === 'scheduled-snapshot')) {
      messages.push(
        message(
          'error',
          'schedule',
          'outputTargets',
          'Scheduled workflow has no scheduled snapshot target.',
          'Add a scheduled-snapshot output target so views read stable run snapshots.'
        )
      );
    }
    if (!targets.some((target) => target.type === 'work-product')) {
      messages.push(
        message(
          'warning',
          'schedule',
          'outputTargets',
          'Scheduled workflow has no work product target.',
          'Add a work-product target for inspectable scheduled output.'
        )
      );
    }
    if (schedule.snapshotRetention !== undefined && schedule.snapshotRetention <= 0) {
      messages.push(
        message(
          'error',
          'schedule',
          'schedule.snapshotRetention',
          'Snapshot retention must be positive.',
          'Use a positive retention count or omit the field.'
        )
      );
    }

    const lastVerifiedAt = parseDate(schedule.lastVerifiedAt);
    const now = Date.now();
    if (lastVerifiedAt && now - lastVerifiedAt > 30 * 24 * 60 * 60 * 1000) {
      messages.push(
        message(
          'warning',
          'schedule',
          'schedule.lastVerifiedAt',
          'Schedule configuration has stale verification.',
          'Run dry-run again before enabling this schedule.'
        )
      );
    }
  }

  private lintPermissions(context: WorkflowDryRunContext, messages: WorkflowLintMessage[]): void {
    if (!hasPermission(context.permissions, 'workflow:execute')) {
      messages.push(
        message(
          'error',
          'permission',
          'permissions',
          'Current identity cannot execute workflows.',
          'Grant workflow:execute or use an identity that can run this workflow.'
        )
      );
    }
    if (!hasPermission(context.permissions, 'workflow:write')) {
      messages.push(
        message(
          'warning',
          'permission',
          'permissions',
          'Current identity cannot save workflow changes.',
          'Grant workflow:write before saving this workflow.'
        )
      );
    }
  }

  private async lintSkillAudit(
    workflow: WorkflowDefinition,
    context: WorkflowDryRunContext,
    messages: WorkflowLintMessage[]
  ): Promise<WorkflowSkillAuditSummary> {
    const audit = await this.skillSecurityService.auditWorkflowSkills(
      workflow,
      context.clientMode ?? 'local'
    );
    for (const reference of audit.references) {
      if (reference.status === 'blocked' || reference.status === 'missing') {
        messages.push(
          message(
            'error',
            'skill',
            `skills.${reference.reference}`,
            reference.message,
            reference.status === 'missing'
              ? 'Install the referenced shared skill or remove it from the workflow.'
              : 'Remediate the skill finding or create an expiring reviewed exception.'
          )
        );
      } else if (reference.status === 'warning' || reference.status === 'unscanned') {
        messages.push(
          message(
            'warning',
            'skill',
            `skills.${reference.reference}`,
            reference.message,
            'Scan the skill, acknowledge medium findings, or create an expiring reviewed exception.'
          )
        );
      } else if (reference.exception) {
        messages.push(
          message(
            'info',
            'skill',
            `skills.${reference.reference}`,
            reference.message,
            'Review the exception before the expiration date.'
          )
        );
      }
    }
    return audit;
  }

  private isScheduled(schedule: WorkflowSchedule | undefined): schedule is WorkflowSchedule {
    return Boolean(schedule?.enabled && SCHEDULED_MODES.has(schedule.mode));
  }

  private buildChecks(messages: WorkflowLintMessage[]): WorkflowDryRunCheck[] {
    return [
      this.checkFor('definition', 'Definition schema', messages),
      this.checkFor('input', 'Recipe inputs', messages),
      this.checkFor('context', 'Task context', messages),
      this.checkFor('permission', 'Permissions', messages),
      this.checkFor('policy', 'Policy gates and tools', messages),
      this.checkFor('skill', 'Skill audit', messages),
      this.checkFor('pipeline', 'Orchestration pipeline', messages),
      this.checkFor('secret', 'Secrets', messages),
      this.checkFor('client', 'Client mode', messages),
      this.checkFor('output', 'Output targets', messages),
      this.checkFor('schedule', 'Schedule', messages),
    ];
  }

  private checkFor(
    category: WorkflowLintCategory,
    label: string,
    messages: WorkflowLintMessage[]
  ): WorkflowDryRunCheck {
    const categoryMessages = messages.filter((item) => item.category === category);
    const error = categoryMessages.find((item) => item.severity === 'error');
    const warning = categoryMessages.find((item) => item.severity === 'warning');
    const info = categoryMessages.find((item) => item.severity === 'info');
    if (error) return { id: category, label, status: 'fail', detail: error.message };
    if (warning) return { id: category, label, status: 'warn', detail: warning.message };
    if (info) return { id: category, label, status: 'pass', detail: info.message };
    return { id: category, label, status: 'pass', detail: 'No issues found.' };
  }
}

let workflowAuthoringServiceInstance: WorkflowAuthoringService | null = null;

export function getWorkflowAuthoringService(): WorkflowAuthoringService {
  if (!workflowAuthoringServiceInstance) {
    workflowAuthoringServiceInstance = new WorkflowAuthoringService();
  }
  return workflowAuthoringServiceInstance;
}

export function resetWorkflowAuthoringService(): void {
  workflowAuthoringServiceInstance = null;
}
