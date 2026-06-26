import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { Network, RefreshCw, SendHorizonal } from 'lucide-react';
import type { TaskPriority } from '@veritas-kanban/shared';
import { useIdentity } from '@/hooks/useIdentity';
import { useToast } from '@/hooks/useToast';
import {
  useWorkspaceCapabilityDiscovery,
  useWorkspaceDelegatedIntake,
  useWorkspaceDelegations,
} from '@/hooks/useWorkspaceCapabilities';

const EMPTY_CAPABILITIES: NonNullable<
  NonNullable<ReturnType<typeof useWorkspaceCapabilityDiscovery>['data']>['local']
>['capabilities'] = [];
const EMPTY_WORKSPACES: NonNullable<
  ReturnType<typeof useWorkspaceCapabilityDiscovery>['data']
>['trusted'] = [];
const EMPTY_CONTEXT_FIELDS: string[] = [];

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

export function WorkspaceCapabilitiesTab() {
  const { hasPermission } = useIdentity();
  const { toast } = useToast();
  const discoveryQuery = useWorkspaceCapabilityDiscovery();
  const delegationsQuery = useWorkspaceDelegations();
  const intake = useWorkspaceDelegatedIntake();
  const discovery = discoveryQuery.data;
  const localCapabilities = discovery?.local?.capabilities ?? EMPTY_CAPABILITIES;
  const trusted = discovery?.trusted ?? EMPTY_WORKSPACES;
  const canCreateDelegatedTask = hasPermission('task:write');

  const [sourceWorkspaceId, setSourceWorkspaceId] = useState<string | null>(null);
  const [capabilityId, setCapabilityId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [context, setContext] = useState('');
  const [type, setType] = useState<string | null>(null);
  const [priority, setPriority] = useState<TaskPriority | null>(null);
  const [project, setProject] = useState('');
  const [contextFields, setContextFields] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!sourceWorkspaceId && trusted[0]) setSourceWorkspaceId(trusted[0].workspaceId);
  }, [sourceWorkspaceId, trusted]);

  useEffect(() => {
    if (!capabilityId && localCapabilities[0]) setCapabilityId(localCapabilities[0].id);
  }, [capabilityId, localCapabilities]);

  const selectedCapability = useMemo(
    () => localCapabilities.find((capability) => capability.id === capabilityId) ?? null,
    [capabilityId, localCapabilities]
  );
  const selectedSource = useMemo(
    () => trusted.find((workspace) => workspace.workspaceId === sourceWorkspaceId) ?? null,
    [sourceWorkspaceId, trusted]
  );
  const taskTypeOptions = useMemo(
    () =>
      (selectedCapability?.acceptedTaskTypes ?? []).map((taskType) => ({
        value: taskType,
        label: taskType,
      })),
    [selectedCapability]
  );
  const requiredFields = selectedCapability?.requiredContextFields ?? EMPTY_CONTEXT_FIELDS;

  useEffect(() => {
    setType(
      selectedCapability?.defaultTaskType ?? selectedCapability?.acceptedTaskTypes[0] ?? null
    );
    setPriority(
      selectedCapability?.defaultPriority ?? discovery?.local?.defaultPriority ?? 'medium'
    );
    setProject(selectedCapability?.defaultProject ?? discovery?.local?.defaultProject ?? '');
    setContextFields((existing) =>
      Object.fromEntries(requiredFields.map((field) => [field, existing[field] ?? '']))
    );
  }, [
    discovery?.local?.defaultPriority,
    discovery?.local?.defaultProject,
    requiredFields,
    selectedCapability,
  ]);

  const canSubmit =
    canCreateDelegatedTask &&
    Boolean(selectedSource) &&
    Boolean(selectedCapability) &&
    title.trim().length > 0 &&
    context.trim().length > 0 &&
    requiredFields.every((field) => contextFields[field]?.trim());

  const handleSubmit = async () => {
    if (!selectedSource || !selectedCapability || !canSubmit) return;
    try {
      const result = await intake.mutateAsync({
        source: {
          workspaceId: selectedSource.workspaceId,
          workspaceName: selectedSource.name,
        },
        capabilityId: selectedCapability.id,
        title: title.trim(),
        context: context.trim(),
        contextFields,
        priority: priority ?? undefined,
        project: project.trim() || undefined,
        type: type ?? undefined,
      });
      toast({
        title: 'Delegated task created',
        description: result.taskId ?? result.record.id,
      });
      setTitle('');
      setContext('');
    } catch (error) {
      toast({
        title: 'Delegated intake failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  if (discoveryQuery.isLoading) {
    return (
      <Group gap="sm" className="text-muted-foreground">
        <Loader size="xs" />
        <Text size="sm">Loading workspace capabilities...</Text>
      </Group>
    );
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="center">
        <Group gap="xs">
          <Network className="h-4 w-4 text-muted-foreground" />
          <Text size="sm" fw={600}>
            Workspace Capabilities
          </Text>
        </Group>
        <Button
          size="xs"
          variant="subtle"
          color="gray"
          onClick={() => discoveryQuery.refetch()}
          leftSection={<RefreshCw className="h-3.5 w-3.5" />}
        >
          Refresh
        </Button>
      </Group>

      {!discovery?.local && (
        <Alert color="yellow" variant="light">
          No local workspace capability manifest is configured.
        </Alert>
      )}

      {discovery?.local && (
        <Paper className="border bg-card p-4" radius="md">
          <Stack gap="sm">
            <Group justify="space-between" align="flex-start">
              <Stack gap={2}>
                <Text size="sm" fw={600}>
                  {discovery.local.name}
                </Text>
                <Text size="xs" c="dimmed">
                  {discovery.local.workspaceId}
                </Text>
              </Stack>
              <Badge color={discovery.local.enabled ? 'green' : 'gray'} variant="light">
                {discovery.local.enabled ? 'Enabled' : 'Disabled'}
              </Badge>
            </Group>
            <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
              {discovery.local.capabilities.map((capability) => (
                <CapabilityCard key={capability.id} capability={capability} />
              ))}
            </SimpleGrid>
          </Stack>
        </Paper>
      )}

      <Stack gap="sm">
        <Text size="sm" fw={600}>
          Trusted Workspaces
        </Text>
        {trusted.length === 0 ? (
          <Paper className="border border-dashed p-4 text-center" radius="md">
            <Text size="sm" c="dimmed">
              No trusted workspace manifests registered.
            </Text>
          </Paper>
        ) : (
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
            {trusted.map((workspace) => (
              <Paper key={workspace.workspaceId} className="border bg-card p-4" radius="md">
                <Stack gap="xs">
                  <Group justify="space-between" align="flex-start">
                    <Stack gap={2}>
                      <Text size="sm" fw={600}>
                        {workspace.name}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {workspace.workspaceId}
                      </Text>
                    </Stack>
                    <Badge color={workspace.enabled ? 'green' : 'gray'} variant="light">
                      {workspace.enabled ? 'Trusted' : 'Disabled'}
                    </Badge>
                  </Group>
                  {workspace.capabilities.map((capability) => (
                    <CapabilityCard key={capability.id} capability={capability} compact />
                  ))}
                </Stack>
              </Paper>
            ))}
          </SimpleGrid>
        )}
      </Stack>

      <Paper className="border bg-card p-4" radius="md">
        <Stack gap="md">
          <Group gap="xs">
            <SendHorizonal className="h-4 w-4 text-muted-foreground" />
            <Text size="sm" fw={600}>
              Delegated Intake
            </Text>
          </Group>
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
            <Select
              label="Source workspace"
              value={sourceWorkspaceId}
              onChange={setSourceWorkspaceId}
              data={trusted.map((workspace) => ({
                value: workspace.workspaceId,
                label: workspace.name,
              }))}
              disabled={trusted.length === 0}
            />
            <Select
              label="Capability"
              value={capabilityId}
              onChange={setCapabilityId}
              data={localCapabilities.map((capability) => ({
                value: capability.id,
                label: capability.name,
              }))}
              disabled={localCapabilities.length === 0}
            />
            <TextInput
              label="Title"
              value={title}
              onChange={(event) => setTitle(event.currentTarget.value)}
            />
            <Select
              label="Priority"
              value={priority}
              onChange={(value) => setPriority((value as TaskPriority | null) ?? null)}
              data={PRIORITY_OPTIONS}
              allowDeselect={false}
            />
            <Select
              label="Type"
              value={type}
              onChange={setType}
              data={taskTypeOptions}
              disabled={taskTypeOptions.length === 0}
            />
            <TextInput
              label="Project"
              value={project}
              onChange={(event) => setProject(event.currentTarget.value)}
            />
          </SimpleGrid>
          <Textarea
            label="Context"
            value={context}
            onChange={(event) => setContext(event.currentTarget.value)}
            minRows={4}
          />
          {requiredFields.length > 0 && (
            <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
              {requiredFields.map((field) => (
                <TextInput
                  key={field}
                  label={field}
                  value={contextFields[field] ?? ''}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setContextFields((existing) => ({
                      ...existing,
                      [field]: value,
                    }));
                  }}
                />
              ))}
            </SimpleGrid>
          )}
          <Group justify="flex-end">
            <Button
              onClick={handleSubmit}
              disabled={!canSubmit || intake.isPending}
              leftSection={<SendHorizonal className="h-4 w-4" />}
            >
              Create Intake
            </Button>
          </Group>
        </Stack>
      </Paper>

      <Stack gap="sm">
        <Text size="sm" fw={600}>
          Recent Delegations
        </Text>
        {delegationsQuery.isLoading ? (
          <Text size="sm" c="dimmed">
            Loading delegations...
          </Text>
        ) : (delegationsQuery.data ?? []).length === 0 ? (
          <Paper className="border border-dashed p-4 text-center" radius="md">
            <Text size="sm" c="dimmed">
              No delegated work recorded.
            </Text>
          </Paper>
        ) : (
          <Stack gap="xs">
            {(delegationsQuery.data ?? []).slice(0, 5).map((record) => (
              <Paper key={record.id} className="border bg-card p-3" radius="md">
                <Group justify="space-between" align="flex-start" wrap="nowrap">
                  <Stack gap={2} className="min-w-0">
                    <Text size="sm" fw={500} className="truncate">
                      {record.title}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {record.source.workspaceId}
                      {' -> '}
                      {record.target.workspaceId}
                    </Text>
                  </Stack>
                  <Badge variant="light" color={record.status === 'blocked' ? 'red' : 'blue'}>
                    {record.latestState ?? record.status}
                  </Badge>
                </Group>
              </Paper>
            ))}
          </Stack>
        )}
      </Stack>
    </Stack>
  );
}

function CapabilityCard({
  capability,
  compact = false,
}: {
  capability: {
    id: string;
    name: string;
    acceptedTaskTypes: string[];
    requiredContextFields?: string[];
    intakeTargets?: string[];
  };
  compact?: boolean;
}) {
  return (
    <Paper
      className={compact ? 'border bg-background/40 p-3' : 'border bg-background/40 p-4'}
      radius="md"
    >
      <Stack gap={6}>
        <Group gap="xs" justify="space-between" align="center">
          <Text size="sm" fw={600}>
            {capability.name}
          </Text>
          <Badge variant="light" color="gray">
            {capability.id}
          </Badge>
        </Group>
        <Group gap={6}>
          {(capability.acceptedTaskTypes.length > 0 ? capability.acceptedTaskTypes : ['any']).map(
            (taskType) => (
              <Badge key={taskType} size="sm" variant="outline">
                {taskType}
              </Badge>
            )
          )}
        </Group>
        {capability.requiredContextFields && capability.requiredContextFields.length > 0 && (
          <Text size="xs" c="dimmed">
            Required: {capability.requiredContextFields.join(', ')}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}
