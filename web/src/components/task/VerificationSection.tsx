import { useState } from 'react';
import { Plus, Trash2, ShieldCheck, Check } from 'lucide-react';
import {
  ActionIcon,
  Box,
  Button,
  Checkbox,
  Group,
  Progress,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import {
  useAddVerificationStep,
  useUpdateVerificationStep,
  useDeleteVerificationStep,
} from '@/hooks/useTasks';
import { cn } from '@/lib/utils';
import type { Task, VerificationStep } from '@veritas-kanban/shared';

interface VerificationSectionProps {
  task: Task;
}

export function VerificationSection({ task }: VerificationSectionProps) {
  const [newDescription, setNewDescription] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const addStep = useAddVerificationStep();
  const updateStep = useUpdateVerificationStep();
  const deleteStep = useDeleteVerificationStep();

  const steps = task.verificationSteps || [];
  const checkedCount = steps.filter((s) => s.checked).length;
  const totalCount = steps.length;
  const progress = totalCount > 0 ? (checkedCount / totalCount) * 100 : 0;

  const handleAddStep = async () => {
    if (!newDescription.trim()) return;

    setIsAdding(true);
    try {
      await addStep.mutateAsync({ taskId: task.id, description: newDescription.trim() });
      setNewDescription('');
    } finally {
      setIsAdding(false);
    }
  };

  const handleToggleStep = async (step: VerificationStep) => {
    await updateStep.mutateAsync({
      taskId: task.id,
      stepId: step.id,
      updates: { checked: !step.checked },
    });
  };

  const handleDeleteStep = async (stepId: string) => {
    await deleteStep.mutateAsync({ taskId: task.id, stepId });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleAddStep();
    }
  };

  const formatTimestamp = (iso: string) => {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center">
        <Group gap={6}>
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          <Text size="sm" c="dimmed" fw={500}>
            Done Criteria
          </Text>
        </Group>
        {totalCount > 0 && (
          <Text size="xs" c="dimmed">
            {checkedCount}/{totalCount} verified
          </Text>
        )}
      </Group>

      {/* Progress bar */}
      {totalCount > 0 && (
        <Progress
          value={progress}
          size="xs"
          radius="xl"
          color={checkedCount === totalCount ? 'green' : 'violet'}
          aria-label="Done criteria progress"
        />
      )}

      {/* Verification step list */}
      <Stack gap={4}>
        {steps.map((step) => (
          <Group
            key={step.id}
            align="flex-start"
            gap="xs"
            className={cn(
              'group rounded-md p-2 transition-colors hover:bg-muted/50',
              step.checked && 'opacity-70'
            )}
          >
            <Checkbox
              checked={step.checked}
              onChange={() => {
                void handleToggleStep(step);
              }}
              color="green"
              className="mt-0.5 flex-shrink-0"
              aria-label={`Mark verification step ${step.description}`}
            />
            <Box className="min-w-0 flex-1">
              <Text
                component="span"
                size="sm"
                className={cn(step.checked && 'text-muted-foreground line-through')}
              >
                {step.description}
              </Text>
              {step.checked && step.checkedAt && (
                <Group gap={4} mt={2}>
                  <Check className="h-3 w-3 text-green-500" />
                  <Text size="xs" c="green.5">
                    {formatTimestamp(step.checkedAt)}
                  </Text>
                </Group>
              )}
            </Box>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
              onClick={() => {
                void handleDeleteStep(step.id);
              }}
              aria-label={`Delete verification step: ${step.description}`}
            >
              <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
            </ActionIcon>
          </Group>
        ))}
      </Stack>

      {/* Add verification step input */}
      <Group gap="xs" align="flex-start" wrap="nowrap">
        <TextInput
          aria-label="New verification step"
          value={newDescription}
          onChange={(e) => setNewDescription(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add verification step..."
          className="flex-1 text-sm"
          disabled={isAdding}
        />
        <Button
          size="sm"
          onClick={() => {
            void handleAddStep();
          }}
          disabled={!newDescription.trim() || isAdding}
          className="shrink-0"
          aria-label="Add verification step"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </Group>
    </Stack>
  );
}
