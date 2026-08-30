import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ActionIcon,
  Box,
  Button,
  Group,
  Modal,
  Paper,
  ScrollArea,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { formatDuration, parseDuration } from '@/hooks/useTimeTracking';
import { api } from '@/lib/api';
import { Play, Square, Plus, Trash2, Clock, Loader2, Timer } from 'lucide-react';
import type { Task, TimeEntry, TimeTracking } from '@veritas-kanban/shared';
import { cn } from '@/lib/utils';
import { sanitizeText } from '@/lib/sanitize';

interface TimeTrackingSectionProps {
  task: Task;
}

// ─── Running Timer Display ──────────────────────────────────────────────────

function RunningTimer({ startTime }: { startTime: string }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = new Date(startTime).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startTime]);

  return (
    <Text
      component="span"
      ff="monospace"
      className="tabular-nums text-green-600 dark:text-green-400"
    >
      {formatDuration(elapsed)}
    </Text>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────
//
// Architecture: fully self-contained local state.
//
// The component owns a `timeTracking` state variable that is:
//   1. Initialized from the task prop on mount / task change
//   2. Updated ONLY from direct API responses (start, stop, add, delete)
//
// There is NO cache sync. The React Query ['tasks'] cache is patched after
// each mutation (so other components like the board stay current), but this
// component never reads back from it. This eliminates all race conditions
// with debounced saves, background refetches, and invalidation storms.
//
// Trade-off: external timer changes (another browser tab, direct API call)
// won't appear until the panel is closed and reopened. Acceptable.

export function TimeTrackingSection({ task }: TimeTrackingSectionProps) {
  const queryClient = useQueryClient();

  // ── Local state ──
  const [timeTracking, setTimeTracking] = useState<TimeTracking | undefined>(task.timeTracking);
  const [busy, setBusy] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [durationInput, setDurationInput] = useState('');
  const [descriptionInput, setDescriptionInput] = useState('');

  // Reset when a different task is opened
  const taskIdRef = useRef(task.id);
  useEffect(() => {
    if (task.id !== taskIdRef.current) {
      taskIdRef.current = task.id;
      setTimeTracking(task.timeTracking);
    }
  }, [task.id, task.timeTracking]);

  // ── Derived values ──
  const isRunning = timeTracking?.isRunning ?? false;
  const totalSeconds = timeTracking?.totalSeconds ?? 0;
  const entries = timeTracking?.entries ?? [];
  const activeEntry = entries.find((e) => e.id === timeTracking?.activeEntryId);

  // ── Cache helper: patch React Query so the board/other components stay current ──
  const patchCache = (updated: Task) => {
    queryClient.setQueryData<Task[]>(['tasks'], (old) =>
      old ? old.map((t) => (t.id === updated.id ? updated : t)) : old
    );
    queryClient.setQueryData(['tasks', updated.id], updated);
  };

  // ── Handlers ──

  const handleStartStop = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = isRunning ? await api.time.stop(task.id) : await api.time.start(task.id);
      setTimeTracking(result.timeTracking);
      patchCache(result);
    } catch (err) {
      // API rejected — fetch fresh state so UI converges
      try {
        const fresh = await api.tasks.get(task.id);
        setTimeTracking(fresh.timeTracking);
        patchCache(fresh);
      } catch {
        // network down — leave UI as-is
      }
      console.warn('[TimeTracking] start/stop failed:', err);
    } finally {
      setBusy(false);
    }
  };

  const handleAddEntry = async () => {
    const seconds = parseDuration(durationInput);
    if (!seconds || busy) return;
    setBusy(true);
    try {
      const result = await api.time.addEntry(task.id, seconds, descriptionInput || undefined);
      setTimeTracking(result.timeTracking);
      patchCache(result);
      setDurationInput('');
      setDescriptionInput('');
      setAddDialogOpen(false);
    } catch (err) {
      console.warn('[TimeTracking] add entry failed:', err);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteEntry = async (entryId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await api.time.deleteEntry(task.id, entryId);
      setTimeTracking(result.timeTracking);
      patchCache(result);
    } catch (err) {
      console.warn('[TimeTracking] delete entry failed:', err);
    } finally {
      setBusy(false);
    }
  };

  // ── Formatters ──

  const formatEntryTime = (entry: TimeEntry) =>
    new Date(entry.startTime).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

  // ── Render ──

  return (
    <Stack gap="md">
      {/* Header */}
      <Group justify="space-between" align="center">
        <Group gap="xs">
          <Clock className="h-4 w-4" />
          <Text size="sm" c="dimmed" fw={500}>
            Time Tracking
          </Text>
        </Group>
        <Text size="sm" fw={500}>
          Total: {formatDuration(totalSeconds)}
        </Text>
      </Group>

      <Paper className="space-y-4 bg-muted/30 p-4" radius="lg" withBorder>
        {/* Timer Controls */}
        <Group justify="space-between" align="center">
          <Group gap="sm">
            {isRunning ? (
              <Button
                color="red"
                size="sm"
                onClick={() => {
                  void handleStartStop();
                }}
                disabled={busy}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Square className="h-4 w-4 mr-2" />
                    Stop
                  </>
                )}
              </Button>
            ) : (
              <Button
                variant="filled"
                size="sm"
                onClick={() => {
                  void handleStartStop();
                }}
                disabled={busy}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Start
                  </>
                )}
              </Button>
            )}

            {isRunning && activeEntry && (
              <Group gap="xs">
                <Timer className="h-4 w-4 text-green-500" />
                <RunningTimer startTime={activeEntry.startTime} />
              </Group>
            )}
          </Group>

          {/* Add Manual Entry */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAddDialogOpen(true)}
            leftSection={<Plus className="h-4 w-4" />}
          >
            Add Time
          </Button>
        </Group>

        <Modal
          opened={addDialogOpen}
          onClose={() => setAddDialogOpen(false)}
          title="Add Time Entry"
          centered
        >
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              Manually add time spent on this task.
            </Text>
            <Stack gap="xs">
              <Text component="label" htmlFor="duration" size="sm" fw={500}>
                Duration
              </Text>
              <TextInput
                id="duration"
                value={durationInput}
                onChange={(e) => setDurationInput(e.currentTarget.value)}
                placeholder="e.g., 1h 30m or 45m or 30"
              />
              <Text size="xs" c="dimmed">
                Enter as &quot;1h 30m&quot;, &quot;45m&quot;, or just minutes (e.g., &quot;30&quot;)
              </Text>
            </Stack>
            <Stack gap="xs">
              <Text component="label" htmlFor="description" size="sm" fw={500}>
                Description (optional)
              </Text>
              <TextInput
                id="description"
                value={descriptionInput}
                onChange={(e) => setDescriptionInput(e.currentTarget.value)}
                placeholder="What did you work on?"
              />
            </Stack>
            <Group justify="flex-end" gap="xs">
              <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  void handleAddEntry();
                }}
                disabled={!parseDuration(durationInput) || busy}
                leftSection={
                  busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />
                }
              >
                Add Entry
              </Button>
            </Group>
          </Stack>
        </Modal>

        {/* Time Entries List */}
        {entries.length > 0 && (
          <Box className="border-t pt-3">
            <Text size="xs" c="dimmed" className="mb-2 block">
              Time Entries ({entries.length})
            </Text>
            <ScrollArea.Autosize mah={192}>
              <Stack gap="xs">
                {entries
                  .slice()
                  .reverse()
                  .map((entry) => {
                    const isActive = entry.id === timeTracking?.activeEntryId;
                    return (
                      <Paper
                        key={entry.id}
                        className={cn(
                          'flex items-center justify-between p-2 text-sm',
                          isActive ? 'bg-green-500/10 border border-green-500/20' : 'bg-muted/50'
                        )}
                        radius="sm"
                      >
                        <Box className="min-w-0 flex-1">
                          <Group gap="xs">
                            {isActive ? (
                              <Timer className="h-3 w-3 text-green-500 flex-shrink-0" />
                            ) : (
                              <Clock className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                            )}
                            <span className="font-medium">
                              {entry.duration != null ? (
                                formatDuration(entry.duration)
                              ) : (
                                <RunningTimer startTime={entry.startTime} />
                              )}
                            </span>
                            {entry.manual && (
                              <Text component="span" size="xs" c="dimmed">
                                (manual)
                              </Text>
                            )}
                          </Group>
                          <Text size="xs" c="dimmed" className="truncate pl-5">
                            {entry.description
                              ? sanitizeText(entry.description)
                              : formatEntryTime(entry)}
                          </Text>
                        </Box>
                        {!isActive && (
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            size="sm"
                            onClick={() => {
                              void handleDeleteEntry(entry.id);
                            }}
                            disabled={busy}
                            aria-label="Delete time entry"
                          >
                            <Trash2 className="h-3 w-3" />
                          </ActionIcon>
                        )}
                      </Paper>
                    );
                  })}
              </Stack>
            </ScrollArea.Autosize>
          </Box>
        )}
      </Paper>
    </Stack>
  );
}
