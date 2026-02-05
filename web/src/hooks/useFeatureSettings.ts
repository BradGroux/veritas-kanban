import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useEffect } from 'react';
import { api } from '@/lib/api';
import type { FeatureSettings } from '@veritas-kanban/shared';
import { DEFAULT_FEATURE_SETTINGS } from '@veritas-kanban/shared';

const QUERY_KEY = ['settings', 'features'] as const;
const STALE_TIME = 5 * 60 * 1000; // 5 minutes — settings don't change often

/**
 * Fetch the full FeatureSettings object.
 * Returns defaults while loading so consumers never see undefined.
 */
export function useFeatureSettings() {
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: api.settings.getFeatures,
    staleTime: STALE_TIME,
    placeholderData: DEFAULT_FEATURE_SETTINGS,
  });

  return {
    ...query,
    settings: query.data ?? DEFAULT_FEATURE_SETTINGS,
  };
}

/**
 * Convenience hook for reading a single nested feature setting.
 *
 * Usage:
 *   const showDashboard = useFeatureSetting('board', 'showDashboard');
 *   const density = useFeatureSetting('board', 'cardDensity');
 */
export function useFeatureSetting<
  S extends keyof FeatureSettings,
  K extends keyof FeatureSettings[S],
>(section: S, key: K): FeatureSettings[S][K] {
  const { settings } = useFeatureSettings();
  return settings[section][key];
}

/**
 * Mutation hook for updating feature settings with optimistic updates.
 *
 * Usage:
 *   const update = useUpdateFeatureSettings();
 *   update.mutate({ board: { showDashboard: false } });
 */
export function useUpdateFeatureSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (patch: Record<string, any>) => api.settings.updateFeatures(patch),
    onMutate: async (patch) => {
      // Cancel in-flight fetches
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });

      // Snapshot current value
      const previous = queryClient.getQueryData<FeatureSettings>(QUERY_KEY);

      // Optimistically update
      if (previous) {
        // SAFETY: FeatureSettings sections are all objects — use Record view for dynamic key access
        const optimistic = { ...previous } as unknown as Record<string, Record<string, unknown>>;
        for (const section of Object.keys(patch) as Array<keyof FeatureSettings>) {
          if (section in optimistic && typeof patch[section] === 'object') {
            optimistic[section] = {
              ...optimistic[section],
              ...patch[section],
            };
          }
        }
        queryClient.setQueryData(QUERY_KEY, optimistic as unknown as FeatureSettings);
      }

      return { previous };
    },
    onError: (_err, _patch, context) => {
      // Rollback on error
      if (context?.previous) {
        queryClient.setQueryData(QUERY_KEY, context.previous);
      }
    },
    onSettled: () => {
      // Refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}

/**
 * Returns a debounced updater function that batches rapid changes.
 * Useful for toggle switches and sliders that fire frequently.
 */
export function useDebouncedFeatureUpdate(delayMs = 500) {
  const update = useUpdateFeatureSettings();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<Record<string, any>>({});

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const flush = useCallback(() => {
    if (Object.keys(pendingRef.current).length > 0) {
      update.mutate({ ...pendingRef.current });
      pendingRef.current = {};
    }
  }, [update]);

  const debouncedUpdate = useCallback(
    (patch: Record<string, any>) => {
      // Merge into pending batch
      for (const section of Object.keys(patch)) {
        pendingRef.current[section] = {
          ...(pendingRef.current[section] || {}),
          ...patch[section],
        };
      }

      // Reset timer
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(flush, delayMs);
    },
    [flush, delayMs]
  );

  return { debouncedUpdate, isPending: update.isPending };
}
