import { useState, useMemo, useRef } from 'react';
import { Plus, X, Ban, CheckCircle2, Link as LinkIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useTasks, isTaskBlocked } from '@/hooks/useTasks';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/useToast';
import type { Task } from '@veritas-kanban/shared';
import { useQueryClient } from '@tanstack/react-query';

interface DependenciesSectionProps {
  task: Task;
  onBlockedByChange: (blockedBy: string[] | undefined) => void;
}

export function DependenciesSection({
  task,
  onBlockedByChange: _onBlockedByChange,
}: DependenciesSectionProps) {
  const { data: allTasks } = useTasks();
  const [isAddingDependsOn, setIsAddingDependsOn] = useState(false);
  const [isAddingBlocks, setIsAddingBlocks] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Refs for focus management
  const addDependsOnButtonRef = useRef<HTMLButtonElement>(null);
  const addBlocksButtonRef = useRef<HTMLButtonElement>(null);

  const dependsOn = task.dependencies?.depends_on || [];
  const blocks = task.dependencies?.blocks || [];

  // Get available tasks (not self, not already in relationship)
  const availableTasksForDependsOn = useMemo(() => {
    if (!allTasks) return [];
    return allTasks.filter(
      (t) => t.id !== task.id && !dependsOn.includes(t.id) && t.status !== 'done'
    );
  }, [allTasks, task.id, dependsOn]);

  const availableTasksForBlocks = useMemo(() => {
    if (!allTasks) return [];
    return allTasks.filter(
      (t) => t.id !== task.id && !blocks.includes(t.id) && t.status !== 'done'
    );
  }, [allTasks, task.id, blocks]);

  // Get task details for dependencies
  const dependsOnTasks = useMemo(() => {
    if (!allTasks) return [];
    return dependsOn.map((id) => allTasks.find((t) => t.id === id)).filter(Boolean) as Task[];
  }, [allTasks, dependsOn]);

  const blocksTasks = useMemo(() => {
    if (!allTasks) return [];
    return blocks.map((id) => allTasks.find((t) => t.id === id)).filter(Boolean) as Task[];
  }, [allTasks, blocks]);

  const isCurrentlyBlocked = useMemo(() => {
    if (!allTasks) return false;
    return isTaskBlocked(task, allTasks);
  }, [task, allTasks]);

  const handleAddDependency = async (targetId: string, type: 'depends_on' | 'blocks') => {
    try {
      const response = await fetch(`/api/tasks/${task.id}/dependencies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [type]: targetId }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to add dependency');
      }

      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['tasks'] });

      toast({
        title: 'Dependency added',
        description: `Successfully added ${type === 'depends_on' ? 'dependency' : 'blocker'}`,
      });

      // Close the select and return focus to the Add button
      if (type === 'depends_on') {
        setIsAddingDependsOn(false);
        // Return focus to the Add Dependency button after DOM update
        setTimeout(() => addDependsOnButtonRef.current?.focus(), 0);
      } else {
        setIsAddingBlocks(false);
        // Return focus to the Add Blocker button after DOM update
        setTimeout(() => addBlocksButtonRef.current?.focus(), 0);
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to add dependency',
        variant: 'destructive',
      });
    }
  };

  const handleRemoveDependency = async (targetId: string) => {
    try {
      const response = await fetch(`/api/tasks/${task.id}/dependencies/${targetId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to remove dependency');
      }

      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['tasks'] });

      toast({
        title: 'Dependency removed',
        description: 'Successfully removed dependency',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to remove dependency',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label className="text-muted-foreground flex items-center gap-2">
          <LinkIcon className="h-4 w-4" aria-hidden="true" />
          Dependencies
        </Label>
        {isCurrentlyBlocked && (
          <Badge variant="destructive" className="text-xs">
            <Ban className="h-3 w-3 mr-1" aria-hidden="true" />
            Blocked
          </Badge>
        )}
      </div>

      {/* Depends On Section */}
      <div className="space-y-2">
        <div className="text-sm font-medium text-foreground/70">Depends On</div>

        {dependsOnTasks.length > 0 && (
          <div className="space-y-1">
            {dependsOnTasks.map((dep) => (
              <div
                key={dep.id}
                className={cn(
                  'flex items-center gap-2 p-2 rounded-md bg-muted/50 group',
                  dep.status === 'done' && 'opacity-60'
                )}
              >
                {dep.status === 'done' ? (
                  <CheckCircle2
                    className="h-4 w-4 text-green-500 flex-shrink-0"
                    aria-hidden="true"
                  />
                ) : (
                  <Ban className="h-4 w-4 text-red-400 flex-shrink-0" aria-hidden="true" />
                )}
                <span
                  className={cn(
                    'flex-1 text-sm truncate',
                    dep.status === 'done' && 'line-through text-muted-foreground'
                  )}
                >
                  {dep.title}
                </span>
                <Badge variant="secondary" className="text-xs">
                  {dep.status}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                  onClick={() => handleRemoveDependency(dep.id)}
                  aria-label={`Remove dependency: ${dep.title}`}
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Add depends_on */}
        {isAddingDependsOn ? (
          <div className="flex gap-2">
            <Select onValueChange={(id) => handleAddDependency(id, 'depends_on')}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Select a task this depends on..." />
              </SelectTrigger>
              <SelectContent>
                {availableTasksForDependsOn.length === 0 ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">
                    No available tasks
                  </div>
                ) : (
                  availableTasksForDependsOn.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      <span className="truncate">{t.title}</span>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsAddingDependsOn(false)}
              aria-label="Cancel adding dependency"
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            ref={addDependsOnButtonRef}
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => setIsAddingDependsOn(true)}
          >
            <Plus className="h-4 w-4 mr-1" aria-hidden="true" />
            Add Dependency
          </Button>
        )}
      </div>

      {/* Blocks Section */}
      <div className="space-y-2 border-t pt-3">
        <div className="text-sm font-medium text-foreground/70">Blocks</div>

        {blocksTasks.length > 0 && (
          <div className="space-y-1">
            {blocksTasks.map((blocked) => (
              <div
                key={blocked.id}
                className="flex items-center gap-2 p-2 rounded-md bg-muted/50 group"
              >
                <Ban className="h-4 w-4 text-amber-500 flex-shrink-0" aria-hidden="true" />
                <span className="flex-1 text-sm truncate">{blocked.title}</span>
                <Badge variant="secondary" className="text-xs">
                  {blocked.status}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                  onClick={() => handleRemoveDependency(blocked.id)}
                  aria-label={`Remove blocker: ${blocked.title}`}
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Add blocks */}
        {isAddingBlocks ? (
          <div className="flex gap-2">
            <Select onValueChange={(id) => handleAddDependency(id, 'blocks')}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Select a task this blocks..." />
              </SelectTrigger>
              <SelectContent>
                {availableTasksForBlocks.length === 0 ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">
                    No available tasks
                  </div>
                ) : (
                  availableTasksForBlocks.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      <span className="truncate">{t.title}</span>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsAddingBlocks(false)}
              aria-label="Cancel adding blocker"
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            ref={addBlocksButtonRef}
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => setIsAddingBlocks(true)}
          >
            <Plus className="h-4 w-4 mr-1" aria-hidden="true" />
            Add Blocker
          </Button>
        )}
      </div>

      {dependsOnTasks.length === 0 && blocksTasks.length === 0 && (
        <p className="text-xs text-muted-foreground text-center pt-2">
          No dependencies. This task is independent.
        </p>
      )}
    </div>
  );
}
