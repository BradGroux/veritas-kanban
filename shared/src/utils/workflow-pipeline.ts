import type {
  WorkflowDefinition,
  WorkflowPipelineRoleStatusPatch,
  WorkflowPipelineSummary,
  WorkflowSubagentRole,
  WorkflowSubagentTelemetry,
} from '../types/workflow.js';

function mergeTelemetry(
  roleTelemetry: WorkflowSubagentTelemetry | undefined,
  patchTelemetry: WorkflowSubagentTelemetry | undefined
): WorkflowSubagentTelemetry {
  return {
    ...(roleTelemetry ?? {}),
    ...(patchTelemetry ?? {}),
  };
}

function workflowRoles(workflow: WorkflowDefinition): WorkflowSubagentRole[] {
  return workflow.pipeline?.roles ?? [];
}

export function buildWorkflowPipelineSummary(
  workflow: WorkflowDefinition,
  statuses: WorkflowPipelineRoleStatusPatch = {}
): WorkflowPipelineSummary | undefined {
  if (!workflow.pipeline) return undefined;

  const roles = workflowRoles(workflow).map((role) => {
    const patch = statuses[role.id] ?? {};
    return {
      ...role,
      required: role.required ?? true,
      dependsOn: role.dependsOn ?? [],
      verification: role.verification ?? [],
      status: patch.status ?? 'pending',
      telemetry: mergeTelemetry(role.telemetry, patch.telemetry),
    };
  });

  return {
    mode: workflow.pipeline.mode,
    parentAgent: workflow.pipeline.parentAgent,
    completion: workflow.pipeline.completion ?? 'all-required',
    handoff: workflow.pipeline.handoff,
    roles,
    totals: {
      roles: roles.length,
      required: roles.filter((role) => role.required !== false).length,
      completed: roles.filter((role) => role.status === 'completed').length,
      blocked: roles.filter((role) => role.status === 'blocked').length,
      failed: roles.filter((role) => role.status === 'failed').length,
    },
  };
}
