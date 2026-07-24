import { useState } from 'react';
import { Alert, Badge, Button, Code, Group, Modal, Stack, Text, Textarea } from '@mantine/core';
import {
  useWorktreeStatus,
  useCreateWorktree,
  useAdoptWorktree,
  useDeleteWorktree,
  useRebaseWorktree,
  useMergeWorktree,
} from '@/hooks/useWorktree';
import { useGitHubStatus } from '@/hooks/useGitHub';
import { useConflictStatus } from '@/hooks/useConflicts';
import { ConflictResolver } from '../ConflictResolver';
import { PRDialog } from './PRDialog';
import {
  Loader2,
  AlertCircle,
  Play,
  ExternalLink,
  RefreshCw,
  GitMerge,
  Trash2,
  FileCode,
  ArrowUp,
  ArrowDown,
  GitPullRequest,
  AlertTriangle,
} from 'lucide-react';
import type { Task } from '@veritas-kanban/shared';

interface WorktreeStatusProps {
  task: Task;
}

export function WorktreeStatus({ task }: WorktreeStatusProps) {
  const hasWorktree = !!task.git?.worktreePath;
  const hasManagedWorktree = hasWorktree && !!task.git?.worktreeManifestId;
  const hasPR = !!task.git?.prUrl;
  const { data: status, isLoading, error } = useWorktreeStatus(task.id, hasManagedWorktree);
  const { data: ghStatus } = useGitHubStatus();
  const { data: conflictStatus } = useConflictStatus(hasWorktree ? task.id : undefined);

  const createWorktree = useCreateWorktree();
  const adoptWorktree = useAdoptWorktree();
  const deleteWorktree = useDeleteWorktree();
  const rebaseWorktree = useRebaseWorktree();
  const mergeWorktree = useMergeWorktree();

  // Conflict resolver state
  const [conflictResolverOpen, setConflictResolverOpen] = useState(false);
  const [prDialogOpen, setPrDialogOpen] = useState(false);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [cleanupOverrideReason, setCleanupOverrideReason] = useState('');
  const [staleBaseReason, setStaleBaseReason] = useState('');

  const handleOpenInVSCode = () => {
    if (task.git?.worktreePath) {
      window.open(`vscode://file/${task.git.worktreePath}`, '_blank', 'noopener,noreferrer');
    }
  };

  const handleOpenPR = () => {
    if (task.git?.prUrl) {
      window.open(task.git.prUrl, '_blank', 'noopener,noreferrer');
    }
  };

  if (!task.git?.repo || !task.git?.branch) {
    return null;
  }

  // No worktree yet - show create button
  if (!hasWorktree) {
    return (
      <Stack gap="xs" className="mt-3 border-t pt-3">
        <Button
          variant="outline"
          fullWidth
          onClick={() => createWorktree.mutate(task.id)}
          disabled={createWorktree.isPending}
          leftSection={
            createWorktree.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )
          }
        >
          Create Worktree
        </Button>
        {createWorktree.error && (
          <>
            <Text size="xs" c="red">
              {(createWorktree.error as Error).message}
            </Text>
            {(createWorktree.error as Error).message.includes('stale-base acknowledgement') && (
              <Stack gap="xs">
                <Textarea
                  label="Offline base acknowledgement"
                  description="The exact local base commit and this reason will be persisted."
                  value={staleBaseReason}
                  onChange={(event) => setStaleBaseReason(event.currentTarget.value)}
                  minRows={2}
                />
                <Button
                  variant="outline"
                  color="orange"
                  disabled={staleBaseReason.trim().length === 0 || createWorktree.isPending}
                  onClick={() =>
                    createWorktree.mutate({
                      taskId: task.id,
                      request: {
                        allowStaleBase: true,
                        staleBaseAcknowledgement: { reason: staleBaseReason.trim() },
                      },
                    })
                  }
                >
                  Retry with acknowledged local base
                </Button>
              </Stack>
            )}
          </>
        )}
      </Stack>
    );
  }

  if (!hasManagedWorktree) {
    return (
      <Alert
        className="mt-3"
        color="orange"
        icon={<AlertTriangle className="h-5 w-5" />}
        title="Legacy worktree needs adoption"
      >
        <Stack gap="xs">
          <Text size="sm">
            This pre-6.0 worktree has no durable ownership manifest. An administrator must validate
            its repository, branch, path, remote base, and current status before agent launch or
            lifecycle actions can continue. Local changes are preserved.
          </Text>
          <Code className="truncate" color="dark">
            {task.git.worktreePath}
          </Code>
          <Button
            variant="outline"
            color="orange"
            size="xs"
            onClick={() => adoptWorktree.mutate(task.id)}
            disabled={adoptWorktree.isPending}
          >
            {adoptWorktree.isPending ? 'Validating...' : 'Adopt existing worktree'}
          </Button>
          {adoptWorktree.error && (
            <Text size="xs" c="red">
              {(adoptWorktree.error as Error).message}
            </Text>
          )}
        </Stack>
      </Alert>
    );
  }

  // Loading worktree status
  if (isLoading) {
    return (
      <Group gap="xs" className="mt-3 border-t pt-3">
        <Loader2 className="h-4 w-4 animate-spin" />
        <Text size="sm" c="dimmed">
          Loading worktree status...
        </Text>
      </Group>
    );
  }

  // Error loading status
  if (error) {
    return (
      <Group gap="xs" className="mt-3 border-t pt-3">
        <AlertCircle className="h-4 w-4" />
        <Text size="sm" c="red">
          {(error as Error).message}
        </Text>
      </Group>
    );
  }

  // Show worktree status
  return (
    <Stack gap="sm" className="mt-3 border-t pt-3">
      {/* Conflict warning banner */}
      {status?.remoteState?.stale && status.baseCommit && (
        <Alert
          color="orange"
          icon={<AlertTriangle className="h-5 w-5" />}
          title="Stale base acknowledged"
        >
          <Text size="xs">
            This worktree was created from an explicitly acknowledged local base because the remote
            fetch failed. Exact base: {status.baseCommit.slice(0, 12)}.
          </Text>
        </Alert>
      )}

      {conflictStatus?.hasConflicts && (
        <Alert
          color="yellow"
          icon={<AlertTriangle className="h-5 w-5" />}
          title={`${conflictStatus.conflictingFiles.length} conflict${
            conflictStatus.conflictingFiles.length !== 1 ? 's' : ''
          } detected`}
        >
          <Group justify="space-between" align="center" gap="sm">
            <Text size="xs" c="yellow.7">
              {conflictStatus.rebaseInProgress ? 'Rebase' : 'Merge'} requires manual resolution
            </Text>
            <Button
              size="xs"
              variant="outline"
              color="yellow"
              onClick={() => setConflictResolverOpen(true)}
              leftSection={<AlertTriangle className="h-4 w-4" />}
            >
              Resolve Conflicts
            </Button>
          </Group>
        </Alert>
      )}

      {/* Status indicators */}
      <Group justify="space-between" align="center">
        <Group gap="xs">
          <span
            className={`h-2 w-2 rounded-full ${
              conflictStatus?.hasConflicts ? 'bg-amber-500' : 'bg-green-500'
            }`}
          >
            <span className="sr-only">
              {conflictStatus?.hasConflicts
                ? 'Warning: conflicts detected'
                : 'Status: active and healthy'}
            </span>
          </span>
          <Text size="sm" c="dimmed">
            {conflictStatus?.hasConflicts ? 'Conflicts detected' : 'Worktree active'}
          </Text>
        </Group>
        <Group gap="sm">
          {status && (
            <>
              {status.aheadBehind.ahead > 0 && (
                <Badge variant="light" color="blue" leftSection={<ArrowUp className="h-3 w-3" />}>
                  {status.aheadBehind.ahead} ahead
                </Badge>
              )}
              {status.aheadBehind.behind > 0 && (
                <Badge
                  variant="light"
                  color="yellow"
                  leftSection={<ArrowDown className="h-3 w-3" />}
                >
                  {status.aheadBehind.behind} behind
                </Badge>
              )}
              {status.hasChanges && (
                <Badge variant="light" color="gray" leftSection={<FileCode className="h-3 w-3" />}>
                  {status.changedFiles} changed
                </Badge>
              )}
            </>
          )}
        </Group>
      </Group>

      {/* Action buttons */}
      <Group gap="xs">
        <Button
          variant="outline"
          size="xs"
          onClick={handleOpenInVSCode}
          leftSection={<ExternalLink className="h-3 w-3" />}
        >
          Open in VS Code
        </Button>

        {/* PR Button - show View PR if exists, Create PR if not */}
        {hasPR ? (
          <Button
            variant="outline"
            size="xs"
            onClick={handleOpenPR}
            leftSection={<GitPullRequest className="h-3 w-3" />}
          >
            View PR #{task.git?.prNumber}
          </Button>
        ) : (
          status &&
          status.aheadBehind.ahead > 0 &&
          ghStatus?.authenticated && (
            <Button
              variant="outline"
              size="xs"
              onClick={() => setPrDialogOpen(true)}
              leftSection={<GitPullRequest className="h-3 w-3" />}
            >
              Create PR
            </Button>
          )
        )}

        {status && status.aheadBehind.behind > 0 && (
          <Button
            variant="outline"
            size="xs"
            onClick={() => rebaseWorktree.mutate(task.id)}
            disabled={rebaseWorktree.isPending}
            leftSection={
              rebaseWorktree.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )
            }
          >
            Rebase
          </Button>
        )}

        {status && status.aheadBehind.ahead > 0 && !status.hasChanges && (
          <Button
            color="green"
            size="xs"
            onClick={() => setMergeDialogOpen(true)}
            leftSection={<GitMerge className="h-3 w-3" />}
          >
            Merge
          </Button>
        )}

        <Button
          variant="subtle"
          color="gray"
          size="xs"
          onClick={() => setDeleteDialogOpen(true)}
          leftSection={<Trash2 className="h-3 w-3" />}
        >
          Delete Worktree
        </Button>
      </Group>

      {/* Worktree path */}
      <Code className="truncate" color="dark">
        {task.git.worktreePath}
      </Code>
      {status?.baseCommit && status.baseSource && status.manifestId && (
        <Text size="xs" c="dimmed">
          Base {status.baseCommit.slice(0, 12)} from {status.baseSource}; manifest{' '}
          {status.manifestId}
        </Text>
      )}

      {/* Conflict Resolver */}
      <ConflictResolver
        task={task}
        open={conflictResolverOpen}
        onOpenChange={setConflictResolverOpen}
      />

      {/* PR Dialog */}
      <PRDialog task={task} open={prDialogOpen} onOpenChange={setPrDialogOpen} />

      <Modal
        opened={mergeDialogOpen}
        onClose={() => setMergeDialogOpen(false)}
        title={`Merge to ${task.git?.baseBranch}?`}
        centered
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            This will merge {task.git?.branch} into {task.git?.baseBranch}, push to remote, delete
            the worktree, and mark the task as Done. Integration runs in a dedicated temporary
            worktree and does not change your primary checkout.
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => setMergeDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              color="green"
              onClick={() => {
                mergeWorktree.mutate(task.id);
                setMergeDialogOpen(false);
              }}
              disabled={mergeWorktree.isPending}
            >
              {mergeWorktree.isPending ? 'Merging...' : 'Merge & Complete'}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        title="Delete worktree?"
        centered
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            This will remove the worktree but keep the branch.
          </Text>
          {(status?.cleanupPreview?.blockedReasons.length ?? 0) > 0 && (
            <Alert color="red" title="Cleanup is blocked">
              <Stack gap={4}>
                {status?.cleanupPreview?.blockedReasons.map((reason) => (
                  <Text size="xs" key={reason.code}>
                    {reason.message}
                  </Text>
                ))}
              </Stack>
            </Alert>
          )}
          {status?.cleanupPreview?.requiresOverride && (
            <Textarea
              label="Override reason"
              description="This reason is stored in the worktree manifest."
              value={cleanupOverrideReason}
              onChange={(event) => setCleanupOverrideReason(event.currentTarget.value)}
              minRows={2}
              required
            />
          )}
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              color="red"
              onClick={() => {
                deleteWorktree.mutate({
                  taskId: task.id,
                  force: (status?.cleanupPreview?.blockedReasons.length ?? 0) > 0,
                  reason: status?.cleanupPreview?.requiresOverride
                    ? cleanupOverrideReason.trim()
                    : undefined,
                });
                setDeleteDialogOpen(false);
                setCleanupOverrideReason('');
              }}
              disabled={
                Boolean(
                  status?.cleanupPreview?.blockedReasons.some((reason) => !reason.overrideable)
                ) ||
                (Boolean(status?.cleanupPreview?.requiresOverride) &&
                  cleanupOverrideReason.trim().length === 0)
              }
            >
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
