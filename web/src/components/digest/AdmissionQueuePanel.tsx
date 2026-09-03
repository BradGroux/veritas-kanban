import {
  UiHeading,
  UiSurface,
  UiAction,
  UiPill,
  semanticToneForLegacyColor,
} from '@/components/ui/UiVocabulary';
import { useMemo, useState, type ReactNode } from 'react';
import { Alert, Group, Loader, Modal, Stack, Text, Textarea } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  AlertTriangle,
  ArrowUpRight,
  Ban,
  Clock3,
  Gauge,
  GitBranch,
  Layers3,
  Play,
  RefreshCw,
  Route,
} from 'lucide-react';
import type {
  AdmissionQueueInspectionEntry,
  AdmissionQueueListResponse,
  AdmissionReservation,
  AdmissionScope,
} from '@veritas-kanban/shared';
import type { TaskDetailNavigationTarget } from '@/components/task/TaskDetailPanel';
import {
  useAdmissionQueue,
  useAdmissionQueueCancel,
  useAdmissionReservations,
  useAdmissionTreeCancel,
  useAdmissionTreeResume,
} from '@/hooks/useAdmissionQueue';
import { cn } from '@/lib/utils';

interface AdmissionQueuePanelProps {
  onTaskClick?: (taskId: string, target?: TaskDetailNavigationTarget) => void;
  onWorkflowClick?: (workflowId: string) => void;
}

interface QueueSummary {
  waiting: number;
  leased: number;
  oldestWaitingMs: number;
  readiness: Array<[AdmissionQueueInspectionEntry['readiness'], number]>;
  limitingScopes: Array<[AdmissionScope, number]>;
}

type AdmissionControlAction = 'cancel-queue' | 'cancel-tree' | 'resume-tree';

interface AdmissionControlTarget {
  action: AdmissionControlAction;
  id: string;
  label: string;
}

interface AdmissionControlRequest extends AdmissionControlTarget {
  idempotencyKey: string;
}

export function AdmissionQueuePanel({ onTaskClick, onWorkflowClick }: AdmissionQueuePanelProps) {
  const queue = useAdmissionQueue();
  const reservations = useAdmissionReservations();
  const cancelQueue = useAdmissionQueueCancel();
  const cancelTree = useAdmissionTreeCancel();
  const resumeTree = useAdmissionTreeResume();
  const [controlRequest, setControlRequest] = useState<AdmissionControlRequest | null>(null);
  const [controlReason, setControlReason] = useState('');
  const data = queue.data;
  const summary = useMemo(() => summarizeQueue(data), [data]);
  const treeControls = useMemo(
    () =>
      (reservations.data?.reservations ?? [])
        .filter(
          (reservation) =>
            reservation.request.executionTree?.edge === 'root' && reservation.executionTreeControl
        )
        .sort((left, right) =>
          (right.executionTreeControl?.recordedAt ?? '').localeCompare(
            left.executionTreeControl?.recordedAt ?? ''
          )
        )
        .slice(0, 12),
    [reservations.data]
  );

  const openControl = (request: AdmissionControlTarget) => {
    setControlReason('');
    setControlRequest({
      ...request,
      idempotencyKey: `operations:${request.action}:${request.id}:${crypto.randomUUID()}`,
    });
  };

  const closeControl = () => {
    if (cancelQueue.isPending || cancelTree.isPending || resumeTree.isPending) return;
    setControlRequest(null);
    setControlReason('');
  };

  const submitControl = async () => {
    if (!controlRequest || controlReason.trim().length < 8) return;
    const input = {
      idempotencyKey: controlRequest.idempotencyKey,
      reason: controlReason.trim(),
    };
    try {
      if (controlRequest.action === 'cancel-queue') {
        await cancelQueue.mutateAsync({ id: controlRequest.id, ...input });
      } else if (controlRequest.action === 'cancel-tree') {
        await cancelTree.mutateAsync({ rootObjectiveId: controlRequest.id, ...input });
      } else {
        await resumeTree.mutateAsync({ rootObjectiveId: controlRequest.id, ...input });
      }
      notifications.show({
        color: controlRequest.action === 'resume-tree' ? 'teal' : 'orange',
        title:
          controlRequest.action === 'resume-tree' ? 'Execution tree resumed' : 'Control recorded',
        message: controlRequest.label,
      });
      setControlRequest(null);
      setControlReason('');
    } catch (error) {
      notifications.show({
        color: 'red',
        title: 'Admission control failed',
        message: errorMessage(error),
      });
    }
  };

  if (queue.isLoading && !data) {
    return (
      <UiSurface
        component="section"
        level="card"
        className="p-5"
        aria-labelledby="admission-queue-heading"
        aria-busy="true"
      >
        <PanelHeading />
        <UiSurface
          level="inset"
          className="mt-5 flex min-h-28 items-center justify-center gap-3 border-dashed text-sm text-muted-foreground"
        >
          <Loader size="sm" />
          Loading bounded admission queue…
        </UiSurface>
      </UiSurface>
    );
  }

  if (!data) {
    return (
      <UiSurface
        component="section"
        level="card"
        className="border-red-900/60 p-5"
        aria-labelledby="admission-queue-heading"
      >
        <PanelHeading />
        <Alert
          mt="md"
          color="red"
          variant="light"
          icon={<AlertTriangle className="h-4 w-4" />}
          title="Admission queue unavailable"
        >
          <Group justify="space-between" align="center" wrap="wrap">
            <Text size="sm">{errorMessage(queue.error)}</Text>
            <UiAction variant="secondary" onClick={() => void queue.refetch()}>
              Retry
            </UiAction>
          </Group>
        </Alert>
      </UiSurface>
    );
  }

  const isPartial = data.pagination.hasMore || data.pagination.snapshotTruncated;
  const isSaturated = data.depth.global.current >= data.depth.global.limit;
  const isStale = queue.isStale || Boolean(queue.error);
  const controlPending = cancelQueue.isPending || cancelTree.isPending || resumeTree.isPending;

  return (
    <>
      <section
        className={cn(
          'overflow-hidden rounded-xl border bg-card shadow-sm',
          isSaturated ? 'border-amber-500/50' : 'border-border'
        )}
        aria-labelledby="admission-queue-heading"
      >
        <div className="border-b border-border bg-muted/20 p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <PanelHeading />
            <Group gap="xs" wrap="wrap" aria-live="polite">
              <UiPill kind="status" tone={semanticToneForLegacyColor(isStale ? 'yellow' : 'cyan')}>
                {isStale ? 'Stale snapshot' : 'Live snapshot'}
              </UiPill>
              {isSaturated ? (
                <UiPill kind="status" tone="warning">
                  Saturated
                </UiPill>
              ) : null}
              {isPartial ? <UiPill>Partial view</UiPill> : null}
              <UiPill>Conditional, no start-time promise</UiPill>
              <UiAction
                variant="quiet"
                onClick={() => void queue.refetch()}
                leftSection={
                  <RefreshCw className={cn('h-3.5 w-3.5', queue.isFetching && 'animate-spin')} />
                }
              >
                Refresh queue
              </UiAction>
            </Group>
          </div>

          {queue.error ? (
            <Alert
              mt="md"
              color="yellow"
              variant="light"
              icon={<AlertTriangle className="h-4 w-4" />}
            >
              Showing the last available bounded snapshot. Refresh failed:{' '}
              {errorMessage(queue.error)}
            </Alert>
          ) : null}

          <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1.7fr)_repeat(3,minmax(130px,0.55fr))]">
            <CapacityRail
              current={data.depth.global.current}
              limit={data.depth.global.limit}
              saturated={isSaturated}
            />
            <Signal
              icon={<Layers3 className="h-4 w-4 text-muted-foreground" />}
              label="Visible waiting"
              value={String(summary.waiting)}
              detail={isPartial ? 'bounded subset' : 'complete snapshot'}
            />
            <Signal
              icon={<Route className="h-4 w-4 text-muted-foreground" />}
              label="Visible leased"
              value={String(summary.leased)}
              detail={isPartial ? 'bounded subset' : 'reserved for dispatch'}
            />
            <Signal
              icon={<Clock3 className="h-4 w-4 text-[var(--vk-semantic-warning-fg)]" />}
              label="Oldest visible wait"
              value={formatAge(summary.oldestWaitingMs)}
              detail={`${data.pagination.limit}-row bound`}
            />
          </div>
        </div>

        <div className="space-y-5 p-5">
          <TreeControlPanel
            reservations={treeControls}
            loading={reservations.isLoading}
            onControl={openControl}
          />
          <WorkspacePressure data={data} />

          <div className="grid gap-3 lg:grid-cols-2">
            <SignalStrip
              label="Readiness"
              empty="No active readiness signals"
              values={summary.readiness.map(([readiness, count]) => ({
                label: readableLabel(readiness),
                value: count,
              }))}
            />
            <SignalStrip
              label="Limiting scopes"
              empty="No limiting scope is reported"
              values={summary.limitingScopes.map(([scope, count]) => ({
                label: readableLabel(scope),
                value: count,
              }))}
            />
          </div>

          {data.entries.length === 0 ? (
            <UiSurface level="empty" className="border-dashed px-4 py-10 text-center" role="status">
              <Text fw={600}>Admission runway is clear</Text>
              <Text size="sm" c="dimmed" mt={4}>
                No queued, requeued, or leased work is visible in this bounded snapshot.
              </Text>
            </UiSurface>
          ) : (
            <QueueTable
              data={data}
              onTaskClick={onTaskClick}
              onWorkflowClick={onWorkflowClick}
              onControl={openControl}
            />
          )}

          <div className="flex flex-col gap-1 border-t border-border pt-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>
              Snapshot {formatDateTime(data.generatedAt)} · {data.pagination.total} matching entries
            </span>
            <span>
              Position can change with arrivals, capacity, policy checks, retries, and lease expiry.
            </span>
          </div>
        </div>
      </section>
      <Modal
        opened={Boolean(controlRequest)}
        onClose={closeControl}
        title={controlTitle(controlRequest?.action)}
        centered
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            {controlRequest?.label}
          </Text>
          <Textarea
            label="Operator reason"
            description="Stored as durable control evidence. Minimum 8 characters."
            value={controlReason}
            onChange={(event) => setControlReason(event.currentTarget.value)}
            minRows={3}
            maxLength={1_000}
            autoFocus
          />
          <Group justify="flex-end">
            <UiAction variant="quiet" onClick={closeControl} disabled={controlPending}>
              Keep running
            </UiAction>
            <UiAction
              variant={controlRequest?.action === 'resume-tree' ? 'primary' : 'destructive'}
              leftSection={
                controlRequest?.action === 'resume-tree' ? (
                  <Play className="h-4 w-4" />
                ) : (
                  <Ban className="h-4 w-4" />
                )
              }
              loading={controlPending}
              disabled={controlReason.trim().length < 8}
              onClick={() => void submitControl()}
            >
              {controlRequest?.action === 'resume-tree' ? 'Resume expansion' : 'Record control'}
            </UiAction>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

function PanelHeading() {
  return (
    <div>
      <div className="flex items-center gap-2">
        <Gauge className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        <UiHeading
          order={2}
          id="admission-queue-heading"
          className="text-lg font-semibold text-foreground"
        >
          Admission Runway
        </UiHeading>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Bounded queue pressure, readiness, and waiting work from the durable admission scheduler.
      </p>
    </div>
  );
}

function CapacityRail({
  current,
  limit,
  saturated,
}: {
  current: number;
  limit: number;
  saturated: boolean;
}) {
  const percentage = limit > 0 ? Math.min(100, Math.round((current / limit) * 100)) : 0;
  return (
    <UiSurface level="card" className="p-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Global queue depth
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
            {current}
            <span className="ml-1 text-sm font-normal text-muted-foreground">/ {limit}</span>
          </div>
        </div>
        <span
          className={cn(
            'text-xs font-semibold uppercase tracking-wide',
            saturated ? 'text-[var(--vk-semantic-warning-fg)]' : 'text-muted-foreground'
          )}
        >
          {percentage}% occupied
        </span>
      </div>
      <div
        className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="Global admission queue capacity"
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={current}
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width]',
            saturated
              ? 'bg-gradient-to-r from-amber-500 to-orange-400'
              : 'bg-gradient-to-r from-cyan-500 to-sky-300'
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </UiSurface>
  );
}

function Signal({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <UiSurface level="card" className="p-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-xl font-semibold tabular-nums text-foreground">{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{detail}</div>
    </UiSurface>
  );
}

function TreeControlPanel({
  reservations,
  loading,
  onControl,
}: {
  reservations: AdmissionReservation[];
  loading: boolean;
  onControl: (request: AdmissionControlTarget) => void;
}) {
  if (loading && reservations.length === 0) {
    return (
      <UiSurface
        level="card"
        className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground"
      >
        <Loader size="xs" />
        Loading execution-tree controls…
      </UiSurface>
    );
  }
  if (reservations.length === 0) return null;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <UiHeading order={3} className="text-sm font-semibold text-foreground">
          Execution-tree controls
        </UiHeading>
        <span className="text-xs text-muted-foreground">
          Latest {reservations.length} durable controls
        </span>
      </div>
      <div className="grid gap-2 xl:grid-cols-2">
        {reservations.map((reservation) => {
          const control = reservation.executionTreeControl;
          if (!control) return null;
          const rootObjectiveId =
            reservation.request.executionTree?.rootObjectiveId ?? control.rootObjectiveId;
          const evidence = control.evidence;
          return (
            <div
              key={reservation.id}
              className={cn(
                'rounded-lg border bg-card p-3',
                control.state === 'paused'
                  ? 'border-amber-700/60'
                  : control.state === 'cancelled'
                    ? 'border-red-900/60'
                    : 'border-emerald-900/60'
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <GitBranch className="h-4 w-4 text-muted-foreground" />
                    <span className="font-mono text-sm text-foreground">
                      {shortIdentity(rootObjectiveId)}
                    </span>
                    <UiPill
                      kind="status"
                      tone={semanticToneForLegacyColor(
                        control.state === 'paused'
                          ? 'orange'
                          : control.state === 'cancelled'
                            ? 'red'
                            : 'teal'
                      )}
                    >
                      {control.state}
                    </UiPill>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {readableLabel(control.trigger)} · {formatDateTime(control.recordedAt)}
                  </div>
                </div>
                <Group gap={4}>
                  {control.state === 'paused' ? (
                    <UiAction
                      variant="secondary"
                      onClick={() =>
                        onControl({
                          action: 'resume-tree',
                          id: rootObjectiveId,
                          label: `Resume execution tree ${shortIdentity(rootObjectiveId)}`,
                        })
                      }
                      leftSection={<Play className="h-3 w-3" />}
                    >
                      Resume
                    </UiAction>
                  ) : null}
                  {control.state !== 'cancelled' ? (
                    <UiAction
                      variant="destructive"
                      onClick={() =>
                        onControl({
                          action: 'cancel-tree',
                          id: rootObjectiveId,
                          label: `Cancel execution tree ${shortIdentity(rootObjectiveId)}`,
                        })
                      }
                      leftSection={<Ban className="h-3 w-3" />}
                    >
                      Cancel tree
                    </UiAction>
                  ) : null}
                </Group>
              </div>
              {evidence ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-md bg-card p-2 text-xs text-muted-foreground">
                    <div className="font-medium text-foreground">Trigger evidence</div>
                    <div className="mt-1">{evidence.signals.map(readableLabel).join(', ')}</div>
                  </div>
                  <div className="rounded-md bg-card p-2 text-xs text-muted-foreground">
                    <div className="font-medium text-foreground">Tree pressure</div>
                    <div className="mt-1">
                      {evidence.observed.descendants}/{evidence.thresholds.maxDescendants}{' '}
                      descendants · depth {evidence.observed.maxDepth}/
                      {evidence.thresholds.maxDepth}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WorkspacePressure({ data }: { data: AdmissionQueueListResponse }) {
  const workspaceRows = [...data.depth.workspaces].sort((left, right) => {
    const leftRatio = left.limit > 0 ? left.current / left.limit : 0;
    const rightRatio = right.limit > 0 ? right.current / right.limit : 0;
    return rightRatio - leftRatio || left.workspaceId.localeCompare(right.workspaceId);
  });

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <UiHeading order={3} className="text-sm font-semibold text-foreground">
          Workspace pressure
        </UiHeading>
        <span className="text-xs text-muted-foreground">
          {workspaceRows.length} active workspaces
        </span>
      </div>
      {workspaceRows.length ? (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {workspaceRows.map((workspace) => {
            const percentage =
              workspace.limit > 0
                ? Math.min(100, Math.round((workspace.current / workspace.limit) * 100))
                : 0;
            const saturated = workspace.current >= workspace.limit;
            return (
              <UiSurface level="card" key={workspace.workspaceKey} className="px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span
                    className="truncate text-sm font-medium text-foreground"
                    title={workspace.workspaceId}
                  >
                    {workspace.workspaceId}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 text-xs tabular-nums',
                      saturated ? 'text-[var(--vk-semantic-warning-fg)]' : 'text-muted-foreground'
                    )}
                  >
                    {workspace.current}/{workspace.limit}
                  </span>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={saturated ? 'h-full bg-amber-400' : 'h-full bg-cyan-500/80'}
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </UiSurface>
            );
          })}
        </div>
      ) : (
        <Text size="sm" c="dimmed">
          No per-workspace depth is currently reported.
        </Text>
      )}
    </div>
  );
}

function SignalStrip({
  label,
  values,
  empty,
}: {
  label: string;
  values: Array<{ label: string; value: number }>;
  empty: string;
}) {
  return (
    <UiSurface level="card" className="p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 flex min-h-6 flex-wrap gap-1.5">
        {values.length ? (
          values.map((value) => (
            <UiPill key={value.label}>
              {value.label} · {value.value}
            </UiPill>
          ))
        ) : (
          <span className="text-sm text-muted-foreground">{empty}</span>
        )}
      </div>
    </UiSurface>
  );
}

function QueueTable({
  data,
  onTaskClick,
  onWorkflowClick,
  onControl,
}: {
  data: AdmissionQueueListResponse;
  onTaskClick?: AdmissionQueuePanelProps['onTaskClick'];
  onWorkflowClick?: AdmissionQueuePanelProps['onWorkflowClick'];
  onControl: (request: AdmissionControlTarget) => void;
}) {
  return (
    <UiSurface level="card" className="overflow-x-auto">
      <table className="w-full min-w-[1040px] border-collapse text-left text-sm">
        <caption className="sr-only">
          Bounded admission queue. Start timing is conditional and positions may change.
        </caption>
        <thead className="bg-card text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-3 font-medium" scope="col">
              Position
            </th>
            <th className="px-3 py-3 font-medium" scope="col">
              Work
            </th>
            <th className="px-3 py-3 font-medium" scope="col">
              Workspace / source
            </th>
            <th className="px-3 py-3 font-medium" scope="col">
              Priority
            </th>
            <th className="px-3 py-3 font-medium" scope="col">
              Age
            </th>
            <th className="px-3 py-3 font-medium" scope="col">
              Readiness
            </th>
            <th className="px-3 py-3 font-medium" scope="col">
              Lease / limits
            </th>
            <th className="px-3 py-3 text-right font-medium" scope="col">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {data.entries.map((entry) => (
            <QueueRow
              key={entry.id}
              entry={entry}
              onTaskClick={onTaskClick}
              onWorkflowClick={onWorkflowClick}
              onControl={onControl}
            />
          ))}
        </tbody>
      </table>
    </UiSurface>
  );
}

function QueueRow({
  entry,
  onTaskClick,
  onWorkflowClick,
  onControl,
}: {
  entry: AdmissionQueueInspectionEntry;
  onTaskClick?: AdmissionQueuePanelProps['onTaskClick'];
  onWorkflowClick?: AdmissionQueuePanelProps['onWorkflowClick'];
  onControl: (request: AdmissionControlTarget) => void;
}) {
  const tree = entry.navigation.executionTree;
  const taskId = entry.navigation.taskId;
  const workflowId = entry.navigation.workflowId;
  const treeLabel = tree
    ? tree.depth === 0
      ? 'Root'
      : `Descendant · depth ${tree.depth}`
    : 'Direct';
  const scopeLabels = Array.from(new Set(entry.limitingPolicies.map((policy) => policy.scope)));

  return (
    <tr className="bg-card align-top transition-colors hover:bg-card">
      <td className="px-3 py-3">
        <span className="font-mono text-base font-semibold text-foreground">
          {entry.position ?? '—'}
        </span>
        <div className="mt-1 text-xs text-muted-foreground">{readableLabel(entry.state)}</div>
      </td>
      <td className="px-3 py-3">
        <UiPill
          kind="status"
          tone={semanticToneForLegacyColor(tree?.depth === 0 ? 'cyan' : tree ? 'violet' : 'gray')}
          leftSection={tree ? <GitBranch className="h-3 w-3" /> : undefined}
        >
          {treeLabel}
        </UiPill>
        <div className="mt-1.5 text-xs text-muted-foreground">
          {readableLabel(entry.launch.target)}
        </div>
      </td>
      <td className="max-w-64 px-3 py-3">
        <div className="truncate font-medium text-foreground" title={entry.launch.workspaceId}>
          {entry.launch.workspaceId}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {readableLabel(entry.launch.source)} · {readableLabel(entry.launch.provider)}
        </div>
      </td>
      <td className="px-3 py-3">
        <span className="font-medium tabular-nums text-foreground">
          {entry.rawPriority} → {entry.effectivePriority}
        </span>
        <div className="mt-1 text-xs text-muted-foreground">
          {entry.agePromotion > 0 ? `+${entry.agePromotion} age promotion` : 'No age promotion'}
        </div>
      </td>
      <td className="px-3 py-3 tabular-nums text-foreground">{formatAge(entry.ageMs)}</td>
      <td className="px-3 py-3">
        <UiPill kind="status" tone={semanticToneForLegacyColor(readinessColor(entry.readiness))}>
          {readableLabel(entry.readiness)}
        </UiPill>
        <div className="mt-1.5 max-w-44 text-xs text-muted-foreground">
          {entry.conditionalStartFactors.length
            ? entry.conditionalStartFactors.map(readableLabel).join(', ')
            : 'No conditional factors reported'}
        </div>
      </td>
      <td className="px-3 py-3">
        <div className="text-foreground">{readableLabel(entry.lease.posture)}</div>
        {entry.lease.expiresAt ? (
          <div className="mt-1 text-xs text-muted-foreground">
            Expires {formatDateTime(entry.lease.expiresAt)}
          </div>
        ) : null}
        <div className="mt-1.5 flex max-w-48 flex-wrap gap-1">
          {scopeLabels.length ? (
            scopeLabels.map((scope) => (
              <UiPill kind="status" tone="warning" key={scope}>
                {readableLabel(scope)}
              </UiPill>
            ))
          ) : (
            <span className="text-xs text-muted-foreground">No limiting scope</span>
          )}
        </div>
      </td>
      <td className="px-3 py-3">
        <div className="flex max-w-64 flex-wrap justify-end gap-1">
          <UiAction
            variant="destructive"
            onClick={() =>
              onControl({
                action: 'cancel-queue',
                id: entry.id,
                label: `Cancel queued launch ${entry.id}`,
              })
            }
            leftSection={<Ban className="h-3 w-3" />}
          >
            Cancel queue
          </UiAction>
          {tree ? (
            <UiAction
              variant="destructive"
              onClick={() =>
                onControl({
                  action: 'cancel-tree',
                  id: tree.rootObjectiveId,
                  label: `Cancel execution tree ${shortIdentity(tree.rootObjectiveId)}`,
                })
              }
              leftSection={<Ban className="h-3 w-3" />}
            >
              Cancel tree
            </UiAction>
          ) : null}
          {taskId && onTaskClick ? (
            <UiAction
              variant="quiet"
              onClick={() => onTaskClick(taskId)}
              aria-label={`Open task at queue position ${entry.position ?? 'reserved'}`}
              rightSection={<ArrowUpRight className="h-3 w-3" />}
            >
              Task
            </UiAction>
          ) : null}
          {taskId && onTaskClick ? (
            <UiAction
              variant="quiet"
              onClick={() =>
                onTaskClick(taskId, {
                  tab: 'timeline',
                  timelineAttemptId: entry.navigation.attemptId,
                })
              }
              aria-label={`Open attempt at queue position ${entry.position ?? 'reserved'}`}
              rightSection={<ArrowUpRight className="h-3 w-3" />}
            >
              Attempt
            </UiAction>
          ) : null}
          {tree && taskId && onTaskClick ? (
            <UiAction
              variant="quiet"
              onClick={() => onTaskClick(taskId, { tab: 'timeline' })}
              aria-label={`Open execution tree context at queue position ${entry.position ?? 'reserved'}`}
              rightSection={<ArrowUpRight className="h-3 w-3" />}
            >
              Tree
            </UiAction>
          ) : null}
          {workflowId && onWorkflowClick ? (
            <UiAction
              variant="quiet"
              onClick={() => onWorkflowClick(workflowId)}
              aria-label={`Open workflow for queue position ${entry.position ?? 'reserved'}`}
              rightSection={<ArrowUpRight className="h-3 w-3" />}
            >
              Workflow
            </UiAction>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function summarizeQueue(data?: AdmissionQueueListResponse): QueueSummary {
  if (!data) {
    return {
      waiting: 0,
      leased: 0,
      oldestWaitingMs: 0,
      readiness: [],
      limitingScopes: [],
    };
  }

  const waitingEntries = data.entries.filter(
    (entry) => entry.state === 'queued' || entry.state === 'requeued'
  );
  const readiness = new Map<AdmissionQueueInspectionEntry['readiness'], number>();
  const scopes = new Map<AdmissionScope, number>();
  for (const entry of data.entries) {
    readiness.set(entry.readiness, (readiness.get(entry.readiness) ?? 0) + 1);
    for (const scope of new Set(entry.limitingPolicies.map((policy) => policy.scope))) {
      scopes.set(scope, (scopes.get(scope) ?? 0) + 1);
    }
  }

  return {
    waiting: waitingEntries.length,
    leased: data.entries.filter((entry) => entry.state === 'leased').length,
    oldestWaitingMs: waitingEntries.reduce((oldest, entry) => Math.max(oldest, entry.ageMs), 0),
    readiness: [...readiness.entries()].sort((left, right) => right[1] - left[1]),
    limitingScopes: [...scopes.entries()].sort((left, right) => right[1] - left[1]),
  };
}

function readabilityParts(value: string): string[] {
  return value.split('-').filter(Boolean);
}

function readableLabel(value: string): string {
  return readabilityParts(value)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function readinessColor(
  readiness: AdmissionQueueInspectionEntry['readiness']
): 'cyan' | 'yellow' | 'violet' | 'green' | 'gray' {
  switch (readiness) {
    case 'conditional':
      return 'yellow';
    case 'delayed':
      return 'violet';
    case 'reserved':
      return 'cyan';
    case 'dispatched':
      return 'green';
    case 'terminal':
      return 'gray';
  }
}

function formatAge(ms: number): string {
  if (!ms || ms <= 0) return '0m';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours ? `${days}d ${remainingHours}h` : `${days}d`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function shortIdentity(value: string): string {
  return value.length <= 24 ? value : `${value.slice(0, 12)}…${value.slice(-8)}`;
}

function controlTitle(action?: AdmissionControlAction): string {
  switch (action) {
    case 'cancel-queue':
      return 'Cancel queued launch';
    case 'cancel-tree':
      return 'Cancel execution tree';
    case 'resume-tree':
      return 'Resume execution tree';
    default:
      return 'Execution control';
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The admission operation could not be completed.';
}
