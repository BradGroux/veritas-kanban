import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PwaStatusBanner } from '@/components/layout/PwaStatusBanner';
import { renderWithProviders } from './test-utils';

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value,
  });
}

describe('PwaStatusBanner', () => {
  beforeEach(() => {
    setOnline(true);
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    setOnline(true);
  });

  it('shows a remote-safe offline warning', () => {
    setOnline(false);

    renderWithProviders(<PwaStatusBanner />);

    expect(screen.getByRole('status', { name: 'Offline' })).toBeDefined();
    expect(screen.getByText(/Cached shell only/)).toBeDefined();
    expect(screen.getByText(/Task data and changes require the trusted server/)).toBeDefined();
  });

  it('shows stale realtime state and lets the user retry reads', async () => {
    const user = userEvent.setup();
    const refreshAuth = vi.fn().mockResolvedValue(undefined);

    renderWithProviders(<PwaStatusBanner onRefreshAuth={refreshAuth} />, {
      wsStatus: {
        isConnected: false,
        connectionState: 'reconnecting',
        reconnectAttempt: 2,
      },
    });

    expect(screen.getByRole('status', { name: 'Reconnecting 2' })).toBeDefined();
    expect(screen.getByText(/Data may be stale/)).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refreshAuth).toHaveBeenCalled();
  });

  it('shows expired-session state without queuing failed writes', () => {
    renderWithProviders(<PwaStatusBanner sessionExpiry="2000-01-01T00:00:00.000Z" />);

    expect(screen.getByRole('status', { name: 'Session expired' })).toBeDefined();
    expect(screen.getByText(/Failed writes are not queued/)).toBeDefined();
  });

  it('offers install when the browser exposes a PWA install prompt', async () => {
    const user = userEvent.setup();
    const prompt = vi.fn().mockResolvedValue(undefined);
    const installEvent = new Event('beforeinstallprompt', { cancelable: true });
    Object.defineProperties(installEvent, {
      prompt: { value: prompt },
      userChoice: {
        value: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
      },
    });

    renderWithProviders(<PwaStatusBanner />);

    window.dispatchEvent(installEvent);
    await user.click(await screen.findByRole('button', { name: 'Install' }));

    expect(prompt).toHaveBeenCalled();
  });
});
