import { Divider, Stack } from '@mantine/core';
import type { Task } from '@veritas-kanban/shared';
import { DeliverablesSection } from './DeliverablesSection';
import { WorkProductsSection } from './WorkProductsSection';

interface TaskResultsProductsSectionProps {
  task: Task;
}

export function TaskResultsProductsSection({ task }: TaskResultsProductsSectionProps) {
  return (
    <Stack gap="lg">
      <WorkProductsSection taskId={task.id} />
      <Divider />
      <DeliverablesSection task={task} />
    </Stack>
  );
}
