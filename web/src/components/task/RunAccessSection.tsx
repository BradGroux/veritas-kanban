import { Group, Paper, Stack, Text } from '@mantine/core';
import { ShieldCheck } from 'lucide-react';
import type { Task } from '@veritas-kanban/shared';
import { RunAccessPanel } from './RunAccessPanel';

interface RunAccessSectionProps {
  task: Task;
}

export function RunAccessSection({ task }: RunAccessSectionProps) {
  if (!task.attempt?.id) {
    return (
      <Stack gap="sm">
        <Group gap="xs">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Text size="sm" fw={600}>
            Run access
          </Text>
        </Group>
        <Paper withBorder p="md" radius="md">
          <Text size="sm" c="dimmed">
            Access evidence becomes available after an execution attempt starts.
          </Text>
        </Paper>
      </Stack>
    );
  }

  return (
    <RunAccessPanel
      taskId={task.id}
      attemptId={task.attempt.id}
      live={task.attempt.status === 'running' || task.attempt.status === 'pending'}
    />
  );
}
