import { useState } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Group,
  Progress,
  Stack,
  Switch,
  Text,
  TextInput,
} from '@mantine/core';
import {
  useAddSubtask,
  useUpdateSubtask,
  useDeleteSubtask,
  useToggleSubtaskCriteria,
} from '@/hooks/useTasks';
import { cn } from '@/lib/utils';
import type { Task, Subtask } from '@veritas-kanban/shared';

interface SubtasksSectionProps {
  task: Task;
  onAutoCompleteChange: (value: boolean) => void;
}

export function SubtasksSection({ task, onAutoCompleteChange }: SubtasksSectionProps) {
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [showCriteriaInput, setShowCriteriaInput] = useState(false);
  const [criteriaInputs, setCriteriaInputs] = useState<string[]>(['']);
  const [expandedSubtasks, setExpandedSubtasks] = useState<Set<string>>(new Set());

  const addSubtask = useAddSubtask();
  const updateSubtask = useUpdateSubtask();
  const deleteSubtask = useDeleteSubtask();
  const toggleCriteria = useToggleSubtaskCriteria();

  const subtasks = task.subtasks || [];
  const completedCount = subtasks.filter((s) => s.completed).length;
  const totalCount = subtasks.length;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  const handleAddSubtask = async () => {
    if (!newSubtaskTitle.trim()) return;

    setIsAdding(true);
    try {
      const criteria = criteriaInputs.filter((c) => c.trim() !== '');
      await addSubtask.mutateAsync({
        taskId: task.id,
        title: newSubtaskTitle.trim(),
        ...(criteria.length > 0 && { acceptanceCriteria: criteria }),
      });
      setNewSubtaskTitle('');
      setCriteriaInputs(['']);
      setShowCriteriaInput(false);
    } finally {
      setIsAdding(false);
    }
  };

  const handleToggleSubtask = async (subtask: Subtask) => {
    await updateSubtask.mutateAsync({
      taskId: task.id,
      subtaskId: subtask.id,
      updates: { completed: !subtask.completed },
    });
  };

  const handleDeleteSubtask = async (subtaskId: string) => {
    await deleteSubtask.mutateAsync({ taskId: task.id, subtaskId });
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleAddSubtask();
    }
  };

  const handleAddCriteriaInput = () => {
    setCriteriaInputs([...criteriaInputs, '']);
  };

  const handleRemoveCriteriaInput = (index: number) => {
    setCriteriaInputs(criteriaInputs.filter((_, i) => i !== index));
  };

  const handleCriteriaInputChange = (index: number, value: string) => {
    const updated = [...criteriaInputs];
    updated[index] = value;
    setCriteriaInputs(updated);
  };

  const toggleSubtaskExpanded = (subtaskId: string) => {
    setExpandedSubtasks((current) => {
      const next = new Set(current);
      if (next.has(subtaskId)) {
        next.delete(subtaskId);
      } else {
        next.add(subtaskId);
      }
      return next;
    });
  };

  const handleToggleCriteria = async (subtaskId: string, criteriaIndex: number) => {
    await toggleCriteria.mutateAsync({ taskId: task.id, subtaskId, criteriaIndex });
  };

  const getCriteriaProgress = (subtask: Subtask) => {
    if (!subtask.acceptanceCriteria || subtask.acceptanceCriteria.length === 0) return null;
    const checked = subtask.criteriaChecked?.filter((c) => c).length || 0;
    const total = subtask.acceptanceCriteria.length;
    return { checked, total };
  };

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center">
        <Text size="sm" c="dimmed" fw={500}>
          Subtasks
        </Text>
        {totalCount > 0 && (
          <Text size="xs" c="dimmed">
            {completedCount}/{totalCount} complete
          </Text>
        )}
      </Group>

      {/* Progress bar */}
      {totalCount > 0 && (
        <Progress value={progress} size="xs" radius="xl" aria-label="Subtask progress" />
      )}

      {/* Subtask list */}
      <Stack gap={4}>
        {subtasks.map((subtask) => {
          const criteria = subtask.acceptanceCriteria || [];
          const criteriaProgress = getCriteriaProgress(subtask);
          const isExpanded = expandedSubtasks.has(subtask.id);
          const hasCriteria = criteria.length > 0;

          return (
            <Stack key={subtask.id} gap={4}>
              <Group
                align="center"
                gap="xs"
                className={cn(
                  'group rounded-md p-2 transition-colors hover:bg-muted/50',
                  subtask.completed && 'opacity-60'
                )}
              >
                <Checkbox
                  checked={subtask.completed}
                  onChange={() => {
                    void handleToggleSubtask(subtask);
                  }}
                  className="flex-shrink-0"
                  aria-label={`Mark subtask ${subtask.title}`}
                />
                {hasCriteria && (
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    size="xs"
                    className="h-4 w-4 p-0"
                    onClick={() => toggleSubtaskExpanded(subtask.id)}
                    aria-label={`${isExpanded ? 'Collapse' : 'Expand'} criteria for ${subtask.title}`}
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                  </ActionIcon>
                )}
                <Text
                  size="sm"
                  className={cn(
                    'flex-1 text-sm',
                    subtask.completed && 'line-through text-muted-foreground'
                  )}
                >
                  {subtask.title}
                </Text>
                {criteriaProgress && (
                  <Badge variant="outline" color="gray" size="sm">
                    {criteriaProgress.checked}/{criteriaProgress.total}
                  </Badge>
                )}
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => {
                    void handleDeleteSubtask(subtask.id);
                  }}
                  aria-label={`Delete subtask: ${subtask.title}`}
                >
                  <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                </ActionIcon>
              </Group>

              {/* Acceptance criteria checklist */}
              {hasCriteria && isExpanded && (
                <Stack gap={4} className="ml-10">
                  {criteria.map((criterion, idx) => (
                    <Group key={idx} align="flex-start" gap="xs" className="p-1">
                      <Checkbox
                        checked={subtask.criteriaChecked?.[idx] || false}
                        onChange={() => {
                          void handleToggleCriteria(subtask.id, idx);
                        }}
                        className="flex-shrink-0 mt-0.5"
                        aria-label={`Mark criterion ${criterion}`}
                      />
                      <Text size="xs" c="dimmed">
                        {criterion}
                      </Text>
                    </Group>
                  ))}
                </Stack>
              )}
            </Stack>
          );
        })}
      </Stack>

      {/* Add subtask input */}
      <Stack gap="xs">
        <Group gap="xs" align="flex-start" wrap="nowrap">
          <TextInput
            aria-label="New subtask"
            value={newSubtaskTitle}
            onChange={(e) => setNewSubtaskTitle(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add a subtask..."
            className="flex-1 text-sm"
            disabled={isAdding}
          />
          <Button
            size="sm"
            onClick={() => {
              void handleAddSubtask();
            }}
            disabled={!newSubtaskTitle.trim() || isAdding}
            className="shrink-0"
            aria-label="Add subtask"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </Group>

        {/* Add Acceptance Criteria toggle */}
        <Button
          variant="subtle"
          size="sm"
          onClick={() => setShowCriteriaInput(!showCriteriaInput)}
          className="self-start text-xs text-muted-foreground"
        >
          {showCriteriaInput ? '- Hide' : '+ Add'} Acceptance Criteria
        </Button>

        {/* Acceptance Criteria inputs */}
        {showCriteriaInput && (
          <Stack gap="xs" className="border-l-2 border-muted pl-4">
            {criteriaInputs.map((criterion, idx) => (
              <Group key={idx} gap="xs" align="flex-start" wrap="nowrap">
                <TextInput
                  value={criterion}
                  onChange={(e) => handleCriteriaInputChange(idx, e.currentTarget.value)}
                  placeholder={`Criterion ${idx + 1}...`}
                  className="flex-1 text-xs"
                  aria-label={`Criterion ${idx + 1}`}
                />
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  className="h-8 w-8"
                  onClick={() => handleRemoveCriteriaInput(idx)}
                  disabled={criteriaInputs.length === 1}
                  aria-label={`Remove criterion ${idx + 1}`}
                >
                  <Trash2 className="h-3 w-3" />
                </ActionIcon>
              </Group>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={handleAddCriteriaInput}
              className="self-start text-xs"
              leftSection={<Plus className="h-3 w-3" />}
            >
              Add Criterion
            </Button>
          </Stack>
        )}
      </Stack>

      {/* Auto-complete toggle */}
      {totalCount > 0 && (
        <Group justify="space-between" align="center" className="border-t pt-2">
          <Text component="label" htmlFor="auto-complete" size="xs" c="dimmed">
            Auto-complete task when all subtasks done
          </Text>
          <Switch
            id="auto-complete"
            checked={task.autoCompleteOnSubtasks || false}
            onChange={(event) => onAutoCompleteChange(event.currentTarget.checked)}
            aria-label="Auto-complete task when all subtasks done"
          />
        </Group>
      )}
    </Stack>
  );
}
