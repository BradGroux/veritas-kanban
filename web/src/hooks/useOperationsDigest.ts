import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AgentOperationsDigestFilters, ScheduledDeliverableRunInput } from '@/lib/api';

export const OPERATIONS_DIGEST_DELIVERABLE_TAG = 'operations-digest';

export function normalizeOperationsDigestFilters(
  filters: AgentOperationsDigestFilters
): AgentOperationsDigestFilters {
  const next: AgentOperationsDigestFilters = {};
  if (typeof filters.hours === 'number') next.hours = filters.hours;
  if (filters.from?.trim()) next.from = filters.from.trim();
  if (filters.to?.trim()) next.to = filters.to.trim();
  if (filters.project?.trim()) next.project = filters.project.trim();
  if (filters.repo?.trim()) next.repo = filters.repo.trim();
  if (filters.cwd?.trim()) next.cwd = filters.cwd.trim();
  return next;
}

export function useOperationsDigest(filters: AgentOperationsDigestFilters) {
  const normalizedFilters = normalizeOperationsDigestFilters(filters);

  return useQuery({
    queryKey: ['operations-digest', normalizedFilters],
    queryFn: () => api.digest.operations(normalizedFilters),
    placeholderData: (previousData) => previousData,
    staleTime: 30_000,
  });
}

export function useOperationsDigestMarkdown(filters: AgentOperationsDigestFilters) {
  const normalizedFilters = normalizeOperationsDigestFilters(filters);

  return useQuery({
    queryKey: ['operations-digest-markdown', normalizedFilters],
    queryFn: () => api.digest.operationsMarkdown(normalizedFilters),
    placeholderData: (previousData) => previousData,
    staleTime: 30_000,
  });
}

export function useOperationsDigestSchedule() {
  return useQuery({
    queryKey: ['scheduled-deliverables', OPERATIONS_DIGEST_DELIVERABLE_TAG],
    queryFn: () =>
      api.scheduledDeliverables.list({
        tag: OPERATIONS_DIGEST_DELIVERABLE_TAG,
      }),
    staleTime: 30_000,
  });
}

export function useCreateOperationsDigestSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      api.scheduledDeliverables.create({
        name: 'Operations Digest',
        description: 'Daily deterministic agent operations digest for standups and briefings.',
        schedule: 'daily',
        scheduleDescription: 'Every day',
        agent: 'veritas',
        outputPath: 'operations/digests',
        tags: [OPERATIONS_DIGEST_DELIVERABLE_TAG, 'standup', 'briefing'],
        enabled: true,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['scheduled-deliverables', OPERATIONS_DIGEST_DELIVERABLE_TAG],
      });
    },
  });
}

export function useRecordOperationsDigestSnapshot() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      deliverableId,
      run,
    }: {
      deliverableId: string;
      run: ScheduledDeliverableRunInput;
    }) => api.scheduledDeliverables.recordRun(deliverableId, run),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['scheduled-deliverables', OPERATIONS_DIGEST_DELIVERABLE_TAG],
      });
    },
  });
}
