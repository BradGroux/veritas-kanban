import { useEffect, useState } from 'react';
import type { WorkflowAccess, WorkflowDefinition } from '@veritas-kanban/shared';
import { Alert, Badge, Button, Group, Skeleton, Stack, Text, Title } from '@mantine/core';
import { AlertTriangle, ArrowLeft, Copy, Pencil } from 'lucide-react';
import { workflowsApi } from '@/lib/api/workflows';
import { WorkflowAuthoringPanel } from './WorkflowAuthoringPanel';

interface WorkflowEditorRouteProps {
  sourceWorkflowId: string;
  mode: 'edit' | 'duplicate';
  canWriteWorkflows: boolean;
  onBack: () => void;
  onSaved: (workflowId: string) => void;
  onDuplicate: () => void;
}

function duplicateWorkflow(workflow: WorkflowDefinition): WorkflowDefinition {
  const suffix = '-copy';
  const baseId = workflow.id.slice(0, Math.max(1, 100 - suffix.length));
  return {
    ...workflow,
    id: `${baseId}${suffix}`,
    name: `${workflow.name} Copy`,
    version: 1,
    createdBy: undefined,
    updatedBy: undefined,
    createdAt: undefined,
    updatedAt: undefined,
    agents: workflow.agents.map((agent) => ({
      ...agent,
      tools: agent.tools ? [...agent.tools] : undefined,
      budget: agent.budget
        ? {
            ...agent.budget,
            limits: agent.budget.limits ? { ...agent.budget.limits } : undefined,
          }
        : undefined,
    })),
    steps: workflow.steps.map((step) => ({
      ...step,
      acceptance_criteria: step.acceptance_criteria ? [...step.acceptance_criteria] : undefined,
      parallel: step.parallel
        ? {
            ...step.parallel,
            steps: step.parallel.steps.map((branch) => ({ ...branch })),
          }
        : undefined,
    })),
  };
}

export function WorkflowEditorRoute({
  sourceWorkflowId,
  mode,
  canWriteWorkflows,
  onBack,
  onSaved,
  onDuplicate,
}: WorkflowEditorRouteProps) {
  const [workflow, setWorkflow] = useState<WorkflowDefinition | null>(null);
  const [access, setAccess] = useState<WorkflowAccess | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setWorkflow(null);
    setAccess(null);
    setError(null);
    Promise.all([workflowsApi.get(sourceWorkflowId), workflowsApi.access(sourceWorkflowId)])
      .then(([nextWorkflow, nextAccess]) => {
        if (cancelled) return;
        setWorkflow(mode === 'duplicate' ? duplicateWorkflow(nextWorkflow) : nextWorkflow);
        setAccess(nextAccess);
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : `Workflow ${sourceWorkflowId} could not be loaded.`
        );
      });
    return () => {
      cancelled = true;
    };
  }, [mode, sourceWorkflowId]);

  const allowed =
    canWriteWorkflows && access && (mode === 'edit' ? access.canEdit : access.canDuplicate);

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start">
        <Stack gap={6}>
          <Button
            variant="subtle"
            size="sm"
            leftSection={<ArrowLeft className="h-4 w-4" />}
            onClick={onBack}
            className="self-start"
          >
            Back to workflow
          </Button>
          <Group gap="sm">
            <Title order={1} className="text-2xl">
              {mode === 'edit' ? 'Edit workflow' : 'Duplicate workflow'}
            </Title>
            <Badge variant="light">Author</Badge>
          </Group>
          <Text c="dimmed">
            {mode === 'edit'
              ? 'Save a new version of this user-owned workflow definition.'
              : 'Create an editable workflow from the read-only source definition.'}
          </Text>
        </Stack>
        {mode === 'edit' ? (
          <Pencil className="h-5 w-5 text-muted-foreground" aria-hidden />
        ) : (
          <Copy className="h-5 w-5 text-muted-foreground" aria-hidden />
        )}
      </Group>

      {error && (
        <Alert
          color="red"
          icon={<AlertTriangle className="h-4 w-4" />}
          title="Authoring unavailable"
        >
          {error}
        </Alert>
      )}

      {!error && (!workflow || !access) && (
        <Stack gap="md" aria-label="Loading workflow authoring">
          <Skeleton h={80} />
          <Skeleton h={320} />
        </Stack>
      )}

      {workflow && access && !allowed && (
        <Alert
          color="blue"
          icon={<AlertTriangle className="h-4 w-4" />}
          title={mode === 'edit' ? 'This workflow is read-only' : 'Duplicate permission required'}
        >
          <Stack gap="sm">
            <Text size="sm">
              {mode === 'edit'
                ? access.readOnlyReason
                : 'The current identity cannot create workflow definitions.'}
            </Text>
            {mode === 'edit' && canWriteWorkflows && access.canDuplicate && (
              <Button size="xs" variant="light" onClick={onDuplicate} className="self-start">
                Duplicate to customize
              </Button>
            )}
          </Stack>
        </Alert>
      )}

      {workflow && access && allowed && (
        <WorkflowAuthoringPanel
          key={`${mode}:${sourceWorkflowId}:${workflow.version}`}
          canSaveWorkflow
          initialWorkflow={workflow}
          saveMode={mode === 'edit' ? 'edit' : 'create'}
          onWorkflowCreated={onSaved}
        />
      )}
    </Stack>
  );
}
