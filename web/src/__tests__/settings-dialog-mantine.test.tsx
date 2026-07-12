import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { SettingsDialog } from '@/components/settings/SettingsDialog';
import { renderWithProviders } from './test-utils';

const mocks = vi.hoisted(() => ({
  debouncedUpdate: vi.fn(),
  hasPermission: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/hooks/useFeatureSettings', () => ({
  useFeatureSettings: () => ({
    settings: {
      general: { humanDisplayName: 'Human' },
      board: {},
      tasks: {},
      agents: {},
      telemetry: {},
      notifications: {},
      markdown: {},
      docFreshness: {},
      archive: {},
      sharedResources: {},
    },
  }),
  useDebouncedFeatureUpdate: () => ({ debouncedUpdate: mocks.debouncedUpdate }),
}));

vi.mock('@/hooks/useIdentity', () => ({
  useIdentity: () => ({ hasPermission: mocks.hasPermission }),
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock('@/components/settings/tabs/GeneralTab', () => ({
  GeneralTab: () => <div>General settings loaded</div>,
}));

vi.mock('@/components/settings/tabs/BoardTab', () => ({
  BoardTab: () => <div>Board settings loaded</div>,
}));

vi.mock('@/components/settings/tabs/TasksTab', () => ({
  TasksTab: () => <div>Tasks settings loaded</div>,
}));

vi.mock('@/components/settings/tabs/AgentsTab', () => ({
  AgentsTab: () => <div>Agents settings loaded</div>,
}));

vi.mock('@/components/settings/tabs/DataTab', () => ({
  DataTab: () => <div>Data settings loaded</div>,
}));

vi.mock('@/components/settings/tabs/NotificationsTab', () => ({
  NotificationsTab: () => <div>Notifications settings loaded</div>,
}));

vi.mock('@/components/settings/tabs/ManageTab', () => ({
  ManageTab: () => <div>Manage settings loaded</div>,
}));

vi.mock('@/components/settings/tabs/SecurityTab', () => ({
  SecurityTab: () => <div>Security settings loaded</div>,
}));

vi.mock('@/components/settings/tabs/DelegationTab', () => ({
  DelegationTab: () => <div>Delegation settings loaded</div>,
}));

vi.mock('@/components/settings/tabs/ToolPoliciesTab', () => ({
  ToolPoliciesTab: () => <div>Tool policies settings loaded</div>,
}));

vi.mock('@/components/settings/tabs/EnforcementTab', () => ({
  EnforcementTab: () => <div>Enforcement settings loaded</div>,
}));

vi.mock('@/components/settings/tabs/ReflectionTab', () => ({
  ReflectionTab: () => <div>Reflection settings loaded</div>,
}));

vi.mock('@/components/settings/tabs/SharedResourcesTab', () => ({
  SharedResourcesTab: () => <div>Shared resources settings loaded</div>,
}));

vi.mock('@/components/settings/tabs/DocFreshnessTab', () => ({
  DocFreshnessTab: () => <div>Doc freshness settings loaded</div>,
}));

vi.mock('@/components/settings/tabs/MultiUserTab', () => ({
  MultiUserTab: () => <div>Multi-user settings loaded</div>,
}));

describe('SettingsDialog Mantine shell', () => {
  beforeEach(() => {
    mocks.hasPermission.mockReturnValue(true);
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the settings shell with direct Mantine controls', async () => {
    const { baseElement } = renderWithProviders(<SettingsDialog open onOpenChange={vi.fn()} />);

    expect(await screen.findByText('General settings loaded')).toBeDefined();
    expect(screen.getByRole('tab', { name: 'General' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getAllByLabelText('Select settings section').length).toBeGreaterThanOrEqual(1);
    expect(baseElement.querySelector('.mantine-Button-root')).toBeDefined();
    expect(baseElement.querySelector('.mantine-ScrollArea-root')).toBeDefined();
    expect(baseElement.querySelector('.mantine-Select-root')).toBeDefined();
  });

  it('switches tab content through the Mantine sidebar buttons', async () => {
    renderWithProviders(<SettingsDialog open onOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Board' }));

    expect(await screen.findByText('Board settings loaded')).toBeDefined();
    expect(screen.getByRole('tab', { name: 'Board' }).getAttribute('aria-selected')).toBe('true');
  });

  it('keeps compact section navigation in the mobile header flow', async () => {
    renderWithProviders(<SettingsDialog open onOpenChange={vi.fn()} />);

    const selector = screen.getByRole('combobox', { name: 'Select settings section' });
    const mobileHeader = selector.closest('[data-settings-mobile-header]');

    expect(mobileHeader).not.toBeNull();
    expect(mobileHeader?.className).toContain('sm:hidden');
    expect(mobileHeader?.className).not.toContain('absolute');
    expect(selector.closest('.mantine-Select-root')?.className).toContain('w-full');

    fireEvent.click(selector);
    fireEvent.click(await screen.findByRole('option', { name: 'Board' }));

    expect(await screen.findByText('Board settings loaded')).toBeDefined();
    expect(screen.getByRole('tabpanel', { name: 'Board' }).className).toContain(
      'focus-visible:outline-2'
    );
  });
});
