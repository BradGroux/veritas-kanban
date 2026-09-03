import { UiAction, UiPill, semanticToneForLegacyColor } from '@/components/ui/UiVocabulary';
import { SettingsGroup, SettingsNotice } from '@/components/settings/shared/SettingsLayout';
import { useState } from 'react';
import { Group, Loader, SimpleGrid, Stack, Text, Tooltip } from '@mantine/core';
import {
  AlertTriangle,
  CheckCircle2,
  Pause,
  Play,
  RefreshCw,
  RotateCw,
  Search,
} from 'lucide-react';
import type {
  QueueMonitorCandidatePacket,
  QueueMonitorEvent,
  QueueMonitorSnapshot,
} from '@veritas-kanban/shared';
import { useIdentity } from '@/hooks/useIdentity';
import {
  useQueueMonitorExplain,
  useQueueMonitorPause,
  useQueueMonitorResume,
  useQueueMonitorRun,
  useQueueMonitors,
} from '@/hooks/useQueueMonitors';
import { useToast } from '@/hooks/useToast';
import { SettingsPage, SettingsSection } from '../shared';

const EMPTY_MONITORS: QueueMonitorSnapshot[] = [];
const EMPTY_EVENTS: QueueMonitorEvent[] = [];

export function QueueMonitorsTab() {
  const { hasPermission } = useIdentity();
  const { toast } = useToast();
  const monitorsQuery = useQueueMonitors();
  const run = useQueueMonitorRun();
  const pause = useQueueMonitorPause();
  const resume = useQueueMonitorResume();
  const explain = useQueueMonitorExplain();
  const [packet, setPacket] = useState<QueueMonitorCandidatePacket | null>(null);
  const canExecute = hasPermission('workflow:execute');
  const canWrite = hasPermission('workflow:write');
  const monitors = monitorsQuery.data?.monitors ?? EMPTY_MONITORS;
  const events = monitorsQuery.data?.recentEvents ?? EMPTY_EVENTS;

  const mutate = async (action: () => Promise<unknown>, successTitle: string) => {
    try {
      await action();
      toast({ title: successTitle });
    } catch (error) {
      toast({
        title: 'Queue monitor action failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const explainMonitor = async (monitorId: string) => {
    await mutate(async () => {
      const result = await explain.mutateAsync(monitorId);
      setPacket(result.packet);
    }, 'Queue packet refreshed');
  };

  if (monitorsQuery.isLoading) {
    return (
      <Group gap="sm" className="text-muted-foreground">
        <Loader size="xs" />
        <Text size="sm">Loading queue monitors...</Text>
      </Group>
    );
  }

  return (
    <SettingsPage
      title="Queues"
      description="Monitor governed queue intake, eligibility decisions, and recent processing events."
      actions={
        <Tooltip label="Refresh queue monitors">
          <UiAction
            variant="quiet"
            leftSection={<RefreshCw className="h-3.5 w-3.5" />}
            onClick={() => monitorsQuery.refetch()}
          >
            Refresh
          </UiAction>
        </Tooltip>
      }
    >
      <SettingsSection
        title="Queue Intake Monitors"
        description="Review monitor health, run due intake, and inspect candidate packets."
      >
        <Stack gap="lg">
          {monitorsQuery.data && (
            <SimpleGrid cols={{ base: 2, md: 5 }} spacing="sm">
              <SummaryStat label="Total" value={monitorsQuery.data.summary.total} />
              <SummaryStat label="Enabled" value={monitorsQuery.data.summary.enabled} />
              <SummaryStat label="Due" value={monitorsQuery.data.summary.due} />
              <SummaryStat label="Failed" value={monitorsQuery.data.summary.failed} />
              <SummaryStat label="Blocked" value={monitorsQuery.data.summary.blocked} />
            </SimpleGrid>
          )}

          <Stack gap="sm">
            {monitors.length === 0 ? (
              <SettingsGroup empty className="text-center">
                <Text size="sm" c="dimmed">
                  No queue monitors are configured.
                </Text>
              </SettingsGroup>
            ) : (
              monitors.map((monitor) => (
                <SettingsGroup key={monitor.id}>
                  <Stack gap="sm">
                    <Group justify="space-between" align="flex-start">
                      <Stack gap={2}>
                        <Group gap="xs">
                          <Text size="sm" fw={600}>
                            {monitor.name}
                          </Text>
                          <UiPill>{monitor.mode}</UiPill>
                          <HealthBadge monitor={monitor} />
                        </Group>
                        <Text size="xs" c="dimmed" lineClamp={2}>
                          {monitor.source.repo} · {monitor.source.labels.join(', ') || 'all labels'}
                        </Text>
                      </Stack>
                      <Group gap="xs">
                        <UiAction
                          variant="quiet"
                          disabled={explain.isPending || !monitor.actions.canExplain}
                          leftSection={<Search className="h-3.5 w-3.5" />}
                          onClick={() => explainMonitor(monitor.id)}
                        >
                          Explain
                        </UiAction>
                        <UiAction
                          variant="secondary"
                          disabled={!canExecute || run.isPending || !monitor.actions.canRun}
                          leftSection={<Play className="h-3.5 w-3.5" />}
                          onClick={() =>
                            mutate(() => run.mutateAsync(monitor.id), 'Queue monitor run recorded')
                          }
                        >
                          Run
                        </UiAction>
                        {monitor.enabled ? (
                          <UiAction
                            variant="quiet"
                            disabled={!canWrite || pause.isPending || !monitor.actions.canPause}
                            leftSection={<Pause className="h-3.5 w-3.5" />}
                            onClick={() =>
                              mutate(() => pause.mutateAsync(monitor.id), 'Queue monitor paused')
                            }
                          >
                            Pause
                          </UiAction>
                        ) : (
                          <UiAction
                            variant="quiet"
                            disabled={!canWrite || resume.isPending || !monitor.actions.canResume}
                            leftSection={<RotateCw className="h-3.5 w-3.5" />}
                            onClick={() =>
                              mutate(() => resume.mutateAsync(monitor.id), 'Queue monitor resumed')
                            }
                          >
                            Resume
                          </UiAction>
                        )}
                      </Group>
                    </Group>

                    <SimpleGrid cols={{ base: 1, md: 4 }} spacing="xs">
                      <Meta label="Next" value={formatDate(monitor.nextRunAt)} />
                      <Meta label="Last scan" value={formatDate(monitor.lastScanAt)} />
                      <Meta
                        label="Candidates"
                        value={String(monitor.lastPacket?.candidates.length ?? 0)}
                      />
                      <Meta label="Failures" value={String(monitor.failureStreak)} />
                    </SimpleGrid>

                    {monitor.actionItem && (
                      <SettingsNotice tone="warning" icon={<AlertTriangle className="h-4 w-4" />}>
                        <Text size="xs" fw={600}>
                          {monitor.actionItem.summary}
                        </Text>
                        <Text size="xs">{monitor.actionItem.remediation}</Text>
                      </SettingsNotice>
                    )}

                    {monitor.lastSummary && (
                      <Text size="xs" c={monitor.lastStatus === 'failed' ? 'red' : 'dimmed'}>
                        {monitor.lastSummary}
                      </Text>
                    )}
                  </Stack>
                </SettingsGroup>
              ))
            )}
          </Stack>

          {packet && (
            <SettingsGroup>
              <Stack gap="sm">
                <Group gap="xs">
                  <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                  <Text size="sm" fw={600}>
                    Latest Candidate Packet
                  </Text>
                  <UiPill>{packet.candidates.length} candidates</UiPill>
                </Group>
                {packet.selected ? (
                  <Stack gap={2}>
                    <Text size="sm" fw={600}>
                      {packet.selected.repo}#{packet.selected.number} {packet.selected.title}
                    </Text>
                    <Text size="xs" c="dimmed">
                      score {packet.selected.score} ·{' '}
                      {packet.selected.reasons.join(', ') || 'no score reasons'}
                    </Text>
                  </Stack>
                ) : (
                  <Text size="sm" c="dimmed">
                    No candidate selected.
                  </Text>
                )}
                {packet.skipped.length > 0 && (
                  <Stack gap={4}>
                    <Text size="xs" fw={600}>
                      Skipped
                    </Text>
                    {packet.skipped.slice(0, 5).map((item) => (
                      <Text key={item.candidateId} size="xs" c="dimmed">
                        {item.title}: {item.reasons.join(', ')}
                      </Text>
                    ))}
                  </Stack>
                )}
              </Stack>
            </SettingsGroup>
          )}

          {events.length > 0 && (
            <Stack gap="sm">
              <Text size="sm" fw={600}>
                Recent Events
              </Text>
              <Stack gap="xs">
                {events.slice(0, 6).map((event) => (
                  <Group
                    key={event.id}
                    justify="space-between"
                    className="rounded border px-3 py-2"
                  >
                    <Stack gap={0}>
                      <Text size="xs" fw={600}>
                        {event.summary}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {event.monitorId} · {formatDate(event.createdAt)}
                      </Text>
                    </Stack>
                    <UiPill
                      kind="status"
                      tone={semanticToneForLegacyColor(statusColor(event.status))}
                    >
                      {event.status}
                    </UiPill>
                  </Group>
                ))}
              </Stack>
            </Stack>
          )}
        </Stack>
      </SettingsSection>
    </SettingsPage>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <SettingsGroup>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="lg" fw={700}>
        {value}
      </Text>
    </SettingsGroup>
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

function HealthBadge({ monitor }: { monitor: QueueMonitorSnapshot }) {
  return (
    <UiPill kind="status" tone={semanticToneForLegacyColor(healthColor(monitor.health))}>
      {monitor.health}
    </UiPill>
  );
}

function healthColor(health: QueueMonitorSnapshot['health']): string {
  if (health === 'healthy') return 'green';
  if (health === 'blocked') return 'red';
  if (health === 'paused') return 'gray';
  return 'yellow';
}

function statusColor(status: QueueMonitorEvent['status']): string {
  if (status === 'success' || status === 'started') return 'green';
  if (status === 'blocked' || status === 'failed') return 'red';
  return 'gray';
}

function formatDate(value?: string): string {
  if (!value) return 'not set';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'invalid';
  return date.toLocaleString();
}
