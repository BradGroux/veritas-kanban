import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Group, Loader, Paper, Select, Stack, Text, TextInput } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Play, RefreshCw, Save, SearchCode, XCircle } from 'lucide-react';
import type {
  ExternalTrackerFieldMapping,
  ExternalTrackerMappingProfile,
  ExternalTrackerMappingProfileInput,
  ExternalTrackerSchema,
  ExternalTrackerValidationResult,
  Task,
  VeritasTaskMappingField,
} from '@veritas-kanban/shared';
import { useIdentity } from '@/hooks/useIdentity';
import { useToast } from '@/hooks/useToast';
import { api } from '@/lib/api';

const TRACKERS_QUERY_KEY = ['settings', 'external-trackers'] as const;

const SOURCE_OPTIONS: { value: VeritasTaskMappingField; label: string }[] = [
  { value: 'title', label: 'Title' },
  { value: 'description', label: 'Description' },
  { value: 'priority', label: 'Priority' },
  { value: 'status', label: 'Status' },
  { value: 'type', label: 'Type' },
  { value: 'project', label: 'Project' },
  { value: 'sprint', label: 'Sprint' },
  { value: 'github.url', label: 'GitHub URL' },
  { value: 'literal', label: 'Literal' },
];

function defaultMappings(): ExternalTrackerFieldMapping[] {
  return [
    { trackerFieldId: 'System.Title', source: 'title', required: true },
    { trackerFieldId: 'System.Description', source: 'description' },
    { trackerFieldId: 'Microsoft.VSTS.Common.Priority', source: 'priority' },
    { trackerFieldId: 'System.State', source: 'status' },
    { trackerFieldId: 'System.Tags', source: 'literal', literalValue: 'veritas' },
  ];
}

function buildDraft(
  schema: ExternalTrackerSchema,
  profile?: ExternalTrackerMappingProfile
): ExternalTrackerMappingProfileInput {
  if (profile) {
    return {
      id: profile.id,
      name: profile.name,
      provider: profile.provider,
      enabled: profile.enabled,
      workspaceId: profile.workspaceId,
      project: profile.project,
      defaultWorkItemType: profile.defaultWorkItemType,
      defaultProjectPath: profile.defaultProjectPath,
      defaultAreaPath: profile.defaultAreaPath,
      defaultTeamPath: profile.defaultTeamPath,
      defaultIterationPath: profile.defaultIterationPath,
      fieldMappings: profile.fieldMappings,
      valueMappings: profile.valueMappings,
      backlinkFieldId: profile.backlinkFieldId,
    };
  }

  return {
    id: 'default-mock-profile',
    name: 'Default Mock Tracker Mapping',
    provider: schema.provider,
    enabled: true,
    project: schema.projects[0]?.path,
    defaultWorkItemType: schema.workItemTypes[0]?.id ?? 'Task',
    defaultProjectPath: schema.projects[0]?.path,
    defaultAreaPath: schema.areaPaths[0]?.path,
    defaultTeamPath: schema.teams[0]?.path,
    defaultIterationPath: schema.iterationPaths[0]?.path,
    fieldMappings: defaultMappings(),
    valueMappings: {
      priority: { low: 4, medium: 3, high: 2, critical: 1 },
      status: {
        todo: 'New',
        'in-progress': 'Active',
        blocked: 'Active',
        done: 'Closed',
        cancelled: 'Closed',
      },
      type: { feature: 'Feature', bug: 'Bug', chore: 'Task', task: 'Task', code: 'Task' },
    },
    backlinkFieldId: 'Custom.VeritasBacklink',
  };
}

function sampleTask(): Task {
  return {
    id: 'task_tracker_preview',
    title: 'Preview tracker mapping',
    description: 'Dry-run preview from Settings.',
    type: 'feature',
    status: 'todo',
    priority: 'medium',
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };
}

function validationColor(validation?: ExternalTrackerValidationResult): string {
  if (!validation) return 'gray';
  return validation.valid ? 'green' : 'red';
}

export function TrackersTab() {
  const queryClient = useQueryClient();
  const { hasPermission } = useIdentity();
  const { toast } = useToast();
  const canWrite = hasPermission('settings:write');
  const [draft, setDraft] = useState<ExternalTrackerMappingProfileInput | null>(null);
  const [validation, setValidation] = useState<ExternalTrackerValidationResult | null>(null);
  const [taskId, setTaskId] = useState('');
  const [dryRunFields, setDryRunFields] = useState<string[]>([]);

  const schemaQuery = useQuery({
    queryKey: [...TRACKERS_QUERY_KEY, 'schema'],
    queryFn: () => api.integrations.trackerSchema(),
    staleTime: 60_000,
  });
  const profilesQuery = useQuery({
    queryKey: [...TRACKERS_QUERY_KEY, 'profiles'],
    queryFn: () => api.integrations.trackerProfiles(),
    staleTime: 60_000,
  });

  const schema = schemaQuery.data;
  const firstProfile = profilesQuery.data?.[0];

  useEffect(() => {
    if (!schema || draft) return;
    setDraft(buildDraft(schema, firstProfile));
  }, [draft, firstProfile, schema]);

  const fieldOptions = useMemo(
    () =>
      schema?.fields.map((field) => ({ value: field.id, label: `${field.name} (${field.id})` })) ??
      [],
    [schema]
  );
  const workItemTypeOptions = useMemo(
    () => schema?.workItemTypes.map((item) => ({ value: item.id, label: item.name })) ?? [],
    [schema]
  );
  const projectOptions = useMemo(
    () => schema?.projects.map((item) => ({ value: item.path, label: item.path })) ?? [],
    [schema]
  );
  const areaOptions = useMemo(
    () => schema?.areaPaths.map((item) => ({ value: item.path, label: item.path })) ?? [],
    [schema]
  );
  const teamOptions = useMemo(
    () => schema?.teams.map((item) => ({ value: item.path, label: item.path })) ?? [],
    [schema]
  );
  const iterationOptions = useMemo(
    () => schema?.iterationPaths.map((item) => ({ value: item.path, label: item.path })) ?? [],
    [schema]
  );

  const invalidate = () => queryClient.invalidateQueries({ queryKey: TRACKERS_QUERY_KEY });

  const introspect = useMutation({
    mutationFn: () => api.integrations.introspectTracker({ provider: 'mock' }),
    onSuccess: async (nextSchema) => {
      setDraft((current) => current ?? buildDraft(nextSchema));
      await invalidate();
      toast({ title: 'Tracker schema refreshed' });
    },
    onError: (error) => {
      toast({
        title: 'Tracker introspection failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const saveProfile = useMutation({
    mutationFn: (input: ExternalTrackerMappingProfileInput) =>
      api.integrations.saveTrackerProfile(input.id ?? 'default-mock-profile', input),
    onSuccess: async () => {
      await invalidate();
      toast({ title: 'Tracker mapping saved' });
    },
    onError: (error) => {
      toast({
        title: 'Tracker mapping failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const validateProfile = useMutation({
    mutationFn: async () => {
      if (!draft?.id) throw new Error('Save the mapping before validation');
      return api.integrations.validateTrackerProfile(draft.id);
    },
    onSuccess: (result) => {
      setValidation(result);
      toast({ title: result.valid ? 'Tracker mapping valid' : 'Tracker mapping has errors' });
    },
  });

  const dryRun = useMutation({
    mutationFn: async () => {
      if (!draft?.id) throw new Error('Save the mapping before dry-run');
      return api.integrations.dryRunTrackerCreate({
        profileId: draft.id,
        taskId: taskId.trim() || undefined,
        task: taskId.trim() ? undefined : sampleTask(),
      });
    },
    onSuccess: (result) => {
      setValidation(result.validation);
      setDryRunFields(Object.keys(result.payload.fields));
      toast({ title: result.validation.valid ? 'Dry-run valid' : 'Dry-run found errors' });
    },
  });

  const updateDraft = (patch: Partial<ExternalTrackerMappingProfileInput>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  };

  const updateMapping = (index: number, patch: Partial<ExternalTrackerFieldMapping>) => {
    setDraft((current) => {
      if (!current) return current;
      const fieldMappings = current.fieldMappings.map((mapping, itemIndex) =>
        itemIndex === index ? { ...mapping, ...patch } : mapping
      );
      return { ...current, fieldMappings };
    });
  };

  if (schemaQuery.isLoading || profilesQuery.isLoading || !draft) {
    return (
      <Group gap="sm" className="text-muted-foreground">
        <Loader size="xs" />
        <Text size="sm">Loading tracker settings...</Text>
      </Group>
    );
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="center">
        <Stack gap={2}>
          <Text size="sm" fw={600}>
            External Trackers
          </Text>
          <Group gap="xs">
            <Badge variant="light" color="blue">
              {schema?.providerLabel ?? 'Mock Tracker'}
            </Badge>
            <Badge
              variant="light"
              color={schema?.connectionPosture.status === 'connected' ? 'green' : 'yellow'}
            >
              {schema?.connectionPosture.status ?? 'unknown'}
            </Badge>
            <Badge variant="light" color="gray">
              {schema?.fields.length ?? 0} fields
            </Badge>
            <Badge variant="light" color="gray">
              {schema?.workItemTypes.length ?? 0} types
            </Badge>
          </Group>
        </Stack>
        <Button
          size="xs"
          variant="subtle"
          color="gray"
          leftSection={<SearchCode className="h-3.5 w-3.5" />}
          onClick={() => introspect.mutate()}
          loading={introspect.isPending}
          disabled={!canWrite}
        >
          Introspect
        </Button>
      </Group>

      <Paper className="border bg-card p-4" radius="md">
        <Stack gap="md">
          <Group justify="space-between" align="center">
            <Text size="sm" fw={600}>
              Mapping Profile
            </Text>
            <Badge variant="light" color={validationColor(validation ?? undefined)}>
              {validation
                ? validation.valid
                  ? 'valid'
                  : `${validation.errors.length} errors`
                : 'not checked'}
            </Badge>
          </Group>

          <TextInput
            label="Profile"
            value={draft.name}
            onChange={(event) => updateDraft({ name: event.currentTarget.value })}
            disabled={!canWrite}
          />

          <Group grow align="flex-start">
            <Select
              label="Type"
              data={workItemTypeOptions}
              value={draft.defaultWorkItemType}
              onChange={(value) => value && updateDraft({ defaultWorkItemType: value })}
              disabled={!canWrite}
            />
            <Select
              label="Project"
              data={projectOptions}
              value={draft.defaultProjectPath ?? null}
              onChange={(value) => updateDraft({ defaultProjectPath: value ?? undefined })}
              disabled={!canWrite}
            />
          </Group>

          <Group grow align="flex-start">
            <Select
              label="Area"
              data={areaOptions}
              value={draft.defaultAreaPath ?? null}
              onChange={(value) => updateDraft({ defaultAreaPath: value ?? undefined })}
              disabled={!canWrite}
            />
            <Select
              label="Iteration"
              data={iterationOptions}
              value={draft.defaultIterationPath ?? null}
              onChange={(value) => updateDraft({ defaultIterationPath: value ?? undefined })}
              disabled={!canWrite}
            />
            <Select
              label="Team"
              data={teamOptions}
              value={draft.defaultTeamPath ?? null}
              onChange={(value) => updateDraft({ defaultTeamPath: value ?? undefined })}
              disabled={!canWrite}
            />
          </Group>
        </Stack>
      </Paper>

      <Paper className="border bg-card p-4" radius="md">
        <Stack gap="sm">
          <Text size="sm" fw={600}>
            Fields
          </Text>
          {draft.fieldMappings.map((mapping, index) => (
            <Group key={`${mapping.trackerFieldId}-${index}`} grow align="flex-end">
              <Select
                label={index === 0 ? 'Tracker field' : undefined}
                data={fieldOptions}
                value={mapping.trackerFieldId}
                onChange={(value) => value && updateMapping(index, { trackerFieldId: value })}
                disabled={!canWrite}
              />
              <Select
                label={index === 0 ? 'Veritas field' : undefined}
                data={SOURCE_OPTIONS}
                value={mapping.source}
                onChange={(value) =>
                  value && updateMapping(index, { source: value as VeritasTaskMappingField })
                }
                disabled={!canWrite}
              />
              <TextInput
                label={index === 0 ? 'Literal' : undefined}
                value={mapping.literalValue ?? ''}
                onChange={(event) =>
                  updateMapping(index, { literalValue: event.currentTarget.value })
                }
                disabled={!canWrite || mapping.source !== 'literal'}
              />
            </Group>
          ))}
        </Stack>
      </Paper>

      <Paper className="border bg-card p-4" radius="md">
        <Stack gap="sm">
          <Group justify="space-between" align="center">
            <Text size="sm" fw={600}>
              Dry Run
            </Text>
            {validation ? (
              validation.valid ? (
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              ) : (
                <XCircle className="h-4 w-4 text-red-600" />
              )
            ) : null}
          </Group>
          <TextInput
            label="Task ID"
            placeholder="optional"
            value={taskId}
            onChange={(event) => setTaskId(event.currentTarget.value)}
          />
          {validation && !validation.valid ? (
            <Stack gap={4}>
              {validation.errors.slice(0, 3).map((item) => (
                <Text key={`${item.code}-${item.fieldId ?? item.message}`} size="xs" c="red">
                  {item.message}
                </Text>
              ))}
            </Stack>
          ) : dryRunFields.length > 0 ? (
            <Text size="xs" c="dimmed">
              Payload: {dryRunFields.join(', ')}
            </Text>
          ) : null}
        </Stack>
      </Paper>

      <Group justify="flex-end">
        <Button
          size="xs"
          variant="subtle"
          color="gray"
          leftSection={<RefreshCw className="h-3.5 w-3.5" />}
          onClick={() => validateProfile.mutate()}
          loading={validateProfile.isPending}
          disabled={!draft.id}
        >
          Validate
        </Button>
        <Button
          size="xs"
          variant="subtle"
          color="gray"
          leftSection={<Play className="h-3.5 w-3.5" />}
          onClick={() => dryRun.mutate()}
          loading={dryRun.isPending}
          disabled={!draft.id}
        >
          Dry Run
        </Button>
        <Button
          size="xs"
          leftSection={<Save className="h-3.5 w-3.5" />}
          onClick={() => saveProfile.mutate(draft)}
          loading={saveProfile.isPending}
          disabled={!canWrite}
        >
          Save
        </Button>
      </Group>
    </Stack>
  );
}
