import { useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Code,
  Group,
  Select,
  Text,
  TextInput,
  Textarea,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Copy,
  Download,
  ExternalLink,
  FileText,
  RefreshCw,
  Search,
} from 'lucide-react';
import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer';
import { useProjects } from '@/hooks/useProjects';
import {
  normalizeOperationsDigestFilters,
  useCreateOperationsDigestSchedule,
  useOperationsDigest,
  useOperationsDigestMarkdown,
  useOperationsDigestSchedule,
  useRecordOperationsDigestSnapshot,
} from '@/hooks/useOperationsDigest';
import type {
  AgentOperationsDigest,
  AgentOperationsDigestFilters,
  AgentOperationsDigestGroup,
  AgentOperationsSourceLink,
  SearchCollection,
} from '@/lib/api';
import { cn } from '@/lib/utils';

interface OperationsDigestPageProps {
  onBack: () => void;
  onTaskClick?: (taskId: string) => void;
}

type WindowPreset = '24' | '72' | '168' | 'custom';

const WINDOW_OPTIONS: Array<{ value: WindowPreset; label: string }> = [
  { value: '24', label: '24 hours' },
  { value: '72', label: '3 days' },
  { value: '168', label: '7 days' },
  { value: 'custom', label: 'Custom range' },
];

const SOURCE_COLLECTIONS: SearchCollection[] = ['tasks-active', 'agent-runs', 'scheduled-runs'];

export function OperationsDigestPage({ onBack, onTaskClick }: OperationsDigestPageProps) {
  const [windowPreset, setWindowPreset] = useState<WindowPreset>('24');
  const [from, setFrom] = useState(() => toLocalDateTimeInput(hoursAgo(24)));
  const [to, setTo] = useState(() => toLocalDateTimeInput(new Date()));
  const [project, setProject] = useState('all');
  const [repo, setRepo] = useState('');
  const [cwd, setCwd] = useState('');

  const filters = useMemo<AgentOperationsDigestFilters>(() => {
    const base =
      windowPreset === 'custom'
        ? {
            from: localDateTimeInputToIso(from),
            to: localDateTimeInputToIso(to),
          }
        : {
            hours: Number(windowPreset),
          };

    return normalizeOperationsDigestFilters({
      ...base,
      project: project === 'all' ? undefined : project,
      repo,
      cwd,
    });
  }, [cwd, from, project, repo, to, windowPreset]);

  const { data: projects = [] } = useProjects();
  const digestQuery = useOperationsDigest(filters);
  const markdownQuery = useOperationsDigestMarkdown(filters);
  const scheduleQuery = useOperationsDigestSchedule();
  const createSchedule = useCreateOperationsDigestSchedule();
  const recordSnapshot = useRecordOperationsDigestSnapshot();

  const digest = digestQuery.data;
  const markdown = markdownQuery.data?.markdown ?? '';
  const scheduledDeliverable = scheduleQuery.data?.[0];
  const isLoading = digestQuery.isLoading || markdownQuery.isLoading;
  const isRefreshing = digestQuery.isFetching || markdownQuery.isFetching;

  const projectOptions = useMemo(
    () => [
      { value: 'all', label: 'All projects' },
      ...projects.map((item) => ({ value: item.id, label: item.label || item.id })),
    ],
    [projects]
  );

  const refresh = async () => {
    await Promise.all([digestQuery.refetch(), markdownQuery.refetch(), scheduleQuery.refetch()]);
  };

  const copyMarkdown = async () => {
    if (!markdown) return;
    await navigator.clipboard.writeText(markdown);
    notifications.show({
      title: 'Digest copied',
      message: 'Markdown briefing is on the clipboard.',
      color: 'green',
    });
  };

  const exportMarkdown = () => {
    if (!markdown) return;
    downloadText(`operations-digest-${dateStamp()}.md`, markdown, 'text/markdown;charset=utf-8');
  };

  const exportJson = () => {
    if (!digest) return;
    downloadText(
      `operations-digest-${dateStamp()}.json`,
      JSON.stringify(digest, null, 2),
      'application/json;charset=utf-8'
    );
  };

  const ensureDailySchedule = async () => {
    await createSchedule.mutateAsync();
    notifications.show({
      title: 'Daily digest scheduled',
      message: 'The operations digest is registered as a daily scheduled deliverable.',
      color: 'green',
    });
  };

  const recordScheduledSnapshot = async () => {
    if (!scheduledDeliverable || !digest) return;
    await recordSnapshot.mutateAsync({
      deliverableId: scheduledDeliverable.id,
      run: {
        status: digest.hasActivity ? 'success' : 'skipped',
        summary: markdown || markdownQuery.data?.message || 'No operations activity.',
        snapshotMetadata: digestSnapshotMetadata(digest, filters),
      },
    });
    notifications.show({
      title: 'Snapshot recorded',
      message: 'The current digest was stored in scheduled deliverable history.',
      color: 'green',
    });
  };

  const openSources = (items: AgentOperationsSourceLink[]) => {
    const uniqueTaskIds = Array.from(new Set(items.map((item) => item.taskId).filter(isString)));
    if (uniqueTaskIds.length === 1 && onTaskClick) {
      onTaskClick(uniqueTaskIds[0]);
      return;
    }

    const query = Array.from(
      new Set(items.flatMap((item) => [item.taskId, item.id]).filter(isString))
    )
      .slice(0, 12)
      .join(' ');
    if (!query) return;

    window.dispatchEvent(
      new CustomEvent('veritas:open-search', {
        detail: {
          query,
          collections: SOURCE_COLLECTIONS,
        },
      })
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <Button variant="subtle" size="sm" onClick={onBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Board
          </Button>
          <div className="min-w-0">
            <Group gap="xs" wrap="wrap">
              <h1 className="text-2xl font-bold">Operations Digest</h1>
              <Badge
                variant="light"
                color={digest?.hasActivity ? 'green' : 'gray'}
                tt="none"
                leftSection={<ClipboardList className="h-3 w-3" />}
              >
                {digest?.hasActivity ? `${digest.totals.groups} active groups` : 'No activity'}
              </Badge>
            </Group>
            <p className="text-sm text-muted-foreground">
              Deterministic standup and briefing output from agent tasks, runs, tokens, and
              approvals.
            </p>
          </div>
        </div>

        <Group gap="xs" wrap="wrap">
          <Button
            variant="light"
            size="sm"
            onClick={() => void refresh()}
            leftSection={<RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />}
          >
            Refresh
          </Button>
          <Button
            variant="light"
            size="sm"
            onClick={() => void copyMarkdown()}
            disabled={!markdown}
            leftSection={<Copy className="h-4 w-4" />}
          >
            Copy
          </Button>
          <Button
            variant="light"
            size="sm"
            onClick={exportMarkdown}
            disabled={!markdown}
            leftSection={<Download className="h-4 w-4" />}
          >
            Markdown
          </Button>
          <Button
            variant="light"
            size="sm"
            onClick={exportJson}
            disabled={!digest}
            leftSection={<Download className="h-4 w-4" />}
          >
            JSON
          </Button>
        </Group>
      </div>

      <div className="grid gap-3 md:grid-cols-[180px_1fr_1fr] xl:grid-cols-[180px_220px_1fr_1fr_1fr]">
        <Select
          value={windowPreset}
          onChange={(value) => setWindowPreset((value ?? '24') as WindowPreset)}
          data={WINDOW_OPTIONS}
          allowDeselect={false}
          label="Window"
        />
        <Select
          value={project}
          onChange={(value) => setProject(value ?? 'all')}
          data={projectOptions}
          allowDeselect={false}
          searchable
          label="Project"
        />
        <TextInput
          value={repo}
          onChange={(event) => setRepo(event.currentTarget.value)}
          label="Repository"
          placeholder="Any repository"
          leftSection={<Search className="h-4 w-4 text-muted-foreground" />}
        />
        <TextInput
          value={cwd}
          onChange={(event) => setCwd(event.currentTarget.value)}
          label="CWD / worktree"
          placeholder="Any worktree path"
          leftSection={<Search className="h-4 w-4 text-muted-foreground" />}
        />
      </div>

      {windowPreset === 'custom' && (
        <div className="grid gap-3 md:grid-cols-2">
          <TextInput
            type="datetime-local"
            value={from}
            onChange={(event) => setFrom(event.currentTarget.value)}
            label="From"
          />
          <TextInput
            type="datetime-local"
            value={to}
            onChange={(event) => setTo(event.currentTarget.value)}
            label="To"
          />
        </div>
      )}

      {digestQuery.error || markdownQuery.error ? (
        <Alert color="red" variant="light" icon={<AlertTriangle className="h-4 w-4" />}>
          {(digestQuery.error as Error | undefined)?.message ||
            (markdownQuery.error as Error | undefined)?.message ||
            'Failed to load operations digest.'}
        </Alert>
      ) : null}

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <Metric label="Active" value={digest?.totals.active} tone="green" />
        <Metric label="Blocked" value={digest?.totals.blocked} tone="orange" />
        <Metric label="Stuck" value={digest?.totals.stuck} tone="yellow" />
        <Metric label="Completed" value={digest?.totals.completed} tone="blue" />
        <Metric label="Failed" value={digest?.totals.failed} tone="red" />
        <Metric label="Open approvals" value={digest?.totals.openApprovals} tone="violet" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Source Groups</h2>
              <p className="text-sm text-muted-foreground">
                Counts use the same filtered source bundle as the briefing output.
              </p>
            </div>
            <Badge variant="light" color="gray" tt="none">
              {isLoading ? 'Loading' : `${digest?.groups.length ?? 0} groups`}
            </Badge>
          </div>

          {isLoading ? (
            <div className="rounded-lg border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
              Loading operations digest...
            </div>
          ) : digest?.groups.length ? (
            digest.groups.map((group) => (
              <DigestGroupCard key={group.key} group={group} onOpenSources={openSources} />
            ))
          ) : (
            <div className="rounded-lg border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
              No operations activity matches the current filters.
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Daily Delivery</h2>
                <p className="text-sm text-muted-foreground">
                  Uses scheduled deliverables for recurring digest records.
                </p>
              </div>
              <Badge
                variant="light"
                color={scheduledDeliverable?.enabled ? 'green' : 'gray'}
                tt="none"
                leftSection={
                  scheduledDeliverable ? (
                    <CheckCircle2 className="h-3 w-3" />
                  ) : (
                    <CalendarClock className="h-3 w-3" />
                  )
                }
              >
                {scheduledDeliverable ? 'Configured' : 'Not scheduled'}
              </Badge>
            </div>

            <div className="mt-4 space-y-2 text-sm">
              {scheduledDeliverable ? (
                <>
                  <ScheduleFact label="Name" value={scheduledDeliverable.name} />
                  <ScheduleFact label="Cadence" value={scheduledDeliverable.scheduleDescription} />
                  <ScheduleFact
                    label="Last run"
                    value={formatDateTime(scheduledDeliverable.lastRunAt)}
                  />
                  <ScheduleFact
                    label="Next run"
                    value={formatDateTime(scheduledDeliverable.nextRunAt)}
                  />
                  <ScheduleFact label="Runs" value={String(scheduledDeliverable.totalRuns)} />
                </>
              ) : (
                <Text size="sm" c="dimmed">
                  Register the digest as a daily deliverable before recording recurring snapshots.
                </Text>
              )}
            </div>

            <Group mt="md" gap="xs" wrap="wrap">
              <Button
                size="sm"
                variant="light"
                onClick={() => void ensureDailySchedule()}
                loading={createSchedule.isPending}
                disabled={Boolean(scheduledDeliverable)}
                leftSection={<CalendarClock className="h-4 w-4" />}
              >
                Enable Daily
              </Button>
              <Button
                size="sm"
                variant="light"
                onClick={() => void recordScheduledSnapshot()}
                loading={recordSnapshot.isPending}
                disabled={!scheduledDeliverable || !digest}
                leftSection={<FileText className="h-4 w-4" />}
              >
                Record Snapshot
              </Button>
            </Group>
          </div>

          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Briefing Markdown</h2>
                <p className="text-sm text-muted-foreground">
                  Deterministic output for standups and handoff notes.
                </p>
              </div>
              <Badge variant="light" color="gray" tt="none">
                {digest?.refresh.narrative === 'deterministic-only' ? 'No LLM' : 'Narrative'}
              </Badge>
            </div>

            <Textarea
              mt="md"
              value={markdown || markdownQuery.data?.message || ''}
              readOnly
              minRows={12}
              aria-label="Operations digest markdown"
              classNames={{
                input: 'font-mono text-xs',
              }}
            />
          </div>
        </aside>
      </section>

      {markdown ? (
        <section className="rounded-lg border bg-card p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Rendered Briefing</h2>
            <Badge variant="light" color="gray" tt="none">
              {formatDateTime(digest?.generatedAt)}
            </Badge>
          </div>
          <MarkdownRenderer content={markdown} className="text-sm" />
        </section>
      ) : null}
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value?: number;
  tone: 'green' | 'orange' | 'yellow' | 'blue' | 'red' | 'violet';
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{formatNumber(value ?? 0)}</div>
      <div className={cn('mt-3 h-1 rounded-full', toneClass(tone))} />
    </div>
  );
}

function DigestGroupCard({
  group,
  onOpenSources,
}: {
  group: AgentOperationsDigestGroup;
  onOpenSources: (items: AgentOperationsSourceLink[]) => void;
}) {
  const heading = [group.project, group.repo, group.cwd].filter(Boolean).join(' / ');
  const totals = group.totals;

  return (
    <article className="rounded-lg border bg-card p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold">{heading}</h3>
          <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span>{formatNumber(totals.runs)} runs</span>
            <span>{formatDuration(totals.activeTimeMs)} active</span>
            <span>{formatDuration(totals.wallTimeMs)} observed</span>
            <span>{formatNumber(totals.totalTokens)} tokens</span>
            <span>${totals.tokenCost.toFixed(4)}</span>
          </div>
        </div>
        <Group gap="xs" wrap="wrap">
          <SourceButton
            label="Active"
            count={totals.active}
            items={group.sourceLinks.activeTasks}
            onOpenSources={onOpenSources}
          />
          <SourceButton
            label="Blocked"
            count={totals.blocked}
            items={group.sourceLinks.blockedTasks}
            onOpenSources={onOpenSources}
          />
          <SourceButton
            label="Stuck"
            count={totals.stuck}
            items={group.sourceLinks.stuckTasks}
            onOpenSources={onOpenSources}
          />
          <SourceButton
            label="Done"
            count={totals.completed}
            items={group.sourceLinks.completedTasks}
            onOpenSources={onOpenSources}
          />
          <SourceButton
            label="Failed"
            count={totals.failed}
            items={group.sourceLinks.failedRuns}
            onOpenSources={onOpenSources}
          />
        </Group>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <SourceList
          title="Plan completions"
          items={group.topPlanCompletions}
          empty="No completed plans in this window."
        />
        <SourceList
          title="Notable failures"
          items={group.notableFailures}
          empty="No failures in this group."
        />
        <SourceList
          title="Open approvals"
          items={group.openApprovals}
          empty="No pending approvals."
        />
      </div>
    </article>
  );
}

function SourceButton({
  label,
  count,
  items,
  onOpenSources,
}: {
  label: string;
  count: number;
  items: AgentOperationsSourceLink[];
  onOpenSources: (items: AgentOperationsSourceLink[]) => void;
}) {
  const canOpen = items.length > 0;
  return (
    <Button
      variant="subtle"
      color="gray"
      size="compact-sm"
      onClick={() => onOpenSources(items)}
      disabled={!canOpen}
      rightSection={canOpen ? <ExternalLink className="h-3 w-3" /> : undefined}
    >
      {label}: {formatNumber(count)}
    </Button>
  );
}

function SourceList({
  title,
  items,
  empty,
}: {
  title: string;
  items: AgentOperationsSourceLink[];
  empty: string;
}) {
  return (
    <div className="min-w-0">
      <h4 className="text-sm font-medium">{title}</h4>
      {items.length ? (
        <div className="mt-2 space-y-2">
          {items.slice(0, 5).map((item) => (
            <div key={`${item.kind}:${item.id}`} className="min-w-0 text-sm">
              <div className="truncate">{item.label}</div>
              <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                <Code className="truncate" color="dark">
                  {item.id}
                </Code>
                <span className="shrink-0">{formatDateTime(item.timestamp)}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Text mt="xs" size="sm" c="dimmed">
          {empty}
        </Text>
      )}
    </div>
  );
}

function ScheduleFact({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-right font-medium">{value || 'None'}</span>
    </div>
  );
}

function toneClass(tone: 'green' | 'orange' | 'yellow' | 'blue' | 'red' | 'violet') {
  switch (tone) {
    case 'green':
      return 'bg-green-500/70';
    case 'orange':
      return 'bg-orange-500/70';
    case 'yellow':
      return 'bg-yellow-500/70';
    case 'blue':
      return 'bg-blue-500/70';
    case 'red':
      return 'bg-red-500/70';
    case 'violet':
      return 'bg-violet-500/70';
  }
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: Math.abs(value) >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value);
}

function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return '0m';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function formatDateTime(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function toLocalDateTimeInput(date: Date): string {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 16);
}

function localDateTimeInputToIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function downloadText(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function digestSnapshotMetadata(
  digest: AgentOperationsDigest,
  filters: AgentOperationsDigestFilters
): Record<string, string | number | boolean | null> {
  return {
    generatedAt: digest.generatedAt,
    periodStart: digest.period.start,
    periodEnd: digest.period.end,
    windowHours: digest.period.windowHours,
    groups: digest.totals.groups,
    active: digest.totals.active,
    blocked: digest.totals.blocked,
    stuck: digest.totals.stuck,
    completed: digest.totals.completed,
    failed: digest.totals.failed,
    runs: digest.totals.runs,
    totalTokens: digest.totals.totalTokens,
    tokenCost: digest.totals.tokenCost,
    project: filters.project ?? null,
    repo: filters.repo ?? null,
    cwd: filters.cwd ?? null,
  };
}

function isString(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}
