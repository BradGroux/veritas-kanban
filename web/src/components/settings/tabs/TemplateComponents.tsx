import { useState } from 'react';
import { ActionIcon, Badge, Button, Select, Text, Textarea, TextInput } from '@mantine/core';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { type TaskTemplate, useCreateTemplate, useDeleteTemplate } from '@/hooks/useTemplates';
import { getTypeIcon, useTaskTypesManager } from '@/hooks/useTaskTypes';
import { FileText, Trash2 } from 'lucide-react';
import type { AgentType, TaskPriority } from '@veritas-kanban/shared';
import { TEMPLATE_CATEGORIES, getCategoryIcon, getCategoryLabel } from '@/lib/template-categories';

const priorityOptions: Array<{ value: TaskPriority; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

const agentOptions: Array<{ value: AgentType; label: string }> = [
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'amp', label: 'Amp' },
  { value: 'copilot', label: 'Copilot' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'veritas', label: 'Veritas' },
];

export function AddTemplateForm({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<string>('');
  const [type, setType] = useState<string>('');
  const [priority, setPriority] = useState<TaskPriority | ''>('');
  const [project, setProject] = useState('');
  const [agent, setAgent] = useState<AgentType | ''>('');
  const [descriptionTemplate, setDescriptionTemplate] = useState('');
  const createTemplate = useCreateTemplate();
  const { items: taskTypes } = useTaskTypesManager();

  const categoryOptions = Object.entries(TEMPLATE_CATEGORIES).map(([key, { label, icon }]) => ({
    value: key,
    label: `${icon} ${label}`,
  }));

  const taskTypeOptions = taskTypes.map((taskType) => ({
    value: taskType.id,
    label: taskType.label,
    icon: taskType.icon,
  }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await createTemplate.mutateAsync({
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
    });
    onClose();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 border rounded-lg p-4 bg-muted/30">
      <div className="flex items-center gap-2 text-sm font-medium">
        <FileText className="h-4 w-4" /> Add Template
      </div>
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <TextInput
            label="Name *"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Bug Fix"
            size="sm"
            radius="md"
          />
          <TextInput
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g., Template for bug fixes"
            size="sm"
            radius="md"
          />
        </div>
        <Select
          label="Category"
          value={category || null}
          onChange={(value) => setCategory(value ?? '')}
          data={categoryOptions}
          placeholder="Select category..."
          size="sm"
          radius="md"
        />
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Default Type"
            value={type || null}
            onChange={(value) => setType(value ?? '')}
            data={taskTypeOptions}
            placeholder="Any"
            size="sm"
            radius="md"
            renderOption={({ option }) => {
              const iconName = taskTypeOptions.find((entry) => entry.value === option.value)?.icon;
              const IconComponent = iconName ? getTypeIcon(iconName) : null;
              return (
                <div className="flex items-center gap-2">
                  {IconComponent && <IconComponent className="h-4 w-4" />}
                  {option.label}
                </div>
              );
            }}
          />
          <Select
            label="Default Priority"
            value={priority || null}
            onChange={(value) => setPriority((value as TaskPriority | null) ?? '')}
            data={priorityOptions}
            placeholder="Any"
            size="sm"
            radius="md"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextInput
            label="Default Project"
            value={project}
            onChange={(e) => setProject(e.target.value)}
            placeholder="e.g., rubicon"
            size="sm"
            radius="md"
          />
          <Select
            label="Preferred Agent"
            value={agent || null}
            onChange={(value) => setAgent((value as AgentType | null) ?? '')}
            data={agentOptions}
            placeholder="Any"
            size="sm"
            radius="md"
          />
        </div>
        <Textarea
          label="Description Template"
          value={descriptionTemplate}
          onChange={(e) => setDescriptionTemplate(e.target.value)}
          placeholder="Pre-filled description text..."
          rows={2}
          size="sm"
          radius="md"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" radius="md" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          radius="md"
          disabled={!name.trim() || createTemplate.isPending}
        >
          {createTemplate.isPending ? 'Creating...' : 'Create Template'}
        </Button>
      </div>
    </form>
  );
}

export function TemplateItem({ template }: { template: TaskTemplate }) {
  const deleteTemplate = useDeleteTemplate();
  const taskDefaults = template.taskDefaults ?? {};
  const metadata = [
    taskDefaults.type,
    taskDefaults.priority,
    taskDefaults.project,
    taskDefaults.agent,
  ]
    .filter(Boolean)
    .join(' • ');

  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-md border bg-card">
      <div className="flex items-center gap-3">
        <FileText className="h-4 w-4 text-muted-foreground" />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <Text size="sm" fw={500}>
              {template.name}
            </Text>
            {template.category && (
              <Badge variant="light" color="gray" size="xs">
                {getCategoryIcon(template.category)} {getCategoryLabel(template.category)}
              </Badge>
            )}
          </div>
          <Text size="xs" c="dimmed">
            {metadata || 'No defaults'}
          </Text>
        </div>
      </div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <ActionIcon
            type="button"
            variant="subtle"
            color="red"
            size="sm"
            radius="md"
            aria-label={`Delete ${template.name}`}
          >
            <Trash2 className="h-4 w-4" />
          </ActionIcon>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete template?</AlertDialogTitle>
            <AlertDialogDescription>This will delete "{template.name}".</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTemplate.mutate(template.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
