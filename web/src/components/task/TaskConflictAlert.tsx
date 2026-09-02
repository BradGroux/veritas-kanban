import { Alert, Button, Group, Stack, Text } from '@mantine/core';
import { AlertTriangle } from 'lucide-react';
import type { TaskConflict } from '@/hooks/useTaskConflicts';

interface TaskConflictAlertProps {
  conflict: TaskConflict;
  taskTitle: string;
  onRetry: () => void;
  onDiscard: () => void;
  onDismiss: () => void;
}

export function TaskConflictAlert({
  conflict,
  taskTitle,
  onRetry,
  onDiscard,
  onDismiss,
}: TaskConflictAlertProps) {
  return (
    <Alert
      color="orange"
      icon={<AlertTriangle className="h-4 w-4" />}
      title="Update needs review"
      className="mx-4 mt-3 flex-shrink-0 sm:mx-6"
      role="status"
      aria-live="polite"
    >
      <Stack gap="xs">
        <Text size="sm">
          {conflict.localEditsPreserved
            ? `The latest version is loaded. Your unsaved ${conflict.dirtyFields.join(', ')} ${conflict.dirtyFields.length === 1 ? 'change is' : 'changes are'} still available.`
            : `The latest version is loaded. Review it before retrying your ${conflict.operation}.`}
        </Text>
        <Group gap="xs">
          {conflict.localEditsPreserved ? (
            <>
              <Button
                size="xs"
                color="orange"
                onClick={onRetry}
                aria-label={`Retry preserved edits for ${taskTitle}`}
              >
                Retry edits
              </Button>
              <Button
                size="xs"
                variant="subtle"
                color="gray"
                onClick={onDiscard}
                aria-label={`Discard preserved edits for ${taskTitle}`}
              >
                Discard edits
              </Button>
            </>
          ) : (
            <Button
              size="xs"
              variant="subtle"
              color="gray"
              onClick={onDismiss}
              aria-label={`Dismiss conflict for ${taskTitle}`}
            >
              Dismiss
            </Button>
          )}
        </Group>
      </Stack>
    </Alert>
  );
}
