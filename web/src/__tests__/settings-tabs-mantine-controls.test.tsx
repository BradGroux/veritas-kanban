import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { BoardTab } from '@/components/settings/tabs/BoardTab';
import { EnforcementTab } from '@/components/settings/tabs/EnforcementTab';
import { NotificationsTab } from '@/components/settings/tabs/NotificationsTab';
import { TasksTab } from '@/components/settings/tabs/TasksTab';
import { renderWithProviders } from './test-utils';

const mocks = vi.hoisted(() => ({
  debouncedUpdate: vi.fn(),
  settings: {
    board: {},
    tasks: {},
    markdown: {},
    notifications: {
      enabled: true,
      onTaskComplete: true,
      onAgentFailure: true,
      onReviewNeeded: true,
      channel: '19:test@thread.tacv2',
    },
    squadWebhook: {
      enabled: true,
      mode: 'webhook',
      url: 'https://example.com/webhook',
      secret: 'test-secret-value',
      notifyOnHuman: true,
      notifyOnAgent: true,
    },
    enforcement: {
      orchestratorDelegation: true,
      orchestratorAgent: 'codex',
      squadChat: false,
      reviewGate: false,
      closingComments: false,
      autoTelemetry: false,
      autoTimeTracking: false,
    },
  },
}));

vi.mock('@/hooks/useFeatureSettings', () => ({
  useFeatureSettings: () => ({
    settings: mocks.settings,
  }),
  useDebouncedFeatureUpdate: () => ({
    debouncedUpdate: mocks.debouncedUpdate,
    isPending: false,
  }),
}));

vi.mock('@/hooks/useConfig', () => ({
  useConfig: () => ({
    data: {
      agents: [
        { type: 'codex', name: 'Codex', enabled: true },
        { type: 'claude', name: 'Claude', enabled: true },
      ],
    },
  }),
}));

describe('Settings tab Mantine controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders Board and Tasks select controls through direct Mantine Select', () => {
    const { container: boardContainer } = renderWithProviders(<BoardTab />);

    expect(screen.getByRole('combobox', { name: 'Card Density' })).toBeDefined();
    expect(boardContainer.querySelector('.mantine-Select-root')).toBeDefined();

    cleanup();

    const { container: tasksContainer } = renderWithProviders(<TasksTab />);

    expect(screen.getByRole('combobox', { name: 'Default Priority' })).toBeDefined();
    expect(tasksContainer.querySelector('.mantine-Select-root')).toBeDefined();
  });

  it('renders Notifications text and select controls through direct Mantine primitives', () => {
    const { container } = renderWithProviders(<NotificationsTab />);

    expect(screen.getByLabelText('Channel')).toBeDefined();
    expect(screen.getByRole('combobox', { name: 'Mode' })).toBeDefined();
    expect(screen.getByLabelText('Webhook URL')).toBeDefined();
    expect(screen.getByLabelText('Secret (Optional)')).toBeDefined();
    expect(container.querySelectorAll('.mantine-TextInput-root').length).toBeGreaterThanOrEqual(3);
    expect(container.querySelector('.mantine-Select-root')).toBeDefined();

    fireEvent.change(screen.getByRole('textbox', { name: 'Channel' }), {
      target: { value: '19:updated@thread.tacv2' },
    });

    expect(mocks.debouncedUpdate).toHaveBeenCalledWith({
      notifications: { channel: '19:updated@thread.tacv2' },
    });
  });

  it('renders Enforcement agent selection through direct Mantine Select', () => {
    const { container } = renderWithProviders(<EnforcementTab />);

    expect(screen.getByRole('combobox', { name: 'Orchestrator Agent' })).toBeDefined();
    expect(container.querySelector('.mantine-Select-root')).toBeDefined();
  });
});
