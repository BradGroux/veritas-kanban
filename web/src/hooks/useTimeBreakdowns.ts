import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { TimeBreakdownFilters } from '@/lib/api';

export function normalizeTimeBreakdownFilters(filters: TimeBreakdownFilters): TimeBreakdownFilters {
  const next: TimeBreakdownFilters = {};
  if (filters.preset) next.preset = filters.preset;
  if (filters.from?.trim()) next.from = filters.from.trim();
  if (filters.to?.trim()) next.to = filters.to.trim();
  if (filters.taskId?.trim()) next.taskId = filters.taskId.trim();
  if (filters.project?.trim()) next.project = filters.project.trim();
  if (filters.repo?.trim()) next.repo = filters.repo.trim();
  if (filters.cwd?.trim()) next.cwd = filters.cwd.trim();
  if (filters.actor?.trim()) next.actor = filters.actor.trim();
  if (typeof filters.includeInferred === 'boolean') next.includeInferred = filters.includeInferred;
  if (typeof filters.limit === 'number') next.limit = filters.limit;
  return next;
}

export function useTimeBreakdown(filters: TimeBreakdownFilters) {
  const normalized = normalizeTimeBreakdownFilters(filters);

  return useQuery({
    queryKey: ['time-breakdowns', normalized],
    queryFn: () => api.timeBreakdowns.generate(normalized),
    placeholderData: (previousData) => previousData,
    staleTime: 30_000,
  });
}
