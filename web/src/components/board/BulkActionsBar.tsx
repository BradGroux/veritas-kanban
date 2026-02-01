import { useState, useMemo } from 'react';
import { X, Trash2, Archive, ArrowRight, CheckSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useBulkActions } from '@/hooks/useBulkActions';
import { useUpdateTask, useDeleteTask, useArchiveTask } from '@/hooks/useTasks';
import { cn } from '@/lib/utils';
import type { Task, TaskStatus } from '@veritas-kanban/shared';

const STATUS_BUTTONS: { id: TaskStatus; label: string; color: string; activeColor: string }[] = [
  {
    id: 'todo',
    label: 'Todo',
    color: 'border-slate-400 text-slate-600',
    activeColor: 'bg-slate-500 text-white border-slate-500',
  },
  {
    id: 'planning',
    label: 'Planning',
    color: 'border-violet-400 text-violet-600',
    activeColor: 'bg-violet-500 text-white border-violet-500',
  },
  {
    id: 'in-progress',
    label: 'In Progress',
    color: 'border-blue-400 text-blue-600',
    activeColor: 'bg-blue-500 text-white border-blue-500',
  },
  {
    id: 'blocked',
    label: 'Blocked',
    color: 'border-red-400 text-red-600',
    activeColor: 'bg-red-500 text-white border-red-500',
  },
  {
    id: 'done',
    label: 'Done',
    color: 'border-green-400 text-green-600',
    activeColor: 'bg-green-500 text-white border-green-500',
  },
];

interface BulkActionsBarProps {
  tasks: Task[];
}

export function BulkActionsBar({ tasks }: BulkActionsBarProps) {
  const { selectedIds, isSelecting, toggleSelecting, selectAll, toggleGroup, clearSelection } =
    useBulkActions();

  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const archiveTask = useArchiveTask();

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // Group task IDs by status
  const taskIdsByStatus = useMemo(() => {
    const map: Record<TaskStatus, string[]> = {
      todo: [],
      planning: [],
      'in-progress': [],
      blocked: [],
      done: [],
    };
    for (const task of tasks) {
      if (map[task.status]) {
        map[task.status].push(task.id);
      }
    }
    return map;
  }, [tasks]);

  const allTaskIds = useMemo(() => tasks.map((t) => t.id), [tasks]);
  const selectedCount = selectedIds.size;
  const allSelected = selectedCount === allTaskIds.length && allTaskIds.length > 0;

  const handleSelectAll = () => {
    if (allSelected) {
      clearSelection();
    } else {
      selectAll(allTaskIds);
    }
  };

  /** Check if all tasks of a given status are selected */
  const isStatusFullySelected = (status: TaskStatus): boolean => {
    const ids = taskIdsByStatus[status];
    return ids.length > 0 && ids.every((id) => selectedIds.has(id));
  };

  /** Check if some (but not all) tasks of a given status are selected */
  const isStatusPartiallySelected = (status: TaskStatus): boolean => {
    const ids = taskIdsByStatus[status];
    if (ids.length === 0) return false;
    const someSelected = ids.some((id) => selectedIds.has(id));
    const allSelectedInGroup = ids.every((id) => selectedIds.has(id));
    return someSelected && !allSelectedInGroup;
  };

  const handleMoveToStatus = async (status: TaskStatus) => {
    setIsProcessing(true);
    try {
      await Promise.all(
        Array.from(selectedIds).map((id) => updateTask.mutateAsync({ id, input: { status } }))
      );
      clearSelection();
    } finally {
      setIsProcessing(false);
    }
  };

  const handleArchiveSelected = async () => {
    setIsProcessing(true);
    try {
      await Promise.all(Array.from(selectedIds).map((id) => archiveTask.mutateAsync(id)));
      clearSelection();
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteSelected = async () => {
    setIsProcessing(true);
    try {
      await Promise.all(Array.from(selectedIds).map((id) => deleteTask.mutateAsync(id)));
      clearSelection();
    } finally {
      setIsProcessing(false);
      setShowDeleteConfirm(false);
    }
  };

  if (!isSelecting) {
    return (
      <div className="flex justify-end mb-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleSelecting}
          className="text-muted-foreground"
        >
          <CheckSquare className="h-4 w-4 mr-1" />
          Select
        </Button>
      </div>
    );
  }

  return (
    <>
      <div
        className="flex items-center justify-between gap-4 mb-4 p-3 rounded-lg bg-muted/50 border"
        role="toolbar"
        aria-label="Bulk actions"
      >
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={toggleSelecting}>
            <X className="h-4 w-4" />
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleSelectAll}
            aria-label={allSelected ? 'Deselect all tasks' : 'Select all tasks'}
          >
            {allSelected ? 'Deselect All' : 'Select All'}
          </Button>

          {/* Status filter buttons */}
          <div className="flex items-center gap-1.5 ml-1">
            {STATUS_BUTTONS.map(({ id, label, color, activeColor }) => {
              const count = taskIdsByStatus[id].length;
              if (count === 0) return null;
              const fullySelected = isStatusFullySelected(id);
              const partiallySelected = isStatusPartiallySelected(id);
              return (
                <Button
                  key={id}
                  variant="outline"
                  size="sm"
                  onClick={() => toggleGroup(taskIdsByStatus[id])}
                  className={cn(
                    'text-xs h-7 px-2 border transition-colors',
                    fullySelected ? activeColor : partiallySelected ? `${color} opacity-70` : color
                  )}
                  aria-label={`Select all ${label} tasks (${count})`}
                  aria-pressed={fullySelected}
                >
                  {label} ({count})
                </Button>
              );
            })}
          </div>

          <span className="text-sm text-muted-foreground ml-1">{selectedCount} selected</span>
        </div>

        {selectedCount > 0 && (
          <div className="flex items-center gap-2">
            {/* Move to status */}
            <Select
              value=""
              onValueChange={(value) => handleMoveToStatus(value as TaskStatus)}
              disabled={isProcessing}
            >
              <SelectTrigger className="w-[140px]">
                <div className="flex items-center gap-1">
                  <ArrowRight className="h-4 w-4" />
                  <span>Move to...</span>
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todo">To Do</SelectItem>
                <SelectItem value="planning">Planning</SelectItem>
                <SelectItem value="in-progress">In Progress</SelectItem>
                <SelectItem value="review">Review</SelectItem>
                <SelectItem value="done">Done</SelectItem>
              </SelectContent>
            </Select>

            {/* Archive */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleArchiveSelected}
              disabled={isProcessing}
            >
              <Archive className="h-4 w-4 mr-1" />
              Archive
            </Button>

            {/* Delete */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={isProcessing}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Delete
            </Button>
          </div>
        )}
      </div>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedCount} task{selectedCount !== 1 ? 's' : ''}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The selected tasks will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isProcessing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteSelected}
              disabled={isProcessing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isProcessing ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
