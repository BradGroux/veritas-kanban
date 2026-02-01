import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import {
  api,
  type Activity,
  type ActivityType,
  type ActivityFilters,
  type ActivityFilterOptions,
} from '../lib/api';

export type { Activity, ActivityType, ActivityFilters, ActivityFilterOptions };

export function useActivities(limit: number = 50) {
  return useQuery({
    queryKey: ['activities', limit],
    queryFn: () => api.activity.list(limit),
    refetchInterval: 30000, // Refresh every 30s
  });
}

/**
 * Infinite-scroll activity feed with filters.
 * Each page fetches `pageSize` activities. The backend already returns newest-first.
 */
export function useActivityFeed(pageSize: number = 30, filters?: ActivityFilters) {
  return useInfiniteQuery<Activity[]>({
    queryKey: ['activity-feed', pageSize, filters],
    queryFn: ({ pageParam }) => {
      return api.activity.list(pageSize, filters, pageParam as number);
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      // If we got fewer items than pageSize, there are no more pages
      if (lastPage.length < pageSize) return undefined;
      return (lastPageParam as number) + 1;
    },
    refetchInterval: 30000,
  });
}

/**
 * Fetch available filter options (distinct agents and activity types).
 */
export function useActivityFilterOptions() {
  return useQuery<ActivityFilterOptions>({
    queryKey: ['activity-filter-options'],
    queryFn: () => api.activity.filters(),
    staleTime: 60000,
  });
}

export function useClearActivities() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.activity.clear(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activities'] });
      queryClient.invalidateQueries({ queryKey: ['activity-feed'] });
      queryClient.invalidateQueries({ queryKey: ['activity-filter-options'] });
    },
  });
}
