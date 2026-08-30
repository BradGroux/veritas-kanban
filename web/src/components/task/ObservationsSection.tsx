import { useState } from 'react';
import { Eye, Trash2, Plus } from 'lucide-react';
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Modal,
  Paper,
  Select,
  SimpleGrid,
  Slider,
  Stack,
  Text,
  Textarea,
} from '@mantine/core';
import type { Task, Observation, ObservationType } from '@veritas-kanban/shared';

interface ObservationsSectionProps {
  task: Task;
  onAddObservation: (data: {
    type: ObservationType;
    content: string;
    score: number;
    agent?: string;
  }) => Promise<void>;
  onDeleteObservation: (observationId: string) => Promise<void>;
}

function formatRelativeTime(timestamp: string): string {
  const now = new Date();
  const date = new Date(timestamp);
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600)
    return `${Math.floor(seconds / 60)} minute${Math.floor(seconds / 60) === 1 ? '' : 's'} ago`;
  if (seconds < 86400)
    return `${Math.floor(seconds / 3600)} hour${Math.floor(seconds / 3600) === 1 ? '' : 's'} ago`;
  if (seconds < 604800)
    return `${Math.floor(seconds / 86400)} day${Math.floor(seconds / 86400) === 1 ? '' : 's'} ago`;

  return date.toLocaleDateString();
}

const TYPE_COLORS: Record<ObservationType, string> = {
  decision: 'violet',
  blocker: 'red',
  insight: 'blue',
  context: 'gray',
};

const OBSERVATION_TYPES: { value: ObservationType; label: string }[] = [
  { value: 'context', label: 'Context' },
  { value: 'decision', label: 'Decision' },
  { value: 'insight', label: 'Insight' },
  { value: 'blocker', label: 'Blocker' },
];

function ObservationItem({
  observation,
  onDelete,
}: {
  observation: Observation;
  onDelete: (observationId: string) => Promise<void>;
}) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const handleDelete = async () => {
    await onDelete(observation.id);
    setDeleteDialogOpen(false);
  };

  return (
    <>
      <Paper
        className="group bg-card p-3 transition-colors hover:bg-muted/30"
        radius="md"
        withBorder
      >
        <Stack gap="xs">
          <Group gap="xs" align="center">
            <Badge color={TYPE_COLORS[observation.type]} variant="light" size="sm">
              {observation.type}
            </Badge>
            <Text size="xs" fw={500} c="dimmed">
              Score: {observation.score}/10
            </Text>
            <Text size="xs" c="dimmed">
              {formatRelativeTime(observation.timestamp)}
            </Text>
            {observation.agent && (
              <Text size="xs" c="dimmed">
                by {observation.agent}
              </Text>
            )}
            {/* Delete button - visible on hover */}
            <ActionIcon
              variant="subtle"
              color="red"
              size="sm"
              className="veritas-secondary-action ml-auto"
              aria-label={`Delete observation: ${observation.content}`}
              onClick={() => setDeleteDialogOpen(true)}
            >
              <Trash2
                className="h-3 w-3 text-muted-foreground hover:text-destructive"
                aria-hidden="true"
              />
            </ActionIcon>
          </Group>
          <Text size="sm" className="whitespace-pre-wrap text-foreground">
            {observation.content}
          </Text>
        </Stack>
      </Paper>

      <Modal
        opened={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        title="Delete Observation"
        centered
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Are you sure you want to delete this observation? This action cannot be undone.
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              color="red"
              onClick={() => {
                void handleDelete();
              }}
            >
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

export function ObservationsSection({
  task,
  onAddObservation,
  onDeleteObservation,
}: ObservationsSectionProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [newObsType, setNewObsType] = useState<ObservationType>('context');
  const [newObsContent, setNewObsContent] = useState('');
  const [newObsScore, setNewObsScore] = useState(5);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const observations = task.observations || [];

  const handleAdd = async () => {
    if (!newObsContent.trim()) return;

    setIsSubmitting(true);
    try {
      await onAddObservation({
        type: newObsType,
        content: newObsContent.trim(),
        score: newObsScore,
      });
      setNewObsContent('');
      setNewObsScore(5);
      setNewObsType('context');
      setIsAdding(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center">
        <Group gap="xs">
          <Eye className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <Text size="lg" fw={600}>
            Observations
          </Text>
          <Text size="sm" c="dimmed">
            ({observations.length})
          </Text>
        </Group>
        {!isAdding && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsAdding(true)}
            leftSection={<Plus className="h-4 w-4" aria-hidden="true" />}
          >
            Add Observation
          </Button>
        )}
      </Group>

      {isAdding && (
        <Paper className="bg-card p-4" radius="lg" withBorder>
          <Stack gap="sm">
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              <Stack gap="xs">
                <Text component="label" htmlFor="obs-type" size="sm" fw={500}>
                  Type
                </Text>
                <Select
                  id="obs-type"
                  aria-label="Observation type"
                  allowDeselect={false}
                  data={OBSERVATION_TYPES}
                  value={newObsType}
                  onChange={(value) => {
                    if (value) setNewObsType(value as ObservationType);
                  }}
                />
              </Stack>
              <Stack gap="xs">
                <Text component="label" htmlFor="obs-score" size="sm" fw={500}>
                  Importance: {newObsScore}/10
                </Text>
                <Slider
                  id="obs-score"
                  min={1}
                  max={10}
                  value={newObsScore}
                  onChange={setNewObsScore}
                  aria-label={`Importance score: ${newObsScore} out of 10`}
                />
              </Stack>
            </SimpleGrid>
            <Stack gap="xs">
              <Text component="label" htmlFor="obs-content" size="sm" fw={500}>
                Content
              </Text>
              <Textarea
                id="obs-content"
                value={newObsContent}
                onChange={(e) => setNewObsContent(e.currentTarget.value)}
                placeholder="Record a decision, blocker, insight, or context..."
                className="min-h-[100px] resize-none"
                autoFocus
              />
            </Stack>
            <Group gap="xs" justify="flex-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setIsAdding(false);
                  setNewObsContent('');
                  setNewObsScore(5);
                  setNewObsType('context');
                }}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  void handleAdd();
                }}
                disabled={!newObsContent.trim() || isSubmitting}
              >
                {isSubmitting ? 'Adding...' : 'Add Observation'}
              </Button>
            </Group>
          </Stack>
        </Paper>
      )}

      <Stack gap="xs">
        {observations.length === 0 && !isAdding && (
          <Text size="sm" c="dimmed" ta="center" className="py-8">
            No observations yet. Add context, decisions, insights, or blockers as you work on this
            task.
          </Text>
        )}
        {observations
          .slice()
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
          .map((obs) => (
            <ObservationItem key={obs.id} observation={obs} onDelete={onDeleteObservation} />
          ))}
      </Stack>
    </Stack>
  );
}
