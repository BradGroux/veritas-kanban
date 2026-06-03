import { useEffect } from 'react';
import { DEFAULT_FEATURE_SETTINGS } from '@veritas-kanban/shared';
import { useFeatureSettings, useUpdateFeatureSettings } from '@/hooks/useFeatureSettings';
import { clearPendingProductMode, readPendingProductMode } from '@/lib/product-modes';

export function usePendingProductMode(): void {
  const { settings, isLoading } = useFeatureSettings();
  const update = useUpdateFeatureSettings();
  const selectedMode =
    settings.productMode?.selectedMode ?? DEFAULT_FEATURE_SETTINGS.productMode.selectedMode;

  useEffect(() => {
    if (isLoading || update.isPending) return;
    const pendingMode = readPendingProductMode();
    if (!pendingMode) return;

    if (pendingMode === selectedMode) {
      clearPendingProductMode();
      return;
    }

    update.mutate(
      {
        productMode: {
          selectedMode: pendingMode,
          lastSelectedAt: new Date().toISOString(),
        },
      },
      {
        onSuccess: clearPendingProductMode,
      }
    );
  }, [isLoading, selectedMode, update]);
}
