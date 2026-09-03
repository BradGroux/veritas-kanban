import { UiAction, UiPill, semanticToneForLegacyColor } from '@/components/ui/UiVocabulary';
import { SettingsGroup } from '@/components/settings/shared/SettingsLayout';
import { Group, Loader, Stack, Text, Tooltip } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, GitMerge, RefreshCw, Trash2, XCircle } from 'lucide-react';
import type { ReflectionCandidate, ReflectionPromotionTarget } from '@veritas-kanban/shared';
import { useIdentity } from '@/hooks/useIdentity';
import { useToast } from '@/hooks/useToast';
import { api } from '@/lib/api';
import { SettingsPage, SettingsSection } from '../shared';

const REFLECTIONS_QUERY_KEY = ['reflections', 'settings'] as const;
const REVIEWER = 'operator';

function statusColor(status: ReflectionCandidate['status']): string {
  switch (status) {
    case 'pending':
      return 'yellow';
    case 'accepted':
      return 'green';
    case 'rejected':
      return 'red';
    case 'deleted':
      return 'gray';
  }
}

function sourceLabel(candidate: ReflectionCandidate): string {
  const source = candidate.source;
  return (
    source.taskId ||
    source.runId ||
    source.messageId ||
    source.errorId ||
    source.observationId ||
    source.reviewId ||
    source.url ||
    source.kind
  );
}

function promotionLabel(target: ReflectionPromotionTarget): string {
  return target
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function ReflectionTab() {
  const queryClient = useQueryClient();
  const { hasPermission } = useIdentity();
  const { toast } = useToast();
  const canWrite = hasPermission('workflow:write');
  const reflectionsQuery = useQuery({
    queryKey: REFLECTIONS_QUERY_KEY,
    queryFn: () => api.reflections.list({ limit: 50 }),
    staleTime: 30_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: REFLECTIONS_QUERY_KEY });
  const runAction = async (action: () => Promise<unknown>, successTitle: string) => {
    try {
      await action();
      await invalidate();
      toast({ title: successTitle });
    } catch (error) {
      toast({
        title: 'Reflection action failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const accept = useMutation({
    mutationFn: (candidate: ReflectionCandidate) =>
      api.reflections.accept(candidate.id, {
        reviewedBy: REVIEWER,
        promotionTarget: candidate.promotionTarget,
        reviewerNote: 'Accepted from the reflection review queue.',
      }),
  });
  const reject = useMutation({
    mutationFn: (candidate: ReflectionCandidate) =>
      api.reflections.reject(candidate.id, {
        reviewedBy: REVIEWER,
        reason: 'Rejected from the reflection review queue.',
      }),
  });
  const merge = useMutation({
    mutationFn: (candidate: ReflectionCandidate) =>
      api.reflections.merge(candidate.id, { mergedBy: REVIEWER }),
  });
  const remove = useMutation({
    mutationFn: (candidate: ReflectionCandidate) =>
      api.reflections.delete(candidate.id, {
        deletedBy: REVIEWER,
        reason: 'Deleted from the reflection review queue.',
      }),
  });

  const candidates = reflectionsQuery.data?.candidates ?? [];
  const duplicateGroups = reflectionsQuery.data?.duplicateGroups ?? [];
  const pendingCount = candidates.filter((candidate) => candidate.status === 'pending').length;

  if (reflectionsQuery.isLoading) {
    return (
      <Group gap="sm" className="text-muted-foreground">
        <Loader size="xs" />
        <Text size="sm">Loading reflection queue...</Text>
      </Group>
    );
  }

  return (
    <SettingsPage
      title="Reflections"
      description="Review corrections before they become durable lessons, policies, profiles, or templates."
      actions={
        <Tooltip label="Refresh reflections">
          <UiAction
            variant="quiet"
            leftSection={<RefreshCw className="h-3.5 w-3.5" />}
            onClick={() => reflectionsQuery.refetch()}
          >
            Refresh
          </UiAction>
        </Tooltip>
      }
    >
      <SettingsSection
        title="Reflection Promotion Queue"
        description="Approve, merge, reject, or delete captured reflection candidates."
      >
        <Stack gap="lg">
          <Group gap="xs">
            <UiPill kind="status" tone="warning">
              {pendingCount} pending
            </UiPill>
            <UiPill
              kind="status"
              tone={semanticToneForLegacyColor(duplicateGroups.length > 0 ? 'orange' : 'gray')}
            >
              {duplicateGroups.length} duplicate groups
            </UiPill>
            <UiPill kind="count">{candidates.length} loaded</UiPill>
          </Group>

          <Stack gap="sm">
            {candidates.length === 0 ? (
              <SettingsGroup empty className="text-center">
                <Text size="sm" c="dimmed">
                  No reflection candidates are waiting for review.
                </Text>
              </SettingsGroup>
            ) : (
              candidates.map((candidate) => (
                <ReflectionCandidateItem
                  key={candidate.id}
                  candidate={candidate}
                  canWrite={canWrite}
                  onAccept={() =>
                    runAction(() => accept.mutateAsync(candidate), 'Reflection accepted')
                  }
                  onReject={() =>
                    runAction(() => reject.mutateAsync(candidate), 'Reflection rejected')
                  }
                  onMerge={() => runAction(() => merge.mutateAsync(candidate), 'Duplicate merged')}
                  onDelete={() =>
                    runAction(() => remove.mutateAsync(candidate), 'Reflection deleted')
                  }
                  busy={accept.isPending || reject.isPending || merge.isPending || remove.isPending}
                />
              ))
            )}
          </Stack>
        </Stack>
      </SettingsSection>
    </SettingsPage>
  );
}

function ReflectionCandidateItem({
  candidate,
  canWrite,
  onAccept,
  onReject,
  onMerge,
  onDelete,
  busy,
}: {
  candidate: ReflectionCandidate;
  canWrite: boolean;
  onAccept: () => void;
  onReject: () => void;
  onMerge: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const canReview = canWrite && candidate.status === 'pending';
  const requiresTypedPromotion =
    candidate.status === 'pending' && candidate.promotionTarget !== 'task-lesson';
  const canAcceptHere = canReview && !requiresTypedPromotion;
  const isMergeable = canReview && candidate.duplicateCount > 1 && !!candidate.duplicateOf;

  return (
    <SettingsGroup>
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start" gap="md">
          <Stack gap={4} className="min-w-0 flex-1">
            <Group gap="xs">
              <Text size="sm" fw={600} lineClamp={2}>
                {candidate.summary}
              </Text>
              <UiPill
                kind="status"
                tone={semanticToneForLegacyColor(statusColor(candidate.status))}
              >
                {candidate.status}
              </UiPill>
              <UiPill>{candidate.category}</UiPill>
              {candidate.duplicateCount > 1 && (
                <UiPill kind="status" tone="warning">
                  {candidate.duplicateCount} duplicates
                </UiPill>
              )}
            </Group>
            <Text size="xs" c="dimmed">
              {candidate.source.kind} · {sourceLabel(candidate)}
            </Text>
          </Stack>
          <Group gap="xs">
            <UiAction
              variant="secondary"
              disabled={!canAcceptHere || busy}
              title={
                requiresTypedPromotion
                  ? 'This target requires explicit typed review input through the API.'
                  : undefined
              }
              leftSection={<CheckCircle2 className="h-3.5 w-3.5" />}
              onClick={onAccept}
            >
              {requiresTypedPromotion ? 'Typed review' : 'Accept'}
            </UiAction>
            <UiAction
              variant="quiet"
              disabled={!isMergeable || busy}
              leftSection={<GitMerge className="h-3.5 w-3.5" />}
              onClick={onMerge}
            >
              Merge
            </UiAction>
            <UiAction
              variant="destructive"
              disabled={!canReview || busy}
              leftSection={<XCircle className="h-3.5 w-3.5" />}
              onClick={onReject}
            >
              Reject
            </UiAction>
            <UiAction
              variant="destructive"
              disabled={!canWrite || candidate.status === 'deleted' || busy}
              leftSection={<Trash2 className="h-3.5 w-3.5" />}
              onClick={onDelete}
            >
              Delete
            </UiAction>
          </Group>
        </Group>

        <Stack gap={4}>
          <Meta label="Previous" value={candidate.previousApproach} />
          <Meta label="Correction" value={candidate.correction} />
          <Meta label="Next" value={candidate.nextAttempt} />
          <Meta label="Target" value={promotionLabel(candidate.promotionTarget)} />
          {requiresTypedPromotion && (
            <Text size="xs" c="blue">
              Wider promotion requires explicit typed target input and a reviewer.
            </Text>
          )}
        </Stack>

        {candidate.evidence.length > 0 && (
          <Stack gap={4}>
            <Text size="xs" fw={600} c="dimmed">
              Evidence
            </Text>
            {candidate.evidence.map((item, index) => (
              <Text key={`${candidate.id}-evidence-${index}`} size="xs" c="dimmed" lineClamp={3}>
                {item.title}: {item.content}
              </Text>
            ))}
          </Stack>
        )}

        {candidate.appliedTargets.length > 0 && (
          <Stack gap={4}>
            <Text size="xs" fw={600} c="dimmed">
              Applied targets
            </Text>
            {candidate.appliedTargets.map((target) => (
              <Text key={`${target.kind}-${target.id ?? target.title}`} size="xs" c="dimmed">
                {promotionLabel(target.kind === 'manual-review' ? 'memory' : target.kind)}
                {target.title ? ` · ${target.title}` : ''}
              </Text>
            ))}
          </Stack>
        )}

        {candidate.redaction.redacted && (
          <Text size="xs" c="orange">
            Redacted: {candidate.redaction.notes.join(', ')}
          </Text>
        )}
      </Stack>
    </SettingsGroup>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <Text size="xs" c="dimmed" lineClamp={2}>
      <span className="font-medium text-foreground">{label}:</span> {value}
    </Text>
  );
}
