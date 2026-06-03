import type {
  WorkflowDefinition,
  WorkflowOutputTarget,
  WorkflowSchedule,
  WorkflowStep,
} from '@veritas-kanban/shared';
import { API_BASE, apiFetch } from './helpers';

export type WorkflowRecipeInputType = 'text' | 'textarea' | 'select' | 'boolean';
export type WorkflowLintSeverity = 'error' | 'warning' | 'info';
export type WorkflowLintCategory =
  | 'definition'
  | 'input'
  | 'context'
  | 'permission'
  | 'policy'
  | 'secret'
  | 'client'
  | 'output'
  | 'schedule';

export interface WorkflowSummary {
  id: string;
  name: string;
  version: number;
  description: string;
  agents?: Array<{ id: string; name: string; role?: string }>;
  steps?: Array<{ id: string; name: string }>;
  activeRunCount?: number;
}

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
  workflow?: WorkflowDefinition;
}

export interface WorkflowAuthoringContext {
  taskId?: string;
  clientMode?: 'local' | 'remote' | 'cloud';
  availableSecrets?: string[];
  now?: string;
}

export interface WorkflowRecipeMaterialization {
  recipe: WorkflowRecipe;
  workflow: WorkflowDefinition;
  yaml: string;
  missingInputs: string[];
  lint: WorkflowLintResult;
  preview: {
    steps: Array<{ id: string; name: string; type: WorkflowStep['type']; agent?: string }>;
    outputTargets: WorkflowOutputTarget[];
    schedule?: WorkflowSchedule;
  };
}

export interface WorkflowRunStartResponse {
  id: string;
}

function unwrapData<T>(value: T | { data: T }): T {
  if (value && typeof value === 'object' && 'data' in value) {
    return (value as { data: T }).data;
  }
  return value as T;
}

export const workflowsApi = {
  list: async (): Promise<WorkflowSummary[]> => {
    const response = await apiFetch<WorkflowSummary[] | { data: WorkflowSummary[] }>(
      `${API_BASE}/workflows`
    );
    return unwrapData(response);
  },

  create: async (workflow: WorkflowDefinition): Promise<{ success: true; workflowId: string }> =>
    apiFetch(`${API_BASE}/workflows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(workflow),
    }),

  startRun: async (workflowId: string): Promise<WorkflowRunStartResponse> => {
    const response = await apiFetch<WorkflowRunStartResponse | { data: WorkflowRunStartResponse }>(
      `${API_BASE}/workflows/${encodeURIComponent(workflowId)}/runs`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }
    );
    return unwrapData(response);
  },

  recipes: async (): Promise<WorkflowRecipe[]> => {
    const response = await apiFetch<WorkflowRecipe[] | { data: WorkflowRecipe[] }>(
      `${API_BASE}/workflows/recipes`
    );
    return unwrapData(response);
  },

  materializeRecipe: async (
    recipeId: string,
    inputs: Record<string, unknown>,
    context?: WorkflowAuthoringContext
  ): Promise<WorkflowRecipeMaterialization> => {
    const response = await apiFetch<
      WorkflowRecipeMaterialization | { data: WorkflowRecipeMaterialization }
    >(`${API_BASE}/workflows/recipes/${encodeURIComponent(recipeId)}/materialize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs, context }),
    });
    return unwrapData(response);
  },

  lint: async (input: {
    workflow?: WorkflowDefinition;
    yaml?: string;
    context?: WorkflowAuthoringContext;
  }): Promise<WorkflowLintResult> =>
    apiFetch<WorkflowLintResult>(`${API_BASE}/workflows/authoring/lint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),

  dryRun: async (input: {
    workflow?: WorkflowDefinition;
    yaml?: string;
    context?: WorkflowAuthoringContext;
  }): Promise<WorkflowDryRunResult> =>
    apiFetch<WorkflowDryRunResult>(`${API_BASE}/workflows/authoring/dry-run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),

  renderYaml: async (workflow: WorkflowDefinition): Promise<{ yaml: string }> =>
    apiFetch<{ yaml: string }>(`${API_BASE}/workflows/authoring/yaml`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflow }),
    }),
};
