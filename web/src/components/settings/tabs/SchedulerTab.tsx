import {
  Badge,
  Button,
  Group,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { CalendarClock, CheckCircle2, Pause, Play, RefreshCw, RotateCw } from 'lucide-react';
import type { SchedulerEvent, SchedulerItem, SchedulerRunStatus } from '@veritas-kanban/shared';
import { useIdentity } from '@/hooks/useIdentity';
import {
  useScheduler,
  useSchedulerPause,
  useSchedulerResume,
  useSchedulerRunDue,
  useSchedulerRunItem,
  useSchedulerValidate,
} from '@/hooks/useScheduler';
import { useToast } from '@/hooks/useToast';

const EMPTY_ITEMS: SchedulerItem[] = [];
const EMPTY_EVENTS: SchedulerEvent[] = [];

export function SchedulerTab() {
  const { hasPermission } = useIdentity();
  const { toast } = useToast();
  const scheduler = useScheduler();
  const runDue = useSchedulerRunDue();
  const runItem = useSchedulerRunItem();
  const pause = useSchedulerPause();
  const resume = useSchedulerResume();
  const validate = useSchedulerValidate();
  const canExecute = hasPermission('workflow:execute');
  const canWrite = hasPermission('workflow:write');
  const items = scheduler.data?.items ?? EMPTY_ITEMS;
  const events = scheduler.data?.recentEvents ?? EMPTY_EVENTS;

  const mutate = async (action: () => Promise<unknown>, successTitle: string) => {
    try {
      await action();
      toast({ title: successTitle });
    } catch (error) {
      toast({
        title: 'Scheduler action failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  if (scheduler.isLoading) {
    return (
      <Group gap="sm" className="text-muted-foreground">
        <Loader size="xs" />
        <Text size="sm">Loading scheduler...</Text>
      </Group>
    );
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="center">
        <Group gap="xs">
          <CalendarClock className="h-4 w-4 text-muted-foreground" />
          <Text size="sm" fw={600}>
            Recurring Work Scheduler
          </Text>
        </Group>
        <Group gap="xs">
          <Tooltip label="Run due schedules">
            <Button
              size="xs"
              variant="light"
              color="gray"
              disabled={!canExecute || runDue.isPending}
              leftSection={<Play className="h-3.5 w-3.5" />}
              onClick={() => mutate(() => runDue.mutateAsync(), 'Due schedules checked')}
            >
              Run Due
            </Button>
          </Tooltip>
          <Tooltip label="Refresh scheduler">
            <Button
              size="xs"
              variant="subtle"
              color="gray"
              leftSection={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={() => scheduler.refetch()}
            >
              Refresh
            </Button>
          </Tooltip>
        </Group>
      </Group>

      {scheduler.data && (
        <SimpleGrid cols={{ base: 2, md: 5 }} spacing="sm">
          <SummaryStat label="Total" value={scheduler.data.summary.total} />
          <SummaryStat label="Enabled" value={scheduler.data.summary.enabled} />
          <SummaryStat label="Due" value={scheduler.data.summary.due} />
          <SummaryStat label="Failed" value={scheduler.data.summary.failed} />
          <SummaryStat label="Blocked" value={scheduler.data.summary.blocked} />
        </SimpleGrid>
      )}

      <Stack gap="sm">
        {items.length === 0 ? (
          <Paper className="border border-dashed p-4 text-center" radius="md">
            <Text size="sm" c="dimmed">
              No recurring work is configured.
            </Text>
          </Paper>
        ) : (
          items.map((item) => (
            <Paper key={item.id} className="border bg-card p-4" radius="md">
              <Stack gap="sm">
                <Group justify="space-between" align="flex-start">
                  <Stack gap={2}>
                    <Group gap="xs">
                      <Text size="sm" fw={600}>
                        {item.name}
                      </Text>
                      <Badge
                        size="xs"
                        color={
                          item.kind === 'workflow'
                            ? 'blue'
                            : item.kind === 'queue-monitor'
                              ? 'teal'
                              : 'grape'
                        }
                        variant="light"
                      >
                        {item.kind === 'workflow'
                          ? 'Workflow'
                          : item.kind === 'queue-monitor'
                            ? 'Queue'
                            : 'Deliverable'}
                      </Badge>
                      <HealthBadge item={item} />
                    </Group>
                    <Text size="xs" c="dimmed" lineClamp={2}>
                      {item.description}
                    </Text>
                  </Stack>
                  <Group gap="xs">
                    <Button
                      size="xs"
                      variant="subtle"
                      color="gray"
                      disabled={validate.isPending}
                      leftSection={<CheckCircle2 className="h-3.5 w-3.5" />}
                      onClick={() =>
                        mutate(() => validate.mutateAsync(item.id), 'Scheduler item validated')
                      }
                    >
                      Validate
                    </Button>
                    <Button
                      size="xs"
                      variant="light"
                      color="gray"
                      disabled={!canExecute || runItem.isPending || !item.actions.canRun}
                      leftSection={<Play className="h-3.5 w-3.5" />}
                      onClick={() =>
                        mutate(() => runItem.mutateAsync(item.id), 'Scheduler item run started')
                      }
                    >
                      Run
                    </Button>
                    {item.enabled ? (
                      <Button
                        size="xs"
                        variant="subtle"
                        color="gray"
                        disabled={!canWrite || pause.isPending || !item.actions.canPause}
                        leftSection={<Pause className="h-3.5 w-3.5" />}
                        onClick={() =>
                          mutate(() => pause.mutateAsync(item.id), 'Scheduler item paused')
                        }
                      >
                        Pause
                      </Button>
                    ) : (
                      <Button
                        size="xs"
                        variant="subtle"
                        color="gray"
                        disabled={!canWrite || resume.isPending || !item.actions.canResume}
                        leftSection={<RotateCw className="h-3.5 w-3.5" />}
                        onClick={() =>
                          mutate(() => resume.mutateAsync(item.id), 'Scheduler item resumed')
                        }
                      >
                        Resume
                      </Button>
                    )}
                  </Group>
                </Group>
                <SimpleGrid cols={{ base: 1, md: 4 }} spacing="xs">
                  <Meta label="Schedule" value={item.trigger.description} />
                  <Meta label="Next" value={formatDate(item.nextRunAt)} />
                  <Meta label="Last" value={formatDate(item.lastRunAt)} />
                  <Meta label="Retry" value={`${item.retry.attempts}/${item.retry.maxAttempts}`} />
                </SimpleGrid>
                {item.lastSummary && (
                  <Text size="xs" c={item.lastStatus === 'failed' ? 'red' : 'dimmed'}>
                    {item.lastSummary}
                  </Text>
                )}
              </Stack>
            </Paper>
          ))
        )}
      </Stack>

      {events.length > 0 && (
        <Stack gap="sm">
          <Text size="sm" fw={600}>
            Recent Events
          </Text>
          <Stack gap="xs">
            {events.slice(0, 6).map((event) => (
              <Group key={event.id} justify="space-between" className="rounded border px-3 py-2">
                <Stack gap={0}>
                  <Text size="xs" fw={600}>
                    {event.summary}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {event.itemId} · {formatDate(event.runAt)}
                  </Text>
                </Stack>
                <StatusBadge status={event.status} />
              </Group>
            ))}
          </Stack>
        </Stack>
      )}
    </Stack>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <Paper className="border bg-card p-3" radius="md">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="lg" fw={700}>
        {value}
      </Text>
    </Paper>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <Stack gap={0}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="xs" fw={600}>
        {value}
      </Text>
    </Stack>
  );
}

function HealthBadge({ item }: { item: SchedulerItem }) {
  const color =
    item.health === 'healthy'
      ? 'green'
      : item.health === 'warning'
        ? 'yellow'
        : item.health === 'paused'
          ? 'gray'
          : 'red';
  return (
    <Tooltip label={item.healthSummary}>
      <Badge size="xs" color={color} variant="light">
        {item.health}
      </Badge>
    </Tooltip>
  );
}

function StatusBadge({ status }: { status: SchedulerRunStatus }) {
  const color =
    status === 'success'
      ? 'green'
      : status === 'started'
        ? 'blue'
        : status === 'skipped'
          ? 'gray'
          : 'red';
  return (
    <Badge size="xs" color={color} variant="light">
      {status}
    </Badge>
  );
}

function formatDate(value?: string): string {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Invalid';
  return date.toLocaleString();
}
