import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { DEFAULT_FEATURE_SETTINGS, type FeatureSettings } from '@veritas-kanban/shared';
const mocks = vi.hoisted(() => ({ update: vi.fn(), get: vi.fn(), toast: vi.fn() }));
vi.mock('@/lib/api', () => ({
  settings: {},
  api: { settings: { updateFeatures: mocks.update, getFeatures: mocks.get } },
}));
vi.mock('@/hooks/useToast', () => ({ toast: mocks.toast }));
import {
  useDebouncedFeatureUpdate,
  useFeatureSettings,
  useUpdateFeatureSettings,
} from '@/hooks/useFeatureSettings';
import {
  resetFeatureSettingsWrites,
  FEATURE_SETTINGS_QUERY_KEY,
} from '@/lib/feature-settings-writes';

describe('feature settings write ownership', () => {
  let client: QueryClient;
  let stored: FeatureSettings;
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  async function advance() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
  }
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.toast.mockReturnValue({ dismiss: vi.fn() });
    client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
    });
    stored = structuredClone(DEFAULT_FEATURE_SETTINGS);
    client.setQueryData(FEATURE_SETTINGS_QUERY_KEY, stored);
    mocks.get.mockImplementation(async () => stored);
    mocks.update.mockImplementation(async (patch: Record<string, object>) => {
      for (const [section, values] of Object.entries(patch)) {
        const data = stored as unknown as Record<string, object>;
        data[section] = { ...data[section], ...values };
      }
      return structuredClone(stored);
    });
  });
  afterEach(() => {
    cleanup();
    client.clear();
    vi.useRealTimers();
  });

  it('persists a pending edit after immediate tab or Settings unmount', async () => {
    const hook = renderHook(() => useDebouncedFeatureUpdate(), { wrapper });
    act(() =>
      hook.result.current.debouncedUpdate({ general: { humanDisplayName: 'Retained name' } })
    );
    hook.unmount();
    await advance();
    expect(stored.general.humanDisplayName).toBe('Retained name');
    const reopened = renderHook(() => useFeatureSettings(), { wrapper });
    expect(reopened.result.current.settings.general.humanDisplayName).toBe('Retained name');
  });

  it('batches sections without dropping unrelated settings', async () => {
    const original = structuredClone(stored);
    const hook = renderHook(
      () => ({ first: useDebouncedFeatureUpdate(), second: useDebouncedFeatureUpdate() }),
      { wrapper }
    );
    act(() => {
      hook.result.current.first.debouncedUpdate({ general: { humanDisplayName: 'Changed' } });
      hook.result.current.second.debouncedUpdate({ board: { showDashboard: false } });
    });
    await advance();
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(stored.general.humanDisplayName).toBe('Changed');
    expect(stored.board.showDashboard).toBe(false);
    expect(stored.tasks).toEqual(original.tasks);
  });

  it('serializes writes and overlays newer edits on earlier responses', async () => {
    let finish!: (settings: FeatureSettings) => void;
    mocks.update.mockImplementationOnce(
      () =>
        new Promise<FeatureSettings>((resolve) => {
          finish = resolve;
        })
    );
    const hook = renderHook(() => useDebouncedFeatureUpdate(), { wrapper });
    act(() => hook.result.current.debouncedUpdate({ general: { humanDisplayName: 'First' } }));
    await advance();
    act(() => hook.result.current.debouncedUpdate({ general: { humanDisplayName: 'Latest' } }));
    await advance();
    expect(mocks.update).toHaveBeenCalledOnce();
    await act(async () => {
      finish({ ...stored, general: { ...stored.general, humanDisplayName: 'First' } });
      await Promise.resolve();
    });
    expect(
      client.getQueryData<FeatureSettings>(FEATURE_SETTINGS_QUERY_KEY)?.general.humanDisplayName
    ).toBe('Latest');
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(stored.general.humanDisplayName).toBe('Latest');
  });

  it('retains rejected edits across unmount and exposes explicit retry', async () => {
    mocks.update.mockRejectedValueOnce(new Error('Offline'));
    const hook = renderHook(() => useDebouncedFeatureUpdate(), { wrapper });
    act(() => hook.result.current.debouncedUpdate({ general: { humanDisplayName: 'Retry me' } }));
    await advance();
    expect(hook.result.current.error?.message).toBe('Offline');
    expect(hook.result.current.isPending).toBe(false);
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Settings could not be saved' })
    );
    hook.unmount();
    await advance();
    expect(mocks.update).toHaveBeenCalledOnce();
    const reopened = renderHook(() => useDebouncedFeatureUpdate(), { wrapper });
    expect(reopened.result.current.error?.message).toBe('Offline');
    await act(async () => {
      reopened.result.current.retry();
    });
    expect(stored.general.humanDisplayName).toBe('Retry me');
    expect(reopened.result.current.error).toBeNull();
  });

  it('does not carry queued edits into another authenticated session', async () => {
    const hook = renderHook(() => useDebouncedFeatureUpdate(), { wrapper });
    act(() =>
      hook.result.current.debouncedUpdate({ general: { humanDisplayName: 'Old session' } })
    );
    hook.unmount();
    resetFeatureSettingsWrites(client);
    await advance();
    expect(mocks.update).not.toHaveBeenCalled();
    const next = renderHook(() => useDebouncedFeatureUpdate(), { wrapper });
    expect(next.result.current.isPending).toBe(false);
    expect(client.getQueryData(FEATURE_SETTINGS_QUERY_KEY)).toBeUndefined();
  });

  it('shares serialization with immediate setting mutations', async () => {
    const hook = renderHook(
      () => ({ queued: useDebouncedFeatureUpdate(), immediate: useUpdateFeatureSettings() }),
      { wrapper }
    );
    act(() =>
      hook.result.current.queued.debouncedUpdate({ general: { humanDisplayName: 'Queued' } })
    );
    act(() => hook.result.current.immediate.mutate({ board: { showDashboard: false } }));
    await advance();
    expect(stored.general.humanDisplayName).toBe('Queued');
    expect(stored.board.showDashboard).toBe(false);
    expect(mocks.update).toHaveBeenCalledOnce();
  });
});
