import { useState, useCallback, useRef, useEffect } from 'react';
import type { KeyboardEvent } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
} from '@mantine/core';
import { Lightbulb, X, Plus } from 'lucide-react';
import type { Task } from '@veritas-kanban/shared';

interface LessonsLearnedSectionProps {
  task: Task;
  onUpdate: <K extends keyof Task>(field: K, value: Task[K]) => void;
  readOnly?: boolean;
}

/**
 * Section for capturing lessons learned after task completion.
 * Only displayed when task status is 'done'.
 */
export function LessonsLearnedSection({
  task,
  onUpdate,
  readOnly = false,
}: LessonsLearnedSectionProps) {
  const [newTag, setNewTag] = useState('');
  const [localNotes, setLocalNotes] = useState(task.lessonsLearned || '');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync local state when task changes externally
  useEffect(() => {
    setLocalNotes(task.lessonsLearned || '');
  }, [task.lessonsLearned]);

  const debouncedUpdate = useCallback(
    (value: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onUpdate('lessonsLearned', value);
      }, 500);
    },
    [onUpdate]
  );

  // Only show for completed tasks
  if (task.status !== 'done') {
    return null;
  }

  const tags = task.lessonTags || [];

  const handleAddTag = () => {
    const trimmed = newTag.trim().toLowerCase();
    if (trimmed && !tags.includes(trimmed)) {
      onUpdate('lessonTags', [...tags, trimmed]);
      setNewTag('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    onUpdate(
      'lessonTags',
      tags.filter((t) => t !== tagToRemove)
    );
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    }
  };

  return (
    <Paper className="border border-border bg-muted p-4" radius="lg">
      <Stack gap="md">
        <Group gap="xs" className="text-violet-600 dark:text-violet-400">
          <ThemeIcon variant="light" color="violet" size="sm" radius="xl">
            <Lightbulb className="h-4 w-4" />
          </ThemeIcon>
          <Text fw={600}>Lessons Learned</Text>
        </Group>

        <Text size="sm" c="dimmed">
          Capture institutional knowledge from this completed task. What worked well? What would you
          do differently?
        </Text>

        <Stack gap="xs">
          <Text component="label" htmlFor="lessonsLearned" size="sm" fw={500}>
            Notes (Markdown supported)
          </Text>
          {readOnly ? (
            <Paper className="prose prose-sm dark:prose-invert max-w-none border border-border bg-card p-3">
              {task.lessonsLearned || (
                <Text component="span" size="sm" c="dimmed" fs="italic">
                  No lessons captured
                </Text>
              )}
            </Paper>
          ) : (
            <Textarea
              id="lessonsLearned"
              value={localNotes}
              onChange={(e) => {
                setLocalNotes(e.currentTarget.value);
                debouncedUpdate(e.currentTarget.value);
              }}
              placeholder="What did you learn from this task? What would you do differently next time?"
              rows={4}
              className="bg-card"
            />
          )}
        </Stack>

        <Stack gap="xs">
          <Text size="sm" fw={500}>
            Tags
          </Text>
          <Group gap="xs">
            {tags.map((tag) => (
              <Badge
                key={tag}
                variant="light"
                color="violet"
                rightSection={
                  !readOnly ? (
                    <ActionIcon
                      aria-label={`Remove ${tag} tag`}
                      color="gray"
                      size="xs"
                      variant="transparent"
                      onClick={() => handleRemoveTag(tag)}
                    >
                      <X className="h-3 w-3" />
                    </ActionIcon>
                  ) : undefined
                }
              >
                {tag}
              </Badge>
            ))}
            {tags.length === 0 && (
              <Text size="sm" c="dimmed" fs="italic">
                No tags added
              </Text>
            )}
          </Group>

          {!readOnly && (
            <Group gap="xs" align="flex-start" wrap="nowrap">
              <TextInput
                value={newTag}
                onChange={(e) => setNewTag(e.currentTarget.value)}
                onKeyDown={handleKeyDown}
                placeholder="Add a tag..."
                className="flex-1"
                aria-label="New lesson tag"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddTag}
                disabled={!newTag.trim()}
                aria-label="Add lesson tag"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </Group>
          )}
        </Stack>
      </Stack>
    </Paper>
  );
}
