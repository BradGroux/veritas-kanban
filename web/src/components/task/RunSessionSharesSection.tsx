import { useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Code,
  CopyButton,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from '@mantine/core';
import {
  AlertCircle,
  Copy,
  GitFork,
  Link,
  MessageSquare,
  ShieldCheck,
  Share2,
  Users,
} from 'lucide-react';
import type { RunSessionPermission, RunSessionShare, Task } from '@veritas-kanban/shared';
import {
  useCreateRunSessionShare,
  useForkRunSession,
  useRevokeRunSessionShare,
  useRunSession,
  useRunSessionApprovalResponse,
  useRunSessionEvents,
  useRunSessionEventStream,
  useRunSessions,
  useSendRunSessionMessage,
  useUpdateRunSessionShare,
} from '@/hooks/useRunSessions';
import { useAgentStream } from '@/hooks/useAgent';
import { useToast } from '@/hooks/useToast';
import { sanitizeText } from '@/lib/sanitize';
import { useIdentity } from '@/hooks/useIdentity';

interface RunSessionSharesSectionProps {
  task: Task;
  isAgentRunning?: boolean;
}

const permissionOptions: Array<{ value: RunSessionPermission; label: string }> = [
  { value: 'view', label: 'View' },
  { value: 'edit', label: 'Co-drive' },
  { value: 'fork', label: 'Fork' },
];

function absoluteShareUrl(path: string): string {
  if (typeof window === 'undefined') return path;
  return new URL(path, window.location.origin).toString();
}

function permissionLabel(permission: RunSessionPermission): string {
  if (permission === 'edit') return 'Co-drive';
  if (permission === 'fork') return 'Fork';
  return 'View';
}

function canSendMessages(share?: RunSessionShare): boolean {
  return share?.status === 'active' && share.permission === 'edit';
}

function canFork(share?: RunSessionShare): boolean {
  return share?.status === 'active' && share.permission === 'fork';
}

export function RunSessionSharesSection({ task, isAgentRunning }: RunSessionSharesSectionProps) {
  const [permission, setPermission] = useState<RunSessionPermission>('view');
  const { data: shares = [] } = useRunSessions({ taskId: task.id });
  const createShare = useCreateRunSessionShare();
  const updateShare = useUpdateRunSessionShare();
  const revokeShare = useRevokeRunSessionShare();
  const { toast } = useToast();
  useRunSessionEventStream(task.id);

  const activeShares = shares.filter((share) => share.status === 'active');

  const handleCreate = async () => {
    try {
      const share = await createShare.mutateAsync({
        taskId: task.id,
        permission,
        mobileSafeApprovalClasses: ['human-review', 'task-comment', 'low-risk'],
      });
      toast({
        title: 'Shared run session created',
        description: `${permissionLabel(share.permission)} link ready.`,
      });
    } catch (error) {
      toast({
        title: 'Failed to create shared session',
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Group gap="xs">
          <Share2 className="h-4 w-4 text-muted-foreground" />
          <Text size="sm" c="dimmed">
            Shared Live Sessions
          </Text>
        </Group>
        {isAgentRunning && (
          <Badge variant="light" color="green">
            Live
          </Badge>
        )}
      </Group>

      <Paper className="p-3" radius="md" withBorder>
        <Stack gap="sm">
          <Group gap="xs" align="flex-end">
            <Select
              label="Permission"
              size="xs"
              value={permission}
              onChange={(value) => setPermission((value as RunSessionPermission) || 'view')}
              data={permissionOptions}
              className="w-[140px]"
              checkIconPosition="right"
            />
            <Button
              size="xs"
              leftSection={<Link className="h-3 w-3" />}
              loading={createShare.isPending}
              onClick={handleCreate}
            >
              Create Link
            </Button>
          </Group>

          {activeShares.length === 0 ? (
            <Text size="xs" c="dimmed">
              No active shared run sessions.
            </Text>
          ) : (
            <Stack gap="xs">
              {activeShares.map((share) => (
                <Group key={share.id} justify="space-between" gap="xs" wrap="nowrap">
                  <Group gap="xs" className="min-w-0">
                    <Users className="h-3 w-3 text-muted-foreground" />
                    <Code className="truncate text-xs">{share.id}</Code>
                    <Badge size="xs" variant="outline">
                      {permissionLabel(share.permission)}
                    </Badge>
                  </Group>
                  <Group gap={4} wrap="nowrap">
                    {share.permission === 'view' && (
                      <Tooltip label="Upgrade to co-drive">
                        <Button
                          size="compact-xs"
                          variant="light"
                          onClick={() =>
                            updateShare.mutate({
                              shareId: share.id,
                              input: { permission: 'edit' },
                            })
                          }
                        >
                          Co-drive
                        </Button>
                      </Tooltip>
                    )}
                    <CopyButton value={absoluteShareUrl(share.stablePath)}>
                      {({ copied, copy }) => (
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          leftSection={<Copy className="h-3 w-3" />}
                          onClick={copy}
                        >
                          {copied ? 'Copied' : 'Copy'}
                        </Button>
                      )}
                    </CopyButton>
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      color="red"
                      onClick={() => revokeShare.mutate({ shareId: share.id })}
                    >
                      Revoke
                    </Button>
                  </Group>
                </Group>
              ))}
            </Stack>
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}

export function RunSessionShareView({ shareId }: { shareId: string }) {
  const { authContext } = useIdentity();
  const { data: share, isLoading, error } = useRunSession(shareId);
  const { data: events = [] } = useRunSessionEvents(shareId);
  const { outputs, isConnected } = useAgentStream(share?.taskId);
  const sendMessage = useSendRunSessionMessage();
  const respondToApproval = useRunSessionApprovalResponse();
  const forkSession = useForkRunSession();
  const { toast } = useToast();
  const [message, setMessage] = useState('');
  const [approvalClass, setApprovalClass] = useState('human-review');
  const [approvalNote, setApprovalNote] = useState('');
  const [forkTitle, setForkTitle] = useState('');
  useRunSessionEventStream(share?.taskId);

  const shareUrl = useMemo(() => (share ? absoluteShareUrl(share.stablePath) : ''), [share]);
  const mobileClient = authContext?.clientMode === 'mobile-pwa';

  if (isLoading) {
    return (
      <Stack gap="md">
        <Text c="dimmed">Loading shared run session...</Text>
      </Stack>
    );
  }

  if (!share || error) {
    return (
      <Alert color="red" icon={<AlertCircle className="h-4 w-4" />}>
        Shared run session is unavailable, revoked, expired, or outside your workspace.
      </Alert>
    );
  }

  const handleSendMessage = async () => {
    const trimmed = message.trim();
    if (!trimmed) return;
    try {
      await sendMessage.mutateAsync({ shareId: share.id, input: { message: trimmed } });
      setMessage('');
    } catch (sendError) {
      toast({
        title: 'Message not sent',
        description: sendError instanceof Error ? sendError.message : 'Unknown error',
      });
    }
  };

  const handleApproval = async (response: 'approved' | 'rejected') => {
    try {
      await respondToApproval.mutateAsync({
        shareId: share.id,
        input: {
          actionClass: approvalClass,
          response,
          note: approvalNote.trim() || undefined,
        },
      });
      setApprovalNote('');
    } catch (approvalError) {
      toast({
        title: 'Approval response blocked',
        description: approvalError instanceof Error ? approvalError.message : 'Unknown error',
      });
    }
  };

  const handleFork = async () => {
    try {
      const result = await forkSession.mutateAsync({
        shareId: share.id,
        input: {
          title: forkTitle.trim() || undefined,
          reason: 'Forked from shared live run session.',
        },
      });
      toast({
        title: 'Fork created',
        description: result.task.title,
      });
      setForkTitle('');
    } catch (forkError) {
      toast({
        title: 'Fork failed',
        description: forkError instanceof Error ? forkError.message : 'Unknown error',
      });
    }
  };

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <div>
          <Text size="xs" c="dimmed">
            Shared live run
          </Text>
          <Text fw={700} size="xl">
            {share.snapshot.taskTitle || share.taskId}
          </Text>
          <Group gap="xs" mt={4}>
            <Badge variant="light">{permissionLabel(share.permission)}</Badge>
            <Badge variant="outline" color={share.status === 'active' ? 'green' : 'red'}>
              {share.status}
            </Badge>
            <Badge variant="outline">{isConnected ? 'Connected' : 'Disconnected'}</Badge>
          </Group>
        </div>
        <CopyButton value={shareUrl}>
          {({ copied, copy }) => (
            <Button
              size="xs"
              variant="light"
              leftSection={<Copy className="h-3 w-3" />}
              onClick={copy}
            >
              {copied ? 'Copied' : 'Copy Link'}
            </Button>
          )}
        </CopyButton>
      </Group>

      <Paper className="p-3" radius="md" withBorder>
        <Stack gap={6}>
          <Text size="sm" fw={600}>
            Run Snapshot
          </Text>
          <Group gap="xs">
            <Code>{share.snapshot.attemptId || 'no-attempt'}</Code>
            {share.snapshot.agent && <Badge variant="outline">{share.snapshot.agent}</Badge>}
            {share.snapshot.model && <Badge variant="outline">{share.snapshot.model}</Badge>}
          </Group>
          {share.snapshot.blocker && (
            <Text size="xs" c="dimmed">
              Current blocker: {share.snapshot.blocker}
            </Text>
          )}
        </Stack>
      </Paper>

      <Paper className="overflow-hidden" radius="md" withBorder>
        <Group justify="space-between" className="border-b bg-card p-2">
          <Text size="sm" fw={600}>
            Live Output
          </Text>
          <Badge variant="dot" color={share.snapshot.running ? 'green' : 'gray'}>
            {share.snapshot.running ? 'running' : 'not running'}
          </Badge>
        </Group>
        <div className="h-[320px] overflow-y-auto bg-zinc-950 p-3 font-mono text-xs text-zinc-200">
          {outputs.length === 0 ? (
            <Text size="xs" c="dimmed">
              No live output received in this viewer.
            </Text>
          ) : (
            outputs.map((output, index) => (
              <div key={`${output.timestamp}-${index}`} className="whitespace-pre-wrap break-all">
                {sanitizeText(output.content)}
              </div>
            ))
          )}
        </div>
      </Paper>

      {canSendMessages(share) && (
        <Paper className="p-3" radius="md" withBorder>
          <Stack gap="xs">
            <Group gap="xs">
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              <Text size="sm" fw={600}>
                Co-drive Message
              </Text>
            </Group>
            <Textarea
              minRows={2}
              value={message}
              onChange={(event) => setMessage(event.currentTarget.value)}
              placeholder="Send an attributed message into the run..."
            />
            <Button size="xs" loading={sendMessage.isPending} onClick={handleSendMessage}>
              Send Message
            </Button>
          </Stack>
        </Paper>
      )}

      {canSendMessages(share) && (
        <Paper className="p-3" radius="md" withBorder>
          <Stack gap="xs">
            <Group gap="xs">
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />
              <Text size="sm" fw={600}>
                Approval Response
              </Text>
            </Group>
            <Select
              label="Action class"
              size="xs"
              value={approvalClass}
              onChange={(value) => setApprovalClass(value || 'human-review')}
              data={share.mobileSafeApprovalClasses.map((item) => ({ value: item, label: item }))}
              checkIconPosition="right"
            />
            {mobileClient && (
              <Text size="xs" c="dimmed">
                Mobile clients can respond only to classes marked mobile-safe for this share.
              </Text>
            )}
            <TextInput
              label="Note"
              size="xs"
              value={approvalNote}
              onChange={(event) => setApprovalNote(event.currentTarget.value)}
            />
            <Group gap="xs">
              <Button size="xs" onClick={() => handleApproval('approved')}>
                Approve
              </Button>
              <Button
                size="xs"
                color="red"
                variant="light"
                onClick={() => handleApproval('rejected')}
              >
                Reject
              </Button>
            </Group>
          </Stack>
        </Paper>
      )}

      {canFork(share) && (
        <Paper className="p-3" radius="md" withBorder>
          <Stack gap="xs">
            <Group gap="xs">
              <GitFork className="h-4 w-4 text-muted-foreground" />
              <Text size="sm" fw={600}>
                Fork Session
              </Text>
            </Group>
            <TextInput
              size="xs"
              label="Fork task title"
              placeholder={`Fork: ${share.snapshot.taskTitle || share.taskId}`}
              value={forkTitle}
              onChange={(event) => setForkTitle(event.currentTarget.value)}
            />
            <Button
              size="xs"
              variant="light"
              loading={forkSession.isPending}
              onClick={handleFork}
              leftSection={<GitFork className="h-3 w-3" />}
            >
              Create Fork
            </Button>
          </Stack>
        </Paper>
      )}

      <Paper className="p-3" radius="md" withBorder>
        <Stack gap="xs">
          <Text size="sm" fw={600}>
            Session Events
          </Text>
          {events.length === 0 ? (
            <Text size="xs" c="dimmed">
              No share events recorded yet.
            </Text>
          ) : (
            events
              .slice()
              .reverse()
              .map((event) => (
                <Group key={event.id} gap="xs" align="flex-start" wrap="nowrap">
                  <Badge size="xs" variant="outline">
                    {event.type}
                  </Badge>
                  <Text size="xs" c="dimmed">
                    {event.actor.label || event.actor.id} at{' '}
                    {new Date(event.createdAt).toLocaleString()}
                    {event.forkTaskId ? ` forked ${event.forkTaskId}` : ''}
                    {event.message ? `: ${event.message}` : ''}
                  </Text>
                </Group>
              ))
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}
