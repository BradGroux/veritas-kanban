import { useState, useMemo } from 'react';
import {
  Alert,
  Button,
  Code,
  Group,
  Modal,
  Paper,
  Select,
  Stack,
  Switch,
  Tabs,
  Text,
  TextInput,
  ThemeIcon,
} from '@mantine/core';
import { useTemplates } from '@/hooks/useTemplates';
import { useUpdateTask } from '@/hooks/useTasks';
import type { Task, Subtask } from '@veritas-kanban/shared';
import {
  FileCode,
  AlertCircle,
  Plus,
  Minus,
  HelpCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { nanoid } from 'nanoid';
import { api } from '@/lib/api';
import {
  interpolateVariables,
  extractCustomVariables,
  type VariableContext,
} from '@/lib/template-variables';
import { getCategoryIcon } from '@/lib/template-categories';

interface ApplyTemplateDialogProps {
  task: Task;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplied?: () => void;
}

interface MergedField {
  field: string;
  label: string;
  before: string | undefined;
  after: string;
  willChange: boolean;
}

interface MergePreview {
  fields: MergedField[];
  subtasksAdded: number;
  existingSubtasks: number;
}

export function ApplyTemplateDialog({
  task,
  open,
  onOpenChange,
  onApplied,
}: ApplyTemplateDialogProps) {
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [customVars, setCustomVars] = useState<Record<string, string>>({});
  const [requiredCustomVars, setRequiredCustomVars] = useState<string[]>([]);
  const [forceOverwrite, setForceOverwrite] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const { data: templates } = useTemplates();
  const updateTask = useUpdateTask();

  // Filter templates by selected category
  const filteredTemplates = useMemo(() => {
    if (!templates) return [];
    if (categoryFilter === 'all') return templates;
    return templates.filter((t) => (t.category || 'custom') === categoryFilter);
  }, [templates, categoryFilter]);

  const templateOptions = useMemo(
    () => [
      { value: 'none', label: 'No template selected' },
      ...filteredTemplates
        .filter((t) => !t.blueprint)
        .map((template) => ({
          value: template.id,
          label: `${template.category ? `${getCategoryIcon(template.category)} ` : ''}${
            template.name
          }${template.description ? ` - ${template.description}` : ''}`,
        })),
    ],
    [filteredTemplates]
  );

  // Get the selected template
  const template = useMemo(() => {
    if (!selectedTemplate || !templates) return null;
    return templates.find((t) => t.id === selectedTemplate) || null;
  }, [selectedTemplate, templates]);

  // Calculate merge preview
  const mergePreview = useMemo((): MergePreview | null => {
    if (!template) return null;

    // Build variable context
    const context: VariableContext = {
      project: task.project,
      author: 'User',
      customVars,
    };

    const fields: MergedField[] = [];

    // Title
    if (template.taskDefaults.descriptionTemplate) {
      const interpolatedTitle = task.title;
      const willChange = forceOverwrite || !task.title;
      fields.push({
        field: 'title',
        label: 'Title',
        before: task.title,
        after: interpolatedTitle,
        willChange,
      });
    }

    // Description
    if (template.taskDefaults.descriptionTemplate) {
      const interpolatedDescription = interpolateVariables(
        template.taskDefaults.descriptionTemplate,
        context
      );
      const willChange = forceOverwrite || !task.description;
      fields.push({
        field: 'description',
        label: 'Description',
        before: task.description,
        after: interpolatedDescription,
        willChange,
      });
    }

    // Type
    if (template.taskDefaults.type) {
      const willChange = forceOverwrite || !task.type;
      fields.push({
        field: 'type',
        label: 'Type',
        before: task.type,
        after: template.taskDefaults.type,
        willChange,
      });
    }

    // Priority
    if (template.taskDefaults.priority) {
      const willChange = forceOverwrite || !task.priority;
      fields.push({
        field: 'priority',
        label: 'Priority',
        before: task.priority,
        after: template.taskDefaults.priority,
        willChange,
      });
    }

    // Project
    if (template.taskDefaults.project) {
      const willChange = forceOverwrite || !task.project;
      fields.push({
        field: 'project',
        label: 'Project',
        before: task.project,
        after: template.taskDefaults.project,
        willChange,
      });
    }

    // Subtasks
    const subtasksAdded = template.subtaskTemplates?.length || 0;
    const existingSubtasks = task.subtasks?.length || 0;

    return {
      fields: fields.filter((f) => f.willChange),
      subtasksAdded,
      existingSubtasks,
    };
  }, [template, task, customVars, forceOverwrite]);

  // Handle template selection
  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplate(templateId);

    const selected = templates?.find((t) => t.id === templateId);
    if (!selected) return;

    // Extract custom variables from description template and subtasks
    const allTemplateText = [
      selected.taskDefaults.descriptionTemplate || '',
      ...(selected.subtaskTemplates?.map((st) => st.title) || []),
      ...(selected.subtaskTemplates?.flatMap((st) => st.acceptanceCriteria || []) || []),
    ].join(' ');

    const customVarNames = extractCustomVariables(allTemplateText);
    setRequiredCustomVars(customVarNames);

    // Initialize custom vars
    const initialCustomVars: Record<string, string> = {};
    customVarNames.forEach((name) => {
      initialCustomVars[name] = '';
    });
    setCustomVars(initialCustomVars);
  };

  // Apply the template
  const handleApply = async () => {
    if (!template) return;

    // Build variable context
    const context: VariableContext = {
      project: task.project,
      author: 'User',
      customVars,
    };

    // Build update input based on merge strategy
    const updates: Record<string, unknown> = {};

    // Description
    if (template.taskDefaults.descriptionTemplate) {
      const interpolated = interpolateVariables(template.taskDefaults.descriptionTemplate, context);
      if (forceOverwrite || !task.description) {
        updates.description = interpolated;
      }
    }

    // Type
    if (template.taskDefaults.type && (forceOverwrite || !task.type)) {
      updates.type = template.taskDefaults.type;
    }

    // Priority
    if (template.taskDefaults.priority && (forceOverwrite || !task.priority)) {
      updates.priority = template.taskDefaults.priority;
    }

    // Project
    if (template.taskDefaults.project && (forceOverwrite || !task.project)) {
      updates.project = template.taskDefaults.project;
    }

    // Subtasks - APPEND to existing
    if (template.subtaskTemplates && template.subtaskTemplates.length > 0) {
      const now = new Date().toISOString();
      const newSubtasks: Subtask[] = template.subtaskTemplates
        .sort((a, b) => a.order - b.order)
        .map((st) => ({
          id: nanoid(),
          title: interpolateVariables(st.title, context),
          completed: false,
          created: now,
          ...(st.acceptanceCriteria?.length && {
            acceptanceCriteria: st.acceptanceCriteria.map((criterion) =>
              interpolateVariables(criterion, context)
            ),
            criteriaChecked: new Array(st.acceptanceCriteria.length).fill(false),
          }),
        }));

      // Append to existing subtasks
      const existingSubtasks = task.subtasks || [];
      updates.subtasks = [...existingSubtasks, ...newSubtasks];
    }

    // Apply the updates
    await updateTask.mutateAsync({
      id: task.id,
      input: updates,
    });

    // Track which fields were changed for activity logging
    const changedFields = Object.keys(updates);

    // Log activity
    try {
      await api.tasks.applyTemplate(task.id, template.id, template.name, changedFields);
    } catch (error) {
      // Intentionally non-fatal: don't fail the whole operation if activity logging fails
      console.error('Failed to log template application:', error);
    }

    // Close dialog and notify parent
    onOpenChange(false);
    onApplied?.();

    // Reset state
    setSelectedTemplate(null);
    setCustomVars({});
    setRequiredCustomVars([]);
    setForceOverwrite(false);
  };

  return (
    <Modal
      opened={open}
      onClose={() => onOpenChange(false)}
      title={
        <Group gap="xs">
          <FileCode className="h-5 w-5" />
          <Text fw={600}>Apply Template to Task</Text>
        </Group>
      }
      size="lg"
    >
      <Stack gap="md">
        <Group justify="flex-end">
          <Button
            variant="subtle"
            size="xs"
            color="gray"
            onClick={() => setShowHelp(!showHelp)}
            leftSection={<HelpCircle className="h-4 w-4" />}
            rightSection={
              showHelp ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
            }
          >
            Help
          </Button>
        </Group>

        {showHelp && (
          <Alert
            color="blue"
            variant="light"
            icon={<AlertCircle className="h-4 w-4" />}
            title="Apply Template Guide"
          >
            <Stack gap="xs">
              <Text size="xs" c="dimmed">
                <strong>Safe by Default:</strong> Templates only fill in empty fields. Existing task
                data is not overwritten unless you choose to.
              </Text>
              <Text size="xs" c="dimmed">
                <strong>Force Overwrite:</strong> Toggle this on to replace existing values with
                template values. The preview shows exactly what will be modified.
              </Text>
              <Text size="xs" c="dimmed">
                <strong>Subtasks:</strong> Template subtasks are added to your existing subtasks.
              </Text>
              <Text size="xs" c="dimmed">
                <strong>Variables:</strong> Templates with <Code>{'{{date}}'}</Code> or{' '}
                <Code>{'{{custom:name}}'}</Code> prompt for values before applying.
              </Text>
              <Text size="xs" c="dimmed">
                <strong>Changes Preview:</strong> A before/after diff appears below showing exactly
                what will change.
              </Text>
            </Stack>
          </Alert>
        )}

        <Stack gap="md">
          <Stack gap="sm">
            <Text size="sm" fw={500}>
              Select Template
            </Text>
            <Tabs value={categoryFilter} onChange={(value) => setCategoryFilter(value ?? 'all')}>
              <Tabs.List grow>
                <Tabs.Tab value="all">All</Tabs.Tab>
                <Tabs.Tab value="bug" aria-label="Bug templates">
                  Bug
                </Tabs.Tab>
                <Tabs.Tab value="feature" aria-label="Feature templates">
                  Feature
                </Tabs.Tab>
                <Tabs.Tab value="sprint" aria-label="Sprint templates">
                  Sprint
                </Tabs.Tab>
              </Tabs.List>
            </Tabs>
            <Select
              value={selectedTemplate || 'none'}
              onChange={(value) => {
                if (!value || value === 'none') {
                  setSelectedTemplate(null);
                } else {
                  handleTemplateSelect(value);
                }
              }}
              data={templateOptions}
              label="Template"
              placeholder="Choose a template..."
              checkIconPosition="right"
            />
          </Stack>

          {requiredCustomVars.length > 0 && (
            <Paper className="bg-muted/30 p-3" radius="md" withBorder>
              <Stack gap="sm">
                <Group gap="xs">
                  <ThemeIcon size="sm" color="blue" variant="light">
                    <AlertCircle className="h-4 w-4" />
                  </ThemeIcon>
                  <Text size="sm" fw={500}>
                    Template Variables
                  </Text>
                </Group>
                {requiredCustomVars.map((varName) => (
                  <TextInput
                    key={varName}
                    id={`var-${varName}`}
                    label={varName}
                    value={customVars[varName] || ''}
                    onChange={(e) =>
                      setCustomVars((prev) => ({ ...prev, [varName]: e.currentTarget.value }))
                    }
                    placeholder={`Enter ${varName}...`}
                    size="xs"
                  />
                ))}
              </Stack>
            </Paper>
          )}

          {template && (
            <Paper className="bg-muted/30 p-3" radius="md" withBorder>
              <Group justify="space-between" gap="sm" wrap="nowrap">
                <Stack gap={2}>
                  <Text size="sm" fw={500}>
                    Force Overwrite
                  </Text>
                  <Text size="xs" c="dimmed">
                    Replace existing values with template values
                  </Text>
                </Stack>
                <Switch
                  checked={forceOverwrite}
                  onChange={(event) => setForceOverwrite(event.currentTarget.checked)}
                  aria-label="Force overwrite"
                />
              </Group>
            </Paper>
          )}

          {mergePreview && mergePreview.fields.length > 0 && (
            <Paper className="bg-muted/30 p-3" radius="md" withBorder>
              <Stack gap="sm">
                <Group gap="xs">
                  <ThemeIcon size="sm" color="blue" variant="light">
                    <AlertCircle className="h-4 w-4" />
                  </ThemeIcon>
                  <Text size="sm" fw={500}>
                    Changes Preview
                  </Text>
                </Group>

                {mergePreview.fields.map((field) => (
                  <div key={field.field} className="border-l-2 border-primary/50 py-1 pl-3">
                    <Text size="xs" c="dimmed" fw={600} tt="uppercase">
                      {field.label}
                    </Text>
                    <Group align="flex-start" gap="xs" mt={4} wrap="nowrap">
                      <Minus className="mt-0.5 h-3 w-3 flex-shrink-0 text-red-500" />
                      <Text size="sm" c="red" td="line-through" className="flex-1">
                        {field.before || '(empty)'}
                      </Text>
                    </Group>
                    <Group align="flex-start" gap="xs" wrap="nowrap">
                      <Plus className="mt-0.5 h-3 w-3 flex-shrink-0 text-green-500" />
                      <Text size="sm" c="green" className="flex-1">
                        {field.after}
                      </Text>
                    </Group>
                  </div>
                ))}

                {mergePreview.subtasksAdded > 0 && (
                  <div className="border-l-2 border-primary/50 py-1 pl-3">
                    <Text size="xs" c="dimmed" fw={600} tt="uppercase">
                      Subtasks
                    </Text>
                    <Group gap="xs" mt={4}>
                      <Plus className="h-3 w-3 text-blue-500" />
                      <Text size="sm">
                        Will add {mergePreview.subtasksAdded} subtasks to existing{' '}
                        {mergePreview.existingSubtasks}
                      </Text>
                    </Group>
                  </div>
                )}
              </Stack>
            </Paper>
          )}

          {!template && (
            <Text ta="center" size="sm" c="dimmed" className="py-8">
              Select a template to see what will change
            </Text>
          )}
        </Stack>

        <Group justify="flex-end" gap="xs">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleApply} disabled={!template || updateTask.isPending}>
            {updateTask.isPending ? 'Applying...' : 'Apply Template'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
