import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { desktopSettingsBridge } from '@/lib/desktop-settings';

export const SETTINGS_CHANGED_EVENT = 'veritas:settings-saved';

/** Only invalidation notices cross windows; each renderer refetches with its own authorization. */
export function useSettingsWindowSync() {
  const client = useQueryClient();
  useEffect(() => {
    if (!desktopSettingsBridge() || typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel('veritas-settings-invalidation-v1');
    const publish = () => channel.postMessage('invalidate');
    const unsubscribe = client.getMutationCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'success') publish();
    });
    window.addEventListener(SETTINGS_CHANGED_EVENT, publish);
    channel.onmessage = (event) => {
      if (event.data === 'invalidate') void client.invalidateQueries();
    };
    return () => {
      unsubscribe();
      window.removeEventListener(SETTINGS_CHANGED_EVENT, publish);
      channel.close();
    };
  }, [client]);
}

const AUTH_CHANGED_EVENT = 'veritas:desktop-auth-changed';
export function notifyDesktopAuthChange() {
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

/** Lives outside AuthGuard so another window can lock and later unlock this renderer. */
export function useDesktopAuthSync(refresh: () => Promise<void>) {
  useEffect(() => {
    if (!desktopSettingsBridge() || typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel('veritas-auth-invalidation-v1');
    const publish = () => channel.postMessage('refresh');
    channel.onmessage = (event) => {
      if (event.data === 'refresh') void refresh();
    };
    window.addEventListener(AUTH_CHANGED_EVENT, publish);
    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, publish);
      channel.close();
    };
  }, [refresh]);
}
