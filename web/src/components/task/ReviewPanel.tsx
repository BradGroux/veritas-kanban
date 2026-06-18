import { useState } from 'react';
import {
  Button,
  Code,
  Group,
  Modal,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  ThemeIcon,
} from '@mantine/core';
import { CheckCircle, XCircle, RefreshCcw, MessageSquare, GitMerge, Loader2 } from 'lucide-react';
import { useMergeWorktree } from '@/hooks/useWorktree';
import type { Task, ReviewDecision, ReviewState } from '@veritas-kanban/shared';
import { DecisionReviewSessionsSection } from './DecisionReviewSessionsSection';

interface ReviewPanelProps {
  task: Task;
  onReview: (review: ReviewState) => void;
  onMergeComplete?: () => void;
}

const decisionStyles: Record<
  ReviewDecision,
  { icon: React.ReactNode; label: string; color: string }
> = {
  approved: {
    icon: <CheckCircle className="h-4 w-4" />,
    label: 'Approved',
    color: 'green',
  },
  'changes-requested': {
    icon: <RefreshCcw className="h-4 w-4" />,
    label: 'Changes Requested',
    color: 'yellow',
  },
  rejected: {
    icon: <XCircle className="h-4 w-4" />,
    label: 'Rejected',
    color: 'red',
  },
};

export function ReviewPanel({ task, onReview, onMergeComplete }: ReviewPanelProps) {
  const [showSummary, setShowSummary] = useState(false);
  const [summary, setSummary] = useState('');
  const [pendingDecision, setPendingDecision] = useState<ReviewDecision | null>(null);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);

  const mergeWorktree = useMergeWorktree();
  const hasWorktree = !!task.git?.worktreePath;
  const comments = task.reviewComments || [];
  const currentReview = task.review;
  const isApproved = currentReview?.decision === 'approved';

  const handleDecision = (decision: ReviewDecision) => {
    if (decision === 'changes-requested' || decision === 'rejected') {
      setPendingDecision(decision);
      setShowSummary(true);
    } else {
      submitReview(decision);
    }
  };

  const submitReview = (decision: ReviewDecision, reviewSummary?: string) => {
    onReview({
      decision,
      decidedAt: new Date().toISOString(),
      summary: reviewSummary,
    });
    setShowSummary(false);
    setSummary('');
    setPendingDecision(null);
  };

  return (
    <Stack gap="md">
      {!hasWorktree && (
        <Text ta="center" c="dimmed" className="py-4">
          Start a worktree to enable code review
        </Text>
      )}

      {/* Current review status */}
      {hasWorktree && currentReview?.decision && (
        <Paper className="p-3" radius="md" withBorder>
          <Group gap="sm" wrap="nowrap">
            <ThemeIcon color={decisionStyles[currentReview.decision].color} variant="light">
              {decisionStyles[currentReview.decision].icon}
            </ThemeIcon>
            <Stack gap={2} className="min-w-0 flex-1">
              <Text size="sm" fw={500}>
                {decisionStyles[currentReview.decision].label}
              </Text>
              {currentReview.decidedAt && (
                <Text size="xs" c="dimmed">
                  {new Date(currentReview.decidedAt).toLocaleString()}
                </Text>
              )}
            </Stack>
            <Button variant="subtle" size="xs" onClick={() => onReview({})}>
              Clear
            </Button>
          </Group>
        </Paper>
      )}

      {hasWorktree && currentReview?.summary && (
        <Paper className="bg-muted/50 p-3" radius="md" withBorder>
          <Text size="sm" className="whitespace-pre-wrap">
            {currentReview.summary}
          </Text>
        </Paper>
      )}

      {/* Merge button when approved */}
      {isApproved && hasWorktree && (
        <Button
          fullWidth
          color="green"
          onClick={() => setMergeDialogOpen(true)}
          disabled={mergeWorktree.isPending}
          leftSection={
            mergeWorktree.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <GitMerge className="h-4 w-4" />
            )
          }
        >
          {mergeWorktree.isPending ? 'Merging...' : 'Merge & Close Task'}
        </Button>
      )}

      {/* Comment summary */}
      {hasWorktree && comments.length > 0 && (
        <Group gap="xs">
          <MessageSquare className="h-4 w-4" />
          <Text size="sm" c="dimmed">
            {comments.length} review comment{comments.length === 1 ? '' : 's'}
          </Text>
        </Group>
      )}

      {/* Summary input for changes-requested/rejected */}
      {hasWorktree && showSummary && pendingDecision && (
        <Paper className="bg-muted/50 p-3" radius="md" withBorder>
          <Stack gap="xs">
            <Textarea
              value={summary}
              onChange={(e) => setSummary(e.currentTarget.value)}
              placeholder={
                pendingDecision === 'rejected'
                  ? 'Explain why this is rejected...'
                  : 'Describe the changes needed...'
              }
              minRows={3}
            />
            <Group gap="xs" className="flex-col items-stretch sm:flex-row sm:items-center">
              <Button
                onClick={() => submitReview(pendingDecision, summary || undefined)}
                color={pendingDecision === 'rejected' ? 'red' : undefined}
              >
                Submit {decisionStyles[pendingDecision].label}
              </Button>
              <Button
                variant="subtle"
                onClick={() => {
                  setShowSummary(false);
                  setSummary('');
                  setPendingDecision(null);
                }}
              >
                Cancel
              </Button>
            </Group>
          </Stack>
        </Paper>
      )}

      {/* Action buttons */}
      {hasWorktree && !currentReview?.decision && !showSummary && (
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="xs">
          <Button
            onClick={() => handleDecision('approved')}
            color="green"
            leftSection={<CheckCircle className="h-4 w-4" />}
          >
            Approve
          </Button>
          <Button
            onClick={() => handleDecision('changes-requested')}
            variant="outline"
            leftSection={<RefreshCcw className="h-4 w-4" />}
          >
            Request Changes
          </Button>
          <Button
            onClick={() => handleDecision('rejected')}
            color="red"
            leftSection={<XCircle className="h-4 w-4" />}
          >
            Reject
          </Button>
        </SimpleGrid>
      )}

      <DecisionReviewSessionsSection task={task} />

      <Modal
        opened={mergeDialogOpen}
        onClose={() => setMergeDialogOpen(false)}
        title={`Merge changes to ${task.git?.baseBranch || 'main'}?`}
        centered
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            This will merge the branch <Code>{task.git?.branch}</Code> into{' '}
            <Code>{task.git?.baseBranch || 'main'}</Code>, delete the worktree, and mark this task
            as done.
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => setMergeDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              color="green"
              onClick={() => {
                mergeWorktree.mutate(task.id, {
                  onSuccess: () => {
                    onMergeComplete?.();
                  },
                });
                setMergeDialogOpen(false);
              }}
            >
              Merge & Close
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
