import { useEffect, useMemo, useState } from 'react';
import type {
  WorkflowAgent,
  WorkflowDefinition,
  WorkflowOutputTarget,
  WorkflowOutputTargetType,
  WorkflowSchedule,
  WorkflowStep,
} from '@veritas-kanban/shared';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Checkbox,
  Divider,
  Group,
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Tabs,
  Text,
  TextInput,
  Textarea,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  AlertTriangle,
  BookOpen,
  Calendar,
  CheckCircle2,
  FileText,
  GitBranch,
  Plus,
  Save,
  Trash2,
  Wand2,
  XCircle,
} from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import {
  workflowsApi,
  type WorkflowDryRunResult,
  type WorkflowLintMessage,
  type WorkflowRecipe,
  type WorkflowRecipeInput,
  type WorkflowRecipeMaterialization,
} from '@/lib/api/workflows';

interface WorkflowAuthoringPanelProps {
  canSaveWorkflow: boolean;
  onWorkflowCreated: () => void;
}

type BuilderContext = {
  taskId: string;
  clientMode: 'local' | 'remote' | 'cloud';
};

const OUTPUT_TARGETS: Array<{ value: WorkflowOutputTargetType; label: string }> = [
  { value: 'task-update', label: 'Task update' },
  { value: 'work-product', label: 'Work product' },
  { value: 'completion-packet', label: 'Completion packet' },
  { value: 'notification', label: 'Notification' },
  { value: 'dashboard-queue-item', label: 'Dashboard queue item' },
  { value: 'scheduled-snapshot', label: 'Scheduled snapshot' },
];

const STEP_TYPE_OPTIONS: Array<{ value: WorkflowStep['type']; label: string }> = [
  { value: 'agent', label: 'Agent' },
  { value: 'loop', label: 'Loop' },
  { value: 'gate', label: 'Gate' },
  { value: 'parallel', label: 'Parallel' },
];

const SCHEDULE_OPTIONS: Array<{ value: WorkflowSchedule['mode']; label: string }> = [
  { value: 'manual', label: 'Manual' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Biweekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'custom', label: 'Custom' },
];

const CLIENT_MODE_OPTIONS: Array<{ value: BuilderContext['clientMode']; label: string }> = [
  { value: 'local', label: 'Local' },
  { value: 'remote', label: 'Remote' },
  { value: 'cloud', label: 'Cloud' },
];

function defaultWorkflow(): WorkflowDefinition {
  return {
    id: 'custom-workflow',
    name: 'Custom Workflow',
    version: 1,
    description: 'Custom workflow definition',
    schedule: { mode: 'manual', enabled: false },
    outputTargets: [
      { type: 'work-product', label: 'Work product', path: 'work-products/output.md' },
    ],
    agents: [
      {
        id: 'worker',
        name: 'Worker',
        role: 'developer',
        description: 'Runs the workflow step.',
        tools: ['Read', 'Edit', 'exec'],
      },
    ],
    steps: [
      {
        id: 'work',
        name: 'Do work',
        type: 'agent',
        agent: 'worker',
        input: 'Use the provided task context and produce the requested output.',
        output: { file: 'output.md' },
      },
    ],
  };
}

function recipeInputDefault(input: WorkflowRecipeInput): string | boolean {
  if (input.defaultValue !== undefined) return input.defaultValue;
  return input.type === 'boolean' ? false : '';
}

function messageColor(severity: WorkflowLintMessage['severity']): string {
  if (severity === 'error') return 'red';
  if (severity === 'warning') return 'yellow';
  return 'blue';
}

function messageIcon(severity: WorkflowLintMessage['severity']) {
  if (severity === 'error') return <XCircle className="h-4 w-4" />;
  if (severity === 'warning') return <AlertTriangle className="h-4 w-4" />;
  return <CheckCircle2 className="h-4 w-4" />;
}

function compactContext(context: BuilderContext) {
  return {
    taskId: context.taskId.trim() || undefined,
    clientMode: context.clientMode,
  };
}

function splitTools(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function targetLabel(type: WorkflowOutputTargetType): string {
  return OUTPUT_TARGETS.find((target) => target.value === type)?.label ?? type;
}

function upsertTarget(
  targets: WorkflowOutputTarget[] | undefined,
  type: WorkflowOutputTargetType,
  patch: Partial<WorkflowOutputTarget>
): WorkflowOutputTarget[] {
  const existing = targets ?? [];
  if (existing.some((target) => target.type === type)) {
    return existing.map((target) => (target.type === type ? { ...target, ...patch } : target));
  }
  return [...existing, { type, label: targetLabel(type), ...patch }];
}

export function WorkflowAuthoringPanel({
  canSaveWorkflow,
  onWorkflowCreated,
}: WorkflowAuthoringPanelProps) {
  const { toast } = useToast();
  const [recipes, setRecipes] = useState<WorkflowRecipe[]>([]);
  const [recipesLoading, setRecipesLoading] = useState(true);
  const [selectedRecipeId, setSelectedRecipeId] = useState<string>('');
  const [recipeInputs, setRecipeInputs] = useState<Record<string, string | boolean>>({});
  const [materialized, setMaterialized] = useState<WorkflowRecipeMaterialization | null>(null);
  const [recipeBusy, setRecipeBusy] = useState(false);

  const [builderWorkflow, setBuilderWorkflow] = useState<WorkflowDefinition>(() =>
    defaultWorkflow()
  );
  const [builderContext, setBuilderContext] = useState<BuilderContext>({
    taskId: '',
    clientMode: 'local',
  });
  const [builderDryRun, setBuilderDryRun] = useState<WorkflowDryRunResult | null>(null);
  const [yamlDraft, setYamlDraft] = useState('');
  const [yamlDryRun, setYamlDryRun] = useState<WorkflowDryRunResult | null>(null);
  const [builderBusy, setBuilderBusy] = useState(false);
  const [yamlBusy, setYamlBusy] = useState(false);

  const selectedRecipe = useMemo(
    () => recipes.find((recipe) => recipe.id === selectedRecipeId) ?? null,
    [recipes, selectedRecipeId]
  );

  useEffect(() => {
    let cancelled = false;
    workflowsApi
      .recipes()
      .then((data) => {
        if (cancelled) return;
        setRecipes(data);
        setSelectedRecipeId((current) => current || data[0]?.id || '');
      })
      .catch((error: unknown) => {
        toast({
          title: 'Failed to load workflow recipes',
          description: error instanceof Error ? error.message : 'Unknown error',
        });
      })
      .finally(() => {
        if (!cancelled) setRecipesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [toast]);

  useEffect(() => {
    if (!selectedRecipe) return;
    const nextInputs: Record<string, string | boolean> = {};
    for (const input of selectedRecipe.inputs) {
      nextInputs[input.id] = recipeInputDefault(input);
    }
    setRecipeInputs(nextInputs);
    setMaterialized(null);
  }, [selectedRecipe]);

  const materializeRecipe = async () => {
    if (!selectedRecipe) return;
    setRecipeBusy(true);
    try {
      const result = await workflowsApi.materializeRecipe(selectedRecipe.id, recipeInputs, {
        taskId: typeof recipeInputs.taskId === 'string' ? recipeInputs.taskId : undefined,
        clientMode: builderContext.clientMode,
      });
      setMaterialized(result);
      setYamlDraft(result.yaml);
      setYamlDryRun(null);
    } catch (error) {
      toast({
        title: 'Failed to build recipe',
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setRecipeBusy(false);
    }
  };

  const saveWorkflow = async (workflow: WorkflowDefinition) => {
    if (!canSaveWorkflow) {
      toast({
        title: 'Workflow write permission required',
        description: 'The current identity cannot save workflow definitions.',
      });
      return;
    }
    await workflowsApi.create(workflow);
    toast({
      title: 'Workflow saved',
      description: `${workflow.name} is available for runs.`,
    });
    onWorkflowCreated();
  };

  const runBuilderDryRun = async () => {
    setBuilderBusy(true);
    try {
      const result = await workflowsApi.dryRun({
        workflow: builderWorkflow,
        context: compactContext(builderContext),
      });
      setBuilderDryRun(result);
      if (result.yaml) setYamlDraft(result.yaml);
    } catch (error) {
      toast({
        title: 'Dry-run failed',
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setBuilderBusy(false);
    }
  };

  const renderBuilderYaml = async () => {
    setBuilderBusy(true);
    try {
      const result = await workflowsApi.renderYaml(builderWorkflow);
      setYamlDraft(result.yaml);
    } catch (error) {
      toast({
        title: 'YAML render failed',
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setBuilderBusy(false);
    }
  };

  const runYamlDryRun = async () => {
    setYamlBusy(true);
    try {
      const result = await workflowsApi.dryRun({
        yaml: yamlDraft,
        context: compactContext(builderContext),
      });
      setYamlDryRun(result);
      if (result.workflow) setBuilderWorkflow(result.workflow);
    } catch (error) {
      toast({
        title: 'YAML dry-run failed',
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setYamlBusy(false);
    }
  };

  return (
    <Tabs defaultValue="recipes" className="w-full">
      <Tabs.List className="w-fit">
        <Tabs.Tab value="recipes" leftSection={<BookOpen className="h-4 w-4" />}>
          Recipes
        </Tabs.Tab>
        <Tabs.Tab value="builder" leftSection={<GitBranch className="h-4 w-4" />}>
          Builder
        </Tabs.Tab>
        <Tabs.Tab value="yaml" leftSection={<FileText className="h-4 w-4" />}>
          YAML
        </Tabs.Tab>
      </Tabs.List>

      <Tabs.Panel value="recipes" pt="md">
        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
          <Stack gap="md">
            <Group justify="space-between" align="center">
              <Title order={2} className="text-lg">
                Recipe Gallery
              </Title>
              <Badge variant="light">{recipes.length} recipes</Badge>
            </Group>

            {recipesLoading ? (
              <Text c="dimmed">Loading recipes...</Text>
            ) : (
              <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
                {recipes.map((recipe) => (
                  <Paper
                    key={recipe.id}
                    className="p-4 transition-colors hover:bg-accent/50"
                    radius="md"
                    withBorder
                  >
                    <Stack gap="sm">
                      <Group justify="space-between" align="flex-start">
                        <Title order={3} className="text-base">
                          {recipe.name}
                        </Title>
                        <Button
                          size="xs"
                          variant={selectedRecipeId === recipe.id ? 'filled' : 'light'}
                          onClick={() => setSelectedRecipeId(recipe.id)}
                        >
                          Select
                        </Button>
                      </Group>
                      <Text size="sm" c="dimmed">
                        {recipe.description}
                      </Text>
                      <Group gap={6}>
                        {recipe.tags.map((tag) => (
                          <Badge key={tag} size="xs" variant="outline">
                            {tag}
                          </Badge>
                        ))}
                      </Group>
                    </Stack>
                  </Paper>
                ))}
              </SimpleGrid>
            )}
          </Stack>

          <Stack gap="md">
            <Title order={2} className="text-lg">
              Recipe Inputs
            </Title>
            {selectedRecipe ? (
              <Paper className="p-4" radius="md" withBorder>
                <Stack gap="sm">
                  <Group justify="space-between" align="center">
                    <Text fw={600}>{selectedRecipe.name}</Text>
                    <Badge variant="outline">{selectedRecipe.id}</Badge>
                  </Group>
                  {selectedRecipe.inputs.map((input) => (
                    <RecipeInputControl
                      key={input.id}
                      input={input}
                      value={recipeInputs[input.id] ?? recipeInputDefault(input)}
                      onChange={(value) =>
                        setRecipeInputs((current) => ({ ...current, [input.id]: value }))
                      }
                    />
                  ))}
                  <Group justify="flex-end">
                    <Button
                      leftSection={<Wand2 className="h-4 w-4" />}
                      loading={recipeBusy}
                      onClick={materializeRecipe}
                    >
                      Build Recipe
                    </Button>
                  </Group>
                </Stack>
              </Paper>
            ) : (
              <Text c="dimmed">No recipe selected</Text>
            )}

            {materialized && (
              <WorkflowMaterializationPreview
                materialized={materialized}
                canSaveWorkflow={canSaveWorkflow}
                onSave={() => saveWorkflow(materialized.workflow)}
              />
            )}
          </Stack>
        </SimpleGrid>
      </Tabs.Panel>

      <Tabs.Panel value="builder" pt="md">
        <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="md">
          <Stack gap="md">
            <WorkflowDefinitionEditor workflow={builderWorkflow} onChange={setBuilderWorkflow} />
          </Stack>

          <Stack gap="md">
            <ContextEditor context={builderContext} onChange={setBuilderContext} />
            <BuilderActions
              canSaveWorkflow={canSaveWorkflow}
              isBusy={builderBusy}
              onDryRun={runBuilderDryRun}
              onRenderYaml={renderBuilderYaml}
              onSave={() => saveWorkflow(builderWorkflow)}
            />
            {builderDryRun && <DryRunResultPanel result={builderDryRun} />}
          </Stack>
        </SimpleGrid>
      </Tabs.Panel>

      <Tabs.Panel value="yaml" pt="md">
        <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="md">
          <Stack gap="md">
            <Group justify="space-between" align="center">
              <Title order={2} className="text-lg">
                YAML Editor
              </Title>
              <Button
                variant="light"
                size="sm"
                leftSection={<FileText className="h-4 w-4" />}
                loading={builderBusy}
                onClick={renderBuilderYaml}
              >
                Render from Builder
              </Button>
            </Group>
            <Textarea
              value={yamlDraft}
              onChange={(event) => setYamlDraft(event.currentTarget.value)}
              minRows={24}
              className="font-mono"
              placeholder="Render a workflow or paste workflow YAML"
            />
            <Group justify="flex-end">
              <Button
                variant="outline"
                leftSection={<Wand2 className="h-4 w-4" />}
                loading={yamlBusy}
                onClick={runYamlDryRun}
              >
                Dry Run YAML
              </Button>
              <Button
                leftSection={<Save className="h-4 w-4" />}
                disabled={!canSaveWorkflow || !yamlDryRun?.workflow || !yamlDryRun.canRun}
                onClick={() => yamlDryRun?.workflow && saveWorkflow(yamlDryRun.workflow)}
              >
                Save YAML Workflow
              </Button>
            </Group>
          </Stack>

          <Stack gap="md">
            <ContextEditor context={builderContext} onChange={setBuilderContext} />
            {yamlDryRun ? (
              <DryRunResultPanel result={yamlDryRun} />
            ) : (
              <Alert color="blue" icon={<FileText className="h-4 w-4" />}>
                YAML dry-run results will appear here.
              </Alert>
            )}
          </Stack>
        </SimpleGrid>
      </Tabs.Panel>
    </Tabs>
  );
}

function RecipeInputControl({
  input,
  value,
  onChange,
}: {
  input: WorkflowRecipeInput;
  value: string | boolean;
  onChange: (value: string | boolean) => void;
}) {
  if (input.type === 'boolean') {
    return (
      <Checkbox
        label={input.label}
        checked={Boolean(value)}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
    );
  }
  if (input.type === 'textarea') {
    return (
      <Textarea
        label={input.label}
        value={String(value ?? '')}
        placeholder={input.placeholder}
        description={input.helpText}
        onChange={(event) => onChange(event.currentTarget.value)}
        minRows={3}
      />
    );
  }
  if (input.type === 'select') {
    return (
      <Select
        label={input.label}
        value={String(value ?? '')}
        data={input.options ?? []}
        placeholder={input.placeholder}
        description={input.helpText}
        onChange={(next) => onChange(next ?? '')}
      />
    );
  }
  return (
    <TextInput
      label={input.label}
      value={String(value ?? '')}
      placeholder={input.placeholder}
      description={input.helpText}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  );
}

function WorkflowMaterializationPreview({
  materialized,
  canSaveWorkflow,
  onSave,
}: {
  materialized: WorkflowRecipeMaterialization;
  canSaveWorkflow: boolean;
  onSave: () => void;
}) {
  return (
    <Paper className="p-4" radius="md" withBorder>
      <Stack gap="sm">
        <Group justify="space-between" align="center">
          <Title order={3} className="text-base">
            {materialized.workflow.name}
          </Title>
          <Button
            size="sm"
            leftSection={<Save className="h-4 w-4" />}
            disabled={!canSaveWorkflow || !materialized.lint.ok}
            onClick={onSave}
          >
            Save Workflow
          </Button>
        </Group>

        <Group gap="sm">
          <Badge variant="outline">{materialized.preview.steps.length} steps</Badge>
          <Badge variant="outline">{materialized.preview.outputTargets.length} outputs</Badge>
          <Badge color={materialized.lint.ok ? 'green' : 'red'} variant="light">
            {materialized.lint.ok ? 'Ready' : `${materialized.lint.summary.errors} errors`}
          </Badge>
        </Group>

        <Divider />

        <Stack gap={6}>
          {materialized.preview.steps.map((step) => (
            <Group key={step.id} justify="space-between">
              <Text size="sm">{step.name}</Text>
              <Badge size="xs" variant="outline">
                {step.type}
              </Badge>
            </Group>
          ))}
        </Stack>

        <Divider />

        <Group gap={6}>
          {materialized.preview.outputTargets.map((target) => (
            <Badge key={target.type} size="sm" variant="light">
              {target.label ?? targetLabel(target.type)}
            </Badge>
          ))}
        </Group>

        <MessageList messages={materialized.lint.messages} />
      </Stack>
    </Paper>
  );
}

function WorkflowDefinitionEditor({
  workflow,
  onChange,
}: {
  workflow: WorkflowDefinition;
  onChange: (workflow: WorkflowDefinition) => void;
}) {
  const agentOptions = workflow.agents.map((agent) => ({
    value: agent.id,
    label: agent.name || agent.id,
  }));
  const schedule = workflow.schedule ?? { mode: 'manual', enabled: false };

  const update = (patch: Partial<WorkflowDefinition>) => onChange({ ...workflow, ...patch });

  const updateAgent = (index: number, patch: Partial<WorkflowAgent>) => {
    update({
      agents: workflow.agents.map((agent, candidateIndex) =>
        candidateIndex === index ? { ...agent, ...patch } : agent
      ),
    });
  };

  const updateStep = (index: number, patch: Partial<WorkflowStep>) => {
    update({
      steps: workflow.steps.map((step, candidateIndex) =>
        candidateIndex === index ? { ...step, ...patch } : step
      ),
    });
  };

  const selectedTargetTypes = (workflow.outputTargets ?? []).map((target) => target.type);

  return (
    <Stack gap="md">
      <Paper className="p-4" radius="md" withBorder>
        <Stack gap="sm">
          <Title order={2} className="text-lg">
            Workflow Definition
          </Title>
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
            <TextInput
              label="ID"
              value={workflow.id}
              onChange={(event) => update({ id: event.currentTarget.value })}
            />
            <TextInput
              label="Name"
              value={workflow.name}
              onChange={(event) => update({ name: event.currentTarget.value })}
            />
          </SimpleGrid>
          <Textarea
            label="Description"
            value={workflow.description}
            onChange={(event) => update({ description: event.currentTarget.value })}
            minRows={2}
          />
        </Stack>
      </Paper>

      <Paper className="p-4" radius="md" withBorder>
        <Stack gap="sm">
          <Group justify="space-between" align="center">
            <Title order={2} className="text-lg">
              Agents
            </Title>
            <Button
              size="xs"
              variant="light"
              leftSection={<Plus className="h-3 w-3" />}
              onClick={() =>
                update({
                  agents: [
                    ...workflow.agents,
                    {
                      id: `agent-${workflow.agents.length + 1}`,
                      name: `Agent ${workflow.agents.length + 1}`,
                      role: 'developer',
                      description: 'Workflow agent',
                      tools: ['Read'],
                    },
                  ],
                })
              }
            >
              Add Agent
            </Button>
          </Group>

          {workflow.agents.map((agent, index) => (
            <div key={`${agent.id}-${index}`} className="border-t pt-3 first:border-t-0 first:pt-0">
              <SimpleGrid cols={{ base: 1, md: 3 }} spacing="sm">
                <TextInput
                  label="ID"
                  value={agent.id}
                  onChange={(event) => updateAgent(index, { id: event.currentTarget.value })}
                />
                <TextInput
                  label="Name"
                  value={agent.name}
                  onChange={(event) => updateAgent(index, { name: event.currentTarget.value })}
                />
                <TextInput
                  label="Role"
                  value={agent.role}
                  onChange={(event) => updateAgent(index, { role: event.currentTarget.value })}
                />
              </SimpleGrid>
              <Group align="end" mt="sm">
                <TextInput
                  className="flex-1"
                  label="Tools"
                  value={(agent.tools ?? []).join(', ')}
                  onChange={(event) =>
                    updateAgent(index, { tools: splitTools(event.currentTarget.value) })
                  }
                />
                <Tooltip label="Remove agent">
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    aria-label={`Remove agent ${agent.name}`}
                    onClick={() =>
                      update({
                        agents: workflow.agents.filter(
                          (_, candidateIndex) => candidateIndex !== index
                        ),
                      })
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </div>
          ))}
        </Stack>
      </Paper>

      <Paper className="p-4" radius="md" withBorder>
        <Stack gap="sm">
          <Group justify="space-between" align="center">
            <Title order={2} className="text-lg">
              Steps
            </Title>
            <Button
              size="xs"
              variant="light"
              leftSection={<Plus className="h-3 w-3" />}
              onClick={() =>
                update({
                  steps: [
                    ...workflow.steps,
                    {
                      id: `step-${workflow.steps.length + 1}`,
                      name: `Step ${workflow.steps.length + 1}`,
                      type: 'agent',
                      agent: workflow.agents[0]?.id,
                      input: '',
                      output: { file: `step-${workflow.steps.length + 1}.md` },
                    },
                  ],
                })
              }
            >
              Add Step
            </Button>
          </Group>

          {workflow.steps.map((step, index) => (
            <div key={`${step.id}-${index}`} className="border-t pt-3 first:border-t-0 first:pt-0">
              <Stack gap="sm">
                <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
                  <TextInput
                    label="ID"
                    value={step.id}
                    onChange={(event) => updateStep(index, { id: event.currentTarget.value })}
                  />
                  <TextInput
                    label="Name"
                    value={step.name}
                    onChange={(event) => updateStep(index, { name: event.currentTarget.value })}
                  />
                  <Select
                    label="Type"
                    value={step.type}
                    data={STEP_TYPE_OPTIONS}
                    onChange={(next) =>
                      updateStep(index, { type: (next ?? 'agent') as WorkflowStep['type'] })
                    }
                  />
                  <Select
                    label="Agent"
                    value={step.agent ?? null}
                    data={agentOptions}
                    disabled={step.type === 'gate' || step.type === 'parallel'}
                    onChange={(next) => updateStep(index, { agent: next ?? undefined })}
                  />
                </SimpleGrid>
                <Textarea
                  label="Input"
                  value={step.input ?? ''}
                  onChange={(event) => updateStep(index, { input: event.currentTarget.value })}
                  minRows={2}
                />
                <Group align="end">
                  <TextInput
                    className="flex-1"
                    label="Output file"
                    value={step.output?.file ?? ''}
                    onChange={(event) =>
                      updateStep(index, {
                        output: event.currentTarget.value
                          ? { file: event.currentTarget.value }
                          : undefined,
                      })
                    }
                  />
                  <Tooltip label="Remove step">
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      aria-label={`Remove step ${step.name}`}
                      onClick={() =>
                        update({
                          steps: workflow.steps.filter(
                            (_, candidateIndex) => candidateIndex !== index
                          ),
                        })
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Stack>
            </div>
          ))}
        </Stack>
      </Paper>

      <Paper className="p-4" radius="md" withBorder>
        <Stack gap="sm">
          <Title order={2} className="text-lg">
            Outputs and Schedule
          </Title>
          <Checkbox.Group
            value={selectedTargetTypes}
            onChange={(types) =>
              update({
                outputTargets: types.map((type) => {
                  const typed = type as WorkflowOutputTargetType;
                  return (
                    workflow.outputTargets?.find((target) => target.type === typed) ?? {
                      type: typed,
                      label: targetLabel(typed),
                    }
                  );
                }),
              })
            }
          >
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
              {OUTPUT_TARGETS.map((target) => (
                <Checkbox key={target.value} value={target.value} label={target.label} />
              ))}
            </SimpleGrid>
          </Checkbox.Group>

          {selectedTargetTypes.includes('work-product') && (
            <TextInput
              label="Work product path"
              value={
                workflow.outputTargets?.find((target) => target.type === 'work-product')?.path ?? ''
              }
              onChange={(event) =>
                update({
                  outputTargets: upsertTarget(workflow.outputTargets, 'work-product', {
                    path: event.currentTarget.value,
                  }),
                })
              }
            />
          )}

          {selectedTargetTypes.includes('notification') && (
            <TextInput
              label="Notification channel"
              value={
                workflow.outputTargets?.find((target) => target.type === 'notification')?.channel ??
                ''
              }
              onChange={(event) =>
                update({
                  outputTargets: upsertTarget(workflow.outputTargets, 'notification', {
                    channel: event.currentTarget.value,
                  }),
                })
              }
            />
          )}

          <Divider />

          <Group justify="space-between" align="center">
            <Group gap="xs">
              <Calendar className="h-4 w-4" />
              <Text fw={600}>Schedule</Text>
            </Group>
            <Switch
              checked={Boolean(schedule.enabled)}
              onChange={(event) =>
                update({
                  schedule: {
                    ...schedule,
                    enabled: event.currentTarget.checked,
                    mode:
                      event.currentTarget.checked && schedule.mode === 'manual'
                        ? 'weekly'
                        : schedule.mode,
                  },
                })
              }
            />
          </Group>

          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
            <Select
              label="Mode"
              value={schedule.mode}
              data={SCHEDULE_OPTIONS}
              disabled={!schedule.enabled}
              onChange={(next) =>
                update({
                  schedule: { ...schedule, mode: (next ?? 'manual') as WorkflowSchedule['mode'] },
                })
              }
            />
            <TextInput
              label="Timezone"
              value={schedule.timezone ?? ''}
              disabled={!schedule.enabled}
              onChange={(event) =>
                update({ schedule: { ...schedule, timezone: event.currentTarget.value } })
              }
            />
            <TextInput
              label="Cron"
              value={schedule.cronExpr ?? ''}
              disabled={!schedule.enabled}
              onChange={(event) =>
                update({ schedule: { ...schedule, cronExpr: event.currentTarget.value } })
              }
            />
            <NumberInput
              label="Snapshot retention"
              value={schedule.snapshotRetention ?? ''}
              min={1}
              disabled={!schedule.enabled}
              onChange={(value) =>
                update({
                  schedule: {
                    ...schedule,
                    snapshotRetention: typeof value === 'number' ? value : undefined,
                  },
                })
              }
            />
          </SimpleGrid>
        </Stack>
      </Paper>
    </Stack>
  );
}

function ContextEditor({
  context,
  onChange,
}: {
  context: BuilderContext;
  onChange: (context: BuilderContext) => void;
}) {
  return (
    <Paper className="p-4" radius="md" withBorder>
      <Stack gap="sm">
        <Title order={2} className="text-lg">
          Dry Run Context
        </Title>
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
          <TextInput
            label="Task ID"
            value={context.taskId}
            onChange={(event) => onChange({ ...context, taskId: event.currentTarget.value })}
          />
          <Select
            label="Client mode"
            value={context.clientMode}
            data={CLIENT_MODE_OPTIONS}
            onChange={(next) =>
              onChange({
                ...context,
                clientMode: (next ?? 'local') as BuilderContext['clientMode'],
              })
            }
          />
        </SimpleGrid>
      </Stack>
    </Paper>
  );
}

function BuilderActions({
  canSaveWorkflow,
  isBusy,
  onDryRun,
  onRenderYaml,
  onSave,
}: {
  canSaveWorkflow: boolean;
  isBusy: boolean;
  onDryRun: () => void;
  onRenderYaml: () => void;
  onSave: () => void;
}) {
  return (
    <Paper className="p-4" radius="md" withBorder>
      <Group justify="flex-end">
        <Button
          variant="light"
          leftSection={<FileText className="h-4 w-4" />}
          loading={isBusy}
          onClick={onRenderYaml}
        >
          Render YAML
        </Button>
        <Button
          variant="outline"
          leftSection={<Wand2 className="h-4 w-4" />}
          loading={isBusy}
          onClick={onDryRun}
        >
          Dry Run
        </Button>
        <Button
          leftSection={<Save className="h-4 w-4" />}
          disabled={!canSaveWorkflow}
          onClick={onSave}
        >
          Save Workflow
        </Button>
      </Group>
    </Paper>
  );
}

function DryRunResultPanel({ result }: { result: WorkflowDryRunResult }) {
  const statusColor =
    result.status === 'ready' ? 'green' : result.status === 'attention' ? 'yellow' : 'red';
  return (
    <Paper className="p-4" radius="md" withBorder>
      <Stack gap="sm">
        <Group justify="space-between" align="center">
          <Title order={2} className="text-lg">
            Dry Run
          </Title>
          <Badge color={statusColor} variant="light">
            {result.status}
          </Badge>
        </Group>
        <Group gap="sm">
          <Badge color={result.summary.errors ? 'red' : 'gray'} variant="outline">
            {result.summary.errors} errors
          </Badge>
          <Badge color={result.summary.warnings ? 'yellow' : 'gray'} variant="outline">
            {result.summary.warnings} warnings
          </Badge>
          <Badge color={result.canRun ? 'green' : 'red'} variant="outline">
            {result.canRun ? 'Can run' : 'Blocked'}
          </Badge>
        </Group>

        {result.skillAudit && (
          <Stack gap={4}>
            <Group gap="xs">
              <Badge
                color={
                  result.skillAudit.status === 'fail'
                    ? 'red'
                    : result.skillAudit.status === 'warn'
                      ? 'yellow'
                      : 'green'
                }
                variant="light"
              >
                Skill audit {result.skillAudit.status}
              </Badge>
              <Text size="xs" c="dimmed">
                {result.skillAudit.references.length} referenced skills · {result.skillAudit.mode}{' '}
                mode
              </Text>
            </Group>
            {result.skillAudit.references.length > 0 && (
              <Group gap={4}>
                {result.skillAudit.references.slice(0, 4).map((reference) => (
                  <Badge
                    key={reference.reference}
                    size="xs"
                    color={
                      reference.status === 'blocked' || reference.status === 'missing'
                        ? 'red'
                        : reference.status === 'warning' || reference.status === 'unscanned'
                          ? 'yellow'
                          : 'green'
                    }
                    variant="light"
                  >
                    {reference.name ?? reference.reference}: {reference.status}
                  </Badge>
                ))}
              </Group>
            )}
          </Stack>
        )}

        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xs">
          {result.checks.map((check) => (
            <Alert
              key={check.id}
              color={check.status === 'fail' ? 'red' : check.status === 'warn' ? 'yellow' : 'green'}
              icon={
                check.status === 'fail' ? (
                  <XCircle className="h-4 w-4" />
                ) : check.status === 'warn' ? (
                  <AlertTriangle className="h-4 w-4" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )
              }
            >
              <Text fw={600} size="sm">
                {check.label}
              </Text>
              <Text size="sm">{check.detail}</Text>
            </Alert>
          ))}
        </SimpleGrid>

        <MessageList messages={result.messages} />
      </Stack>
    </Paper>
  );
}

function MessageList({ messages }: { messages: WorkflowLintMessage[] }) {
  if (messages.length === 0) {
    return (
      <Alert color="green" icon={<CheckCircle2 className="h-4 w-4" />}>
        No lint messages.
      </Alert>
    );
  }
  return (
    <ScrollArea.Autosize mah={280}>
      <Stack gap="xs">
        {messages.map((item) => (
          <Alert
            key={item.id}
            color={messageColor(item.severity)}
            icon={messageIcon(item.severity)}
          >
            <Group gap="xs" mb={4}>
              <Badge size="xs" variant="outline">
                {item.category}
              </Badge>
              <Text size="sm" fw={600}>
                {item.path}
              </Text>
            </Group>
            <Text size="sm">{item.message}</Text>
            <Text size="xs" c="dimmed" mt={4}>
              {item.remediation}
            </Text>
          </Alert>
        ))}
      </Stack>
    </ScrollArea.Autosize>
  );
}
