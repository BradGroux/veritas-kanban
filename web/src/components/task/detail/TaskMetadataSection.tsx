import { useState } from 'react';
import { Box, Button, Group, Select, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { useTaskTypes, getTypeIcon } from '@/hooks/useTaskTypes';
import { useProjects } from '@/hooks/useProjects';
import { useSprints } from '@/hooks/useSprints';
import { useConfig } from '@/hooks/useConfig';
import { useFeatureSettings } from '@/hooks/useFeatureSettings';
import {
  DEFAULT_FEATURE_SETTINGS,
  normalizeBoardColumns,
  getBoardStatusLabel,
  type Task,
  type TaskStatus,
  type TaskPriority,
  type AgentType,
} from '@veritas-kanban/shared';
import type { ReactNode } from 'react';

interface TaskMetadataSectionProps {
  task: Task;
  onUpdate: <K extends keyof Task>(field: K, value: Task[K]) => void;
  readOnly?: boolean;
}

const priorityLabels: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

function ReadOnlyValue({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <Box className={`rounded-md bg-muted/30 px-3 py-2 text-sm font-medium ${className}`}>
      {children}
    </Box>
  );
}

export function TaskMetadataSection({
  task,
  onUpdate,
  readOnly = false,
}: TaskMetadataSectionProps) {
  const { data: taskTypes = [] } = useTaskTypes();
  const { data: projects = [] } = useProjects();
  const { data: sprints = [] } = useSprints();
  const { data: config } = useConfig();
  const { settings: featureSettings } = useFeatureSettings();
  const columns = normalizeBoardColumns(
    featureSettings.board?.columns ?? DEFAULT_FEATURE_SETTINGS.board.columns
  );
  const statusOptions = columns.map((column) => ({ value: column.id, label: column.title }));
  const enabledAgents = config?.agents.filter((a) => a.enabled) || [];
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');

  // Get current type info
  const currentType = taskTypes.find((t) => t.id === task.type);
  const typeLabel = currentType ? currentType.label : task.type;

  return (
    <Stack gap="md">
      {/* Status, Type, Priority */}
      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
        <Stack gap={6}>
          <Text size="sm" c="dimmed" fw={500}>
            Status
          </Text>
          {readOnly ? (
            <ReadOnlyValue>{getBoardStatusLabel(task.status, columns)}</ReadOnlyValue>
          ) : (
            <Select
              aria-label="Status"
              allowDeselect={false}
              data={statusOptions}
              value={task.status}
              onChange={(value) => {
                if (value) onUpdate('status', value as TaskStatus);
              }}
            />
          )}
        </Stack>

        <Stack gap={6}>
          <Text size="sm" c="dimmed" fw={500}>
            Type
          </Text>
          {readOnly ? (
            <ReadOnlyValue>{typeLabel}</ReadOnlyValue>
          ) : (
            <Select
              aria-label="Type"
              allowDeselect={false}
              data={taskTypes.map((type) => ({ value: type.id, label: type.label }))}
              renderOption={({ option }) => {
                const type = taskTypes.find((item) => item.id === option.value);
                if (!type) return option.label;
                const IconComponent = getTypeIcon(type.icon);
                return (
                  <Group gap="xs">
                    {IconComponent && <IconComponent className="h-4 w-4" />}
                    <Text size="sm">{type.label}</Text>
                  </Group>
                );
              }}
              value={task.type}
              onChange={(value) => {
                if (value) onUpdate('type', value);
              }}
            />
          )}
        </Stack>

        <Stack gap={6}>
          <Text size="sm" c="dimmed" fw={500}>
            Priority
          </Text>
          {readOnly ? (
            <ReadOnlyValue className="capitalize">{task.priority}</ReadOnlyValue>
          ) : (
            <Select
              aria-label="Priority"
              allowDeselect={false}
              data={Object.entries(priorityLabels).map(([value, label]) => ({ value, label }))}
              value={task.priority}
              onChange={(value) => {
                if (value) onUpdate('priority', value as TaskPriority);
              }}
            />
          )}
        </Stack>
      </SimpleGrid>

      {/* Project */}
      <Stack gap={6}>
        <Text size="sm" c="dimmed" fw={500}>
          Project
        </Text>
        {readOnly ? (
          <ReadOnlyValue>
            {projects.find((p) => p.id === task.project)?.label || task.project || 'No project'}
          </ReadOnlyValue>
        ) : !showNewProject ? (
          <Select
            aria-label="Project"
            allowDeselect={false}
            data={[
              { value: '__none__', label: 'No project' },
              ...projects.map((proj) => ({ value: proj.id, label: proj.label })),
              { value: '__new__', label: '+ New Project' },
            ]}
            placeholder="Select project..."
            value={task.project || '__none__'}
            onChange={(value) => {
              if (value === '__new__') {
                setShowNewProject(true);
                setNewProjectName('');
              } else if (value === '__none__') {
                onUpdate('project', undefined);
              } else if (value) {
                onUpdate('project', value);
              }
            }}
          />
        ) : (
          <Group gap="xs" align="flex-start" wrap="nowrap">
            <TextInput
              aria-label="New project name"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.currentTarget.value)}
              placeholder="Enter project name..."
              autoFocus
              className="flex-1"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newProjectName.trim()) {
                  e.preventDefault();
                  onUpdate('project', newProjectName.trim());
                  setShowNewProject(false);
                }
                if (e.key === 'Escape') {
                  setShowNewProject(false);
                  setNewProjectName('');
                }
              }}
            />
            <Button
              type="button"
              size="xs"
              onClick={() => {
                if (newProjectName.trim()) {
                  onUpdate('project', newProjectName.trim());
                  setShowNewProject(false);
                }
              }}
            >
              Add
            </Button>
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => {
                setShowNewProject(false);
                setNewProjectName('');
              }}
            >
              Cancel
            </Button>
          </Group>
        )}
      </Stack>

      {/* Sprint & Agent */}
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        <Stack gap={6}>
          <Text size="sm" c="dimmed" fw={500}>
            Sprint
          </Text>
          {readOnly ? (
            <ReadOnlyValue>
              {sprints.find((s) => s.id === task.sprint)?.label || task.sprint || 'No sprint'}
            </ReadOnlyValue>
          ) : (
            <Select
              aria-label="Sprint"
              allowDeselect={false}
              data={[
                { value: '__none__', label: 'No Sprint' },
                ...sprints.map((s) => ({ value: s.id, label: s.label })),
              ]}
              placeholder="No sprint"
              value={task.sprint || '__none__'}
              onChange={(value) =>
                onUpdate('sprint', value === '__none__' ? undefined : value || undefined)
              }
            />
          )}
        </Stack>

        <Stack gap={6}>
          <Text size="sm" c="dimmed" fw={500}>
            Agent
          </Text>
          {readOnly ? (
            <ReadOnlyValue>
              {task.agent === 'auto' || !task.agent
                ? 'Auto (routing)'
                : enabledAgents.find((a) => a.type === task.agent)?.name || task.agent}
            </ReadOnlyValue>
          ) : (
            <Select
              aria-label="Agent"
              allowDeselect={false}
              data={[
                { value: 'auto', label: 'Auto (routing)' },
                ...enabledAgents.map((a) => ({ value: a.type, label: a.name })),
              ]}
              value={task.agent || 'auto'}
              onChange={(value) =>
                onUpdate('agent', value === 'auto' ? undefined : ((value || 'auto') as AgentType))
              }
            />
          )}
        </Stack>
      </SimpleGrid>
    </Stack>
  );
}
