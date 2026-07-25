import { useEffect, useMemo, useState } from 'react';
import type { WorkflowAccess, WorkflowDefinition, WorkflowStep } from '@veritas-kanban/shared';
import {
  Alert,
  Badge,
  Button,
  Code,
  Divider,
  Group,
  Paper,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Braces,
  CheckCircle2,
  Copy,
  GitBranch,
  ListOrdered,
  Pencil,
  Play,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { workflowsApi } from '@/lib/api/workflows';

interface WorkflowDetailViewProps {
  workflowId: string;
  canWriteWorkflows: boolean;
  canExecuteWorkflows: boolean;
  onBack: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onStartRun: (workflow: WorkflowDefinition) => void;
  onViewRuns: () => void;
}

function formatTimestamp(value?: string): string {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function provenanceLabel(access: WorkflowAccess): string {
  if (access.provenance.kind === 'built-in') return 'Built-in';
  if (access.provenance.kind === 'user-owned') return 'Owned by you';
  return 'Shared with you';
}

function cloneRecord(value: Record<string, unknown> | undefined): Array<[string, unknown]> {
  return Object.entries(value ?? {}).sort(([left], [right]) => left.localeCompare(right));
}

export function WorkflowDetailView({
  workflowId,
  canWriteWorkflows,
  canExecuteWorkflows,
  onBack,
  onEdit,
  onDuplicate,
  onStartRun,
  onViewRuns,
}: WorkflowDetailViewProps) {
  const [workflow, setWorkflow] = useState<WorkflowDefinition | null>(null);
  const [access, setAccess] = useState<WorkflowAccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setWorkflow(null);
    setAccess(null);
    setError(null);

    Promise.all([workflowsApi.get(workflowId), workflowsApi.access(workflowId)])
      .then(([nextWorkflow, nextAccess]) => {
        if (cancelled) return;
        setWorkflow(nextWorkflow);
        setAccess(nextAccess);
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : `Workflow ${workflowId} could not be loaded.`
        );
      });

    return () => {
      cancelled = true;
    };
  }, [reloadKey, workflowId]);

  const variables = useMemo(() => cloneRecord(workflow?.variables), [workflow?.variables]);

  if (error) {
    return (
      <Stack gap="md">
        <Button
          variant="subtle"
          size="sm"
          leftSection={<ArrowLeft className="h-4 w-4" />}
          onClick={onBack}
          className="self-start"
        >
          Back to workflows
        </Button>
        <Alert
          color="red"
          icon={<AlertTriangle className="h-4 w-4" />}
          title="Workflow unavailable"
        >
          <Stack gap="sm">
            <Text size="sm">{error}</Text>
            <Button
              size="xs"
              variant="light"
              leftSection={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={() => setReloadKey((current) => current + 1)}
              className="self-start"
            >
              Try again
            </Button>
          </Stack>
        </Alert>
      </Stack>
    );
  }

  if (!workflow || !access) {
    return (
      <Stack gap="md" aria-label="Loading workflow definition">
        <Skeleton h={36} w={220} />
        <Skeleton h={150} />
        <SimpleGrid cols={{ base: 1, lg: 2 }}>
          <Skeleton h={260} />
          <Skeleton h={260} />
        </SimpleGrid>
      </Stack>
    );
  }

  const canEdit = canWriteWorkflows && access.canEdit;
  const canDuplicate = canWriteWorkflows && access.canDuplicate;
  const canStart = canExecuteWorkflows && access.canExecute;

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start" gap="md">
        <Stack gap={8}>
          <Button
            variant="subtle"
            size="sm"
            leftSection={<ArrowLeft className="h-4 w-4" />}
            onClick={onBack}
            className="self-start"
          >
            Back to workflows
          </Button>
          <Group gap="sm" align="center">
            <Title order={1} className="text-2xl">
              {workflow.name}
            </Title>
            <Badge variant="outline">v{workflow.version}</Badge>
            <Badge color={access.provenance.kind === 'built-in' ? 'gray' : 'blue'} variant="light">
              {provenanceLabel(access)}
            </Badge>
          </Group>
          <Text c="dimmed" maw={780} className="whitespace-pre-wrap">
            {workflow.description}
          </Text>
        </Stack>

        <Group gap="xs" justify="flex-end">
          {canEdit && (
            <Button variant="light" leftSection={<Pencil className="h-4 w-4" />} onClick={onEdit}>
              Edit
            </Button>
          )}
          {canDuplicate && (
            <Button
              variant="outline"
              leftSection={<Copy className="h-4 w-4" />}
              onClick={onDuplicate}
            >
              Duplicate
            </Button>
          )}
          <Button
            leftSection={<Play className="h-4 w-4" />}
            disabled={!canStart}
            title={canStart ? 'Configure and start a run' : 'Workflow execute permission required'}
            onClick={() => onStartRun(workflow)}
          >
            Start Run
          </Button>
        </Group>
      </Group>

      {!access.canEdit && access.readOnlyReason && (
        <Alert color="blue" icon={<ShieldCheck className="h-4 w-4" />} title="Read-only workflow">
          <Group justify="space-between" align="center" gap="md">
            <Text size="sm">{access.readOnlyReason}</Text>
            {canDuplicate && (
              <Button size="xs" variant="light" onClick={onDuplicate}>
                Duplicate to customize
              </Button>
            )}
          </Group>
        </Alert>
      )}

      <SimpleGrid cols={{ base: 1, lg: 3 }} spacing="md">
        <Paper p="md" radius="md" withBorder>
          <Stack gap="xs">
            <Group gap="xs">
              <Bot className="h-4 w-4 text-muted-foreground" />
              <Text fw={600}>Agents</Text>
            </Group>
            <Title order={2} className="text-2xl">
              {workflow.agents.length}
            </Title>
            <Text size="sm" c="dimmed">
              Assigned roles and runtime defaults
            </Text>
          </Stack>
        </Paper>
        <Paper p="md" radius="md" withBorder>
          <Stack gap="xs">
            <Group gap="xs">
              <ListOrdered className="h-4 w-4 text-muted-foreground" />
              <Text fw={600}>Steps</Text>
            </Group>
            <Title order={2} className="text-2xl">
              {workflow.steps.length}
            </Title>
            <Text size="sm" c="dimmed">
              Ordered execution blueprint
            </Text>
          </Stack>
        </Paper>
        <Paper p="md" radius="md" withBorder>
          <Stack gap="xs">
            <Group gap="xs">
              <GitBranch className="h-4 w-4 text-muted-foreground" />
              <Text fw={600}>Completion</Text>
            </Group>
            <Text fw={700} size="lg">
              {workflow.pipeline?.completion ?? 'Step order'}
            </Text>
            <Text size="sm" c="dimmed">
              {workflow.pipeline?.mode ?? 'Sequential workflow'}
            </Text>
          </Stack>
        </Paper>
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, xl: 3 }} spacing="md">
        <Stack gap="md" className="xl:col-span-2">
          <Paper p="md" radius="md" withBorder>
            <Stack gap="md">
              <Group justify="space-between">
                <Title order={2} className="text-lg">
                  Execution blueprint
                </Title>
                <Badge variant="light">{workflow.steps.length} ordered steps</Badge>
              </Group>
              <Divider />
              <Stack gap={0}>
                {workflow.steps.map((step, index) => (
                  <WorkflowStepDetail
                    key={step.id}
                    step={step}
                    index={index}
                    isLast={index === workflow.steps.length - 1}
                  />
                ))}
              </Stack>
            </Stack>
          </Paper>

          <Paper p="md" radius="md" withBorder>
            <Stack gap="md">
              <Group justify="space-between">
                <Title order={2} className="text-lg">
                  Agents
                </Title>
                <Badge variant="outline">{workflow.agents.length}</Badge>
              </Group>
              <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
                {workflow.agents.map((agent) => (
                  <Paper key={agent.id} p="sm" radius="sm" withBorder>
                    <Stack gap={6}>
                      <Group justify="space-between" align="flex-start">
                        <div>
                          <Text fw={600}>{agent.name}</Text>
                          <Text size="xs" c="dimmed">
                            {agent.id}
                          </Text>
                        </div>
                        <Badge size="xs" variant="light">
                          {agent.role}
                        </Badge>
                      </Group>
                      <Text size="sm">{agent.description}</Text>
                      <Group gap={6}>
                        {agent.provider && (
                          <Badge size="xs" variant="outline">
                            {agent.provider}
                          </Badge>
                        )}
                        {(agent.tools ?? []).slice(0, 6).map((tool) => (
                          <Badge key={tool} size="xs" color="gray" variant="light">
                            {tool}
                          </Badge>
                        ))}
                      </Group>
                    </Stack>
                  </Paper>
                ))}
              </SimpleGrid>
            </Stack>
          </Paper>
        </Stack>

        <Stack gap="md">
          <Paper p="md" radius="md" withBorder>
            <Stack gap="sm">
              <Title order={2} className="text-lg">
                Inputs
              </Title>
              {variables.length === 0 ? (
                <Text size="sm" c="dimmed">
                  No workflow variables are declared. Run context can still be supplied when
                  starting.
                </Text>
              ) : (
                variables.map(([name, value]) => (
                  <Group key={name} justify="space-between" align="flex-start" gap="sm">
                    <Code>{name}</Code>
                    <Text size="sm" ta="right" className="break-all">
                      {typeof value === 'string' ? value : JSON.stringify(value)}
                    </Text>
                  </Group>
                ))
              )}
            </Stack>
          </Paper>

          <Paper p="md" radius="md" withBorder>
            <Stack gap="sm">
              <Title order={2} className="text-lg">
                Outputs
              </Title>
              {(workflow.outputTargets ?? []).length === 0 ? (
                <Text size="sm" c="dimmed">
                  Step outputs only
                </Text>
              ) : (
                workflow.outputTargets?.map((target, index) => (
                  <Paper key={`${target.type}-${index}`} p="xs" radius="sm" withBorder>
                    <Group justify="space-between" align="flex-start">
                      <div>
                        <Text size="sm" fw={600}>
                          {target.label ?? target.type}
                        </Text>
                        {target.path && (
                          <Text size="xs" c="dimmed" className="break-all">
                            {target.path}
                          </Text>
                        )}
                      </div>
                      <Badge size="xs" variant="outline">
                        {target.type}
                      </Badge>
                    </Group>
                  </Paper>
                ))
              )}
            </Stack>
          </Paper>

          <Paper p="md" radius="md" withBorder>
            <Stack gap="sm">
              <Title order={2} className="text-lg">
                Provenance
              </Title>
              <MetadataRow label="Workflow ID" value={workflow.id} />
              <MetadataRow label="Owner" value={access.provenance.owner ?? 'Not recorded'} />
              <MetadataRow
                label="Created by"
                value={access.provenance.createdBy ?? 'Not recorded'}
              />
              <MetadataRow
                label="Updated by"
                value={access.provenance.updatedBy ?? 'Not recorded'}
              />
              <MetadataRow label="Created" value={formatTimestamp(access.provenance.createdAt)} />
              <MetadataRow label="Updated" value={formatTimestamp(access.provenance.updatedAt)} />
            </Stack>
          </Paper>

          <Button variant="subtle" onClick={onViewRuns}>
            View workflow runs
          </Button>
        </Stack>
      </SimpleGrid>
    </Stack>
  );
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <Group justify="space-between" align="flex-start" gap="sm">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="xs" ta="right" className="break-all">
        {value}
      </Text>
    </Group>
  );
}

function WorkflowStepDetail({
  step,
  index,
  isLast,
}: {
  step: WorkflowStep;
  index: number;
  isLast: boolean;
}) {
  return (
    <div className="grid grid-cols-[2.5rem_1fr] gap-3">
      <div className="flex flex-col items-center">
        <div className="flex h-8 w-8 items-center justify-center rounded-full border bg-muted text-xs font-semibold">
          {index + 1}
        </div>
        {!isLast && <div className="min-h-8 flex-1 border-l border-dashed" aria-hidden />}
      </div>
      <Stack gap="xs" pb={isLast ? 0 : 'lg'}>
        <Group justify="space-between" align="flex-start" gap="sm">
          <div>
            <Text fw={650}>{step.name}</Text>
            <Text size="xs" c="dimmed">
              {step.id}
              {step.agent ? ` · ${step.agent}` : ''}
            </Text>
          </div>
          <Group gap={6}>
            {step.phase && (
              <Badge size="xs" color="blue" variant="light">
                {step.phase}
              </Badge>
            )}
            <Badge size="xs" variant="outline">
              {step.type}
            </Badge>
          </Group>
        </Group>

        {step.input && (
          <Paper p="xs" radius="sm" className="bg-muted/35" withBorder>
            <Group gap={6} mb={4}>
              <Braces className="h-3.5 w-3.5 text-muted-foreground" />
              <Text size="xs" fw={600}>
                Input
              </Text>
            </Group>
            <Text size="sm" className="whitespace-pre-wrap">
              {step.input}
            </Text>
          </Paper>
        )}

        <StepControls step={step} />

        {(step.acceptance_criteria ?? []).length > 0 && (
          <Stack gap={4}>
            <Text size="xs" fw={600}>
              Acceptance criteria
            </Text>
            {step.acceptance_criteria?.map((criterion, criterionIndex) => (
              <Group key={`${step.id}-criterion-${criterionIndex}`} gap={6} align="flex-start">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-500" />
                <Text size="sm">{criterion}</Text>
              </Group>
            ))}
          </Stack>
        )}

        {step.output?.file && (
          <Text size="xs" c="dimmed">
            Output: <Code>{step.output.file}</Code>
          </Text>
        )}
      </Stack>
    </div>
  );
}

function StepControls({ step }: { step: WorkflowStep }) {
  if (step.type === 'gate') {
    return (
      <Paper p="xs" radius="sm" withBorder>
        <Text size="xs" fw={600}>
          Gate condition
        </Text>
        <Code block>{step.condition ?? 'No condition declared'}</Code>
        {step.on_false?.escalate_to && (
          <Text size="xs" c="dimmed" mt={4}>
            If false: {step.on_false.escalate_to}
          </Text>
        )}
      </Paper>
    );
  }

  if (step.type === 'loop') {
    return (
      <Paper p="xs" radius="sm" withBorder>
        <Group gap="sm">
          <Badge size="xs" variant="light">
            {step.loop?.completion ?? 'completion not set'}
          </Badge>
          <Text size="xs">Over: {step.loop?.over ?? 'not declared'}</Text>
          {step.loop?.max_iterations !== undefined && (
            <Text size="xs">Max: {step.loop.max_iterations}</Text>
          )}
        </Group>
      </Paper>
    );
  }

  if (step.type === 'parallel') {
    return (
      <Paper p="xs" radius="sm" withBorder>
        <Stack gap={6}>
          <Group justify="space-between">
            <Text size="xs" fw={600}>
              Parallel branches
            </Text>
            <Badge size="xs" variant="light">
              {step.parallel?.completion ?? 'all'}
            </Badge>
          </Group>
          {(step.parallel?.steps ?? []).map((branch) => (
            <Group key={branch.id} justify="space-between" gap="sm">
              <Text size="sm">{branch.id}</Text>
              <Badge size="xs" variant="outline">
                {branch.agent}
              </Badge>
            </Group>
          ))}
        </Stack>
      </Paper>
    );
  }

  return null;
}
