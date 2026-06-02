import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Code,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
} from '@mantine/core';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  Code2,
  FileDiff,
  FileText,
  GitBranch,
  History,
  KeyRound,
  ListFilter,
  Play,
  ShieldCheck,
  Terminal,
  Timer,
  Wrench,
} from 'lucide-react';
import type {
  AgentRunTimelineEvent,
  AgentRunTimelineEventSource,
  AgentRunTimelineEventType,
  AgentRunTrace,
  AgentRunTraceStep,
  AnyTelemetryEvent,
  Task,
  TelemetryEventType,
  WorkProductPreview,
} from '@veritas-kanban/shared';
import { useAgentRunTraces, useTaskTelemetryEvents } from '@/hooks/useAgentRunTimeline';
import { useTaskWorkProducts } from '@/hooks/useWorkProducts';
import { sanitizeText } from '@/lib/sanitize';

type TimelineTabTarget = 'agent' | 'changes' | 'review' | 'work-products';

interface AgentRunTimelinePanelProps {
  task: Task;
  initialAttemptId?: string | null;
  onOpenTab?: (target: TimelineTabTarget) => void;
}

const EVENT_TYPES: AgentRunTimelineEventType[] = [
  'prompt',
  'command',
  'file',
  'policy',
  'approval',
  'error',
  'usage',
  'tool',
  'result',
];

const MAX_RENDERED_EVENTS = 120;

const EVENT_LABELS: Record<AgentRunTimelineEventType, string> = {
  approval: 'Approval',
  command: 'Command',
  error: 'Error',
  file: 'File',
  policy: 'Policy',
  prompt: 'Prompt',
  result: 'Result',
  tool: 'Tool',
  usage: 'Usage',
};

const EVENT_COLORS: Record<AgentRunTimelineEventType, string> = {
  approval: 'green',
  command: 'blue',
  error: 'red',
  file: 'grape',
  policy: 'yellow',
  prompt: 'cyan',
  result: 'green',
  tool: 'indigo',
  usage: 'orange',
};

const SOURCE_COLORS: Record<AgentRunTimelineEventSource, string> = {
  derived: 'gray',
  live: 'blue',
  stored: 'green',
};

const EVENT_ICONS: Record<AgentRunTimelineEventType, React.ElementType> = {
  approval: CheckCircle2,
  command: Terminal,
  error: AlertTriangle,
  file: FileText,
  policy: ShieldCheck,
  prompt: Bot,
  result: ClipboardCheck,
  tool: Wrench,
  usage: Timer,
};

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]'],
  [/\bsk-[A-Za-z0-9_-]{12,}/g, 'sk-[REDACTED]'],
  [/\bghp_[A-Za-z0-9_]{12,}/g, 'ghp_[REDACTED]'],
  [/\bgithub_pat_[A-Za-z0-9_]{12,}/g, 'github_pat_[REDACTED]'],
  [
    /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY)[A-Z0-9_]*)\s*=\s*([^\s"'`]+)/gi,
    '$1=[REDACTED]',
  ],
  [/\b(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*([^\s"'`,}]+)/gi, '$1=[REDACTED]'],
];

function isRunEvent(event: AnyTelemetryEvent): event is AnyTelemetryEvent & {
  attemptId?: string;
  agent?: string;
  model?: string;
  durationMs?: number;
  success?: boolean;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheTokens?: number;
  totalTokens?: number;
  cost?: number;
} {
  return event.type.startsWith('run.');
}

function formatDate(value?: string): string {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not recorded';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatDurationMs(value?: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Not recorded';
  if (value < 1000) return `${Math.max(0, Math.round(value))}ms`;
  const seconds = Math.round(value / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes === 0) return `${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours === 0) return `${minutes}m ${remainingSeconds}s`;
  return `${hours}h ${remainingMinutes}m`;
}

function getEventAttemptId(event: AnyTelemetryEvent): string | undefined {
  return isRunEvent(event) ? event.attemptId : undefined;
}

function safeString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const sanitized = sanitizeText(value.trim());
  return sanitized.length > 0 ? sanitized : undefined;
}

export function redactTimelineText(value: string): string {
  let redacted = sanitizeText(value);
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
}

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return redactTimelineText(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
      const sensitiveKey = /(token|secret|password|authorization|api[_-]?key)/i.test(key);
      return [key, sensitiveKey ? '[REDACTED]' : redactValue(entry)];
    })
  );
}

function stringifyMetadata(metadata?: Record<string, unknown>): string {
  if (!metadata || Object.keys(metadata).length === 0) return '';
  const serialized = JSON.stringify(redactValue(metadata), null, 2);
  if (serialized.length <= 4000) return serialized;
  return `${serialized.slice(0, 4000)}\n...`;
}

function sourceForTrace(trace?: AgentRunTrace): AgentRunTimelineEventSource {
  if (!trace) return 'derived';
  return trace.status === 'running' ? 'live' : 'stored';
}

function eventText(metadata: Record<string, unknown> | undefined): string {
  return [
    safeString(metadata?.eventType),
    safeString(metadata?.summary),
    safeString(metadata?.tool),
    safeString(metadata?.command),
  ]
    .filter(Boolean)
    .join(' ');
}

export function getTimelineEventType(
  stepType: AgentRunTraceStep['type'],
  metadata?: Record<string, unknown>
): AgentRunTimelineEventType {
  const text = `${stepType} ${eventText(metadata)}`.toLowerCase();

  if (stepType === 'error' || /error|failed|failure|abort|exception/.test(text)) return 'error';
  if (stepType === 'complete') return 'result';
  if (/approval|approve|denied|deny|permission request/.test(text)) return 'approval';
  if (/policy|permission|sandbox|security|guard/.test(text)) return 'policy';
  if (/file|diff|patch|write|edit|created|modified|deleted/.test(text)) return 'file';
  if (/\b(command|shell|terminal|stdout|stderr)\b|exec[.:_-]/.test(text)) return 'command';
  if (/token|usage|cost|input_tokens|output_tokens/.test(text)) return 'usage';
  if (/tool|function|mcp/.test(text)) return 'tool';
  if (/completed|final|result|finish/.test(text)) return 'result';
  return stepType === 'init' ? 'prompt' : 'tool';
}

function titleForStep(type: AgentRunTimelineEventType, step: AgentRunTraceStep): string {
  const eventType = safeString(step.metadata?.eventType);
  const summary = safeString(step.metadata?.summary);
  if (eventType) return eventType;
  if (summary) return summary.length > 80 ? `${summary.slice(0, 77)}...` : summary;

  switch (type) {
    case 'prompt':
      return 'Run initialized';
    case 'result':
      return 'Run completed';
    case 'error':
      return 'Run error recorded';
    default:
      return `${EVENT_LABELS[type]} event`;
  }
}

function telemetryTitle(event: AnyTelemetryEvent): string {
  if (event.type === 'run.started') return 'Run started';
  if (event.type === 'run.completed') {
    return isRunEvent(event) && event.success === false ? 'Run failed' : 'Run completed';
  }
  if (event.type === 'run.error') return 'Run error recorded';
  if (event.type === 'run.tokens') return 'Token usage recorded';
  return event.type;
}

function telemetryEventType(event: AnyTelemetryEvent): AgentRunTimelineEventType {
  if (event.type === 'run.started') return 'prompt';
  if (event.type === 'run.completed') {
    return isRunEvent(event) && event.success === false ? 'error' : 'result';
  }
  if (event.type === 'run.error') return 'error';
  if (event.type === 'run.tokens') return 'usage';
  return 'tool';
}

function metadataForTaskPrompt(task: Task, trace?: AgentRunTrace): Record<string, unknown> {
  return {
    taskId: task.id,
    title: task.title,
    description: task.description,
    project: task.project,
    sprint: task.sprint,
    type: task.type,
    priority: task.priority,
    runMode: task.runMode,
    assignedAgent: task.agent,
    selectedAgent: trace?.agent || task.attempt?.agent,
    model: trace?.metadata?.model || task.attempt?.model,
    provider: trace?.metadata?.provider || task.attempt?.provider,
    repo: task.git?.repo,
    branch: task.git?.branch,
    baseBranch: task.git?.baseBranch,
    worktreePath: task.git?.worktreePath,
    policyProfile: trace?.metadata?.policyProfile,
    capabilitySet: trace?.metadata?.capabilitySet,
    workspaceId: trace?.metadata?.workspaceId,
    sessionKey: trace?.metadata?.sessionKey,
    runKey: trace?.metadata?.runKey || task.attempt?.id,
  };
}

function sortTimelineEvents(events: AgentRunTimelineEvent[]): AgentRunTimelineEvent[] {
  return events
    .sort((a, b) => {
      const byTime = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      if (Number.isFinite(byTime) && byTime !== 0) return byTime;
      return a.sequence - b.sequence;
    })
    .map((event, index) => ({ ...event, sequence: index + 1 }));
}

interface BuildTimelineOptions {
  task: Task;
  traces: AgentRunTrace[];
  telemetryEvents: AnyTelemetryEvent[];
  workProducts: WorkProductPreview[];
  selectedAttemptId?: string | null;
}

export function buildAgentRunTimelineEvents({
  task,
  traces,
  telemetryEvents,
  workProducts,
  selectedAttemptId,
}: BuildTimelineOptions): AgentRunTimelineEvent[] {
  const selectedTrace =
    traces.find((trace) => trace.traceId === selectedAttemptId) ||
    traces[0] ||
    (selectedAttemptId ? undefined : null);
  const attemptId = selectedAttemptId || selectedTrace?.traceId || task.attempt?.id;
  const source = sourceForTrace(selectedTrace || undefined);
  const events: AgentRunTimelineEvent[] = [];
  let nextSequence = 1;
  const startedAt = selectedTrace?.startedAt || task.attempt?.started || task.created;

  events.push({
    id: `prompt-${attemptId || task.id}`,
    sequence: nextSequence++,
    type: 'prompt',
    source: selectedTrace ? source : 'derived',
    timestamp: startedAt,
    title: 'Prompt and task input prepared',
    detail: task.title,
    metadata: metadataForTaskPrompt(task, selectedTrace || undefined),
  });

  if (selectedTrace) {
    for (const step of selectedTrace.steps) {
      const eventType = getTimelineEventType(step.type, step.metadata);
      events.push({
        id: `trace-${selectedTrace.traceId}-${step.sequence ?? nextSequence}`,
        sequence: step.sequence ?? nextSequence,
        type: eventType,
        source,
        timestamp: step.startedAt,
        title: titleForStep(eventType, step),
        detail: safeString(step.metadata?.summary),
        durationMs: step.durationMs,
        metadata: {
          traceStepType: step.type,
          traceSequence: step.sequence,
          ...step.metadata,
        },
      });
      nextSequence += 1;
    }
  }

  const relevantTelemetry = telemetryEvents.filter((event) => {
    if (!attemptId) return event.taskId === task.id;
    return event.taskId === task.id && getEventAttemptId(event) === attemptId;
  });

  for (const event of relevantTelemetry) {
    const run = isRunEvent(event) ? event : undefined;
    const type = telemetryEventType(event);
    events.push({
      id: `telemetry-${event.id}`,
      sequence: nextSequence++,
      type,
      source: selectedTrace ? source : 'derived',
      timestamp: event.timestamp,
      title: telemetryTitle(event),
      detail: run?.error,
      durationMs: run?.durationMs,
      metadata: {
        telemetryType: event.type as TelemetryEventType,
        agent: run?.agent,
        model: run?.model,
        attemptId: run?.attemptId,
        success: run?.success,
        inputTokens: run?.inputTokens,
        outputTokens: run?.outputTokens,
        cacheTokens: run?.cacheTokens,
        totalTokens: run?.totalTokens,
        cost: run?.cost,
      },
    });
  }

  const currentAttempt = task.attempt;
  if (currentAttempt && (!attemptId || currentAttempt.id === attemptId)) {
    if (
      currentAttempt.started &&
      !events.some((event) => event.id === `attempt-start-${currentAttempt.id}`)
    ) {
      events.push({
        id: `attempt-start-${currentAttempt.id}`,
        sequence: nextSequence++,
        type: 'prompt',
        source: 'derived',
        timestamp: currentAttempt.started,
        title: 'Task attempt started',
        detail: currentAttempt.agent,
        metadata: currentAttempt as unknown as Record<string, unknown>,
      });
    }
    if (currentAttempt.ended) {
      events.push({
        id: `attempt-end-${currentAttempt.id}`,
        sequence: nextSequence++,
        type: currentAttempt.status === 'failed' ? 'error' : 'result',
        source: 'derived',
        timestamp: currentAttempt.ended,
        title: currentAttempt.status === 'failed' ? 'Task attempt failed' : 'Task attempt finished',
        detail: currentAttempt.agent,
        metadata: currentAttempt as unknown as Record<string, unknown>,
      });
    }
  }

  if (task.git?.worktreePath) {
    events.push({
      id: `worktree-${task.id}`,
      sequence: nextSequence++,
      type: 'file',
      source: 'derived',
      timestamp: startedAt,
      title: 'Worktree attached',
      detail: task.git.branch || task.git.baseBranch,
      metadata: {
        repo: task.git.repo,
        branch: task.git.branch,
        baseBranch: task.git.baseBranch,
        worktreePath: task.git.worktreePath,
        prUrl: task.git.prUrl,
        prNumber: task.git.prNumber,
      },
      link: { label: 'Changes', href: '#changes', target: 'changes' },
    });
  }

  if (task.review?.decision) {
    events.push({
      id: `review-${task.id}`,
      sequence: nextSequence++,
      type: task.review.decision === 'approved' ? 'approval' : 'error',
      source: 'derived',
      timestamp: task.review.decidedAt || task.updated,
      title: `Review ${task.review.decision}`,
      detail: task.review.summary,
      metadata: task.review as unknown as Record<string, unknown>,
      link: { label: 'Review', href: '#review', target: 'review' },
    });
  }

  for (const product of workProducts) {
    if (attemptId && product.sourceRunId && product.sourceRunId !== attemptId) continue;
    events.push({
      id: `work-product-${product.id}`,
      sequence: nextSequence++,
      type: 'file',
      source: 'derived',
      timestamp: product.createdAt,
      title: `Work product saved: ${product.title}`,
      detail: product.snippet,
      metadata: {
        kind: product.kind,
        version: product.version,
        status: product.status,
        sourceRunId: product.sourceRunId,
        agent: product.agent,
        model: product.model,
        redacted: product.redacted,
      },
      link: { label: 'Work products', href: '#work-products', target: 'work-products' },
    });
  }

  if ((task.verificationSteps?.length ?? 0) > 0) {
    const checked = task.verificationSteps?.filter((step) => step.checked).length ?? 0;
    events.push({
      id: `verification-${task.id}`,
      sequence: nextSequence++,
      type: checked === task.verificationSteps?.length ? 'approval' : 'result',
      source: 'derived',
      timestamp: task.updated,
      title: 'Verification checklist updated',
      detail: `${checked}/${task.verificationSteps?.length ?? 0} checks complete`,
      metadata: {
        checks: task.verificationSteps,
      },
    });
  }

  return sortTimelineEvents(events);
}

function getRunOptions(
  task: Task,
  traces: AgentRunTrace[],
  telemetryEvents: AnyTelemetryEvent[],
  workProducts: WorkProductPreview[]
): Array<{ value: string; label: string }> {
  const attempts = new Map<string, string>();
  const addAttempt = (id: string | undefined, label: string) => {
    if (!id || attempts.has(id)) return;
    attempts.set(id, label);
  };

  for (const trace of traces) {
    addAttempt(trace.traceId, `${trace.traceId} (${trace.status})`);
  }
  addAttempt(task.attempt?.id, `${task.attempt?.id} (${task.attempt?.status ?? 'current'})`);
  for (const attempt of task.attempts ?? []) {
    addAttempt(attempt.id, `${attempt.id} (${attempt.status})`);
  }
  for (const event of telemetryEvents) {
    addAttempt(getEventAttemptId(event), `${getEventAttemptId(event)} (telemetry)`);
  }
  for (const product of workProducts) {
    addAttempt(product.sourceRunId, `${product.sourceRunId} (work product)`);
  }

  return Array.from(attempts.entries()).map(([value, label]) => ({ value, label }));
}

function typeFilterLabel(type: AgentRunTimelineEventType): string {
  return EVENT_LABELS[type];
}

function EventRow({
  event,
  onOpenTab,
}: {
  event: AgentRunTimelineEvent;
  onOpenTab?: (target: TimelineTabTarget) => void;
}) {
  const Icon = EVENT_ICONS[event.type];
  const metadata = stringifyMetadata(event.metadata);
  const linkTarget = event.link?.target;
  const canOpenInternal =
    linkTarget && linkTarget !== 'external' && linkTarget !== 'workflow' && onOpenTab;

  return (
    <Paper withBorder p="sm" radius="md">
      <Stack gap="xs">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Group gap="sm" align="flex-start" wrap="nowrap" className="min-w-0">
            <ThemeIcon size="sm" radius="xl" color={EVENT_COLORS[event.type]} variant="light">
              <Icon className="h-4 w-4" />
            </ThemeIcon>
            <div className="min-w-0">
              <Group gap="xs" wrap="wrap">
                <Text size="sm" fw={600}>
                  {redactTimelineText(event.title)}
                </Text>
                <Badge size="xs" color={EVENT_COLORS[event.type]} variant="light">
                  {EVENT_LABELS[event.type]}
                </Badge>
                <Badge size="xs" color={SOURCE_COLORS[event.source]} variant="outline">
                  {event.source}
                </Badge>
              </Group>
              <Text size="xs" c="dimmed">
                {formatDate(event.timestamp)}
                {event.durationMs !== undefined ? ` | ${formatDurationMs(event.durationMs)}` : ''}
              </Text>
            </div>
          </Group>
          <Text size="xs" c="dimmed" className="shrink-0 tabular-nums">
            #{event.sequence}
          </Text>
        </Group>
        {event.detail && (
          <Text size="sm" c="dimmed">
            {redactTimelineText(event.detail)}
          </Text>
        )}
        {metadata && (
          <Code block className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs">
            {metadata}
          </Code>
        )}
        {canOpenInternal && event.link && linkTarget && (
          <Group gap="xs">
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={() => onOpenTab?.(linkTarget as TimelineTabTarget)}
            >
              {event.link.label}
            </Button>
          </Group>
        )}
      </Stack>
    </Paper>
  );
}

export function AgentRunTimelinePanel({
  task,
  initialAttemptId,
  onOpenTab,
}: AgentRunTimelinePanelProps) {
  const { data: traces = [], isLoading: tracesLoading } = useAgentRunTraces(task.id);
  const { data: telemetryEvents = [], isLoading: telemetryLoading } = useTaskTelemetryEvents(
    task.id
  );
  const { data: workProducts = [], isLoading: workProductsLoading } = useTaskWorkProducts(task.id);
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(
    initialAttemptId ?? task.attempt?.id ?? null
  );
  const [filter, setFilter] = useState<AgentRunTimelineEventType | 'all'>('all');

  useEffect(() => {
    if (initialAttemptId) {
      setSelectedAttemptId(initialAttemptId);
    }
  }, [initialAttemptId]);

  const runOptions = useMemo(
    () => getRunOptions(task, traces, telemetryEvents, workProducts),
    [task, traces, telemetryEvents, workProducts]
  );

  useEffect(() => {
    if (runOptions.length === 0) {
      if (selectedAttemptId) setSelectedAttemptId(null);
      return;
    }
    if (!selectedAttemptId || !runOptions.some((option) => option.value === selectedAttemptId)) {
      setSelectedAttemptId(runOptions[0].value);
    }
  }, [runOptions, selectedAttemptId]);

  const selectedTrace = useMemo(
    () => traces.find((trace) => trace.traceId === selectedAttemptId),
    [selectedAttemptId, traces]
  );

  const events = useMemo(
    () =>
      buildAgentRunTimelineEvents({
        task,
        traces,
        telemetryEvents,
        workProducts,
        selectedAttemptId,
      }),
    [task, traces, telemetryEvents, workProducts, selectedAttemptId]
  );

  const filteredEvents = useMemo(
    () => (filter === 'all' ? events : events.filter((event) => event.type === filter)),
    [events, filter]
  );
  const visibleEvents = filteredEvents.slice(0, MAX_RENDERED_EVENTS);
  const isLoading = tracesLoading || telemetryLoading || workProductsLoading;
  const source = sourceForTrace(selectedTrace);
  const linkedWorkProducts = workProducts.filter(
    (product) => !selectedAttemptId || product.sourceRunId === selectedAttemptId
  );

  return (
    <Stack gap="md">
      <Paper withBorder p="md" radius="md">
        <Stack gap="sm">
          <Group justify="space-between" align="flex-start" gap="md" wrap="nowrap">
            <div className="min-w-0">
              <Group gap="xs" wrap="wrap">
                <ThemeIcon size="sm" radius="xl" variant="light">
                  <History className="h-4 w-4" />
                </ThemeIcon>
                <Text fw={700}>Run Timeline</Text>
                <Badge color={SOURCE_COLORS[source]} variant="light">
                  {source === 'live' ? 'Live' : source === 'stored' ? 'Stored replay' : 'Derived'}
                </Badge>
                {selectedTrace && (
                  <Badge
                    color={selectedTrace.status === 'failed' ? 'red' : 'gray'}
                    variant="outline"
                  >
                    {selectedTrace.status}
                  </Badge>
                )}
              </Group>
              <Text size="sm" c="dimmed" mt={6}>
                {selectedAttemptId || 'No attempt selected'} | {events.length} events
              </Text>
            </div>
            {isLoading && (
              <Group gap="xs" className="shrink-0">
                <Loader size="xs" />
                <Text size="xs" c="dimmed">
                  Loading
                </Text>
              </Group>
            )}
          </Group>

          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            <Select
              label="Run"
              aria-label="Run"
              value={selectedAttemptId}
              onChange={setSelectedAttemptId}
              data={runOptions}
              placeholder="Derived task timeline"
              size="xs"
              checkIconPosition="right"
              disabled={runOptions.length === 0}
            />
            <Group gap="xs" align="flex-end">
              <Button
                size="compact-xs"
                variant="light"
                leftSection={<Bot className="h-3 w-3" />}
                onClick={() => onOpenTab?.('agent')}
              >
                Agent
              </Button>
              {task.git?.worktreePath && (
                <Button
                  size="compact-xs"
                  variant="subtle"
                  leftSection={<FileDiff className="h-3 w-3" />}
                  onClick={() => onOpenTab?.('changes')}
                >
                  Changes
                </Button>
              )}
              <Button
                size="compact-xs"
                variant="subtle"
                leftSection={<ClipboardCheck className="h-3 w-3" />}
                onClick={() => onOpenTab?.('review')}
              >
                Review
              </Button>
              <Button
                size="compact-xs"
                variant="subtle"
                leftSection={<FileText className="h-3 w-3" />}
                onClick={() => onOpenTab?.('work-products')}
              >
                Work Products
              </Button>
            </Group>
          </SimpleGrid>
        </Stack>
      </Paper>

      <Paper withBorder p="md" radius="md">
        <Stack gap="sm">
          <Group gap="xs">
            <ListFilter className="h-4 w-4 text-muted-foreground" />
            <Text fw={600} size="sm">
              Event Filters
            </Text>
          </Group>
          <Group gap="xs">
            <Button
              size="compact-xs"
              variant={filter === 'all' ? 'filled' : 'light'}
              onClick={() => setFilter('all')}
            >
              All
            </Button>
            {EVENT_TYPES.map((type) => (
              <Button
                key={type}
                size="compact-xs"
                color={EVENT_COLORS[type]}
                variant={filter === type ? 'filled' : 'light'}
                onClick={() => setFilter(type)}
              >
                {typeFilterLabel(type)}
              </Button>
            ))}
          </Group>
        </Stack>
      </Paper>

      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
        <Paper withBorder p="sm" radius="md">
          <Group gap="xs" wrap="nowrap">
            <Code2 className="h-4 w-4 text-muted-foreground" />
            <div className="min-w-0">
              <Text size="xs" c="dimmed">
                Agent / model
              </Text>
              <Text size="sm" fw={600} truncate>
                {selectedTrace?.agent || task.attempt?.agent || task.agent || 'Unassigned'}
                {selectedTrace?.metadata?.model || task.attempt?.model
                  ? ` / ${selectedTrace?.metadata?.model || task.attempt?.model}`
                  : ''}
              </Text>
            </div>
          </Group>
        </Paper>
        <Paper withBorder p="sm" radius="md">
          <Group gap="xs" wrap="nowrap">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            <div className="min-w-0">
              <Text size="xs" c="dimmed">
                Branch / worktree
              </Text>
              <Text size="sm" fw={600} truncate>
                {task.git?.branch || task.git?.baseBranch || 'Not configured'}
              </Text>
            </div>
          </Group>
        </Paper>
        <Paper withBorder p="sm" radius="md">
          <Group gap="xs" wrap="nowrap">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            <div className="min-w-0">
              <Text size="xs" c="dimmed">
                Policy / capabilities
              </Text>
              <Text size="sm" fw={600} truncate>
                {selectedTrace?.metadata?.policyProfile || task.runMode || 'Default'}
              </Text>
            </div>
          </Group>
        </Paper>
      </SimpleGrid>

      {linkedWorkProducts.length > 0 && (
        <Paper withBorder p="md" radius="md">
          <Stack gap="xs">
            <Group gap="xs">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <Text fw={600} size="sm">
                Linked Work Products
              </Text>
              <Badge variant="light">{linkedWorkProducts.length}</Badge>
            </Group>
            {linkedWorkProducts.slice(0, 4).map((product) => (
              <Group key={product.id} gap="xs" wrap="nowrap">
                <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                <Text size="sm" truncate className="min-w-0">
                  {product.title}
                </Text>
                <Badge size="xs" variant="outline">
                  v{product.version}
                </Badge>
              </Group>
            ))}
          </Stack>
        </Paper>
      )}

      <ScrollArea.Autosize mah={520} type="auto">
        <Stack gap="xs" pr="xs">
          {visibleEvents.length > 0 ? (
            visibleEvents.map((event) => (
              <EventRow key={event.id} event={event} onOpenTab={onOpenTab} />
            ))
          ) : (
            <Paper withBorder p="md" radius="md">
              <Group gap="xs">
                <Play className="h-4 w-4 text-muted-foreground" />
                <Text size="sm" c="dimmed">
                  No timeline events match this run and filter.
                </Text>
              </Group>
            </Paper>
          )}
          {filteredEvents.length > visibleEvents.length && (
            <Text size="xs" c="dimmed" ta="center" py="xs">
              Showing {visibleEvents.length} of {filteredEvents.length} filtered events.
            </Text>
          )}
        </Stack>
      </ScrollArea.Autosize>
    </Stack>
  );
}
