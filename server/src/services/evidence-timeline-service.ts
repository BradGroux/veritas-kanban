import type {
  AnyTelemetryEvent,
  Attachment,
  Comment,
  Deliverable,
  EvidenceTimelineCitation,
  EvidenceTimelineEvent,
  EvidenceTimelineEventSource,
  EvidenceTimelineEventType,
  EvidenceTimelineFilters,
  EvidenceTimelineRecap,
  EvidenceTimelineResponse,
  Observation,
  ReviewComment,
  Task,
  TimeEntry,
  WorkProduct,
} from '@veritas-kanban/shared';
import { activityService, type Activity, type ActivityService } from './activity-service.js';
import {
  statusHistoryService,
  type StatusHistoryEntry,
  type StatusHistoryService,
} from './status-history-service.js';
import { getTelemetryService, type TelemetryService } from './telemetry-service.js';
import { getTaskService, type TaskService } from './task-service.js';
import { getWorkProductService, type WorkProductService } from './work-product-service.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const SOURCE_SCAN_LIMIT = 5_000;
const WORK_PRODUCT_TASK_LIMIT = 50;

interface EvidenceTimelineServiceOptions {
  taskService?: Pick<TaskService, 'listTasks'>;
  activity?: Pick<ActivityService, 'getActivities'>;
  statusHistory?: Pick<StatusHistoryService, 'getHistoryByDateRange' | 'getHistory'>;
  telemetry?: Pick<TelemetryService, 'getEvents'>;
  workProducts?: Pick<WorkProductService, 'list'>;
}

interface NormalizedEvidenceFilters extends EvidenceTimelineFilters {
  page: number;
  limit: number;
}

export class EvidenceTimelineService {
  private readonly taskService: Pick<TaskService, 'listTasks'>;
  private readonly activity: Pick<ActivityService, 'getActivities'>;
  private readonly statusHistory: Pick<
    StatusHistoryService,
    'getHistoryByDateRange' | 'getHistory'
  >;
  private readonly telemetry: Pick<TelemetryService, 'getEvents'>;
  private readonly workProducts: Pick<WorkProductService, 'list'>;

  constructor(options: EvidenceTimelineServiceOptions = {}) {
    this.taskService = options.taskService ?? getTaskService();
    this.activity = options.activity ?? activityService;
    this.statusHistory = options.statusHistory ?? statusHistoryService;
    this.telemetry = options.telemetry ?? getTelemetryService();
    this.workProducts = options.workProducts ?? getWorkProductService();
  }

  async getTimeline(filters: EvidenceTimelineFilters = {}): Promise<EvidenceTimelineResponse> {
    const normalized = normalizeFilters(filters);
    const allTasks = await this.taskService.listTasks();
    const scopedTasks = allTasks.filter((task) => taskMatchesScope(task, normalized));
    const scopedTaskIds = new Set(scopedTasks.map((task) => task.id));
    const tasksById = new Map(allTasks.map((task) => [task.id, task]));

    const [activity, statusHistory, telemetry, workProducts] = await Promise.all([
      this.loadActivity(normalized),
      this.loadStatusHistory(normalized),
      this.loadTelemetry(normalized),
      this.loadWorkProducts(scopedTasks),
    ]);

    const events = [
      ...taskEvents(scopedTasks),
      ...activityEvents(activity, tasksById),
      ...statusHistoryEvents(statusHistory, tasksById),
      ...telemetryEvents(telemetry, tasksById),
      ...workProductEvents(workProducts, tasksById),
    ]
      .filter((event) => eventMatchesScopedTasks(event, scopedTaskIds, normalized))
      .filter((event) => eventMatchesFilters(event, normalized))
      .sort(compareEvents);

    const total = events.length;
    const start = (normalized.page - 1) * normalized.limit;
    const paged = events.slice(start, start + normalized.limit);

    return {
      events: paged,
      recap: buildRecap(events, normalized),
      total,
      page: normalized.page,
      limit: normalized.limit,
      hasMore: start + paged.length < total,
      generatedAt: new Date().toISOString(),
      filters: stripEmptyFilters(normalized),
    };
  }

  private async loadActivity(filters: NormalizedEvidenceFilters): Promise<Activity[]> {
    return this.activity.getActivities(SOURCE_SCAN_LIMIT, {
      taskId: filters.taskId,
      since: filters.from,
      until: filters.to,
    });
  }

  private async loadStatusHistory(
    filters: NormalizedEvidenceFilters
  ): Promise<StatusHistoryEntry[]> {
    if (filters.from || filters.to) {
      return this.statusHistory.getHistoryByDateRange(
        filters.from ?? '1970-01-01T00:00:00.000Z',
        filters.to ?? new Date().toISOString()
      );
    }
    return this.statusHistory.getHistory(SOURCE_SCAN_LIMIT);
  }

  private async loadTelemetry(filters: NormalizedEvidenceFilters): Promise<AnyTelemetryEvent[]> {
    return this.telemetry.getEvents({
      taskId: filters.taskId,
      project: filters.project,
      since: filters.from,
      until: filters.to,
      limit: SOURCE_SCAN_LIMIT,
    });
  }

  private async loadWorkProducts(tasks: Task[]): Promise<WorkProduct[]> {
    const products = await Promise.all(
      tasks.slice(0, WORK_PRODUCT_TASK_LIMIT).map((task) =>
        this.workProducts.list({
          taskId: task.id,
          includeArchived: true,
          limit: 200,
        })
      )
    );
    return products.flat();
  }
}

function taskEvents(tasks: Task[]): EvidenceTimelineEvent[] {
  return tasks.flatMap((task) => {
    const context = taskContext(task);
    const events: EvidenceTimelineEvent[] = [
      {
        id: `task:${task.id}:created`,
        timestamp: task.created,
        type: 'task',
        source: 'task',
        title: 'Task created',
        detail: task.title,
        ...context,
        actor: task.createdBy,
        sourceLink: taskLink(task.id, 'Open task'),
      },
    ];

    if (task.updated && task.updated !== task.created) {
      events.push({
        id: `task:${task.id}:updated`,
        timestamp: task.updated,
        type: 'task',
        source: 'task',
        title: 'Task updated',
        detail: `Current status: ${task.status}`,
        ...context,
        actor: task.updatedBy,
        sourceLink: taskLink(task.id, 'Open task'),
      });
    }

    if (task.github) {
      events.push({
        id: `task:${task.id}:github:${task.github.issueNumber}`,
        timestamp: task.updated || task.created,
        type: 'github',
        source: 'task',
        title: `GitHub issue #${task.github.issueNumber}`,
        detail: task.github.repo,
        ...context,
        sourceLink: {
          label: 'Open GitHub issue',
          target: 'github',
          taskId: task.id,
          href: task.github.url,
        },
      });
    }

    events.push(...commentEvents(task, task.comments ?? [], 'comment'));
    events.push(...reviewCommentEvents(task, task.reviewComments ?? []));
    events.push(...timeEvents(task, task.timeTracking?.entries ?? []));
    events.push(...observationEvents(task, task.observations ?? []));
    events.push(...attachmentEvents(task, task.attachments ?? []));
    events.push(...deliverableEvents(task, task.deliverables ?? []));
    return events;
  });
}

function commentEvents(
  task: Task,
  comments: Comment[],
  type: EvidenceTimelineEventType
): EvidenceTimelineEvent[] {
  return comments.map((comment) => ({
    id: `comment:${task.id}:${comment.id}`,
    timestamp: comment.timestamp,
    type,
    source: 'task',
    title: 'Comment added',
    detail: truncate(comment.text),
    ...taskContext(task),
    actor: comment.createdBy ?? comment.author,
    sourceLink: taskLink(task.id, 'Open comments'),
  }));
}

function reviewCommentEvents(task: Task, comments: ReviewComment[]): EvidenceTimelineEvent[] {
  return comments.map((comment) => ({
    id: `review-comment:${task.id}:${comment.id}`,
    timestamp: comment.created,
    type: 'comment',
    source: 'task',
    title: `Review comment on ${comment.file}:${comment.line}`,
    detail: truncate(comment.content),
    ...taskContext(task),
    sourceLink: taskLink(task.id, 'Open review'),
  }));
}

function timeEvents(task: Task, entries: TimeEntry[]): EvidenceTimelineEvent[] {
  return entries.map((entry) => ({
    id: `time:${task.id}:${entry.id}`,
    timestamp: entry.endTime ?? entry.startTime,
    type: 'time',
    source: 'task',
    title: entry.endTime ? 'Time tracked' : 'Timer started',
    detail: entry.description ?? formatSeconds(entry.duration),
    ...taskContext(task),
    metadata: {
      durationSeconds: entry.duration ?? null,
      manual: entry.manual ?? false,
      running: !entry.endTime,
    },
    sourceLink: taskLink(task.id, 'Open time tracking'),
  }));
}

function observationEvents(task: Task, observations: Observation[]): EvidenceTimelineEvent[] {
  return observations.map((observation) => ({
    id: `observation:${task.id}:${observation.id}`,
    timestamp: observation.timestamp,
    type: 'observation',
    source: 'task',
    title: `${capitalize(observation.type)} observation`,
    detail: truncate(observation.content),
    ...taskContext(task),
    agent: observation.agent,
    metadata: { score: observation.score },
    sourceLink: taskLink(task.id, 'Open observations'),
  }));
}

function attachmentEvents(task: Task, attachments: Attachment[]): EvidenceTimelineEvent[] {
  return attachments.map((attachment) => ({
    id: `attachment:${task.id}:${attachment.id}`,
    timestamp: attachment.uploaded,
    type: 'attachment',
    source: 'task',
    title: `Attachment uploaded: ${attachment.originalName || attachment.filename}`,
    detail: attachment.mimeType,
    ...taskContext(task),
    actor: attachment.uploadedBy,
    metadata: {
      size: attachment.size,
      validationStatus: attachment.validationStatus ?? null,
    },
    sourceLink: {
      ...taskLink(task.id, 'Open attachments'),
      target: 'attachments',
    },
  }));
}

function deliverableEvents(task: Task, deliverables: Deliverable[]): EvidenceTimelineEvent[] {
  return deliverables.map((deliverable) => ({
    id: `deliverable:${task.id}:${deliverable.id}`,
    timestamp: deliverable.updated ?? deliverable.created,
    type: 'deliverable',
    source: 'deliverable',
    title: `Deliverable ${deliverable.status}: ${deliverable.title}`,
    detail: deliverable.description ?? deliverable.path,
    ...taskContext(task),
    agent: deliverable.agent,
    metadata: {
      kind: deliverable.type,
      version: deliverable.version ?? null,
      sourceRunId: deliverable.sourceRunId ?? null,
    },
    sourceLink: deliverable.path
      ? { label: 'Open deliverable', target: 'external', taskId: task.id, href: deliverable.path }
      : taskLink(task.id, 'Open deliverables'),
  }));
}

function activityEvents(
  activities: Activity[],
  tasksById: Map<string, Task>
): EvidenceTimelineEvent[] {
  return activities.map((activity) => {
    const task = tasksById.get(activity.taskId);
    return {
      id: `activity:${activity.id}`,
      timestamp: activity.timestamp,
      type: activityType(activity.type),
      source: 'activity',
      title: activity.type.replaceAll('_', ' '),
      detail: stringifyDetails(activity.details),
      ...taskContext(task, activity.taskId, activity.taskTitle),
      actor: activity.actor,
      agent: activity.agent,
      sourceLink: taskLink(activity.taskId, 'Open task'),
    };
  });
}

function statusHistoryEvents(
  entries: StatusHistoryEntry[],
  tasksById: Map<string, Task>
): EvidenceTimelineEvent[] {
  return entries.map((entry) => {
    const task = entry.taskId ? tasksById.get(entry.taskId) : undefined;
    return {
      id: `status-history:${entry.id}`,
      timestamp: entry.timestamp,
      type: 'status',
      source: 'status-history',
      title: `Agent status ${entry.previousStatus} -> ${entry.newStatus}`,
      detail: entry.durationMs
        ? `Previous status lasted ${formatDuration(entry.durationMs)}`
        : undefined,
      ...taskContext(task, entry.taskId, entry.taskTitle),
      metadata: {
        previousStatus: entry.previousStatus,
        newStatus: entry.newStatus,
        subAgentCount: entry.subAgentCount ?? null,
        durationMs: entry.durationMs ?? null,
      },
      sourceLink: entry.taskId ? taskLink(entry.taskId, 'Open task') : undefined,
    };
  });
}

function telemetryEvents(
  events: AnyTelemetryEvent[],
  tasksById: Map<string, Task>
): EvidenceTimelineEvent[] {
  return events.map((event) => {
    const task = event.taskId ? tasksById.get(event.taskId) : undefined;
    const runAgent = 'agent' in event ? event.agent : undefined;
    const attemptId = 'attemptId' in event ? event.attemptId : undefined;
    return {
      id: `telemetry:${event.id}`,
      timestamp: event.timestamp,
      type: event.type.startsWith('run.') ? 'agent_run' : 'telemetry',
      source: 'telemetry',
      title: telemetryTitle(event),
      detail: telemetryDetail(event),
      ...taskContext(task, event.taskId, task?.title),
      agent: runAgent,
      metadata: telemetryMetadata(event),
      sourceLink: {
        label: attemptId ? 'Open run timeline' : 'Open telemetry',
        target: attemptId ? 'timeline' : 'telemetry',
        taskId: event.taskId,
        eventId: event.id,
        runId: attemptId,
      },
    };
  });
}

function workProductEvents(
  products: WorkProduct[],
  tasksById: Map<string, Task>
): EvidenceTimelineEvent[] {
  return products.map((product) => {
    const task = product.taskId ? tasksById.get(product.taskId) : undefined;
    return {
      id: `work-product:${product.id}:${product.version}`,
      timestamp: product.updatedAt,
      type: 'work_product',
      source: 'work-product',
      title: `Work product ${product.status}: ${product.title}`,
      detail:
        product.metadata?.packetType === 'completion_packet' ? 'Completion packet' : undefined,
      ...taskContext(task, product.taskId, task?.title),
      agent: product.agent,
      metadata: {
        kind: product.kind,
        version: product.version,
        sourceRunId: product.sourceRunId ?? null,
      },
      sourceLink: {
        label: 'Open work product',
        target: 'work-products',
        taskId: product.taskId,
        runId: product.sourceRunId,
      },
    };
  });
}

function buildRecap(
  events: EvidenceTimelineEvent[],
  filters: NormalizedEvidenceFilters
): EvidenceTimelineRecap {
  if (events.length === 0) {
    return {
      markdown: 'No evidence events matched the selected filters.',
      citations: [],
    };
  }

  const byType = countBy(events, (event) => event.type);
  const bySource = countBy(events, (event) => event.source);
  const citations = importantCitations(events);
  const scope = filters.taskId
    ? `task ${filters.taskId}`
    : filters.project
      ? `project ${filters.project}`
      : 'selected scope';

  const markdown = [
    `Evidence recap for ${scope}: ${events.length} deterministic events matched.`,
    `Top event types: ${formatCounts(byType)}.`,
    `Sources used: ${formatCounts(bySource)}.`,
    ...citations.map(
      (citation, index) => `E${index + 1}: ${citation.label} (${citation.timestamp}).`
    ),
  ].join('\n');

  return { markdown, citations };
}

function importantCitations(events: EvidenceTimelineEvent[]): EvidenceTimelineCitation[] {
  const priorities: EvidenceTimelineEventType[] = [
    'deliverable',
    'work_product',
    'agent_run',
    'status',
    'time',
    'comment',
    'task',
  ];
  const selected: EvidenceTimelineEvent[] = [];
  for (const type of priorities) {
    const event = [...events].reverse().find((candidate) => candidate.type === type);
    if (event) selected.push(event);
    if (selected.length >= 5) break;
  }
  if (selected.length === 0) selected.push(...events.slice(-5));
  return selected.slice(0, 5).map((event) => ({
    eventId: event.id,
    label: event.title,
    timestamp: event.timestamp,
    source: event.source,
  }));
}

function normalizeFilters(filters: EvidenceTimelineFilters): NormalizedEvidenceFilters {
  return {
    taskId: optional(filters.taskId),
    project: optional(filters.project),
    repo: optional(filters.repo),
    cwd: optional(filters.cwd),
    from: optional(filters.from),
    to: optional(filters.to),
    type: filters.type,
    source: filters.source,
    actor: optional(filters.actor),
    page: Math.max(1, Number(filters.page) || 1),
    limit: Math.min(Math.max(Number(filters.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT),
  };
}

function stripEmptyFilters(filters: NormalizedEvidenceFilters): EvidenceTimelineFilters {
  const next: EvidenceTimelineFilters = {
    page: filters.page,
    limit: filters.limit,
  };
  for (const key of [
    'taskId',
    'project',
    'repo',
    'cwd',
    'from',
    'to',
    'type',
    'source',
    'actor',
  ] as const) {
    if (filters[key]) {
      next[key] = filters[key] as never;
    }
  }
  return next;
}

function eventMatchesScopedTasks(
  event: EvidenceTimelineEvent,
  scopedTaskIds: Set<string>,
  filters: NormalizedEvidenceFilters
): boolean {
  if (event.taskId) return scopedTaskIds.has(event.taskId);
  return !filters.taskId && !filters.project && !filters.repo && !filters.cwd;
}

function eventMatchesFilters(
  event: EvidenceTimelineEvent,
  filters: NormalizedEvidenceFilters
): boolean {
  if (filters.from && event.timestamp < filters.from) return false;
  if (filters.to && event.timestamp > filters.to) return false;
  if (filters.type && event.type !== filters.type) return false;
  if (filters.source && event.source !== filters.source) return false;
  if (filters.actor) {
    const actor = (event.actor ?? event.agent ?? '').toLowerCase();
    if (!actor.includes(filters.actor.toLowerCase())) return false;
  }
  return true;
}

function taskMatchesScope(task: Task, filters: EvidenceTimelineFilters): boolean {
  if (filters.taskId && task.id !== filters.taskId) return false;
  if (filters.project && normalize(task.project) !== filters.project) return false;
  if (filters.repo && normalize(task.git?.repo) !== filters.repo) return false;
  if (filters.cwd && normalize(task.git?.worktreePath) !== filters.cwd) return false;
  return true;
}

function compareEvents(a: EvidenceTimelineEvent, b: EvidenceTimelineEvent): number {
  const timestamp = a.timestamp.localeCompare(b.timestamp);
  if (timestamp !== 0) return timestamp;
  return a.id.localeCompare(b.id);
}

function taskContext(task?: Task, taskId?: string, taskTitle?: string) {
  return {
    taskId: task?.id ?? taskId,
    taskTitle: task?.title ?? taskTitle,
    project: task?.project,
    repo: task?.git?.repo,
    cwd: task?.git?.worktreePath,
  };
}

function taskLink(taskId: string, label: string) {
  return {
    label,
    target: 'task' as const,
    taskId,
  };
}

function activityType(type: Activity['type']): EvidenceTimelineEventType {
  if (type.includes('comment')) return 'comment';
  if (type.includes('deliverable')) return 'deliverable';
  if (type.includes('agent')) return 'agent_run';
  if (type.includes('status')) return 'status';
  if (type.includes('observation')) return 'observation';
  return 'task';
}

function telemetryTitle(event: AnyTelemetryEvent): string {
  switch (event.type) {
    case 'run.started':
      return `Agent run started by ${event.agent}`;
    case 'run.completed':
      return `Agent run ${event.success ? 'completed' : 'failed'} by ${event.agent}`;
    case 'run.error':
      return `Agent run error from ${event.agent}`;
    case 'run.tokens':
      return `Token usage recorded for ${event.agent}`;
    case 'task.status_changed':
      return 'Task status changed';
    case 'task.created':
      return 'Task telemetry created';
    case 'task.archived':
      return 'Task archived';
    case 'task.restored':
      return 'Task restored';
  }
}

function telemetryDetail(event: AnyTelemetryEvent): string | undefined {
  if ('error' in event && event.error) return truncate(event.error);
  if ('durationMs' in event && event.durationMs) return formatDuration(event.durationMs);
  if (event.type === 'run.tokens') {
    return `${(event.totalTokens ?? event.inputTokens + event.outputTokens).toLocaleString()} tokens`;
  }
  if (event.type === 'task.status_changed') {
    return `${event.previousStatus ?? 'unknown'} -> ${event.status ?? 'unknown'}`;
  }
  return undefined;
}

function telemetryMetadata(
  event: AnyTelemetryEvent
): Record<string, string | number | boolean | null> {
  const metadata: Record<string, string | number | boolean | null> = { telemetryType: event.type };
  if ('attemptId' in event) metadata.attemptId = event.attemptId ?? null;
  if ('model' in event) metadata.model = event.model ?? null;
  if ('success' in event) metadata.success = event.success ?? null;
  if ('durationMs' in event) metadata.durationMs = event.durationMs ?? null;
  if ('totalTokens' in event) metadata.totalTokens = event.totalTokens ?? null;
  if ('cost' in event) metadata.cost = event.cost ?? null;
  return metadata;
}

function stringifyDetails(details?: Record<string, unknown>): string | undefined {
  if (!details) return undefined;
  const entries = Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== null && typeof value !== 'object')
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${String(value)}`);
  return entries.length > 0 ? entries.join(', ') : undefined;
}

function countBy<T extends string>(
  events: EvidenceTimelineEvent[],
  selector: (event: EvidenceTimelineEvent) => T
): Map<T, number> {
  const counts = new Map<T, number>();
  for (const event of events) {
    const key = selector(event);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function formatCounts<T extends string>(counts: Map<T, number>): string {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([key, count]) => `${key} ${count}`)
    .join(', ');
}

function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function normalize(value: string | undefined): string | undefined {
  return optional(value);
}

function truncate(value: string, limit = 240): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}...` : normalized;
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function formatSeconds(value?: number): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return formatDuration(value * 1000);
}

function formatDuration(valueMs: number): string {
  const seconds = Math.max(0, Math.round(valueMs / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes === 0) return `${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours === 0) return `${minutes}m ${remainingSeconds}s`;
  return `${hours}h ${remainingMinutes}m`;
}
