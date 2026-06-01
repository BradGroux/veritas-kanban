import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  ActionIcon,
  Alert,
  Code,
  Group,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
} from '@mantine/core';
import { Button } from '@/components/ui/button';
import { useTaskTypes, getTypeIcon } from '@/hooks/useTaskTypes';
import { useProjects } from '@/hooks/useProjects';
import { useSprints } from '@/hooks/useSprints';
import { useConfig } from '@/hooks/useConfig';
import { useTemplateForm } from '@/hooks/useTemplateForm';
import { useCreateTaskForm } from '@/hooks/useCreateTaskForm';
import { BlueprintPreview } from './create/BlueprintPreview';
import { TemplateVariableInputs } from './create/TemplateVariableInputs';
import type { TaskPriority } from '@veritas-kanban/shared';
import {
  AlertTriangle,
  Bug,
  Check,
  ExternalLink,
  FileText,
  HelpCircle,
  Info,
  Loader2,
  Sparkles,
  RefreshCw,
  X,
} from 'lucide-react';
import { getCategoryIcon } from '@/lib/template-categories';
import { api, type SearchResult } from '@/lib/api';
import { extractTaskId } from '@/lib/search-utils';
import { Badge } from '@/components/ui/badge';
import { useView } from '@/contexts/ViewContext';

interface CreateTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const priorityOptions: { value: TaskPriority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

export function CreateTaskDialog({ open, onOpenChange }: CreateTaskDialogProps) {
  const { navigateToTask } = useView();
  const [duplicateResults, setDuplicateResults] = useState<SearchResult[]>([]);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [isCheckingDuplicates, setIsCheckingDuplicates] = useState(false);
  // Consolidated form state via useReducer
  const {
    state: formState,
    setTitle,
    setDescription,
    setType,
    setPriority,
    setProject,
    setSprint,
    setAgent,
    setCategoryFilter,
    setNewProjectName,
    toggleHelp,
    showNewProject: onShowNewProject,
    hideNewProject,
    applyTemplate: applyFormDefaults,
    reset: resetForm,
    canSubmit,
  } = useCreateTaskForm();

  const {
    title,
    description,
    type,
    priority,
    project,
    sprint,
    agent,
    categoryFilter,
    showHelp,
    showNewProject,
    newProjectName,
  } = formState;

  const { data: taskTypes = [] } = useTaskTypes();
  const { data: projects = [] } = useProjects();
  const { data: sprints = [] } = useSprints();
  const { data: config } = useConfig();

  const {
    selectedTemplate,
    templates,
    subtasks,
    customVars,
    requiredCustomVars,
    applyTemplate,
    clearTemplate,
    removeSubtask,
    setCustomVars,
    createTasks,
    isCreating,
  } = useTemplateForm();

  // Filter templates by selected category
  const filteredTemplates = useMemo(() => {
    if (!templates) return [];
    if (categoryFilter === 'all') return templates;
    return templates.filter((t) => (t.category || 'custom') === categoryFilter);
  }, [templates, categoryFilter]);

  const templateOptions = useMemo(
    () => [
      { value: 'none', label: 'No template' },
      ...filteredTemplates.map((template) => ({
        value: template.id,
        label: `${template.category ? `${getCategoryIcon(template.category)} ` : ''}${
          template.name
        }${template.description ? ` - ${template.description}` : ''}`,
      })),
    ],
    [filteredTemplates]
  );

  const taskTypeOptions = useMemo(
    () => taskTypes.map((taskType) => ({ value: taskType.id, label: taskType.label })),
    [taskTypes]
  );

  const projectOptions = useMemo(() => {
    const options = [
      { value: '__none__', label: 'No project' },
      ...projects.map((proj) => ({ value: proj.id, label: proj.label })),
    ];

    if (project && !projects.some((proj) => proj.id === project)) {
      options.push({ value: project, label: project });
    }

    options.push({ value: '__new__', label: '+ New Project' });
    return options;
  }, [project, projects]);

  const sprintOptions = useMemo(
    () => [
      { value: '__none__', label: 'No Sprint' },
      ...sprints.map((s) => ({ value: s.id, label: s.label })),
    ],
    [sprints]
  );

  const agentOptions = useMemo(
    () => [
      { value: 'auto', label: 'Auto (routing)' },
      ...(config?.agents ?? [])
        .filter((enabledAgent) => enabledAgent.enabled)
        .map((enabledAgent) => ({
          value: enabledAgent.type,
          label: enabledAgent.name,
        })),
    ],
    [config?.agents]
  );

  const handleTemplateSelect = (templateId: string) => {
    if (templateId === 'none') {
      clearTemplate();
      return;
    }

    const template = templates?.find((t) => t.id === templateId);
    if (!template) return;

    const defaults = applyTemplate(template);
    // Apply template defaults to form state atomically
    applyFormDefaults({
      type: defaults.type || type,
      priority: defaults.priority || priority,
      project: defaults.project || project,
      description: defaults.description || description,
    });
  };

  const currentTemplate = selectedTemplate
    ? templates?.find((t) => t.id === selectedTemplate)
    : null;
  const isBlueprint = Boolean(currentTemplate?.blueprint && currentTemplate.blueprint.length > 0);

  useEffect(() => {
    const query = [title, description].filter(Boolean).join(' ').trim();
    if (!open || isBlueprint || title.trim().length < 4) {
      setDuplicateResults([]);
      setDuplicateError(null);
      setIsCheckingDuplicates(false);
      return;
    }

    let cancelled = false;
    setIsCheckingDuplicates(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await api.search.query({
          query,
          backend: 'auto',
          collections: ['tasks-active', 'tasks-archive'],
          limit: 5,
        });

        if (cancelled) return;
        const normalizedTitle = title.trim().toLowerCase();
        setDuplicateResults(
          response.results
            .filter((result) => result.title.trim().toLowerCase() !== normalizedTitle)
            .slice(0, 3)
        );
        setDuplicateError(response.degraded ? response.reason || null : null);
      } catch (err) {
        if (cancelled) return;
        setDuplicateResults([]);
        setDuplicateError(err instanceof Error ? err.message : 'Duplicate check failed');
      } finally {
        if (!cancelled) setIsCheckingDuplicates(false);
      }
    }, 500);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [description, isBlueprint, open, title]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Use computed canSubmit instead of inline check
    if (!canSubmit(isBlueprint)) {
      return;
    }

    await createTasks(title, description, project, sprint, type, priority, agent);

    // Reset form state atomically
    resetForm();
    clearTemplate();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create New Task</DialogTitle>
          </DialogHeader>

          {/* Template selector */}
          {templates && templates.length > 0 && (
            <Stack gap="sm" className="border-b pb-2">
              <Group justify="space-between" gap="sm">
                <Group gap="xs">
                  <ThemeIcon size="sm" variant="light" color="violet">
                    <FileText className="h-3.5 w-3.5" />
                  </ThemeIcon>
                  <Text size="sm" fw={500}>
                    Template
                  </Text>
                </Group>
                <ActionIcon
                  type="button"
                  variant="subtle"
                  size="sm"
                  onClick={toggleHelp}
                  aria-label={showHelp ? 'Hide template help' : 'Show template help'}
                >
                  <HelpCircle className="h-4 w-4 text-muted-foreground" />
                </ActionIcon>
              </Group>

              {/* Help Section */}
              {showHelp && (
                <Alert
                  variant="light"
                  color="blue"
                  icon={<Info className="h-4 w-4" />}
                  title="Using Templates"
                >
                  <Stack gap={4}>
                    <Text component="div" size="xs" c="dimmed">
                      <ul className="space-y-1">
                        <li>
                          <strong>Simple templates</strong> pre-fill task fields and can include
                          subtasks
                        </li>
                        <li>
                          <strong>Variables</strong> like <Code>{'{{date}}'}</Code> or{' '}
                          <Code>{'{{author}}'}</Code> are replaced when creating the task
                        </li>
                        <li>
                          <strong>Custom variables</strong> such as <Code>{'{{bugId}}'}</Code>{' '}
                          prompt you for values
                        </li>
                        <li>
                          <strong>Blueprint templates</strong> create multiple linked tasks with
                          dependencies
                        </li>
                      </ul>
                    </Text>
                  </Stack>
                </Alert>
              )}

              <Tabs value={categoryFilter} onChange={(value) => setCategoryFilter(value ?? 'all')}>
                <Tabs.List grow>
                  <Tabs.Tab value="all">All</Tabs.Tab>
                  <Tabs.Tab value="bug" aria-label="Bug templates">
                    <Bug className="h-4 w-4" />
                  </Tabs.Tab>
                  <Tabs.Tab value="feature" aria-label="Feature templates">
                    <Sparkles className="h-4 w-4" />
                  </Tabs.Tab>
                  <Tabs.Tab value="sprint" aria-label="Sprint templates">
                    <RefreshCw className="h-4 w-4" />
                  </Tabs.Tab>
                </Tabs.List>
              </Tabs>

              <Select
                value={selectedTemplate || 'none'}
                onChange={(value) => handleTemplateSelect(value ?? 'none')}
                data={templateOptions}
                placeholder="Select template..."
                checkIconPosition="right"
              />
            </Stack>
          )}

          {/* Blueprint preview or regular form */}
          <Stack gap="md" py="md">
            {isBlueprint ? (
              currentTemplate ? (
                <>
                  <BlueprintPreview template={currentTemplate} />
                  <TemplateVariableInputs
                    variables={requiredCustomVars}
                    values={customVars}
                    onChange={(name, value) =>
                      setCustomVars((prev) => ({ ...prev, [name]: value }))
                    }
                  />
                </>
              ) : null
            ) : (
              <>
                <TextInput
                  id="title"
                  label="Title"
                  value={title}
                  onChange={(event) => setTitle(event.currentTarget.value)}
                  placeholder="Enter task title..."
                  autoFocus
                />

                <Textarea
                  id="description"
                  label="Description"
                  value={description}
                  onChange={(event) => setDescription(event.currentTarget.value)}
                  placeholder="Describe the task..."
                  rows={3}
                />

                {(isCheckingDuplicates || duplicateResults.length > 0 || duplicateError) && (
                  <Alert
                    color="yellow"
                    variant="light"
                    icon={<AlertTriangle className="h-4 w-4" aria-hidden="true" />}
                    title={
                      <Group justify="space-between" gap="sm">
                        <Text size="sm" fw={600}>
                          Possible duplicates
                        </Text>
                        {isCheckingDuplicates && (
                          <Loader2
                            className="h-4 w-4 animate-spin text-muted-foreground"
                            aria-label="Checking duplicates"
                          />
                        )}
                      </Group>
                    }
                  >
                    <Stack gap="sm" mt={duplicateResults.length > 0 ? 'xs' : 0}>
                      {isCheckingDuplicates && (
                        <Text size="sm" c="dimmed">
                          Checking existing tasks...
                        </Text>
                      )}
                      {duplicateResults.length > 0 ? (
                        duplicateResults.map((result) => {
                          const taskId = extractTaskId(result.path);
                          return (
                            <Paper
                              key={`${result.collection}:${result.id}`}
                              component="button"
                              type="button"
                              withBorder
                              radius="md"
                              p="sm"
                              className="flex w-full items-start gap-2 bg-background text-left transition-colors hover:bg-muted/50"
                              onClick={() => {
                                if (!taskId) return;
                                navigateToTask(taskId);
                                onOpenChange(false);
                              }}
                            >
                              <span className="min-w-0 flex-1">
                                <span className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-medium">{result.title}</span>
                                  <Badge variant="secondary">{result.collection}</Badge>
                                </span>
                                <span className="mt-1 block break-all text-xs text-muted-foreground">
                                  {result.path}
                                </span>
                                {result.snippet && (
                                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                                    {result.snippet}
                                  </span>
                                )}
                              </span>
                              {taskId && (
                                <ExternalLink
                                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
                                  aria-hidden="true"
                                />
                              )}
                            </Paper>
                          );
                        })
                      ) : !isCheckingDuplicates ? (
                        <Text size="sm" c="dimmed">
                          No likely task duplicates found.
                        </Text>
                      ) : null}
                      {duplicateError && (
                        <Text size="xs" c="dimmed">
                          {duplicateError}
                        </Text>
                      )}
                    </Stack>
                  </Alert>
                )}

                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                  <Select
                    label="Type"
                    value={type}
                    onChange={(value) => setType(value ?? 'code')}
                    data={taskTypeOptions}
                    renderOption={({ option }) => {
                      const taskType = taskTypes.find((item) => item.id === option.value);
                      const IconComponent = taskType ? getTypeIcon(taskType.icon) : null;
                      return (
                        <Group gap="xs">
                          {IconComponent && <IconComponent className="h-4 w-4" />}
                          <span>{option.label}</span>
                        </Group>
                      );
                    }}
                    checkIconPosition="right"
                  />

                  <Select
                    label="Priority"
                    value={priority}
                    onChange={(value) => setPriority((value ?? 'medium') as TaskPriority)}
                    data={priorityOptions}
                    checkIconPosition="right"
                  />
                </SimpleGrid>

                <Stack gap="xs">
                  {!showNewProject ? (
                    <Select
                      label="Project (optional)"
                      value={project || '__none__'}
                      onChange={(value) => {
                        if (value === '__new__') {
                          onShowNewProject();
                        } else {
                          setProject(value === '__none__' ? '' : (value ?? ''));
                        }
                      }}
                      data={projectOptions}
                      placeholder="Select project..."
                      checkIconPosition="right"
                    />
                  ) : (
                    <Group gap="sm" align="end" wrap="nowrap">
                      <TextInput
                        label="New project"
                        value={newProjectName}
                        onChange={(event) => setNewProjectName(event.currentTarget.value)}
                        placeholder="Enter project name..."
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && newProjectName.trim()) {
                            e.preventDefault();
                            setProject(newProjectName.trim());
                          }
                          if (e.key === 'Escape') {
                            hideNewProject();
                          }
                        }}
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          if (newProjectName.trim()) {
                            setProject(newProjectName.trim());
                          }
                        }}
                      >
                        Add
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={hideNewProject}>
                        Cancel
                      </Button>
                    </Group>
                  )}
                </Stack>

                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                  <Select
                    label="Sprint (optional)"
                    value={sprint || '__none__'}
                    onChange={(value) => setSprint(value === '__none__' ? '' : (value ?? ''))}
                    data={sprintOptions}
                    placeholder="No sprint"
                    checkIconPosition="right"
                  />

                  <Select
                    label="Agent"
                    value={agent || 'auto'}
                    onChange={(value) => setAgent(value ?? 'auto')}
                    data={agentOptions}
                    checkIconPosition="right"
                  />
                </SimpleGrid>

                <TemplateVariableInputs
                  variables={requiredCustomVars}
                  values={customVars}
                  onChange={(name, value) => setCustomVars((prev) => ({ ...prev, [name]: value }))}
                />

                {subtasks.length > 0 && (
                  <Stack gap="xs">
                    <Text size="sm" fw={500}>
                      Subtasks ({subtasks.length})
                    </Text>
                    <Paper withBorder radius="md" p="xs">
                      <ScrollArea.Autosize mah={160} type="auto">
                        <Stack gap={4}>
                          {subtasks.map((subtask) => (
                            <Group
                              key={subtask.id}
                              justify="space-between"
                              gap="sm"
                              wrap="nowrap"
                              className="rounded px-2 py-1 transition-colors hover:bg-muted/50"
                            >
                              <Group gap="xs" className="min-w-0 flex-1" wrap="nowrap">
                                <Check className="h-3 w-3 shrink-0 text-muted-foreground" />
                                <Text size="sm" truncate>
                                  {subtask.title}
                                </Text>
                              </Group>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                onClick={() => removeSubtask(subtask.id)}
                                aria-label={`Remove subtask: ${subtask.title}`}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </Group>
                          ))}
                        </Stack>
                      </ScrollArea.Autosize>
                    </Paper>
                  </Stack>
                )}
              </>
            )}
          </Stack>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit(isBlueprint) || isCreating}>
              {isCreating ? 'Creating...' : isBlueprint ? 'Create Tasks' : 'Create Task'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
