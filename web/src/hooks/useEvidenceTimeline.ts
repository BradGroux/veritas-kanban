import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { EvidenceTimelineFilters } from '@/lib/api';

export function normalizeEvidenceTimelineFilters(
  filters: EvidenceTimelineFilters
): EvidenceTimelineFilters {
  const next: EvidenceTimelineFilters = {};
  if (filters.taskId?.trim()) next.taskId = filters.taskId.trim();
  if (filters.project?.trim()) next.project = filters.project.trim();
  if (filters.repo?.trim()) next.repo = filters.repo.trim();
  if (filters.cwd?.trim()) next.cwd = filters.cwd.trim();
  if (filters.from?.trim()) next.from = filters.from.trim();
  if (filters.to?.trim()) next.to = filters.to.trim();
  if (filters.type) next.type = filters.type;
  if (filters.source) next.source = filters.source;
  if (filters.actor?.trim()) next.actor = filters.actor.trim();
  if (typeof filters.page === 'number') next.page = filters.page;
  if (typeof filters.limit === 'number') next.limit = filters.limit;
  return next;
}

export function useEvidenceTimeline(filters: EvidenceTimelineFilters) {
  const normalized = normalizeEvidenceTimelineFilters(filters);

  return useQuery({
    queryKey: ['evidence-timeline', normalized],
    queryFn: () => api.evidence.timeline(normalized),
    placeholderData: (previousData) => previousData,
    staleTime: 30_000,
  });
}
