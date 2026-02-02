import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
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
import { TaskMetadataSection } from './TaskMetadataSection';
import { SubtasksSection } from '../SubtasksSection';
import { VerificationSection } from '../VerificationSection';
import { DependenciesSection } from '../DependenciesSection';
import { TimeTrackingSection } from '../TimeTrackingSection';
import { CommentsSection } from '../CommentsSection';
import { BlockedReasonSection } from '../BlockedReasonSection';
import { useDeleteTask, useArchiveTask } from '@/hooks/useTasks';
import { useFeatureSettings } from '@/hooks/useFeatureSettings';
import { Trash2, Archive, Calendar, Clock, RotateCcw } from 'lucide-react';
import type { Task, BlockedReason } from '@veritas-kanban/shared';
import { sanitizeText } from '@/lib/sanitize';

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
    <div className="space-y-6">
      {/* Description */}
      <div className="space-y-2">
        <Label className="text-muted-foreground">Description</Label>
        {readOnly ? (
          <div className="text-sm whitespace-pre-wrap text-foreground/80 bg-muted/30 rounded-md p-3 min-h-[60px]">
            {sanitizeText(task.description || '') || 'No description'}
          </div>
        ) : (
          <Textarea
            value={task.description}
            onChange={(e) => onUpdate('description', e.target.value)}
            placeholder="Add a description..."
            rows={4}
            className="resize-none"
          />
        )}
      </div>

      {/* Plan section removed (GH-66 cleanup — planning was agent-internal, not board-level) */}

      {/* Metadata Section */}
      <TaskMetadataSection task={task} onUpdate={onUpdate} readOnly={readOnly} />

      {/* Blocked Reason (shown when status is blocked) */}
      {task.status === 'blocked' && (
        <div className="border-t pt-4">
          <BlockedReasonSection
            task={task}
            onUpdate={(blockedReason: BlockedReason | undefined) =>
              onUpdate('blockedReason', blockedReason)
            }
            readOnly={readOnly}
          />
        </div>
      )}

      {/* Subtasks */}
      <div className="border-t pt-4">
        <SubtasksSection
          task={task}
          onAutoCompleteChange={(value) => onUpdate('autoCompleteOnSubtasks', value || undefined)}
        />
      </div>

      {/* Verification / Done Criteria */}
      <div className="border-t pt-4">
        <VerificationSection task={task} />
      </div>

      {/* Dependencies */}
      {taskSettings.enableDependencies && (
        <div className="border-t pt-4">
          <DependenciesSection
            task={task}
            onBlockedByChange={(blockedBy) => onUpdate('blockedBy', blockedBy)}
          />
        </div>
      )}

      {/* Time Tracking */}
      {taskSettings.enableTimeTracking && (
        <div className="border-t pt-4">
          <TimeTrackingSection task={task} />
        </div>
      )}

      {/* Comments */}
      {taskSettings.enableComments && (
        <div className="border-t pt-4">
          <CommentsSection task={task} />
        </div>
      )}

      {/* Metadata Footer */}
      <div className="border-t pt-4 space-y-2 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4" />
          <span>Created: {formatDate(task.created)}</span>
        </div>
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4" />
          <span>Updated: {formatDate(task.updated)}</span>
        </div>
        <div className="text-xs font-mono opacity-50">ID: {task.id}</div>
      </div>

      {/* Delete/Restore Button */}
      <div className="border-t pt-4">
        {readOnly && onRestore ? (
          <Button variant="default" className="w-full" onClick={() => onRestore(task.id)}>
            <RotateCcw className="h-4 w-4 mr-2" />
            Restore to Board
          </Button>
        ) : (
          !readOnly && (
            <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={handleArchive}>
              <Archive className="h-4 w-4 mr-2" />
              Archive
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" className="flex-1">
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this task?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete "{task.title}".
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            </div>
          )
        )}
      </div>
    </div>
  );
}
