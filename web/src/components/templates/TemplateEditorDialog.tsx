import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Tabs,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { useCreateTemplate, useUpdateTemplate, type TaskTemplate } from '@/hooks/useTemplates';
import { useTaskTypesManager, getTypeIcon } from '@/hooks/useTaskTypes';
import { useToast } from '@/hooks/useToast';
import { TEMPLATE_CATEGORIES, getCategoryIcon } from '@/lib/template-categories';
import type { TaskPriority, AgentType } from '@veritas-kanban/shared';
import { Loader2 } from 'lucide-react';

interface TemplateEditorDialogProps {
  template: TaskTemplate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface TemplateFormValues {
  name: string;
  description: string;
  category: string;
  type: string;
  priority: TaskPriority | '';
  project: string;
  agent: AgentType | '';
  descriptionTemplate: string;
}

const EMPTY_FORM_VALUES: TemplateFormValues = {
  name: '',
  description: '',
  category: '',
  type: '',
  priority: '',
  project: '',
  agent: '',
  descriptionTemplate: '',
};

function formValuesForTemplate(template: TaskTemplate | null): TemplateFormValues {
  if (!template) return EMPTY_FORM_VALUES;
  return {
    name: template.name,
    description: template.description || '',
    category: template.category || '',
    type: template.taskDefaults?.type || '',
    priority: (template.taskDefaults?.priority as TaskPriority) || '',
    project: template.taskDefaults?.project || '',
    agent: (template.taskDefaults?.agent as AgentType) || '',
    descriptionTemplate: template.taskDefaults?.descriptionTemplate || '',
  };
}

function serializeForm(values: TemplateFormValues): string {
  return JSON.stringify(values);
}

export function TemplateEditorDialog({ template, open, onOpenChange }: TemplateEditorDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<string>('');
  const [type, setType] = useState<string>('');
  const [priority, setPriority] = useState<TaskPriority | ''>('');
  const [project, setProject] = useState('');
  const [agent, setAgent] = useState<AgentType | ''>('');
  const [descriptionTemplate, setDescriptionTemplate] = useState('');
  const [initialSnapshot, setInitialSnapshot] = useState(() => serializeForm(EMPTY_FORM_VALUES));
  const [showValidationErrors, setShowValidationErrors] = useState(false);

  const { toast } = useToast();
  const { items: taskTypes } = useTaskTypesManager();
  const createTemplate = useCreateTemplate();
  const updateTemplate = useUpdateTemplate();
  const isLoading = createTemplate.isPending || updateTemplate.isPending;
  const categoryOptions = Object.entries(TEMPLATE_CATEGORIES).map(([key, { label }]) => ({
    value: key,
    label: `${getCategoryIcon(key)} ${label}`,
  }));
  const taskTypeOptions = taskTypes.map((taskType) => ({
    value: taskType.id,
    label: taskType.label,
    icon: taskType.icon,
  }));
  const priorityOptions = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'urgent', label: 'Urgent' },
  ];
  const agentOptions = [
    { value: 'claude-opus-4', label: 'Claude Opus 4' },
    { value: 'claude-sonnet-4', label: 'Claude Sonnet 4' },
    { value: 'gpt-4', label: 'GPT-4' },
  ];

  const currentValues: TemplateFormValues = {
    name,
    description,
    category,
    type,
    priority,
    project,
    agent,
    descriptionTemplate,
  };
  const isDirty = open && serializeForm(currentValues) !== initialSnapshot;

  const applyFormValues = useCallback((values: TemplateFormValues) => {
    setName(values.name);
    setDescription(values.description);
    setCategory(values.category);
    setType(values.type);
    setPriority(values.priority);
    setProject(values.project);
    setAgent(values.agent);
    setDescriptionTemplate(values.descriptionTemplate);
  }, []);

  useEffect(() => {
    const values = formValuesForTemplate(template);
    applyFormValues(values);
    setInitialSnapshot(serializeForm(values));
    setShowValidationErrors(false);
  }, [applyFormValues, template, open]);

  const resetForm = () => {
    applyFormValues(EMPTY_FORM_VALUES);
    setInitialSnapshot(serializeForm(EMPTY_FORM_VALUES));
    setShowValidationErrors(false);
  };

  const requestClose = () => {
    if (isDirty && !window.confirm('Discard unsaved template changes?')) return;
    onOpenChange(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setShowValidationErrors(true);

    if (!name.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Template name is required',
        variant: 'destructive',
      });
      return;
    }

    try {
      const input = {
        name: name.trim(),
        description: description.trim() || undefined,
        category: category || undefined,
        taskDefaults: {
          type: type || undefined,
          priority: priority || undefined,
          project: project.trim() || undefined,
          agent: agent || undefined,
          descriptionTemplate: descriptionTemplate.trim() || undefined,
        },
      };

      if (template) {
        await updateTemplate.mutateAsync({ id: template.id, input });
        toast({
          title: 'Success',
          description: `Template "${name}" updated successfully.`,
        });
      } else {
        await createTemplate.mutateAsync(input);
        toast({
          title: 'Success',
          description: `Template "${name}" created successfully.`,
        });
      }

      resetForm();
      onOpenChange(false);
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to save template',
        variant: 'destructive',
      });
    }
  };

  return (
    <Modal
      opened={open}
      onClose={requestClose}
      title={template ? 'Edit Template' : 'Create New Template'}
      size="min(960px, calc(100vw - 2rem))"
      centered
      classNames={{
        content:
          'flex h-[min(780px,calc(100dvh-2rem))] max-h-[calc(100dvh-2rem)] flex-col overflow-hidden',
        header: 'shrink-0',
        body: 'min-h-0 flex-1 overflow-hidden p-0',
      }}
    >
      <form onSubmit={handleSubmit} className="flex h-full min-h-0 flex-col">
        <div
          data-testid="template-editor-scroll-region"
          className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 sm:px-6"
          tabIndex={0}
        >
          <Stack gap="lg">
            <Tabs defaultValue="basic" className="w-full">
              <Tabs.List className="w-fit max-w-full">
                <Tabs.Tab value="basic">Basic Info</Tabs.Tab>
                <Tabs.Tab value="defaults">Task Defaults</Tabs.Tab>
              </Tabs.List>

              {/* Basic Info Tab */}
              <Tabs.Panel value="basic" className="space-y-4 mt-4">
                <div className="grid gap-4">
                  <TextInput
                    id="name"
                    label={
                      <>
                        Template Name <span className="text-destructive">*</span>
                      </>
                    }
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      if (showValidationErrors && e.target.value.trim()) {
                        setShowValidationErrors(false);
                      }
                    }}
                    placeholder="e.g., Bug Fix, Feature Implementation"
                    error={
                      showValidationErrors && !name.trim() ? 'Template name is required' : undefined
                    }
                    aria-required="true"
                  />

                  <Textarea
                    id="description"
                    label="Description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What is this template used for?"
                    rows={3}
                  />

                  <Select
                    id="category"
                    label="Category"
                    value={category || null}
                    onChange={(value) => setCategory(value ?? '')}
                    data={categoryOptions}
                    placeholder="Select a category..."
                  />
                </div>
              </Tabs.Panel>

              {/* Task Defaults Tab */}
              <Tabs.Panel value="defaults" className="space-y-4 mt-4">
                <div className="grid gap-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Select
                      id="type"
                      label="Default Type"
                      value={type || null}
                      onChange={(value) => setType(value ?? '')}
                      data={taskTypeOptions}
                      placeholder="Any"
                      renderOption={({ option }) => {
                        const iconName = taskTypeOptions.find(
                          (entry) => entry.value === option.value
                        )?.icon;
                        const IconComponent = iconName ? getTypeIcon(iconName) : null;
                        return (
                          <Group gap="xs">
                            {IconComponent && <IconComponent className="h-4 w-4" />}
                            <span>{option.label}</span>
                          </Group>
                        );
                      }}
                    />

                    <Select
                      id="priority"
                      label="Default Priority"
                      value={priority || null}
                      onChange={(value) => setPriority((value as TaskPriority | null) ?? '')}
                      data={priorityOptions}
                      placeholder="None"
                    />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextInput
                      id="project"
                      label="Default Project"
                      value={project}
                      onChange={(e) => setProject(e.target.value)}
                      placeholder="e.g., VK-001"
                    />

                    <Select
                      id="agent"
                      label="Default Agent"
                      value={agent || null}
                      onChange={(value) => setAgent((value as AgentType | null) ?? '')}
                      data={agentOptions}
                      placeholder="None"
                    />
                  </div>

                  <div className="grid gap-2">
                    <Textarea
                      id="descriptionTemplate"
                      label="Description Template"
                      value={descriptionTemplate}
                      onChange={(e) => setDescriptionTemplate(e.target.value)}
                      placeholder="Template for task description (can include variables like {{date}}, {{project}})"
                      minRows={12}
                      aria-label="Description Template"
                      styles={{ input: { minHeight: 240, resize: 'vertical' } }}
                    />
                    <Text size="xs" c="dimmed">
                      Tip: Use variables like {'{{date}}'} to auto-populate values
                    </Text>
                  </div>
                </div>
              </Tabs.Panel>
            </Tabs>
          </Stack>
        </div>

        <Group
          data-testid="template-editor-actions"
          justify="flex-end"
          className="shrink-0 border-t bg-card px-4 py-4 sm:px-6"
        >
          <Button type="button" variant="outline" onClick={requestClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {template ? 'Update Template' : 'Create Template'}
          </Button>
        </Group>
      </form>
    </Modal>
  );
}
