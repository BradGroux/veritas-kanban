import { useState, useMemo, useRef } from 'react';
import { API_BASE } from '@/lib/config';
import { Plus, X, Ban, CheckCircle2, Link as LinkIcon } from 'lucide-react';
import { ActionIcon, Badge, Button, Group, Paper, Select, Stack, Text } from '@mantine/core';
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

  const dependsOn = useMemo(
    () => task.dependencies?.depends_on || [],
    [task.dependencies?.depends_on]
  );
  const blocks = useMemo(() => task.dependencies?.blocks || [], [task.dependencies?.blocks]);

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
      const response = await fetch(`${API_BASE}/tasks/${task.id}/dependencies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [type]: targetId }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to add dependency');
      }

      // Invalidate queries to refresh data
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });

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
      const response = await fetch(`${API_BASE}/tasks/${task.id}/dependencies/${targetId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to remove dependency');
      }

      // Invalidate queries to refresh data
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });

      toast({
        title: 'Dependency removed',
        description: 'Successfully removed dependency',
      });
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to remove dependency',
        variant: 'destructive',
      });
    }
  };

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center">
        <Group gap="xs" className="text-muted-foreground">
          <LinkIcon className="h-4 w-4" aria-hidden="true" />
          <Text size="sm" fw={500}>
            Dependencies
          </Text>
        </Group>
        {isCurrentlyBlocked && (
          <Badge color="red" variant="filled" size="sm" leftSection={<Ban className="h-3 w-3" />}>
            Blocked
          </Badge>
        )}
      </Group>

      {/* Depends On Section */}
      <Stack gap="xs">
        <Text size="sm" fw={500} className="text-foreground/70">
          Depends On
        </Text>

        {dependsOnTasks.length > 0 && (
          <Stack gap={4}>
            {dependsOnTasks.map((dep) => (
              <Paper
                key={dep.id}
                radius="md"
                className={cn(
                  'group flex items-center gap-2 bg-muted/50 p-2',
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
                <Badge color="gray" variant="light" size="sm">
                  {dep.status}
                </Badge>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                  onClick={() => {
                    void handleRemoveDependency(dep.id);
                  }}
                  aria-label={`Remove dependency: ${dep.title}`}
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </ActionIcon>
              </Paper>
            ))}
          </Stack>
        )}

        {/* Add depends_on */}
        {isAddingDependsOn ? (
          <Group gap="xs" align="flex-start" wrap="nowrap">
            <Select
              aria-label="Select dependency task"
              className="flex-1"
              placeholder="Select a task this depends on..."
              data={availableTasksForDependsOn.map((t) => ({ value: t.id, label: t.title }))}
              nothingFoundMessage="No available tasks"
              onChange={(id) => {
                if (id) void handleAddDependency(id, 'depends_on');
              }}
            />
            <Button
              variant="subtle"
              size="xs"
              onClick={() => setIsAddingDependsOn(false)}
              aria-label="Cancel adding dependency"
            >
              Cancel
            </Button>
          </Group>
        ) : (
          <Button
            ref={addDependsOnButtonRef}
            variant="outline"
            size="xs"
            className="w-full"
            onClick={() => setIsAddingDependsOn(true)}
            leftSection={<Plus className="h-4 w-4" aria-hidden="true" />}
          >
            Add Dependency
          </Button>
        )}
      </Stack>

      {/* Blocks Section */}
      <Stack gap="xs" className="border-t pt-3">
        <Text size="sm" fw={500} className="text-foreground/70">
          Blocks
        </Text>

        {blocksTasks.length > 0 && (
          <Stack gap={4}>
            {blocksTasks.map((blocked) => (
              <Paper
                key={blocked.id}
                radius="md"
                className="group flex items-center gap-2 bg-muted/50 p-2"
              >
                <Ban className="h-4 w-4 text-amber-500 flex-shrink-0" aria-hidden="true" />
                <span className="flex-1 text-sm truncate">{blocked.title}</span>
                <Badge color="gray" variant="light" size="sm">
                  {blocked.status}
                </Badge>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                  onClick={() => {
                    void handleRemoveDependency(blocked.id);
                  }}
                  aria-label={`Remove blocker: ${blocked.title}`}
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </ActionIcon>
              </Paper>
            ))}
          </Stack>
        )}

        {/* Add blocks */}
        {isAddingBlocks ? (
          <Group gap="xs" align="flex-start" wrap="nowrap">
            <Select
              aria-label="Select blocked task"
              className="flex-1"
              placeholder="Select a task this blocks..."
              data={availableTasksForBlocks.map((t) => ({ value: t.id, label: t.title }))}
              nothingFoundMessage="No available tasks"
              onChange={(id) => {
                if (id) void handleAddDependency(id, 'blocks');
              }}
            />
            <Button
              variant="subtle"
              size="xs"
              onClick={() => setIsAddingBlocks(false)}
              aria-label="Cancel adding blocker"
            >
              Cancel
            </Button>
          </Group>
        ) : (
          <Button
            ref={addBlocksButtonRef}
            variant="outline"
            size="xs"
            className="w-full"
            onClick={() => setIsAddingBlocks(true)}
            leftSection={<Plus className="h-4 w-4" aria-hidden="true" />}
          >
            Add Blocker
          </Button>
        )}
      </Stack>

      {dependsOnTasks.length === 0 && blocksTasks.length === 0 && (
        <Text size="xs" c="dimmed" ta="center" pt="xs">
          No dependencies. This task is independent.
        </Text>
      )}
    </Stack>
  );
}
