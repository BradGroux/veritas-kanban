import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Group, Select, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { UiModal as Modal, OverlayFooter } from '@/components/ui/UiOverlay';
import { UiAction, UiSectionHeading } from '@/components/ui/UiVocabulary';
import { useCreateTemplate, useUpdateTemplate, type TaskTemplate } from '@/hooks/useTemplates';
import { useTaskTypesManager, getTypeIcon } from '@/hooks/useTaskTypes';
import { useToast } from '@/hooks/useToast';
import { TEMPLATE_CATEGORIES, getCategoryIcon } from '@/lib/template-categories';
import type { TaskPriority, AgentType } from '@veritas-kanban/shared';

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
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitting = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const saveErrorAlert = useRef<HTMLDivElement>(null);

  const { toast } = useToast();
  const { items: taskTypes } = useTaskTypesManager();
  const createTemplate = useCreateTemplate();
  const updateTemplate = useUpdateTemplate();
  const isLoading = isSubmitting || createTemplate.isPending || updateTemplate.isPending;
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
    setConfirmDiscard(false);
    setSaveError(null);
  }, [applyFormValues, template, open]);

  useEffect(() => {
    if (saveError && !isLoading) saveErrorAlert.current?.focus();
  }, [saveError, isLoading]);

  const resetForm = () => {
    applyFormValues(EMPTY_FORM_VALUES);
    setInitialSnapshot(serializeForm(EMPTY_FORM_VALUES));
    setShowValidationErrors(false);
  };

  const requestClose = () => {
    if (submitting.current || isLoading) return;
    if (isDirty) {
      setConfirmDiscard(true);
      return;
    }
    onOpenChange(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting.current || isLoading) return;
    setSaveError(null);
    setShowValidationErrors(true);

    if (!name.trim()) {
      nameInput.current?.focus();
      toast({
        title: 'Validation Error',
        description: 'Template name is required',
        variant: 'destructive',
      });
      return;
    }

    submitting.current = true;
    setIsSubmitting(true);
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
      setSaveError(err instanceof Error ? err.message : 'Failed to save template');
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to save template',
        variant: 'destructive',
      });
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      variant="authoring"
      compound
      opened={open}
      onClose={requestClose}
      title={template ? 'Edit Template' : 'Create New Template'}
      centered
      closeOnEscape={!confirmDiscard && !isLoading}
      closeOnClickOutside={!confirmDiscard && !isLoading}
      closeButtonProps={{ disabled: isLoading }}
      classNames={{
        content:
          'flex h-[min(45rem,calc(100dvh-2rem))] max-h-[calc(100dvh-2rem)] flex-col overflow-hidden',
        header: 'shrink-0',
        body: 'min-h-0 flex-1 overflow-hidden p-0',
      }}
    >
      <form
        onSubmit={handleSubmit}
        noValidate
        aria-busy={isLoading}
        className="flex h-full min-h-0 flex-col"
      >
        <div data-testid="template-editor-scroll-region" className="vk-overlay-scroll" tabIndex={0}>
          <Stack gap="1rem">
            {saveError && (
              <Alert
                color="red"
                title="Template could not be saved"
                ref={saveErrorAlert}
                tabIndex={-1}
              >
                {saveError} Your changes are still here. Try saving again.
              </Alert>
            )}
            <section aria-label="Basic Information" className="space-y-4">
              <UiSectionHeading
                title="Basic Information"
                description="Name the template and explain when to use it. Only the name is required."
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextInput
                  id="name"
                  ref={nameInput}
                  data-autofocus
                  label="Template Name"
                  withAsterisk
                  disabled={isLoading}
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

                <Select
                  id="category"
                  label="Category"
                  disabled={isLoading}
                  value={category || null}
                  onChange={(value) => setCategory(value ?? '')}
                  data={categoryOptions}
                  placeholder="Select a category..."
                />
              </div>
              <Textarea
                id="description"
                label="Description"
                disabled={isLoading}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this template used for?"
                rows={2}
              />
            </section>
            <section aria-label="Task Defaults" className="space-y-4 border-t border-border pt-4">
              <UiSectionHeading
                title="Task Defaults"
                description="Optional starting values for new tasks. You can change them when creating a task."
              />
              <div className="grid gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Select
                    id="type"
                    label="Default Type"
                    disabled={isLoading}
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
                    disabled={isLoading}
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
                    disabled={isLoading}
                    value={project}
                    onChange={(e) => setProject(e.target.value)}
                    placeholder="e.g., VK-001"
                  />

                  <Select
                    id="agent"
                    label="Default Agent"
                    disabled={isLoading}
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
                    disabled={isLoading}
                    description="Markdown is supported. Drag the lower edge to expand the editor."
                    value={descriptionTemplate}
                    onChange={(e) => setDescriptionTemplate(e.target.value)}
                    placeholder="Template for task description (can include variables like {{date}}, {{project}})"
                    rows={6}
                    aria-label="Description Template"
                    styles={{ input: { minHeight: '10rem', resize: 'vertical' } }}
                  />
                  <Text size="xs" c="dimmed">
                    Tip: Use variables like {'{{date}}'} to auto-populate values
                  </Text>
                </div>
              </div>
            </section>
          </Stack>
        </div>

        <OverlayFooter data-testid="template-editor-actions">
          <UiAction type="button" variant="secondary" onClick={requestClose} disabled={isLoading}>
            Cancel
          </UiAction>
          <UiAction type="submit" loading={isLoading}>
            {template ? 'Update Template' : 'Create Template'}
          </UiAction>
        </OverlayFooter>
      </form>
      <Modal
        variant="confirm"
        opened={open && confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        title="Discard template changes?"
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            Your unsaved changes will be lost. Keep editing to finish or save them.
          </Text>
          <Group justify="flex-end">
            <UiAction variant="secondary" data-autofocus onClick={() => setConfirmDiscard(false)}>
              Keep editing
            </UiAction>
            <UiAction
              variant="destructive"
              onClick={() => {
                setConfirmDiscard(false);
                onOpenChange(false);
              }}
            >
              Discard changes
            </UiAction>
          </Group>
        </Stack>
      </Modal>
    </Modal>
  );
}
