import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useAddSubtask, useUpdateSubtask, useDeleteSubtask } from '@/hooks/useTasks';
import { cn } from '@/lib/utils';
import type { Task, Subtask } from '@veritas-kanban/shared';

interface SubtasksSectionProps {
  task: Task;
  onAutoCompleteChange: (value: boolean) => void;
}

export function SubtasksSection({ task, onAutoCompleteChange }: SubtasksSectionProps) {
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const addSubtask = useAddSubtask();
  const updateSubtask = useUpdateSubtask();
  const deleteSubtask = useDeleteSubtask();

  const subtasks = task.subtasks || [];
  const completedCount = subtasks.filter((s) => s.completed).length;
  const totalCount = subtasks.length;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  const handleAddSubtask = async () => {
    if (!newSubtaskTitle.trim()) return;

    setIsAdding(true);
    try {
      await addSubtask.mutateAsync({ taskId: task.id, title: newSubtaskTitle.trim() });
      setNewSubtaskTitle('');
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAddSubtask();
    }
  };

  return (
    <section className="space-y-3" aria-label="Subtasks">
      <div className="flex items-center justify-between">
        <Label className="text-muted-foreground">Subtasks</Label>
        {totalCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {completedCount}/{totalCount} complete
          </span>
        )}
      </div>

      {/* Progress bar */}
      {totalCount > 0 && (
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* Subtask list */}
      <div className="space-y-1">
        {subtasks.map((subtask) => (
          <div
            key={subtask.id}
            className={cn(
              'flex items-center gap-2 p-2 rounded-md group hover:bg-muted/50 transition-colors',
              subtask.completed && 'opacity-60'
            )}
          >
            <Checkbox
              checked={subtask.completed}
              onCheckedChange={() => handleToggleSubtask(subtask)}
              className="flex-shrink-0"
              aria-label={`Mark "${subtask.title}" as ${subtask.completed ? 'incomplete' : 'complete'}`}
            />
            <span
              className={cn(
                'flex-1 text-sm',
                subtask.completed && 'line-through text-muted-foreground'
              )}
            >
              {subtask.title}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => handleDeleteSubtask(subtask.id)}
              aria-label={`Delete subtask: ${subtask.title}`}
            >
              <Trash2
                className="h-3 w-3 text-muted-foreground hover:text-destructive"
                aria-hidden="true"
              />
            </Button>
          </div>
        ))}
      </div>

      {/* Add subtask input */}
      <div className="flex gap-2">
        <Input
          value={newSubtaskTitle}
          onChange={(e) => setNewSubtaskTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add a subtask..."
          aria-label="New subtask title"
          className="text-sm"
          disabled={isAdding}
        />
        <Button
          size="icon"
          onClick={handleAddSubtask}
          disabled={!newSubtaskTitle.trim() || isAdding}
          className="h-9 w-9 shrink-0"
          aria-label="Add subtask"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      {/* Auto-complete toggle */}
      {totalCount > 0 && (
        <div className="flex items-center justify-between pt-2 border-t">
          <Label htmlFor="auto-complete" className="text-xs text-muted-foreground cursor-pointer">
            Auto-complete task when all subtasks done
          </Label>
          <Switch
            id="auto-complete"
            checked={task.autoCompleteOnSubtasks || false}
            onCheckedChange={onAutoCompleteChange}
          />
        </div>
      )}
    </section>
  );
}
