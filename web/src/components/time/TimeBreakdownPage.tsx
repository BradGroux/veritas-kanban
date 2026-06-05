import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Code,
  Group,
  Loader,
  Select,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import {
  AlertTriangle,
  ArrowLeft,
  Clock,
  Download,
  ExternalLink,
  RefreshCw,
  Search,
} from 'lucide-react';
import { normalizeSafeHref } from '@veritas-kanban/shared';
import { useProjects } from '@/hooks/useProjects';
import { normalizeTimeBreakdownFilters, useTimeBreakdown } from '@/hooks/useTimeBreakdowns';
import type {
  TimeBreakdownBlock,
  TimeBreakdownBlockKind,
  TimeBreakdownFilters,
  TimeBreakdownPreset,
  TimeBreakdownSource,
} from '@/lib/api';
import { cn } from '@/lib/utils';

interface TimeBreakdownPageProps {
  onBack: () => void;
  onTaskClick?: (taskId: string) => void;
}

interface DraftBlock extends TimeBreakdownBlock {
  draftLabel: string;
  draftDurationSeconds: number;
  draftNote: string;
  included: boolean;
}

const PRESET_OPTIONS: Array<{ value: TimeBreakdownPreset; label: string }> = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'custom', label: 'Custom' },
];

const LIMIT_OPTIONS = [
  { value: '50', label: '50 events' },
  { value: '100', label: '100 events' },
  { value: '200', label: '200 events' },
];

const KIND_LABELS: Record<TimeBreakdownBlockKind, string> = {
  ambiguous: 'Ambiguous',
  explicit: 'Explicit',
  inferred: 'Inferred',
};

const KIND_COLORS: Record<TimeBreakdownBlockKind, string> = {
  ambiguous: 'yellow',
  explicit: 'green',
  inferred: 'blue',
};

export function TimeBreakdownPage({ onBack, onTaskClick }: TimeBreakdownPageProps) {
  const [preset, setPreset] = useState<TimeBreakdownPreset>('weekly');
  const [project, setProject] = useState('all');
  const [taskId, setTaskId] = useState('');
  const [repo, setRepo] = useState('');
  const [cwd, setCwd] = useState('');
  const [actor, setActor] = useState('');
  const [from, setFrom] = useState(() => toLocalDateTimeInput(daysAgo(6)));
  const [to, setTo] = useState(() => toLocalDateTimeInput(new Date()));
  const [includeInferred, setIncludeInferred] = useState(true);
  const [limit, setLimit] = useState(200);
  const [draftBlocks, setDraftBlocks] = useState<DraftBlock[]>([]);
  const [clientSummary, setClientSummary] = useState('');

  const { data: projects = [] } = useProjects();
  const projectOptions = useMemo(
    () => [
      { value: 'all', label: 'All projects' },
      ...projects.map((item) => ({ value: item.id, label: item.label || item.id })),
    ],
    [projects]
  );

  const filters = useMemo<TimeBreakdownFilters>(
    () =>
      normalizeTimeBreakdownFilters({
        preset,
        from: preset === 'custom' ? localDateTimeInputToIso(from) : undefined,
        to: preset === 'custom' ? localDateTimeInputToIso(to) : undefined,
        project: project === 'all' ? undefined : project,
        taskId,
        repo,
        cwd,
        actor,
        includeInferred,
        limit,
      }),
    [actor, cwd, from, includeInferred, limit, preset, project, repo, taskId, to]
  );

  const query = useTimeBreakdown(filters);
  const breakdown = query.data;

  useEffect(() => {
    if (!breakdown) return;
    setDraftBlocks(
      breakdown.blocks.map((block) => ({
        ...block,
        draftLabel: block.label,
        draftDurationSeconds: block.durationSeconds,
        draftNote: '',
        included: true,
      }))
    );
    setClientSummary(breakdown.clientSummary);
  }, [breakdown]);

  const totals = useMemo(() => draftTotals(draftBlocks), [draftBlocks]);
  const includedBlocks = draftBlocks.filter((block) => block.included);

  const updateBlock = (id: string, patch: Partial<DraftBlock>) => {
    setDraftBlocks((blocks) =>
      blocks.map((block) => (block.id === id ? { ...block, ...patch } : block))
    );
  };

  const openSource = (block: TimeBreakdownBlock) => {
    const source = block.sources[0];
    const href = normalizeSafeHref(source?.sourceLink?.href);
    if (href) {
      window.open(href, '_blank', 'noopener,noreferrer');
      return;
    }
    const taskIdFromSource = source?.sourceLink?.taskId ?? block.taskId;
    if (taskIdFromSource && onTaskClick) {
      onTaskClick(taskIdFromSource);
    }
  };

  const exportCsv = () => {
    downloadText(`time-breakdown-${dateStamp()}.csv`, draftCsv(includedBlocks), 'text/csv');
  };

  const exportMarkdown = () => {
    downloadText(
      `time-breakdown-${dateStamp()}.md`,
      draftMarkdown(clientSummary, includedBlocks, filters),
      'text/markdown;charset=utf-8'
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
              <h1 className="text-2xl font-bold">Time Breakdowns</h1>
              <Badge
                variant="light"
                color="gray"
                tt="none"
                leftSection={<Clock className="h-3 w-3" />}
              >
                Source-backed
              </Badge>
            </Group>
            <Text size="sm" c="dimmed">
              Editable explicit, inferred, and ambiguous time blocks with evidence exports.
            </Text>
          </div>
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
            Generate
          </Button>
          <Button
            variant="light"
            size="sm"
            onClick={exportCsv}
            disabled={!includedBlocks.length}
            leftSection={<Download className="h-4 w-4" />}
          >
            CSV
          </Button>
          <Button
            variant="light"
            size="sm"
            onClick={exportMarkdown}
            disabled={!includedBlocks.length}
            leftSection={<Download className="h-4 w-4" />}
          >
            Markdown
          </Button>
        </Group>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <Select
          value={preset}
          onChange={(value) => setPreset((value ?? 'weekly') as TimeBreakdownPreset)}
          data={PRESET_OPTIONS}
          allowDeselect={false}
          label="Range"
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
          value={taskId}
          onChange={(event) => setTaskId(event.currentTarget.value)}
          label="Task ID"
          placeholder="Any task"
          leftSection={<Search className="h-4 w-4 text-muted-foreground" />}
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

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <TextInput
          value={actor}
          onChange={(event) => setActor(event.currentTarget.value)}
          label="Assignee / agent"
          placeholder="Any actor"
          leftSection={<Search className="h-4 w-4 text-muted-foreground" />}
        />
        {preset === 'custom' ? (
          <>
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
          </>
        ) : null}
        <Select
          value={String(limit)}
          onChange={(value) => setLimit(Number(value ?? 200))}
          data={LIMIT_OPTIONS}
          allowDeselect={false}
          label="Evidence window"
        />
        <Checkbox
          checked={includeInferred}
          onChange={(event) => setIncludeInferred(event.currentTarget.checked)}
          label="Include inferred time"
          className="self-end pb-2"
        />
      </div>

      {query.error ? (
        <Alert color="red" variant="light" icon={<AlertTriangle className="h-4 w-4" />}>
          {(query.error as Error).message || 'Failed to load time breakdown.'}
        </Alert>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Explicit" value={formatSeconds(totals.explicitSeconds)} tone="green" />
        <Metric label="Inferred" value={formatSeconds(totals.inferredSeconds)} tone="blue" />
        <Metric label="Total" value={formatSeconds(totals.totalSeconds)} tone="violet" />
        <Metric label="Ambiguous" value={String(totals.ambiguousCount)} tone="orange" />
      </section>

      <section className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Client Summary</h2>
          <Badge variant="light" color="gray" tt="none">
            Reviewable
          </Badge>
        </div>
        <Textarea
          value={clientSummary}
          onChange={(event) => setClientSummary(event.currentTarget.value)}
          minRows={3}
          aria-label="Client summary"
        />
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-base font-semibold">Editable Draft Blocks</h2>
            <Text size="sm" c="dimmed">
              {breakdown
                ? `${draftBlocks.length} blocks from ${breakdown.period.from.slice(
                    0,
                    10
                  )} to ${breakdown.period.to.slice(0, 10)}`
                : 'No breakdown generated'}
            </Text>
          </div>
        </div>

        {query.isLoading ? (
          <div className="rounded-lg border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
            <Loader size="sm" />
          </div>
        ) : draftBlocks.length ? (
          (['explicit', 'inferred', 'ambiguous'] as const).map((kind) => {
            const blocks = draftBlocks.filter((block) => block.kind === kind);
            if (!blocks.length) return null;
            return (
              <div key={kind} className="space-y-3">
                <Group gap="xs">
                  <h3 className="text-sm font-semibold">{KIND_LABELS[kind]}</h3>
                  <Badge variant="light" color={KIND_COLORS[kind]} tt="none">
                    {blocks.length}
                  </Badge>
                </Group>
                <div className="space-y-3">
                  {blocks.map((block) => (
                    <DraftBlockRow
                      key={block.id}
                      block={block}
                      onUpdate={updateBlock}
                      onOpenSource={() => openSource(block)}
                    />
                  ))}
                </div>
              </div>
            );
          })
        ) : (
          <div className="rounded-lg border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
            No time evidence matches the current filters.
          </div>
        )}
      </section>
    </div>
  );
}

function DraftBlockRow({
  block,
  onUpdate,
  onOpenSource,
}: {
  block: DraftBlock;
  onUpdate: (id: string, patch: Partial<DraftBlock>) => void;
  onOpenSource: () => void;
}) {
  return (
    <article className={cn('rounded-lg border bg-card p-4', !block.included && 'opacity-60')}>
      <div className="grid gap-3 lg:grid-cols-[130px_150px_1fr_1fr_auto] lg:items-end">
        <Checkbox
          checked={block.included}
          onChange={(event) => onUpdate(block.id, { included: event.currentTarget.checked })}
          label={KIND_LABELS[block.kind]}
        />
        <TextInput
          label="Duration"
          value={formatSeconds(block.draftDurationSeconds)}
          onChange={(event) =>
            onUpdate(block.id, {
              draftDurationSeconds: parseDurationSeconds(event.currentTarget.value),
            })
          }
          disabled={block.kind === 'ambiguous'}
          aria-label={`Duration for ${block.label}`}
        />
        <TextInput
          label="Label"
          value={block.draftLabel}
          onChange={(event) => onUpdate(block.id, { draftLabel: event.currentTarget.value })}
          aria-label={`Label for ${block.label}`}
        />
        <TextInput
          label="Note"
          value={block.draftNote}
          onChange={(event) => onUpdate(block.id, { draftNote: event.currentTarget.value })}
          placeholder="Optional export note"
          aria-label={`Note for ${block.label}`}
        />
        <Button
          variant="light"
          color="gray"
          size="sm"
          onClick={onOpenSource}
          disabled={!block.sources.length}
          rightSection={<ExternalLink className="h-3 w-3" />}
        >
          Source
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span>{block.date}</span>
        {block.taskTitle ? <span>{block.taskTitle}</span> : null}
        {block.project ? <span>{block.project}</span> : null}
        {block.repo ? <span>{block.repo}</span> : null}
        {block.cwd ? <span className="max-w-full truncate">{block.cwd}</span> : null}
        <span>{block.confidence} confidence</span>
        <span>{block.confidenceReason}</span>
      </div>

      {block.sources.length ? (
        <Group mt="sm" gap="xs" wrap="wrap">
          {block.sources.map((source) => (
            <Code key={source.eventId} color="dark" className="max-w-full truncate">
              {source.eventId}
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
  value: string;
  tone: 'green' | 'blue' | 'violet' | 'orange';
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
      <div className={cn('mt-3 h-1 rounded-full', toneClass(tone))} />
    </div>
  );
}

function draftTotals(blocks: DraftBlock[]) {
  return blocks.reduce(
    (totals, block) => {
      if (!block.included) return totals;
      if (block.kind === 'explicit') totals.explicitSeconds += block.draftDurationSeconds;
      if (block.kind === 'inferred') totals.inferredSeconds += block.draftDurationSeconds;
      if (block.kind === 'ambiguous') totals.ambiguousCount += 1;
      totals.totalSeconds = totals.explicitSeconds + totals.inferredSeconds;
      return totals;
    },
    { explicitSeconds: 0, inferredSeconds: 0, totalSeconds: 0, ambiguousCount: 0 }
  );
}

function draftCsv(blocks: DraftBlock[]): string {
  const header = [
    'date',
    'kind',
    'duration_seconds',
    'duration',
    'label',
    'note',
    'task_id',
    'task_title',
    'project',
    'repo',
    'cwd',
    'actor',
    'agent',
    'confidence',
    'source_events',
  ];
  const rows = blocks.map((block) =>
    [
      block.date,
      block.kind,
      String(block.draftDurationSeconds),
      formatSeconds(block.draftDurationSeconds),
      block.draftLabel,
      block.draftNote,
      block.taskId ?? '',
      block.taskTitle ?? '',
      block.project ?? '',
      block.repo ?? '',
      block.cwd ?? '',
      block.actor ?? '',
      block.agent ?? '',
      block.confidence,
      block.sources.map((source) => source.eventId).join(' '),
    ].map(csvCell)
  );
  return [header.map(csvCell), ...rows].map((row) => row.join(',')).join('\n');
}

function draftMarkdown(
  summary: string,
  blocks: DraftBlock[],
  filters: TimeBreakdownFilters
): string {
  return [
    '# Time Breakdown',
    '',
    summary,
    '',
    `- Range: ${filters.preset ?? 'weekly'}`,
    `- Exported blocks: ${blocks.length}`,
    '',
    '## Blocks',
    '',
    ...blocks.map(
      (block) =>
        `- ${block.date} [${block.kind}] ${formatSeconds(block.draftDurationSeconds)} - ${
          block.draftLabel
        }${block.draftNote ? ` - ${block.draftNote}` : ''} (sources: ${sourceIds(block.sources)})`
    ),
  ].join('\n');
}

function sourceIds(sources: TimeBreakdownSource[]): string {
  return sources.map((source) => source.eventId).join(', ') || 'none';
}

function toneClass(tone: 'green' | 'blue' | 'violet' | 'orange') {
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

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
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

function parseDurationSeconds(value: string): number {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return 0;
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 60;
  const hours = Number(trimmed.match(/(\d+(?:\.\d+)?)\s*h/)?.[1] ?? 0);
  const minutes = Number(trimmed.match(/(\d+(?:\.\d+)?)\s*m/)?.[1] ?? 0);
  const seconds = Number(trimmed.match(/(\d+(?:\.\d+)?)\s*s/)?.[1] ?? 0);
  return Math.max(0, Math.round(hours * 3600 + minutes * 60 + seconds));
}

function formatSeconds(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  if (rounded < 60) return `${rounded}s`;
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  if (minutes < 60) return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
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

function csvCell(value: string): string {
  if (!/[",\n]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}
