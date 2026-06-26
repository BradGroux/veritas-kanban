import { useState } from 'react';
import { Badge, Box, Button, Group, Modal, Paper, Stack, Text, Textarea } from '@mantine/core';
import { API_BASE } from '@/lib/config';
import { MarkdownEditor } from '@/components/ui/MarkdownEditor';
import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer';
import { TaskMetadataSection } from './TaskMetadataSection';
import { SubtasksSection } from '../SubtasksSection';
import { VerificationSection } from '../VerificationSection';
import { DependenciesSection } from '../DependenciesSection';
import { TimeTrackingSection } from '../TimeTrackingSection';
import { CommentsSection } from '../CommentsSection';
import { DeliverablesSection } from '../DeliverablesSection';
import { BlockedReasonSection } from '../BlockedReasonSection';
import { LessonsLearnedSection } from '../LessonsLearnedSection';
import { useDeleteTask, useArchiveTask } from '@/hooks/useTasks';
import { useFeatureSettings } from '@/hooks/useFeatureSettings';
import { Trash2, Archive, Calendar, Clock, RotateCcw, ExternalLink } from 'lucide-react';
import type { Task, BlockedReason } from '@veritas-kanban/shared';
import { isExternalTargetHref, normalizeSafeHref } from '@veritas-kanban/shared';

interface TaskDetailsTabProps {
  task: Task;
  onUpdate: <K extends keyof Task>(field: K, value: Task[K]) => void;
  onClose: () => void;
  readOnly?: boolean;
  onRestore?: (taskId: string) => void;
}

export function TaskDetailsTab({
  task,
  onUpdate,
  onClose,
  readOnly = false,
  onRestore,
}: TaskDetailsTabProps) {
  const deleteTask = useDeleteTask();
  const archiveTask = useArchiveTask();
  const { settings: featureSettings } = useFeatureSettings();
  const taskSettings = featureSettings.tasks;
  const markdownSettings = featureSettings.markdown;
  const markdownEnabled = markdownSettings?.enableMarkdown ?? true;
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const handleDelete = async () => {
    await deleteTask.mutateAsync(task.id);
    onClose();
  };

  const handleArchive = async () => {
    await archiveTask.mutateAsync(task.id);
    onClose();
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  return (
    <Stack gap="lg">
      {/* Description */}
      <Stack gap={6}>
        <Text size="sm" c="dimmed" fw={500}>
          Description
        </Text>
        {readOnly ? (
          <Paper className="min-h-[60px] bg-muted/30 p-3 text-sm text-foreground/80" radius="md">
            {task.description ? (
              markdownEnabled ? (
                <MarkdownRenderer content={task.description} />
              ) : (
                <p className="whitespace-pre-wrap">{task.description}</p>
              )
            ) : (
              <span className="text-muted-foreground italic">No description</span>
            )}
          </Paper>
        ) : markdownEnabled ? (
          <MarkdownEditor
            value={task.description}
            onChange={(value) => onUpdate('description', value)}
            placeholder="Add a description... (supports Markdown)"
            minHeight={120}
          />
        ) : (
          <Textarea
            value={task.description}
            onChange={(e) => onUpdate('description', e.currentTarget.value)}
            placeholder="Add a description..."
            rows={4}
            className="resize-none"
          />
        )}
      </Stack>

      {/* Plan section removed (GH-66 cleanup — planning was agent-internal, not board-level) */}

      {/* Metadata Section */}
      <TaskMetadataSection task={task} onUpdate={onUpdate} readOnly={readOnly} />

      {task.delegatedWork && task.delegatedWork.length > 0 && (
        <Box className="border-t pt-4">
          <Stack gap="sm">
            <Text size="sm" c="dimmed" fw={500}>
              Delegated Work
            </Text>
            <Stack gap="xs">
              {task.delegatedWork.map((link) => (
                <DelegatedWorkLink key={link.id} link={link} />
              ))}
            </Stack>
          </Stack>
        </Box>
      )}

      {/* Blocked Reason (shown when status is blocked) */}
      {task.status === 'blocked' && (
        <Box className="border-t pt-4">
          <BlockedReasonSection
            task={task}
            onUpdate={(blockedReason: BlockedReason | undefined) =>
              onUpdate('blockedReason', blockedReason)
            }
            readOnly={readOnly}
          />
        </Box>
      )}

      {/* Checkpoint Status (shown when checkpoint exists) */}
      {task.checkpoint && (
        <Box className="border-t pt-4">
          <Stack gap="sm">
            <Group justify="space-between" align="center">
              <Text size="sm" c="dimmed" fw={500}>
                Checkpoint
              </Text>
              {!readOnly && (
                <Button
                  variant="subtle"
                  size="xs"
                  aria-label="Clear checkpoint and discard saved progress"
                  onClick={async () => {
                    try {
                      await fetch(`${API_BASE}/tasks/${task.id}/checkpoint`, { method: 'DELETE' });
                      onUpdate('checkpoint', undefined);
                    } catch (error) {
                      console.error('Failed to clear checkpoint:', error);
                    }
                  }}
                >
                  Clear Checkpoint
                </Button>
              )}
            </Group>
            <Paper
              role="status"
              aria-live="polite"
              className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-md p-3 space-y-2"
            >
              <Group gap="xs">
                <Badge color="yellow" variant="light">
                  Checkpoint saved
                </Badge>
                <Text size="xs" c="dimmed">
                  Step {task.checkpoint.step}
                </Text>
              </Group>
              <Text size="xs" c="dimmed">
                Saved: {formatDate(task.checkpoint.timestamp)}
              </Text>
              {task.checkpoint.resumeCount && task.checkpoint.resumeCount > 0 && (
                <Group gap={6} className="text-muted-foreground">
                  <RotateCcw className="h-3 w-3" />
                  <Text size="xs">Resumed {task.checkpoint.resumeCount} time(s)</Text>
                </Group>
              )}
            </Paper>
          </Stack>
        </Box>
      )}

      {/* Subtasks */}
      <Box className="border-t pt-4">
        <SubtasksSection
          task={task}
          onAutoCompleteChange={(value) => onUpdate('autoCompleteOnSubtasks', value || undefined)}
        />
      </Box>

      {/* Verification / Done Criteria */}
      <Box className="border-t pt-4">
        <VerificationSection task={task} />
      </Box>

      {/* Dependencies */}
      {taskSettings.enableDependencies && (
        <Box className="border-t pt-4">
          <DependenciesSection
            task={task}
            onBlockedByChange={(blockedBy) => onUpdate('blockedBy', blockedBy)}
          />
        </Box>
      )}

      {/* Time Tracking */}
      {taskSettings.enableTimeTracking && (
        <Box className="border-t pt-4">
          <TimeTrackingSection task={task} />
        </Box>
      )}

      {/* Deliverables */}
      <Box className="border-t pt-4">
        <DeliverablesSection task={task} />
      </Box>

      {/* Comments */}
      {taskSettings.enableComments && (
        <Box className="border-t pt-4">
          <CommentsSection task={task} />
        </Box>
      )}

      {/* Lessons Learned (only shown for completed tasks) */}
      {task.status === 'done' && (
        <Box className="border-t pt-4">
          <LessonsLearnedSection task={task} onUpdate={onUpdate} readOnly={readOnly} />
        </Box>
      )}

      {/* Metadata Footer */}
      <Stack gap={6} className="border-t pt-4 text-muted-foreground">
        <Group gap="xs">
          <Calendar className="h-4 w-4" />
          <Text size="sm">Created: {formatDate(task.created)}</Text>
        </Group>
        <Group gap="xs">
          <Clock className="h-4 w-4" />
          <Text size="sm">Updated: {formatDate(task.updated)}</Text>
        </Group>
        <Text size="xs" ff="monospace" opacity={0.5}>
          ID: {task.id}
        </Text>
      </Stack>

      {/* Delete/Restore Button */}
      <Box className="border-t pt-4">
        {readOnly && onRestore ? (
          <Button variant="default" className="w-full" onClick={() => onRestore(task.id)}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Restore to Board
          </Button>
        ) : (
          !readOnly && (
            <Group gap="xs" grow>
              <Button variant="outline" className="flex-1" onClick={handleArchive}>
                <Archive className="mr-2 h-4 w-4" />
                Archive
              </Button>
              <Button color="red" className="flex-1" onClick={() => setDeleteConfirmOpen(true)}>
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </Button>
            </Group>
          )
        )}
      </Box>

      <Modal
        opened={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        title="Delete this task?"
        centered
      >
        <Stack gap="md">
          <Text size="sm">This will permanently delete "{task.title}".</Text>
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={() => setDeleteConfirmOpen(false)}>
              Cancel
            </Button>
            <Button color="red" onClick={handleDelete}>
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

function DelegatedWorkLink({ link }: { link: NonNullable<Task['delegatedWork']>[number] }) {
  const href = normalizeSafeHref(link.targetUrl);
  const external = isExternalTargetHref(href);
  return (
    <Paper className="border bg-card p-3" radius="md">
      <Group justify="space-between" gap="sm" wrap="nowrap">
        <Stack gap={2} className="min-w-0">
          <Group gap="xs">
            <Badge variant="light" color={link.status === 'blocked' ? 'red' : 'blue'}>
              {link.latestState ?? link.status}
            </Badge>
            <Text size="xs" c="dimmed">
              {link.capabilityId}
            </Text>
          </Group>
          <Text size="xs" c="dimmed" className="truncate">
            {link.sourceWorkspaceId}
            {' -> '}
            {link.targetWorkspaceId}
          </Text>
        </Stack>
        {href && (
          <Button
            component="a"
            href={href}
            target={external ? '_blank' : undefined}
            rel={external ? 'noreferrer' : undefined}
            variant="subtle"
            size="xs"
            leftSection={<ExternalLink className="h-3.5 w-3.5" />}
          >
            Open
          </Button>
        )}
      </Group>
    </Paper>
  );
}
