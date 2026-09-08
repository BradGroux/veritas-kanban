import { cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  notifyDesktopAuthChange,
  SETTINGS_CHANGED_EVENT,
  useDesktopAuthSync,
  useSettingsWindowSync,
} from '@/hooks/useSettingsWindowSync';

const channels: FakeChannel[] = [];
class FakeChannel {
  onmessage?: (event: { data: unknown }) => void;
  postMessage = vi.fn((data: unknown) => {
    for (const other of channels)
      if (other !== this && other.name === this.name) other.onmessage?.({ data });
  });
  close = vi.fn();
  constructor(public name: string) {
    channels.push(this);
  }
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  channels.length = 0;
  delete (window as Window & { veritasDesktop?: unknown }).veritasDesktop;
});
describe('native window synchronization', () => {
  it('sends only invalidation notices and never treats a payload as authoritative cached settings', () => {
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    Object.assign(window, { veritasDesktop: {} });
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const hook = renderHook(() => useSettingsWindowSync(), { wrapper });
    const channel = channels[0];
    window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT));
    expect(channel.postMessage).toHaveBeenCalledWith('invalidate');
    channel.onmessage?.({ data: { settings: { untrusted: true } } });
    expect(invalidate).not.toHaveBeenCalled();
    channel.onmessage?.({ data: 'invalidate' });
    expect(invalidate).toHaveBeenCalledOnce();
    hook.unmount();
    expect(channel.close).toHaveBeenCalledOnce();
    client.clear();
  });
  it('keeps the auth refresh listener independent of the authenticated editing session', () => {
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    Object.assign(window, { veritasDesktop: {} });
    const refresh = vi.fn(async () => {});
    const hook = renderHook(() => useDesktopAuthSync(refresh));
    notifyDesktopAuthChange();
    expect(channels[0].postMessage).toHaveBeenCalledWith('refresh');
    channels[0].onmessage?.({ data: 'refresh' });
    expect(refresh).toHaveBeenCalledOnce();
    hook.unmount();
    expect(channels[0].close).toHaveBeenCalledOnce();
  });
});
