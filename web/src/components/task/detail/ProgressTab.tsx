import { useState } from 'react';
import {
  Button,
  Center,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Textarea,
  ThemeIcon,
} from '@mantine/core';
import { MarkdownText } from '@/components/shared/MarkdownText';
import { useTaskProgress, useUpdateProgress } from '@/hooks/useTaskProgress';
import { Pencil, Save, X, FileText } from 'lucide-react';
import type { Task } from '@veritas-kanban/shared';

interface ProgressTabProps {
  task: Task;
}

/**
 * Progress Tab - Displays and edits cross-session agent memory for a task
 */
export function ProgressTab({ task }: ProgressTabProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');

  const { data: progress, isLoading } = useTaskProgress(task.id);
  const updateProgress = useUpdateProgress();

  const handleEdit = () => {
    setEditContent(progress || '');
    setIsEditing(true);
  };

  const handleSave = async () => {
    await updateProgress.mutateAsync({ taskId: task.id, content: editContent });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditContent('');
  };

  if (isLoading) {
    return (
      <Center h={128} className="text-muted-foreground">
        <Loader size="sm" />
      </Center>
    );
  }

  const isEmpty = !progress || progress.trim() === '';

  return (
    <Stack gap="md">
      {/* Header */}
      <Group justify="space-between" align="center">
        <Group gap="xs">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <Text size="sm" fw={500}>
            Progress Notes
          </Text>
        </Group>
        {!isEditing && (
          <Button
            variant="outline"
            size="xs"
            onClick={handleEdit}
            leftSection={<Pencil className="h-3 w-3" />}
          >
            {isEmpty ? 'Add notes' : 'Edit'}
          </Button>
        )}
      </Group>

      {/* Edit Mode */}
      {isEditing && (
        <Stack gap="sm">
          <Textarea
            value={editContent}
            onChange={(e) => setEditContent(e.currentTarget.value)}
            placeholder="# Progress Notes

## Learnings
- Document insights discovered during work

## Issues Encountered
- Track problems and their solutions

## Next Steps
- List actionable items for future sessions"
            className="font-mono text-sm min-h-[400px]"
            autoFocus
          />
          <Group gap="xs">
            <Button
              size="xs"
              onClick={handleSave}
              disabled={updateProgress.isPending}
              leftSection={<Save className="h-3 w-3" />}
            >
              {updateProgress.isPending ? 'Saving...' : 'Save'}
            </Button>
            <Button
              variant="outline"
              size="xs"
              onClick={handleCancel}
              leftSection={<X className="h-3 w-3" />}
            >
              Cancel
            </Button>
          </Group>
        </Stack>
      )}

      {/* View Mode */}
      {!isEditing && (
        <Paper
          className={isEmpty ? 'border bg-card p-4' : 'min-h-[200px] border bg-card p-4'}
          radius="lg"
        >
          {isEmpty ? (
            <Group gap="sm" wrap="nowrap" className="text-muted-foreground">
              <ThemeIcon color="gray" variant="light" size="md" className="flex-shrink-0">
                <FileText className="h-4 w-4" />
              </ThemeIcon>
              <div className="min-w-0">
                <Text size="sm" fw={500}>
                  No progress notes yet
                </Text>
                <Text size="xs">Add learnings, issues, and next steps when they are useful.</Text>
              </div>
            </Group>
          ) : (
            <MarkdownText>{progress}</MarkdownText>
          )}
        </Paper>
      )}

      {/* Help Text */}
      {!isEmpty && !isEditing && (
        <Stack gap={4} className="border-t pt-3 text-xs text-muted-foreground">
          <Text size="xs" fw={500}>
            Progress Notes Best Practices:
          </Text>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>Document key learnings and insights discovered during work</li>
            <li>Track issues encountered and their solutions</li>
            <li>List next steps for future sessions to pick up where you left off</li>
            <li>Use markdown sections (##) to organize by category</li>
          </ul>
        </Stack>
      )}
    </Stack>
  );
}
