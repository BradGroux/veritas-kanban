import { useEffect, useRef, useState } from 'react';
import { UiModal as Modal, OverlayFooter } from '@/components/ui/UiOverlay';
import { UiAction } from '@/components/ui/UiVocabulary';
import {
  Button,
  Code,
  Group,
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
  const mergeInFlight = useRef(false);
  const [isMerging, setIsMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const mergeErrorRef = useRef<HTMLParagraphElement | null>(null);

  const mergeWorktree = useMergeWorktree();
  const hasWorktree = !!task.git?.worktreePath;
  const comments = task.reviewComments || [];
  const currentReview = task.review;
  const isApproved = currentReview?.decision === 'approved';

  useEffect(() => {
    if (mergeError) {
      mergeErrorRef.current?.focus({ preventScroll: true });
      mergeErrorRef.current?.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
  }, [mergeError]);

  const closeMerge = () => {
    if (!mergeInFlight.current) {
      setMergeDialogOpen(false);
      setMergeError(null);
    }
  };

  const handleMerge = async () => {
    if (mergeInFlight.current || !isApproved || !hasWorktree) return;
    mergeInFlight.current = true;
    setIsMerging(true);
    setMergeError(null);
    try {
      await mergeWorktree.mutateAsync(task.id);
    } catch (error) {
      setMergeError(error instanceof Error ? error.message : 'Unable to merge the worktree.');
      return;
    } finally {
      mergeInFlight.current = false;
      setIsMerging(false);
    }
    setMergeDialogOpen(false);
    onMergeComplete?.();
  };

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
                Review: {decisionStyles[currentReview.decision].label}
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
          disabled={isMerging}
          leftSection={
            isMerging ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <GitMerge className="h-4 w-4" />
            )
          }
        >
          {isMerging ? 'Merging...' : 'Merge & Close Task'}
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
        variant="confirm"
        compound
        opened={mergeDialogOpen}
        onClose={closeMerge}
        title={`Merge changes to ${task.git?.baseBranch || 'main'}?`}
        centered
      >
        <div className="vk-overlay-scroll">
          <Text size="sm" c="dimmed">
            This will merge the branch <Code>{task.git?.branch}</Code> into{' '}
            <Code>{task.git?.baseBranch || 'main'}</Code>, delete the worktree, and mark this task
            as done.
          </Text>
          {mergeError && (
            <Text ref={mergeErrorRef} role="alert" tabIndex={-1} size="sm" c="red" mt="sm">
              {mergeError}
            </Text>
          )}
        </div>
        <OverlayFooter>
          <UiAction variant="quiet" onClick={closeMerge} disabled={isMerging}>
            Cancel
          </UiAction>
          <UiAction
            onClick={handleMerge}
            disabled={isMerging || !isApproved || !hasWorktree}
            loading={isMerging}
          >
            Merge & Close
          </UiAction>
        </OverlayFooter>
      </Modal>
    </Stack>
  );
}
