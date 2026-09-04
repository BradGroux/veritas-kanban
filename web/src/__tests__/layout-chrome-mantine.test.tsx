import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ViewProvider } from '@/contexts/ViewContext';
import { KeyboardProvider } from '@/hooks/useKeyboard';
import { Header } from '@/components/layout/Header';
import { DesktopBottomPanel } from '@/components/layout/DesktopBottomPanel';
import { DesktopLeftSidebar } from '@/components/layout/DesktopLeftSidebar';
import { DesktopShellProvider } from '@/components/layout/DesktopShellContext';
import { UserMenu } from '@/components/layout/UserMenu';
import { WorkspaceSwitcher } from '@/components/layout/WorkspaceSwitcher';
import { WebSocketIndicator } from '@/components/shared/WebSocketIndicator';
import { renderWithProviders } from './test-utils';

const mocks = vi.hoisted(() => {
  const workspaces = [
    {
      workspace: {
        id: 'workspace-a',
        slug: 'veritas',
        name: 'Veritas',
        description: null,
        mode: 'local',
        createdBy: 'user-1',
        archivedAt: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      membership: {
        workspaceId: 'workspace-a',
        userId: 'user-1',
        role: 'owner' as const,
        status: 'active',
        invitedBy: null,
        joinedAt: '2026-01-01T00:00:00Z',
        disabledAt: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    },
    {
      workspace: {
        id: 'workspace-b',
        slug: 'ops',
        name: 'Operations',
        description: null,
        mode: 'local',
        createdBy: 'user-1',
        archivedAt: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      membership: {
        workspaceId: 'workspace-b',
        userId: 'user-1',
        role: 'admin' as const,
        status: 'active',
        invitedBy: null,
        joinedAt: '2026-01-01T00:00:00Z',
        disabledAt: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    },
  ];

  return {
    identity: {
      authContext: {
        authMethod: 'password',
        keyName: 'Local key',
        permissions: ['*'],
        role: 'owner',
        tokenName: 'Desktop session',
      },
      profile: {
        user: {
          id: 'user-1',
          displayName: 'Brad Groux',
          email: 'brad@example.com',
          handle: 'brad',
          authSubject: null,
          avatarUrl: null,
          disabledAt: null,
          lastSeenAt: null,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        workspaces,
      },
      workspaces,
      activeWorkspace: workspaces[0].workspace,
      activeMembership: workspaces[0].membership,
      activeWorkspaceId: 'workspace-a',
      isLoading: false,
      error: null,
      canManageMembers: true,
      hasPermission: vi.fn(() => true),
      switchWorkspace: vi.fn(),
    },
    logout: vi.fn(),
    setTheme: vi.fn(),
  };
});

vi.mock('@/hooks/useIdentity', () => ({
  useIdentity: () => mocks.identity,
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    status: {
      authenticated: true,
      sessionExpiry: '2030-01-01T00:00:00Z',
    },
    logout: mocks.logout,
  }),
}));

vi.mock('@/hooks/useBacklog', () => ({
  useBacklogCount: () => ({ data: 7 }),
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: 'dark',
    setTheme: mocks.setTheme,
  }),
}));

function renderHeaderChrome() {
  return renderWithProviders(
    <KeyboardProvider>
      <ViewProvider>
        <Header />
      </ViewProvider>
    </KeyboardProvider>
  );
}

function renderDesktopHeaderChrome(options: { withBottomPanel?: boolean } = {}) {
  Object.defineProperty(window, 'veritasDesktop', {
    configurable: true,
    value: {
      toggleWindowMaximize: vi.fn(),
    },
  });
  document.documentElement.dataset.client = 'desktop';

  return renderWithProviders(
    <KeyboardProvider>
      <ViewProvider>
        <DesktopShellProvider>
          <Header />
          {options.withBottomPanel && <DesktopBottomPanel />}
        </DesktopShellProvider>
      </ViewProvider>
    </KeyboardProvider>
  );
}

describe('layout chrome Mantine migration', () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        get length() {
          return storage.size;
        },
        clear: () => storage.clear(),
        getItem: (key: string) => storage.get(key) ?? null,
        key: (index: number) => Array.from(storage.keys())[index] ?? null,
        removeItem: (key: string) => storage.delete(key),
        setItem: (key: string, value: string) => storage.set(key, value),
      } satisfies Storage,
    });
    vi.clearAllMocks();
    window.localStorage.clear();
    window.history.replaceState({}, '', '/');
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1360 });
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollTo = vi.fn();
  });

  afterEach(() => {
    cleanup();
    delete (window as Window & { veritasDesktop?: unknown }).veritasDesktop;
    delete document.documentElement.dataset.client;
  });

  it('renders the header actions, workspace switcher, and user menu through direct Mantine controls', () => {
    const { container } = renderHeaderChrome();

    expect(screen.getByRole('banner')).toBeDefined();
    expect(screen.getByRole('toolbar', { name: 'Board actions' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'New Task' })).toBeDefined();
    expect(screen.getByRole('combobox', { name: 'Workspace' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Search' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Command palette' })).toBeDefined();
    expect(container.querySelector('.mantine-Select-root')).toBeDefined();
    expect(container.querySelectorAll('.mantine-ActionIcon-root').length).toBeGreaterThanOrEqual(6);
    expect(container.querySelectorAll('.mantine-Button-root').length).toBeGreaterThanOrEqual(3);
    expect(container.querySelectorAll('.mantine-Badge-root').length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector('[data-slot="button"]')).toBeNull();
    expect(container.querySelector('[data-slot="badge"]')).toBeNull();
    expect(container.querySelector('[data-slot="select-trigger"]')).toBeNull();
  });

  it('keeps workspace switching wired while rendering a direct Mantine Select', async () => {
    const user = userEvent.setup();
    const { baseElement, container } = renderWithProviders(<WorkspaceSwitcher />);

    expect(screen.getByRole('combobox', { name: 'Workspace' })).toBeDefined();
    expect(container.querySelector('.mantine-Select-root')).toBeDefined();
    expect(container.querySelector('[data-slot="select-trigger"]')).toBeNull();
    expect(container.querySelector('[data-slot="badge"]')).toBeNull();

    await user.click(screen.getByRole('combobox', { name: 'Workspace' }));
    await user.click(await screen.findByText('Operations'));

    await waitFor(() => expect(mocks.identity.switchWorkspace).toHaveBeenCalledWith('workspace-b'));
    expect(baseElement.querySelector('.mantine-Combobox-dropdown')).toBeDefined();
  });

  it('renders the session popover with direct Mantine popover, badge, and key controls', async () => {
    const user = userEvent.setup();
    const onOpenSecuritySettings = vi.fn();
    const onOpenIdentitySettings = vi.fn();
    const { baseElement } = renderWithProviders(
      <UserMenu
        onOpenSecuritySettings={onOpenSecuritySettings}
        onOpenIdentitySettings={onOpenIdentitySettings}
      />
    );

    await user.click(screen.getByTitle('Session menu'));

    expect(screen.getByText('Members & Permissions')).toBeDefined();
    expect(screen.getByText('Security Settings')).toBeDefined();
    expect(screen.getByText('Log Out')).toBeDefined();
    expect(baseElement.querySelector('.mantine-Popover-dropdown')).toBeDefined();
    expect(baseElement.querySelectorAll('.mantine-Badge-root').length).toBeGreaterThanOrEqual(2);
    expect(baseElement.querySelector('.mantine-Kbd-root')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="popover-content"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="button"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="badge"]')).toBeNull();

    await user.click(screen.getByText('Members & Permissions'));

    expect(onOpenIdentitySettings).toHaveBeenCalledOnce();
  });

  it('renders an icon-only session target for compact headers', () => {
    const { container } = renderWithProviders(<UserMenu compact />);

    const sessionMenu = screen.getByRole('button', { name: 'Session menu' });
    expect(sessionMenu.className).toContain('mantine-ActionIcon-root');
    expect(container.querySelector('.mantine-Button-root')).toBeNull();
  });

  it.each([false, true])(
    'dismisses Session menu with Escape from its trigger (compact=%s)',
    async (compact) => {
      const user = userEvent.setup();
      renderWithProviders(<UserMenu compact={compact} />);
      const trigger = screen.getByRole('button', { name: 'Session menu' });
      await user.click(trigger);
      expect(screen.getByRole('dialog')).toBeDefined();
      expect(document.activeElement).toBe(trigger);
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(document.activeElement).toBe(trigger);
    }
  );

  it('returns focus on content Escape without stealing focus on click-away or action handoff', async () => {
    const user = userEvent.setup();
    const onOpenSecuritySettings = vi.fn();
    const onOpenIdentitySettings = vi.fn();
    renderWithProviders(
      <>
        <button>Outside</button>
        <UserMenu
          onOpenSecuritySettings={onOpenSecuritySettings}
          onOpenIdentitySettings={onOpenIdentitySettings}
        />
      </>
    );
    const trigger = screen.getByRole('button', { name: 'Session menu' });
    await user.click(trigger);
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Members & Permissions' })
    );
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);

    await user.click(trigger);
    await user.click(trigger);
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Outside' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Outside' }));

    for (const [name, callback] of [
      ['Security Settings', onOpenSecuritySettings],
      ['Members & Permissions', onOpenIdentitySettings],
    ] as const) {
      await user.click(trigger);
      await user.click(screen.getByRole('button', { name }));
      expect(callback).toHaveBeenCalledOnce();
      expect(screen.queryByRole('dialog')).toBeNull();
    }
  });

  it('lets nested content consume Escape before dismissing the Session menu', async () => {
    const user = userEvent.setup();
    renderWithProviders(<UserMenu />);
    await user.click(screen.getByRole('button', { name: 'Session menu' }));
    const item = screen.getByRole('button', { name: 'Members & Permissions' });
    item.addEventListener('keydown', (event) => event.preventDefault(), { once: true });
    item.focus();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(document.activeElement).toBe(item);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('renders WebSocket status with a direct Mantine popover', async () => {
    const user = userEvent.setup();
    const { baseElement } = renderWithProviders(<WebSocketIndicator />);

    await user.click(screen.getByRole('button', { name: 'WebSocket connected' }));

    expect(screen.getByText('Real-time sync active')).toBeDefined();
    expect(baseElement.querySelector('.mantine-Popover-dropdown')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="popover-content"]')).toBeNull();
  });

  it('renders route-valid desktop shell controls and distinct chat actions', () => {
    const { container } = renderDesktopHeaderChrome();

    const leftRail = screen.getByRole('button', { name: 'Collapse left sidebar' });
    const rightRail = screen.getByRole('button', { name: 'Expand right sidebar' });
    const boardChat = screen.getByRole('button', { name: 'Open Board Chat' });
    const squadChat = screen.getByRole('button', { name: 'Open Squad Chat' });

    expect(leftRail.getAttribute('aria-controls')).toBe('desktop-navigation-sidebar');
    expect(leftRail.getAttribute('aria-expanded')).toBe('true');
    expect(rightRail.getAttribute('aria-controls')).toBe('board-right-sidebar');
    expect(rightRail.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Open chat dock' })).toBeNull();
    expect(boardChat.querySelector('.lucide-message-square')).toBeDefined();
    expect(squadChat.querySelector('.lucide-users')).toBeDefined();
    expect(container.querySelectorAll('.lucide-panel-right')).toHaveLength(1);
    expect(screen.getByRole('group', { name: 'Desktop layout controls' })).toBeDefined();
    expect(screen.getByRole('group', { name: 'Chat controls' })).toBeDefined();

    const brandIcon = screen
      .getByRole('button', { name: 'Refresh page' })
      .querySelector('img[src="/icons/pwa-icon-192.png"]');
    expect(brandIcon).toBeDefined();
    expect(document.querySelector('header h1')).toBeNull();
  });

  it('does not render the board right-rail action on routes without that rail', () => {
    window.history.replaceState({}, '', '/activity');
    const { container } = renderDesktopHeaderChrome();

    expect(screen.getByRole('button', { name: 'Collapse left sidebar' })).toBeDefined();
    expect(screen.queryByRole('button', { name: /right sidebar/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open chat dock' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open Board Chat' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Open Squad Chat' })).toBeDefined();
    expect(container.querySelector('.lucide-panel-right')).toBeNull();
    expect(container.querySelector('.lucide-panel-right-close')).toBeNull();
  });

  it('uses the filled brand treatment with white text for the active desktop navigation item', () => {
    Object.defineProperty(window, 'veritasDesktop', {
      configurable: true,
      value: { toggleWindowMaximize: vi.fn() },
    });
    document.documentElement.dataset.client = 'desktop';
    window.history.replaceState({}, '', '/drift');

    renderWithProviders(
      <ViewProvider>
        <DesktopShellProvider>
          <DesktopLeftSidebar />
        </DesktopShellProvider>
      </ViewProvider>
    );

    const activeItem = screen.getByRole('button', { name: 'Drift Monitor' });
    expect(activeItem.getAttribute('aria-current')).toBe('page');
    expect(activeItem.className).toContain('bg-primary');
    expect(activeItem.className).toContain('text-white');
    expect(activeItem.className).not.toContain('bg-primary/15');
  });

  it('toggles and switches the header chat controls with the right dock', async () => {
    const user = userEvent.setup();
    renderDesktopHeaderChrome({ withBottomPanel: true });

    const openBoard = screen.getByRole('button', { name: 'Open Board Chat' });
    const openSquad = screen.getByRole('button', { name: 'Open Squad Chat' });
    expect(openBoard.getAttribute('aria-pressed')).toBe('false');
    expect(openSquad.getAttribute('aria-pressed')).toBe('false');

    await user.click(openBoard);
    const closeBoard = screen.getByRole('button', { name: 'Close Board Chat' });
    expect(closeBoard.getAttribute('aria-pressed')).toBe('true');
    expect(closeBoard.getAttribute('aria-controls')).toBe('workbench-right-dock');
    expect(closeBoard.querySelector('.lucide-message-square')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Switch to Squad Chat' })).toBeDefined();

    await user.click(closeBoard);
    expect(screen.getByRole('button', { name: 'Open Board Chat' })).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Open Board Chat' }));
    await user.click(screen.getByRole('button', { name: 'Switch to Squad Chat' }));
    const closeSquad = screen.getByRole('button', { name: 'Close Squad Chat' });
    expect(closeSquad.getAttribute('aria-pressed')).toBe('true');
    expect(closeSquad.getAttribute('aria-controls')).toBe('workbench-right-dock');
    expect(closeSquad.querySelector('.lucide-users')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Switch to Board Chat' })).toBeDefined();

    await user.click(closeSquad);
    await waitFor(() => {
      const board = screen.getByRole('button', { name: 'Open Board Chat' });
      const squad = screen.getByRole('button', { name: 'Open Squad Chat' });
      expect([board, squad]).toContain(document.activeElement);
    });

    await user.click(screen.getByRole('button', { name: 'Open Board Chat' }));
    const dock = screen.getByRole('region', { name: 'Workbench right dock' });
    expect(within(dock).queryByRole('radiogroup', { name: 'Dock position' })).toBeNull();
    await user.click(within(dock).getByRole('button', { name: 'Close Board Chat panel' }));
    expect(screen.getByRole('button', { name: 'Open Board Chat' })).toBeDefined();
  });
});
