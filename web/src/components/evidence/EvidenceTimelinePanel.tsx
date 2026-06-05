import { useMemo, useState, type ElementType } from 'react';
import { Alert, Badge, Button, Code, Group, Loader, Select, Text, TextInput } from '@mantine/core';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bot,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileText,
  GitBranch,
  History,
  ListFilter,
  MessageSquareText,
  Paperclip,
  RefreshCw,
  Search,
  Timer,
} from 'lucide-react';
import { normalizeSafeHref } from '@veritas-kanban/shared';
import { useProjects } from '@/hooks/useProjects';
import { normalizeEvidenceTimelineFilters, useEvidenceTimeline } from '@/hooks/useEvidenceTimeline';
import type {
  EvidenceTimelineEvent,
  EvidenceTimelineEventSource,
  EvidenceTimelineEventType,
  EvidenceTimelineFilters,
  EvidenceTimelineSourceLink,
} from '@/lib/api';
import { cn } from '@/lib/utils';

type EventFilterValue = EvidenceTimelineEventType | 'all';
type SourceFilterValue = EvidenceTimelineEventSource | 'all';

interface EvidenceTimelinePanelProps {
  taskId?: string;
  showScopeFilters?: boolean;
  initialProject?: string;
  initialRepo?: string;
  initialCwd?: string;
  initialFrom?: string;
  initialTo?: string;
  onTaskClick?: (taskId: string) => void;
}

const EVENT_TYPES: EvidenceTimelineEventType[] = [
  'task',
  'status',
  'comment',
  'time',
  'agent_run',
  'telemetry',
  'work_product',
  'deliverable',
  'github',
  'attachment',
  'observation',
];

const EVENT_SOURCES: EvidenceTimelineEventSource[] = [
  'task',
  'activity',
  'status-history',
  'telemetry',
  'work-product',
  'deliverable',
];

const EVENT_LABELS: Record<EvidenceTimelineEventType, string> = {
  agent_run: 'Agent Run',
  attachment: 'Attachment',
  comment: 'Comment',
  deliverable: 'Deliverable',
  github: 'GitHub',
  observation: 'Observation',
  status: 'Status',
  task: 'Task',
  telemetry: 'Telemetry',
  time: 'Time',
  work_product: 'Work Product',
};

const SOURCE_LABELS: Record<EvidenceTimelineEventSource, string> = {
  activity: 'Activity',
  deliverable: 'Deliverable',
  'status-history': 'Status History',
  task: 'Task Record',
  telemetry: 'Telemetry',
  'work-product': 'Work Product',
};

const EVENT_COLORS: Record<EvidenceTimelineEventType, string> = {
  agent_run: 'indigo',
  attachment: 'gray',
  comment: 'cyan',
  deliverable: 'green',
  github: 'dark',
  observation: 'violet',
  status: 'blue',
  task: 'gray',
  telemetry: 'orange',
  time: 'yellow',
  work_product: 'teal',
};

const EVENT_ICONS: Record<EvidenceTimelineEventType, ElementType> = {
  agent_run: Bot,
  attachment: Paperclip,
  comment: MessageSquareText,
  deliverable: CheckCircle2,
  github: GitBranch,
  observation: FileText,
  status: History,
  task: FileText,
  telemetry: Clock3,
  time: Timer,
  work_product: FileText,
};

const EVENT_OPTIONS = [
  { value: 'all', label: 'All event types' },
  ...EVENT_TYPES.map((value) => ({ value, label: EVENT_LABELS[value] })),
];

const SOURCE_OPTIONS = [
  { value: 'all', label: 'All sources' },
  ...EVENT_SOURCES.map((value) => ({ value, label: SOURCE_LABELS[value] })),
];

const LIMIT_OPTIONS = [
  { value: '25', label: '25 rows' },
  { value: '50', label: '50 rows' },
  { value: '100', label: '100 rows' },
  { value: '200', label: '200 rows' },
];

export function EvidenceTimelinePanel({
  taskId,
  showScopeFilters = false,
  initialProject,
  initialRepo,
  initialCwd,
  initialFrom,
  initialTo,
  onTaskClick,
}: EvidenceTimelinePanelProps) {
  const [project, setProject] = useState(initialProject ?? 'all');
  const [repo, setRepo] = useState(initialRepo ?? '');
  const [cwd, setCwd] = useState(initialCwd ?? '');
  const [from, setFrom] = useState(initialFrom ?? '');
  const [to, setTo] = useState(initialTo ?? '');
  const [type, setType] = useState<EventFilterValue>('all');
  const [source, setSource] = useState<SourceFilterValue>('all');
  const [actor, setActor] = useState('');
  const [limit, setLimit] = useState(50);
  const [page, setPage] = useState(1);

  const { data: projects = [] } = useProjects();
  const projectOptions = useMemo(
    () => [
      { value: 'all', label: 'All projects' },
      ...projects.map((item) => ({ value: item.id, label: item.label || item.id })),
    ],
    [projects]
  );

  const filters = useMemo<EvidenceTimelineFilters>(
    () =>
      normalizeEvidenceTimelineFilters({
        taskId,
        project: showScopeFilters && project !== 'all' ? project : undefined,
        repo: showScopeFilters ? repo : undefined,
        cwd: showScopeFilters ? cwd : undefined,
        from: localDateTimeInputToIso(from),
        to: localDateTimeInputToIso(to),
        type: type === 'all' ? undefined : type,
        source: source === 'all' ? undefined : source,
        actor,
        page,
        limit,
      }),
    [actor, cwd, from, limit, page, project, repo, showScopeFilters, source, taskId, to, type]
  );

  const query = useEvidenceTimeline(filters);
  const timeline = query.data;
  const events = timeline?.events ?? [];
  const total = timeline?.total ?? 0;
  const currentPage = timeline?.page ?? page;
  const pageLimit = timeline?.limit ?? limit;
  const start = total === 0 ? 0 : (currentPage - 1) * pageLimit + 1;
  const end = Math.min(total, (currentPage - 1) * pageLimit + events.length);
  const sourceCount = new Set(events.map((event) => event.source)).size;
  const eventTypeCount = new Set(events.map((event) => event.type)).size;

  const resetPage = (setter: () => void) => {
    setPage(1);
    setter();
  };

  const openSource = (link?: EvidenceTimelineSourceLink) => {
    if (!link) return;
    const href = normalizeSafeHref(link.href);
    if ((link.target === 'external' || link.target === 'github') && href) {
      window.open(href, '_blank', 'noopener,noreferrer');
      return;
    }
    if (link.taskId && onTaskClick) {
      onTaskClick(link.taskId);
      return;
    }
    if (href) {
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div className="grid flex-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {showScopeFilters ? (
            <>
              <Select
                value={project}
                onChange={(value) => resetPage(() => setProject(value ?? 'all'))}
                data={projectOptions}
                allowDeselect={false}
                searchable
                label="Project"
              />
              <TextInput
                value={repo}
                onChange={(event) => resetPage(() => setRepo(event.currentTarget.value))}
                label="Repository"
                placeholder="Any repository"
                leftSection={<Search className="h-4 w-4 text-muted-foreground" />}
              />
              <TextInput
                value={cwd}
                onChange={(event) => resetPage(() => setCwd(event.currentTarget.value))}
                label="CWD / worktree"
                placeholder="Any worktree path"
                leftSection={<Search className="h-4 w-4 text-muted-foreground" />}
              />
            </>
          ) : null}
          <TextInput
            value={actor}
            onChange={(event) => resetPage(() => setActor(event.currentTarget.value))}
            label="Actor or agent"
            placeholder="Any actor"
            leftSection={<Search className="h-4 w-4 text-muted-foreground" />}
          />
        </div>

        <Group gap="xs" wrap="wrap">
          <Button
            variant="light"
            size="sm"
            onClick={() => void query.refetch()}
            leftSection={
              <RefreshCw className={cn('h-4 w-4', query.isFetching && 'animate-spin')} />
            }
          >
            Generate Recap
          </Button>
        </Group>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <Select
          value={type}
          onChange={(value) => resetPage(() => setType((value ?? 'all') as EventFilterValue))}
          data={EVENT_OPTIONS}
          allowDeselect={false}
          label="Event type"
          leftSection={<ListFilter className="h-4 w-4 text-muted-foreground" />}
        />
        <Select
          value={source}
          onChange={(value) => resetPage(() => setSource((value ?? 'all') as SourceFilterValue))}
          data={SOURCE_OPTIONS}
          allowDeselect={false}
          label="Source"
          leftSection={<ListFilter className="h-4 w-4 text-muted-foreground" />}
        />
        <TextInput
          type="datetime-local"
          value={from}
          onChange={(event) => resetPage(() => setFrom(event.currentTarget.value))}
          label="From"
        />
        <TextInput
          type="datetime-local"
          value={to}
          onChange={(event) => resetPage(() => setTo(event.currentTarget.value))}
          label="To"
        />
        <Select
          value={String(limit)}
          onChange={(value) => resetPage(() => setLimit(Number(value ?? 50)))}
          data={LIMIT_OPTIONS}
          allowDeselect={false}
          label="Page size"
        />
      </div>

      {query.error ? (
        <Alert color="red" variant="light" icon={<AlertTriangle className="h-4 w-4" />}>
          {(query.error as Error).message || 'Failed to load evidence timeline.'}
        </Alert>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Events" value={total} tone="blue" />
        <Metric label="Loaded" value={events.length} tone="green" />
        <Metric label="Types" value={eventTypeCount} tone="violet" />
        <Metric label="Sources" value={sourceCount} tone="orange" />
      </section>

      <section className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-base font-semibold">Source-Backed Recap</h2>
            <Text size="sm" c="dimmed">
              {timeline ? formatDateTime(timeline.generatedAt) : 'Not generated'}
            </Text>
          </div>
          <Badge variant="light" color="gray" tt="none">
            {timeline?.recap.citations.length ?? 0} citations
          </Badge>
        </div>
        {query.isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader size="sm" />
            Loading evidence recap...
          </div>
        ) : (
          <div className="space-y-3">
            <Text component="pre" size="sm" className="m-0 whitespace-pre-wrap font-sans">
              {timeline?.recap.markdown ?? 'No evidence events matched the selected filters.'}
            </Text>
            {timeline?.recap.citations.length ? (
              <Group gap="xs" wrap="wrap">
                {timeline.recap.citations.map((citation, index) => (
                  <Badge key={citation.eventId} variant="light" color="gray" tt="none">
                    E{index + 1}: {SOURCE_LABELS[citation.source]}
                  </Badge>
                ))}
              </Group>
            ) : null}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-base font-semibold">Evidence Events</h2>
            <Text size="sm" c="dimmed">
              {total ? `${start}-${end} of ${total}` : 'No events'}
            </Text>
          </div>
          <Group gap="xs">
            <Button
              variant="subtle"
              size="sm"
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              disabled={currentPage <= 1 || query.isLoading}
              leftSection={<ArrowLeft className="h-4 w-4" />}
            >
              Previous
            </Button>
            <Button
              variant="subtle"
              size="sm"
              onClick={() => setPage((value) => value + 1)}
              disabled={!timeline?.hasMore || query.isLoading}
              rightSection={<ArrowRight className="h-4 w-4" />}
            >
              Next
            </Button>
          </Group>
        </div>

        {query.isLoading ? (
          <div className="rounded-lg border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
            Loading evidence events...
          </div>
        ) : events.length ? (
          <div className="space-y-3">
            {events.map((event) => (
              <EvidenceEventRow key={event.id} event={event} onOpenSource={openSource} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
            No evidence events match the current filters.
          </div>
        )}
      </section>
    </div>
  );
}

function EvidenceEventRow({
  event,
  onOpenSource,
}: {
  event: EvidenceTimelineEvent;
  onOpenSource: (link?: EvidenceTimelineSourceLink) => void;
}) {
  const Icon = EVENT_ICONS[event.type];

  return (
    <article className="rounded-lg border bg-card p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <Group gap="xs" wrap="wrap">
            <Badge
              variant="light"
              color={EVENT_COLORS[event.type]}
              tt="none"
              leftSection={<Icon className="h-3 w-3" />}
            >
              {EVENT_LABELS[event.type]}
            </Badge>
            <Badge variant="outline" color="gray" tt="none">
              {SOURCE_LABELS[event.source]}
            </Badge>
            {event.agent ? (
              <Badge variant="light" color="indigo" tt="none">
                {event.agent}
              </Badge>
            ) : null}
            {event.actor ? (
              <Badge variant="light" color="gray" tt="none">
                {event.actor}
              </Badge>
            ) : null}
          </Group>
          <h3 className="mt-2 text-base font-semibold">{event.title}</h3>
          {event.detail ? <Text size="sm">{event.detail}</Text> : null}
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span>{formatDateTime(event.timestamp)}</span>
            {event.taskTitle ? <span>{event.taskTitle}</span> : null}
            {event.project ? <span>{event.project}</span> : null}
            {event.repo ? <span>{event.repo}</span> : null}
            {event.cwd ? <span className="max-w-full truncate">{event.cwd}</span> : null}
          </div>
        </div>

        <Group gap="xs" wrap="wrap" justify="flex-end">
          {event.sourceLink ? (
            <Button
              variant="light"
              color="gray"
              size="compact-sm"
              onClick={() => onOpenSource(event.sourceLink)}
              rightSection={<ExternalLink className="h-3 w-3" />}
            >
              {event.sourceLink.label}
            </Button>
          ) : null}
        </Group>
      </div>

      {event.metadata && Object.keys(event.metadata).length ? (
        <Group mt="sm" gap="xs" wrap="wrap">
          {Object.entries(event.metadata)
            .filter(([, value]) => value !== null && value !== undefined && value !== '')
            .slice(0, 6)
            .map(([key, value]) => (
              <Code key={key} color="dark" className="max-w-full truncate">
                {key}: {String(value)}
              </Code>
            ))}
        </Group>
      ) : null}
    </article>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'blue' | 'green' | 'violet' | 'orange';
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{formatNumber(value)}</div>
      <div className={cn('mt-3 h-1 rounded-full', toneClass(tone))} />
    </div>
  );
}

function toneClass(tone: 'blue' | 'green' | 'violet' | 'orange') {
  switch (tone) {
    case 'blue':
      return 'bg-blue-500/70';
    case 'green':
      return 'bg-green-500/70';
    case 'orange':
      return 'bg-orange-500/70';
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

function formatDateTime(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function localDateTimeInputToIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}
