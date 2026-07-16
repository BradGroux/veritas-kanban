import { useState, useRef, useEffect, useMemo } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Code,
  Group,
  Modal,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from '@mantine/core';
import { useConfig } from '@/hooks/useConfig';
import {
  useAgentStatus,
  useStartAgent,
  useStopAgent,
  useSendMessage,
  useAgentStream,
  useAgentAttempts,
  useAgentLog,
} from '@/hooks/useAgent';
import { useResolveAgent } from '@/hooks/useRouting';
import {
  Play,
  Square,
  Send,
  Bot,
  Loader2,
  Terminal,
  AlertCircle,
  Wifi,
  WifiOff,
  History,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldAlert,
} from 'lucide-react';
import { evaluateTaskReadiness } from '@veritas-kanban/shared';
import type { Task, AgentType, AttemptStatus } from '@veritas-kanban/shared';
import { cn } from '@/lib/utils';
import { sanitizeText } from '@/lib/sanitize';
import FeatureErrorBoundary from '@/components/shared/FeatureErrorBoundary';
import { useIdentity } from '@/hooks/useIdentity';
import { clientAllowsLocalAgentControls } from '@/lib/client-policy';
import { RunSessionSharesSection } from './RunSessionSharesSection';

interface AgentPanelProps {
  task: Task;
  onOpenTimeline?: (attemptId?: string) => void;
}

const attemptStatusIcons: Record<AttemptStatus, React.ReactNode> = {
  pending: <Clock className="h-3 w-3 text-muted-foreground" />,
  running: <Loader2 className="h-3 w-3 text-blue-500 animate-spin" />,
  complete: <CheckCircle2 className="h-3 w-3 text-green-500" />,
  failed: <XCircle className="h-3 w-3 text-red-500" />,
};

export function AgentPanel({ task, onOpenTimeline }: AgentPanelProps) {
  const { data: config } = useConfig();
  const {
    data: agentStatus,
    error: agentStatusError,
    isFetching: isAgentStatusFetching,
  } = useAgentStatus(task.id);
  const { outputs, isConnected, isRunning, clearOutputs } = useAgentStream(
    task.id,
    agentStatus?.attemptId
  );
  const { data: attempts, refetch: refetchAttempts } = useAgentAttempts(task.id);
  const { data: routingResult } = useResolveAgent(task.id);
  const { authContext, hasPermission } = useIdentity();

  const startAgent = useStartAgent();
  const stopAgent = useStopAgent();
  const sendMessage = useSendMessage();

  const [selectedAgent, setSelectedAgent] = useState<AgentType | undefined>();
  const [selectedModel, setSelectedModel] = useState<string | undefined>();
  const [message, setMessage] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [viewingAttemptId, setViewingAttemptId] = useState<string | null>(null);
  const [stopDialogOpen, setStopDialogOpen] = useState(false);
  const [readinessOverrideOpen, setReadinessOverrideOpen] = useState(false);
  const [readinessOverrideReason, setReadinessOverrideReason] = useState('');

  const models = ['sonnet', 'opus', 'haiku'];

  const outputRef = useRef<HTMLDivElement>(null);

  // Fetch log for historical attempt
  const { data: attemptLog, isLoading: isLoadingLog } = useAgentLog(
    viewingAttemptId ? task.id : undefined,
    viewingAttemptId || undefined
  );

  // Get enabled agents
  const enabledAgents = config?.agents.filter((a) => a.enabled) || [];
  const defaultAgent = config?.defaultAgent;
  const agentOptions = enabledAgents.map((agent) => ({
    value: agent.type,
    label: `${agent.name}${agent.type === defaultAgent ? ' (default)' : ''}`,
  }));
  const modelOptions = models.map((model) => ({ value: model, label: model }));
  const resolvedAgent =
    selectedAgent ||
    (task.agent && task.agent !== 'auto' ? task.agent : undefined) ||
    routingResult?.agent ||
    defaultAgent;
  const readinessSummary = useMemo(
    () =>
      evaluateTaskReadiness(task, {
        isCodeTask: task.type === 'code',
        selectedAgent: resolvedAgent,
      }),
    [task, resolvedAgent]
  );

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [outputs, autoScroll]);

  // Handle scroll to detect user scroll up
  const handleScroll = () => {
    if (!outputRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = outputRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  };

  const startAgentRun = (overrideReason?: string) => {
    clearOutputs();
    setViewingAttemptId(null); // Switch back to live view
    startAgent.mutate(
      {
        taskId: task.id,
        agent: resolvedAgent,
        ...(overrideReason ? { overrideReason } : {}),
      },
      {
        onSuccess: () => {
          refetchAttempts();
          setReadinessOverrideOpen(false);
          setReadinessOverrideReason('');
        },
      }
    );
  };

  const handleStart = () => {
    if (!readinessSummary.ready) {
      setReadinessOverrideOpen(true);
      return;
    }

    startAgentRun();
  };

  const handleReadinessOverride = () => {
    const reason = readinessOverrideReason.trim();
    if (reason.length < 8) return;
    startAgentRun(reason);
  };

  const handleStop = () => {
    if (!canStop || !agentStatus?.attemptId) return;
    stopAgent.mutate({ taskId: task.id, attemptId: agentStatus.attemptId });
    setStopDialogOpen(false);
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || !canSendMessage || !agentStatus?.attemptId) return;

    sendMessage.mutate({
      taskId: task.id,
      attemptId: agentStatus.attemptId,
      message: message.trim(),
    });
    setMessage('');
  };

  // Check if we can start an agent
  const canControlAgent =
    clientAllowsLocalAgentControls(authContext) && hasPermission('agent:write');
  // The polled status is authoritative once it settles. While a realtime start
  // signal refreshes a stale idle snapshot, preserve the stream's running state.
  const isAgentRunning = agentStatus?.running === true || (isAgentStatusFetching && isRunning);
  const canStart = canControlAgent && task.git?.worktreePath && !isAgentRunning;
  const stopControl = agentStatus?.controls?.controls.find((control) => control.action === 'stop');
  const messageControl = agentStatus?.controls?.controls.find(
    (control) => control.action === 'message'
  );
  const statusErrorReason =
    agentStatusError instanceof Error
      ? agentStatusError.message
      : agentStatusError
        ? 'Provider runtime status could not be validated.'
        : undefined;
  const stopReason =
    statusErrorReason ??
    stopControl?.reason ??
    'Validated stop capability evidence is not available for this run.';
  const messageReason =
    statusErrorReason ??
    messageControl?.reason ??
    'Validated steer capability evidence is not available for this run.';
  const hasActiveAttempt = Boolean(agentStatus?.attemptId);
  const canStop = !agentStatusError && hasActiveAttempt && stopControl?.available === true;
  const canSendMessage =
    !agentStatusError && hasActiveAttempt && messageControl?.available === true;

  if (!task.git?.worktreePath) {
    return (
      <Stack gap="xs">
        <Group gap="xs">
          <Bot className="h-4 w-4 text-muted-foreground" />
          <Text size="sm" c="dimmed">
            AI Agent
          </Text>
        </Group>
        <Paper className="p-3" radius="md" withBorder>
          <Group gap="xs" wrap="nowrap">
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
            <Text size="sm" c="dimmed">
              Create a worktree first to use an AI agent.
            </Text>
          </Group>
        </Paper>
      </Stack>
    );
  }

  return (
    <FeatureErrorBoundary fallbackTitle="Agent panel failed to load">
      <Stack gap="sm">
        <Group justify="space-between">
          <Group gap="xs">
            <Bot className="h-4 w-4 text-muted-foreground" />
            <Text size="sm" c="dimmed">
              AI Agent
            </Text>
          </Group>
          <Group gap="xs">
            {isConnected ? (
              <Wifi className="h-3 w-3 text-green-500" />
            ) : (
              <WifiOff className="h-3 w-3 text-muted-foreground" />
            )}
            {isAgentRunning && (
              <Text component="span" size="xs" c="green" className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                Running
              </Text>
            )}
          </Group>
        </Group>

        <Paper className="overflow-hidden bg-muted/30" radius="md" withBorder>
          {!canControlAgent && (
            <Alert
              color="blue"
              icon={<ShieldAlert className="h-4 w-4" />}
              title="Agent controls unavailable for this client"
              className="m-2"
            >
              <Text size="sm">
                This client can inspect run history and live output, but start, stop, retry, and
                message controls require an agent-capable desktop or CLI session.
              </Text>
            </Alert>
          )}

          {!isAgentRunning && !readinessSummary.ready && (
            <Alert
              color="yellow"
              icon={<AlertCircle className="h-4 w-4" />}
              title="Task is not ready for agent execution"
              className="m-2"
            >
              <Stack gap={4}>
                {readinessSummary.missingRequired.map((check) => (
                  <Text key={check.id} size="xs">
                    {check.label}: {check.detail}
                  </Text>
                ))}
              </Stack>
            </Alert>
          )}

          {/* Controls */}
          {canControlAgent && (
            <Group gap="xs" className="border-b bg-card p-2">
              {!isAgentRunning ? (
                <>
                  {routingResult && !selectedAgent && (
                    <Text
                      size="xs"
                      c="dimmed"
                      truncate
                      className="max-w-[200px]"
                      title={routingResult.reason}
                    >
                      Rec:{' '}
                      {enabledAgents.find((a) => a.type === routingResult.agent)?.name ||
                        routingResult.agent}
                      {routingResult.model ? ` (${routingResult.model})` : ''}
                    </Text>
                  )}
                  <Select
                    value={resolvedAgent}
                    onChange={(value) => setSelectedAgent(value as AgentType)}
                    data={agentOptions}
                    placeholder="Select agent..."
                    aria-label="Agent"
                    className="w-[180px]"
                    size="xs"
                    checkIconPosition="right"
                  />
                  <Select
                    value={selectedModel || routingResult?.model || 'sonnet'}
                    onChange={(value) => setSelectedModel(value ?? undefined)}
                    data={modelOptions}
                    placeholder="Model..."
                    aria-label="Model"
                    className="w-[100px]"
                    size="xs"
                    checkIconPosition="right"
                  />
                  <Button
                    size="sm"
                    onClick={handleStart}
                    disabled={!canStart || startAgent.isPending}
                    leftSection={
                      startAgent.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )
                    }
                  >
                    Start
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  color="red"
                  leftSection={<Square className="h-4 w-4" />}
                  onClick={() => setStopDialogOpen(true)}
                  disabled={!canStop}
                  aria-label={canStop ? 'Stop agent' : `Stop agent unavailable: ${stopReason}`}
                  title={canStop ? 'Stop agent' : stopReason}
                >
                  Stop
                </Button>
              )}
            </Group>
          )}

          {isAgentRunning && canControlAgent && (!canStop || !canSendMessage) && (
            <Alert
              color="yellow"
              icon={<ShieldAlert className="h-4 w-4" />}
              title="Provider runtime controls are limited"
              className="m-2"
            >
              <Stack gap={4}>
                {!canStop && <Text size="xs">Stop: {stopReason}</Text>}
                {!canSendMessage && <Text size="xs">Message: {messageReason}</Text>}
              </Stack>
            </Alert>
          )}

          {/* Output */}
          <div
            ref={outputRef}
            onScroll={handleScroll}
            className="h-[300px] overflow-y-auto p-3 font-mono text-xs bg-zinc-950 text-zinc-200"
          >
            {outputs.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <Terminal className="h-6 w-6 mr-2 opacity-50" />
                {isAgentRunning ? 'Waiting for output...' : 'Agent output will appear here'}
              </div>
            ) : (
              outputs.map((output, i) => (
                <div
                  key={i}
                  className={cn(
                    'whitespace-pre-wrap break-all',
                    output.type === 'stderr' && 'text-red-400',
                    output.type === 'stdin' &&
                      'text-blue-400 bg-blue-500/10 px-2 py-1 rounded my-1',
                    output.type === 'system' && 'text-yellow-400 italic'
                  )}
                >
                  {output.type === 'stdin' && <span className="font-bold">You: </span>}
                  {sanitizeText(output.content)}
                </div>
              ))
            )}
          </div>

          {/* Input */}
          {isAgentRunning && canControlAgent && (
            <form onSubmit={handleSendMessage} className="flex gap-2 p-2 border-t bg-card">
              <TextInput
                value={message}
                onChange={(e) => setMessage(e.currentTarget.value)}
                placeholder="Send a message to the agent..."
                className="flex-1 h-8 text-sm"
                disabled={!canSendMessage}
                aria-label={
                  canSendMessage
                    ? 'Send a message to the agent'
                    : `Message unavailable: ${messageReason}`
                }
                title={canSendMessage ? undefined : messageReason}
              />
              <Button
                type="submit"
                size="sm"
                disabled={!canSendMessage || !message.trim() || sendMessage.isPending}
                aria-label={
                  canSendMessage ? 'Send message' : `Send message unavailable: ${messageReason}`
                }
                title={canSendMessage ? 'Send message' : messageReason}
              >
                <Send className="h-4 w-4" />
              </Button>
            </form>
          )}
        </Paper>

        {/* New Attempt button for completed/failed tasks */}
        {task.attempt &&
          ['complete', 'failed'].includes(task.attempt.status) &&
          !isAgentRunning &&
          canControlAgent && (
            <Button
              variant="outline"
              size="sm"
              fullWidth
              leftSection={<RotateCcw className="h-4 w-4" />}
              onClick={handleStart}
            >
              New Attempt
            </Button>
          )}

        {/* Attempt History */}
        {attempts && attempts.length > 0 && (
          <Stack gap="xs">
            <Group gap="xs">
              <History className="h-4 w-4" />
              <Text size="sm" c="dimmed">
                Attempt History ({attempts.length})
              </Text>
            </Group>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {attempts.map((attemptId) => {
                const isCurrentAttempt = task.attempt?.id === attemptId;
                const attemptStatus = isCurrentAttempt ? task.attempt?.status : 'complete';
                const isViewing = viewingAttemptId === attemptId;

                return (
                  <div
                    key={attemptId}
                    className={cn(
                      'flex items-center gap-2 p-2 rounded-md text-xs cursor-pointer transition-colors',
                      isViewing
                        ? 'bg-primary/10 border border-primary/30'
                        : 'bg-muted/50 hover:bg-muted'
                    )}
                    onClick={() => {
                      if (isCurrentAttempt && isAgentRunning) {
                        setViewingAttemptId(null); // Show live output
                      } else {
                        setViewingAttemptId(isViewing ? null : attemptId);
                      }
                    }}
                  >
                    {attemptStatusIcons[attemptStatus as AttemptStatus] ||
                      attemptStatusIcons.complete}
                    <span className="font-mono flex-1 truncate">{attemptId}</span>
                    {isCurrentAttempt && (
                      <Badge variant="light" size="xs">
                        Current
                      </Badge>
                    )}
                    {isViewing && !isCurrentAttempt && (
                      <Badge variant="outline" size="xs">
                        Viewing
                      </Badge>
                    )}
                    {onOpenTimeline && (
                      <Tooltip label="Open run timeline">
                        <ActionIcon
                          aria-label={`Open timeline for ${attemptId}`}
                          size="sm"
                          variant="subtle"
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpenTimeline(attemptId);
                          }}
                        >
                          <History className="h-3 w-3" />
                        </ActionIcon>
                      </Tooltip>
                    )}
                  </div>
                );
              })}
            </div>
          </Stack>
        )}

        {/* Historical attempt log viewer */}
        {viewingAttemptId && viewingAttemptId !== task.attempt?.id && (
          <Paper className="overflow-hidden bg-muted/30" radius="md" withBorder>
            <Group justify="space-between" className="border-b bg-card p-2">
              <Text size="xs" c="dimmed">
                Viewing: <Code>{viewingAttemptId}</Code>
              </Text>
              <Button variant="subtle" size="xs" onClick={() => setViewingAttemptId(null)}>
                Close
              </Button>
            </Group>
            <div className="h-[200px] overflow-y-auto p-3 font-mono text-xs bg-zinc-950 text-zinc-200">
              {isLoadingLog ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Loading log...
                </div>
              ) : attemptLog ? (
                <pre className="whitespace-pre-wrap">{attemptLog}</pre>
              ) : (
                <div className="text-muted-foreground">No log available</div>
              )}
            </div>
          </Paper>
        )}

        {/* Current attempt info */}
        {task.attempt && !viewingAttemptId && (
          <Paper className="bg-muted/30 p-2" radius="md">
            <Stack gap={4}>
              <Group gap="xs">
                {attemptStatusIcons[task.attempt.status]}
                <Text size="xs" c="dimmed" fw={500}>
                  Current: {task.attempt.id}
                </Text>
              </Group>
              <Text size="xs" c="dimmed">
                Agent: {task.attempt.agent}
              </Text>
              {task.attempt.started && (
                <Text size="xs" c="dimmed">
                  Started: {new Date(task.attempt.started).toLocaleString()}
                </Text>
              )}
              {task.attempt.ended && (
                <Text size="xs" c="dimmed">
                  Ended: {new Date(task.attempt.ended).toLocaleString()}
                </Text>
              )}
              {onOpenTimeline && (
                <Button
                  size="compact-xs"
                  variant="subtle"
                  leftSection={<History className="h-3 w-3" />}
                  onClick={() => onOpenTimeline(task.attempt?.id)}
                >
                  Timeline
                </Button>
              )}
            </Stack>
          </Paper>
        )}

        <RunSessionSharesSection task={task} isAgentRunning={isAgentRunning} />

        <Modal
          opened={stopDialogOpen}
          onClose={() => setStopDialogOpen(false)}
          title="Stop the agent?"
          centered
        >
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              This will terminate the running agent. The attempt will be marked as failed.
            </Text>
            {!canStop && (
              <Alert color="yellow" icon={<AlertCircle className="h-4 w-4" />}>
                Stop unavailable: {stopReason}
              </Alert>
            )}
            <Group justify="flex-end" gap="xs">
              <Button variant="default" onClick={() => setStopDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                color="red"
                disabled={!canStop || stopAgent.isPending}
                title={canStop ? 'Stop Agent' : stopReason}
                onClick={handleStop}
              >
                Stop Agent
              </Button>
            </Group>
          </Stack>
        </Modal>

        <Modal
          opened={readinessOverrideOpen}
          onClose={() => setReadinessOverrideOpen(false)}
          title="Start with readiness override?"
          centered
        >
          <Stack gap="md">
            <Stack gap={6}>
              {readinessSummary.missingRequired.map((check) => (
                <Group key={check.id} gap="xs" align="flex-start" wrap="nowrap">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-500" />
                  <div>
                    <Text size="sm" fw={500}>
                      {check.label}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {check.detail}
                    </Text>
                  </div>
                </Group>
              ))}
            </Stack>
            <Textarea
              label="Override reason"
              value={readinessOverrideReason}
              onChange={(event) => setReadinessOverrideReason(event.currentTarget.value)}
              rows={3}
              placeholder="Why is this task safe to start before it is ready?"
            />
            <Group justify="flex-end" gap="xs">
              <Button variant="default" onClick={() => setReadinessOverrideOpen(false)}>
                Cancel
              </Button>
              <Button
                color="yellow"
                onClick={handleReadinessOverride}
                disabled={readinessOverrideReason.trim().length < 8 || startAgent.isPending}
              >
                Start Anyway
              </Button>
            </Group>
          </Stack>
        </Modal>
      </Stack>
    </FeatureErrorBoundary>
  );
}
