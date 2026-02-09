/**
 * Workflow Diff Utility
 * Compares two workflow definitions and returns a list of changed fields
 */

import type { WorkflowDefinition } from '../types/workflow.js';

export interface WorkflowChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

/**
 * Compare two workflow definitions and return list of changes
 */
export function diffWorkflows(
  oldWorkflow: WorkflowDefinition | null,
  newWorkflow: WorkflowDefinition
): WorkflowChange[] {
  if (!oldWorkflow) {
    return [{ field: 'workflow', oldValue: null, newValue: 'created' }];
  }

  const changes: WorkflowChange[] = [];

  // Top-level fields
  if (oldWorkflow.name !== newWorkflow.name) {
    changes.push({ field: 'name', oldValue: oldWorkflow.name, newValue: newWorkflow.name });
  }

  if (oldWorkflow.description !== newWorkflow.description) {
    changes.push({
      field: 'description',
      oldValue: oldWorkflow.description,
      newValue: newWorkflow.description,
    });
  }

  if (oldWorkflow.version !== newWorkflow.version) {
    changes.push({
      field: 'version',
      oldValue: oldWorkflow.version,
      newValue: newWorkflow.version,
    });
  }

  // Config changes
  if (JSON.stringify(oldWorkflow.config) !== JSON.stringify(newWorkflow.config)) {
    changes.push({
      field: 'config',
      oldValue: oldWorkflow.config,
      newValue: newWorkflow.config,
    });
  }

  // Agent changes
  if (JSON.stringify(oldWorkflow.agents) !== JSON.stringify(newWorkflow.agents)) {
    changes.push({
      field: 'agents',
      oldValue: `${oldWorkflow.agents.length} agents`,
      newValue: `${newWorkflow.agents.length} agents`,
    });
  }

  // Step changes
  if (JSON.stringify(oldWorkflow.steps) !== JSON.stringify(newWorkflow.steps)) {
    changes.push({
      field: 'steps',
      oldValue: `${oldWorkflow.steps.length} steps`,
      newValue: `${newWorkflow.steps.length} steps`,
    });
  }

  // Variable changes
  if (JSON.stringify(oldWorkflow.variables) !== JSON.stringify(newWorkflow.variables)) {
    changes.push({
      field: 'variables',
      oldValue: oldWorkflow.variables,
      newValue: newWorkflow.variables,
    });
  }

  return changes;
}
