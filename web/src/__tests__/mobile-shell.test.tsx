import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { MobileShell } from '@/components/layout/MobileShell';
import { ViewProvider } from '@/contexts/ViewContext';
import { renderWithProviders } from './test-utils';

const mocks = vi.hoisted(() => ({
  identity: {
    authContext: {
      authMethod: 'device-session',
      clientMode: 'mobile-pwa',
      isLocalhost: false,
      permissions: ['workspace:read', 'task:read', 'comment:write'],
      role: 'read-only',
    },
    hasPermission: vi.fn((permission: string) => permission === 'settings:read'),
  },
}));

vi.mock('@/hooks/useIdentity', () => ({
  useIdentity: () => mocks.identity,
}));

vi.mock('@/components/dashboard/NeedsAttentionQueue', () => ({
  NeedsAttentionQueue: ({ onOpenTask }: { onOpenTask?: (taskId: string) => void }) => (
    <button type="button" onClick={() => onOpenTask?.('task-mobile')}>
      Open mobile approval
    </button>
  ),
}));

function renderMobileShell() {
  return renderWithProviders(
    <ViewProvider>
      <MobileShell />
    </ViewProvider>
  );
}

describe('mobile shell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    cleanup();
  });

  it('renders mobile navigation with inbox, runs, work products, and settings-lite actions', async () => {
    const user = userEvent.setup();
    const settingsListener = vi.fn();
    const searchListener = vi.fn();
    window.addEventListener('veritas:open-settings', settingsListener);
    window.addEventListener('veritas:open-search', searchListener);

    renderMobileShell();

    expect(screen.getByRole('navigation', { name: 'Mobile navigation' })).toBeDefined();
    expect(screen.getByText('mobile-pwa')).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Mobile notifications' }));
    expect(await screen.findByText('Open mobile approval')).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Mobile runs' }));
    expect(window.location.pathname).toBe('/workflows');

    await user.click(screen.getByRole('button', { name: 'Mobile work' }));
    expect(searchListener).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { collections: ['work-products'] },
      })
    );

    await user.click(screen.getByRole('button', { name: 'Mobile settings' }));
    expect(settingsListener).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { section: 'general' },
      })
    );

    window.removeEventListener('veritas:open-settings', settingsListener);
    window.removeEventListener('veritas:open-search', searchListener);
  });
});
