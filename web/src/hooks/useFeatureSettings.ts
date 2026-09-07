import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createElement, useCallback, useSyncExternalStore } from 'react';
import { toast } from './useToast';
import {
  FEATURE_SETTINGS_QUERY_KEY,
  getFeatureSettingsWrites,
  type FeatureSettingsPatch,
} from '@/lib/feature-settings-writes';
import { api } from '@/lib/api';
import type { FeatureSettings } from '@veritas-kanban/shared';
import { DEFAULT_FEATURE_SETTINGS } from '@veritas-kanban/shared';

const QUERY_KEY = FEATURE_SETTINGS_QUERY_KEY;
const STALE_TIME = 5 * 60 * 1000; // 5 minutes — settings don't change often

/**
 * Fetch the full FeatureSettings object.
 * Returns defaults while loading so consumers never see undefined.
 */
export function useFeatureSettings() {
  const writer = getFeatureSettingsWrites(useQueryClient());
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => writer.overlay(await api.settings.getFeatures()),
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
  const writer = useFeatureWriter();
  return useMutation({ mutationFn: (patch: FeatureSettingsPatch) => writer.save(patch) });
}

function useFeatureWriter() {
  const writer = getFeatureSettingsWrites(useQueryClient());
  writer.onFailure = () => {
    return toast({
      title: 'Settings could not be saved',
      description: 'Your changes are kept for retry. They have not been saved to the server.',
      variant: 'destructive',
      duration: 10000,
      action: createElement(
        'button',
        {
          type: 'button',
          onClick: writer.retry,
          className: 'text-sm underline rounded focus-visible:outline focus-visible:outline-2',
        },
        'Retry settings save'
      ),
    }).dismiss;
  };
  return writer;
}

/** Batches edits across sections and retains failed writes until they are retried. */
export function useDebouncedFeatureUpdate(delayMs = 500) {
  const writer = useFeatureWriter();
  const state = useSyncExternalStore(writer.subscribe, writer.getSnapshot, writer.getSnapshot);
  const debouncedUpdate = useCallback(
    (patch: FeatureSettingsPatch) => {
      writer.enqueue(patch, delayMs);
    },
    [writer, delayMs]
  );
  return { debouncedUpdate, ...state, retry: writer.retry };
}
