import type { QueryClient } from '@tanstack/react-query';
import { DEFAULT_FEATURE_SETTINGS, type FeatureSettings } from '@veritas-kanban/shared';
import { api } from '@/lib/api';

export const FEATURE_SETTINGS_QUERY_KEY = ['settings', 'features'] as const;
export type FeatureSettingsPatch = Record<string, unknown>;

function mergePatch(base: FeatureSettingsPatch, patch: FeatureSettingsPatch): FeatureSettingsPatch {
  const merged = { ...base };
  for (const [section, values] of Object.entries(patch)) {
    const previous = merged[section];
    merged[section] =
      values !== null && typeof values === 'object' && !Array.isArray(values)
        ? { ...(previous !== null && typeof previous === 'object' ? previous : {}), ...values }
        : values;
  }
  return merged;
}

function overlay(settings: FeatureSettings, patch: FeatureSettingsPatch): FeatureSettings {
  return mergePatch(
    settings as unknown as FeatureSettingsPatch,
    patch
  ) as unknown as FeatureSettings;
}

/** One serialized writer per query cache; tab unmounts do not own pending work. */
class FeatureSettingsWrites {
  private pending: FeatureSettingsPatch = {};
  private settleWaiters: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
  private disposed = false;
  private activeWaiters: Array<{
    resolve: (settings: FeatureSettings) => void;
    reject: (error: Error) => void;
  }> = [];
  private active: FeatureSettingsPatch | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<() => void>();
  private waiters: Array<{
    resolve: (settings: FeatureSettings) => void;
    reject: (error: Error) => void;
  }> = [];
  private snapshot = { isPending: false, error: null as Error | null };
  onFailure: ((error: Error) => () => void) | undefined;
  private dismissFailure: (() => void) | undefined;

  constructor(private client: QueryClient) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;
  overlay = (settings: FeatureSettings) =>
    overlay(overlay(settings, this.active ?? {}), this.pending);

  private publish(error: Error | null = null) {
    this.snapshot = {
      isPending: !error && (this.active !== null || Object.keys(this.pending).length > 0),
      error,
    };
    this.listeners.forEach((listener) => listener());
  }

  enqueue = (patch: FeatureSettingsPatch, delay: number) => {
    if (this.disposed) throw new Error('The settings session has ended');
    for (const [section, values] of Object.entries(patch)) {
      if (!values || typeof values !== 'object' || Array.isArray(values)) {
        throw new Error(`Settings section ${section} must be an object`);
      }
    }
    this.pending = mergePatch(this.pending, patch);
    // Do not let cancellation restore an older query snapshot over this edit.
    void this.client.cancelQueries({ queryKey: FEATURE_SETTINGS_QUERY_KEY }, { revert: false });
    this.client.setQueryData<FeatureSettings>(FEATURE_SETTINGS_QUERY_KEY, (current) =>
      overlay(current ?? DEFAULT_FEATURE_SETTINGS, patch)
    );
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush();
    }, delay);
    this.publish();
  };

  save = (patch: FeatureSettingsPatch): Promise<FeatureSettings> =>
    new Promise((resolve, reject) => {
      if (Object.keys(patch).length === 0) {
        resolve(
          this.client.getQueryData<FeatureSettings>(FEATURE_SETTINGS_QUERY_KEY) ??
            DEFAULT_FEATURE_SETTINGS
        );
        return;
      }
      this.enqueue(patch, 0);
      this.waiters.push({ resolve, reject });
    });

  retry = () => {
    this.publish();
    void this.flush();
  };

  /** Flush pending work before a native window session ends; failures require explicit retry. */
  settle = (): Promise<void> => {
    if (this.disposed) return Promise.reject(new Error('The settings session has ended'));
    if (this.snapshot.error) return Promise.reject(this.snapshot.error);
    if (!this.active && Object.keys(this.pending).length === 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.settleWaiters.push({ resolve, reject });
      void this.flush();
    });
  };

  dispose() {
    this.disposed = true;
    this.dismissFailure?.();
    if (this.timer) clearTimeout(this.timer);
    const error = new Error('The settings session has ended');
    this.settleWaiters.splice(0).forEach((waiter) => waiter.reject(error));
    [...this.waiters, ...this.activeWaiters].forEach(({ reject }) => reject(error));
    this.waiters = [];
    this.activeWaiters = [];
    this.pending = {};
    this.active = null;
  }

  private async flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.active || Object.keys(this.pending).length === 0) return;
    const batch = this.pending;
    const waiters = this.waiters;
    this.activeWaiters = waiters;
    this.pending = {};
    this.waiters = [];
    this.active = batch;
    this.publish();
    try {
      const saved = await api.settings.updateFeatures(batch as Partial<FeatureSettings>);
      if (this.disposed) return;
      this.activeWaiters = [];
      this.active = null;
      this.dismissFailure?.();
      this.dismissFailure = undefined;
      this.client.setQueryData(FEATURE_SETTINGS_QUERY_KEY, overlay(saved, this.pending));
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('veritas:settings-saved'));
      waiters.forEach(({ resolve }) => resolve(saved));
      this.publish();
      if (Object.keys(this.pending).length === 0)
        this.settleWaiters.splice(0).forEach((waiter) => waiter.resolve());
      if (Object.keys(this.pending).length > 0 && (!this.timer || this.settleWaiters.length > 0))
        void this.flush();
    } catch (cause) {
      if (this.disposed) return;
      this.activeWaiters = [];
      const error = cause instanceof Error ? cause : new Error('Settings could not be saved');
      // Newer edits win over failed fields; retain both sections for explicit retry.
      this.pending = mergePatch(batch, this.pending);
      this.active = null;
      if (this.timer) clearTimeout(this.timer);
      this.timer = undefined;
      [...waiters, ...this.waiters].forEach(({ reject }) => reject(error));
      this.waiters = [];
      this.settleWaiters.splice(0).forEach((waiter) => waiter.reject(error));
      this.publish(error);
      this.dismissFailure?.();
      this.dismissFailure = this.onFailure?.(error);
    }
  }
}

const writers = new WeakMap<QueryClient, FeatureSettingsWrites>();
export function getFeatureSettingsWrites(client: QueryClient) {
  let writer = writers.get(client);
  if (!writer) {
    writer = new FeatureSettingsWrites(client);
    writers.set(client, writer);
  }
  return writer;
}

export function resetFeatureSettingsWrites(client: QueryClient) {
  writers.get(client)?.dispose();
  writers.delete(client);
  client.removeQueries({ queryKey: FEATURE_SETTINGS_QUERY_KEY });
}
