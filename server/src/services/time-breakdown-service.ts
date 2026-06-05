import type {
  EvidenceTimelineEvent,
  EvidenceTimelineFilters,
  TimeBreakdownBlock,
  TimeBreakdownBlockKind,
  TimeBreakdownConfidence,
  TimeBreakdownFilters,
  TimeBreakdownGroup,
  TimeBreakdownPreset,
  TimeBreakdownResponse,
  TimeBreakdownSource,
  TimeBreakdownTotals,
} from '@veritas-kanban/shared';
import { EvidenceTimelineService } from './evidence-timeline-service.js';

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 200;

interface TimeBreakdownServiceOptions {
  evidence?: Pick<EvidenceTimelineService, 'getTimeline'>;
  now?: () => Date;
}

interface NormalizedTimeBreakdownFilters extends TimeBreakdownFilters {
  preset: TimeBreakdownPreset;
  from: string;
  to: string;
  includeInferred: boolean;
  limit: number;
}

export class TimeBreakdownService {
  private readonly evidence: Pick<EvidenceTimelineService, 'getTimeline'>;
  private readonly now: () => Date;

  constructor(options: TimeBreakdownServiceOptions = {}) {
    this.evidence = options.evidence ?? new EvidenceTimelineService();
    this.now = options.now ?? (() => new Date());
  }

  async generate(filters: TimeBreakdownFilters = {}): Promise<TimeBreakdownResponse> {
    const normalized = normalizeFilters(filters, this.now());
    const evidenceFilters: EvidenceTimelineFilters = {
      taskId: normalized.taskId,
      project: normalized.project,
      repo: normalized.repo,
      cwd: normalized.cwd,
      actor: normalized.actor,
      from: normalized.from,
      to: normalized.to,
      page: 1,
      limit: normalized.limit,
    };
    const timeline = await this.evidence.getTimeline(evidenceFilters);
    const blocks = timeline.events
      .flatMap((event) => eventToBlocks(event, normalized.includeInferred))
      .sort(compareBlocks);
    const groups = buildGroups(blocks);
    const totals = buildTotals(blocks);
    const clientSummary = buildClientSummary(normalized, totals);

    return {
      generatedAt: new Date().toISOString(),
      period: {
        preset: normalized.preset,
        from: normalized.from,
        to: normalized.to,
      },
      filters: stripFilters(normalized),
      totals,
      groups,
      blocks,
      clientSummary,
      markdown: buildMarkdown(normalized, totals, groups, blocks, clientSummary),
      csv: buildCsv(blocks),
    };
  }
}

function eventToBlocks(
  event: EvidenceTimelineEvent,
  includeInferred: boolean
): TimeBreakdownBlock[] {
  if (event.type === 'time') {
    const seconds = numberMeta(event, 'durationSeconds');
    if (seconds && seconds > 0) {
      return [
        blockFromEvent(event, {
          kind: 'explicit',
          durationSeconds: seconds,
          label: event.detail || event.title,
          confidence: 'high',
          confidenceReason: 'Explicit tracked time entry.',
        }),
      ];
    }
    return [
      blockFromEvent(event, {
        kind: 'ambiguous',
        durationSeconds: 0,
        label: event.title,
        confidence: 'low',
        confidenceReason: 'Timer evidence has no completed duration yet.',
      }),
    ];
  }

  if (!includeInferred) return [];

  if (event.type === 'agent_run') {
    const durationMs = numberMeta(event, 'durationMs');
    if (!durationMs || durationMs <= 0) return [];
    return [
      blockFromEvent(event, {
        kind: 'inferred',
        durationSeconds: Math.round(durationMs / 1000),
        label: event.title,
        confidence: booleanMeta(event, 'success') === false ? 'medium' : 'high',
        confidenceReason: 'Agent run telemetry reported duration.',
      }),
    ];
  }

  if (event.type === 'status') {
    const durationMs = numberMeta(event, 'durationMs');
    const previousStatus = stringMeta(event, 'previousStatus');
    if (!durationMs || durationMs <= 0 || !isActiveStatus(previousStatus)) return [];
    return [
      blockFromEvent(event, {
        kind: 'inferred',
        durationSeconds: Math.round(durationMs / 1000),
        label: `Agent status ${previousStatus}`,
        confidence: 'medium',
        confidenceReason: 'Status history recorded active agent time.',
      }),
    ];
  }

  if (event.type === 'comment' || event.type === 'github' || event.type === 'work_product') {
    return [
      blockFromEvent(event, {
        kind: 'ambiguous',
        durationSeconds: 0,
        label: event.title,
        confidence: 'low',
        confidenceReason: 'Source evidence indicates work activity but has no duration.',
      }),
    ];
  }

  return [];
}

function blockFromEvent(
  event: EvidenceTimelineEvent,
  input: {
    kind: TimeBreakdownBlockKind;
    durationSeconds: number;
    label: string;
    confidence: TimeBreakdownConfidence;
    confidenceReason: string;
  }
): TimeBreakdownBlock {
  return {
    id: `time-breakdown:${event.id}`,
    kind: input.kind,
    date: event.timestamp.slice(0, 10),
    timestamp: event.timestamp,
    durationSeconds: Math.max(0, Math.round(input.durationSeconds)),
    label: input.label,
    taskId: event.taskId,
    taskTitle: event.taskTitle,
    project: event.project,
    repo: event.repo,
    cwd: event.cwd,
    actor: event.actor,
    agent: event.agent,
    confidence: input.confidence,
    confidenceReason: input.confidenceReason,
    sources: [sourceFromEvent(event)],
  };
}

function sourceFromEvent(event: EvidenceTimelineEvent): TimeBreakdownSource {
  return {
    eventId: event.id,
    label: event.title,
    timestamp: event.timestamp,
    source: event.source,
    sourceLink: event.sourceLink,
  };
}

function buildGroups(blocks: TimeBreakdownBlock[]): TimeBreakdownGroup[] {
  const groups = new Map<string, TimeBreakdownGroup>();
  for (const block of blocks) {
    const key = [
      block.date,
      block.project ?? 'unassigned',
      block.repo ?? 'no-repo',
      block.cwd ?? 'no-cwd',
      block.taskId ?? 'no-task',
    ].join('::');
    const existing =
      groups.get(key) ??
      ({
        key,
        label: groupLabel(block),
        date: block.date,
        taskId: block.taskId,
        taskTitle: block.taskTitle,
        project: block.project,
        repo: block.repo,
        cwd: block.cwd,
        explicitSeconds: 0,
        inferredSeconds: 0,
        ambiguousCount: 0,
        totalSeconds: 0,
        blockIds: [],
      } satisfies TimeBreakdownGroup);

    if (block.kind === 'explicit') existing.explicitSeconds += block.durationSeconds;
    if (block.kind === 'inferred') existing.inferredSeconds += block.durationSeconds;
    if (block.kind === 'ambiguous') existing.ambiguousCount += 1;
    existing.totalSeconds = existing.explicitSeconds + existing.inferredSeconds;
    existing.blockIds.push(block.id);
    groups.set(key, existing);
  }

  return [...groups.values()].sort((a, b) => {
    const date = a.date.localeCompare(b.date);
    if (date !== 0) return date;
    return b.totalSeconds - a.totalSeconds || a.label.localeCompare(b.label);
  });
}

function buildTotals(blocks: TimeBreakdownBlock[]): TimeBreakdownTotals {
  return blocks.reduce<TimeBreakdownTotals>(
    (totals, block) => {
      totals.blocks += 1;
      if (block.kind === 'explicit') totals.explicitSeconds += block.durationSeconds;
      if (block.kind === 'inferred') totals.inferredSeconds += block.durationSeconds;
      if (block.kind === 'ambiguous') totals.ambiguousCount += 1;
      totals.totalSeconds = totals.explicitSeconds + totals.inferredSeconds;
      return totals;
    },
    {
      explicitSeconds: 0,
      inferredSeconds: 0,
      totalSeconds: 0,
      ambiguousCount: 0,
      blocks: 0,
    }
  );
}

function buildClientSummary(
  filters: NormalizedTimeBreakdownFilters,
  totals: TimeBreakdownTotals
): string {
  const range = `${formatDate(filters.from)} to ${formatDate(filters.to)}`;
  return [
    `Time breakdown for ${range}.`,
    `Explicit tracked time: ${formatDuration(totals.explicitSeconds)}.`,
    `Inferred agent/activity time: ${formatDuration(totals.inferredSeconds)}.`,
    `Ambiguous source events needing review: ${totals.ambiguousCount}.`,
  ].join(' ');
}

function buildMarkdown(
  filters: NormalizedTimeBreakdownFilters,
  totals: TimeBreakdownTotals,
  groups: TimeBreakdownGroup[],
  blocks: TimeBreakdownBlock[],
  clientSummary: string
): string {
  const lines = [
    '# Time Breakdown',
    '',
    clientSummary,
    '',
    `- Window: ${formatDateTime(filters.from)} to ${formatDateTime(filters.to)}`,
    `- Explicit: ${formatDuration(totals.explicitSeconds)}`,
    `- Inferred: ${formatDuration(totals.inferredSeconds)}`,
    `- Ambiguous events: ${totals.ambiguousCount}`,
    '',
    '## Groups',
    '',
    ...groups.map(
      (group) =>
        `- ${group.date} ${group.label}: ${formatDuration(group.totalSeconds)} (${formatDuration(
          group.explicitSeconds
        )} explicit, ${formatDuration(group.inferredSeconds)} inferred, ${
          group.ambiguousCount
        } ambiguous)`
    ),
    '',
    '## Source Blocks',
    '',
    ...blocks.map(
      (block) =>
        `- ${block.date} [${block.kind}] ${formatDuration(block.durationSeconds)} - ${
          block.label
        } (${block.confidence}; sources: ${block.sources.map((source) => source.eventId).join(', ')})`
    ),
  ];
  return lines.join('\n');
}

function buildCsv(blocks: TimeBreakdownBlock[]): string {
  const header = [
    'date',
    'kind',
    'duration_seconds',
    'duration',
    'label',
    'task_id',
    'task_title',
    'project',
    'repo',
    'cwd',
    'actor',
    'agent',
    'confidence',
    'confidence_reason',
    'source_events',
  ];
  const rows = blocks.map((block) =>
    [
      block.date,
      block.kind,
      String(block.durationSeconds),
      formatDuration(block.durationSeconds),
      block.label,
      block.taskId ?? '',
      block.taskTitle ?? '',
      block.project ?? '',
      block.repo ?? '',
      block.cwd ?? '',
      block.actor ?? '',
      block.agent ?? '',
      block.confidence,
      block.confidenceReason,
      block.sources.map((source) => source.eventId).join(' '),
    ].map(csvCell)
  );
  return [header.map(csvCell), ...rows].map((row) => row.join(',')).join('\n');
}

function normalizeFilters(
  filters: TimeBreakdownFilters,
  now: Date
): NormalizedTimeBreakdownFilters {
  const preset = filters.preset ?? 'weekly';
  const range = dateRangeForPreset(preset, now);
  return {
    preset,
    from: optional(filters.from) ?? range.from,
    to: optional(filters.to) ?? range.to,
    taskId: optional(filters.taskId),
    project: optional(filters.project),
    repo: optional(filters.repo),
    cwd: optional(filters.cwd),
    actor: optional(filters.actor),
    includeInferred: filters.includeInferred ?? true,
    limit: Math.min(Math.max(Number(filters.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT),
  };
}

function stripFilters(filters: NormalizedTimeBreakdownFilters): TimeBreakdownFilters {
  const next: TimeBreakdownFilters = {
    preset: filters.preset,
    from: filters.from,
    to: filters.to,
    includeInferred: filters.includeInferred,
    limit: filters.limit,
  };
  if (filters.taskId) next.taskId = filters.taskId;
  if (filters.project) next.project = filters.project;
  if (filters.repo) next.repo = filters.repo;
  if (filters.cwd) next.cwd = filters.cwd;
  if (filters.actor) next.actor = filters.actor;
  return next;
}

function dateRangeForPreset(preset: TimeBreakdownPreset, now: Date): { from: string; to: string } {
  const to = new Date(now);
  const from = new Date(now);
  switch (preset) {
    case 'daily':
      from.setHours(0, 0, 0, 0);
      break;
    case 'monthly':
      from.setDate(1);
      from.setHours(0, 0, 0, 0);
      break;
    case 'custom':
    case 'weekly':
      from.setDate(from.getDate() - 6);
      from.setHours(0, 0, 0, 0);
      break;
  }
  return { from: from.toISOString(), to: to.toISOString() };
}

function compareBlocks(a: TimeBreakdownBlock, b: TimeBreakdownBlock): number {
  const timestamp = a.timestamp.localeCompare(b.timestamp);
  if (timestamp !== 0) return timestamp;
  return a.id.localeCompare(b.id);
}

function groupLabel(block: TimeBreakdownBlock): string {
  return [block.project, block.repo, block.cwd, block.taskTitle ?? block.taskId]
    .filter(Boolean)
    .join(' / ');
}

function isActiveStatus(status: string | undefined): boolean {
  return status === 'working' || status === 'thinking' || status === 'sub-agent';
}

function numberMeta(event: EvidenceTimelineEvent, key: string): number | undefined {
  const value = event.metadata?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringMeta(event: EvidenceTimelineEvent, key: string): string | undefined {
  const value = event.metadata?.[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function booleanMeta(event: EvidenceTimelineEvent, key: string): boolean | undefined {
  const value = event.metadata?.[key];
  return typeof value === 'boolean' ? value : undefined;
}

function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function formatDate(value: string): string {
  return value.slice(0, 10);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  });
}

function formatDuration(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  if (rounded < 60) return `${rounded}s`;
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  if (minutes < 60) return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function csvCell(value: string): string {
  if (!/[",\n]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}
