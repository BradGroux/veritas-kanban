import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { BoardTab } from '@/components/settings/tabs/BoardTab';
import { EnforcementTab } from '@/components/settings/tabs/EnforcementTab';
import { NotificationsTab } from '@/components/settings/tabs/NotificationsTab';
import { TasksTab } from '@/components/settings/tabs/TasksTab';
import { renderWithProviders } from './test-utils';

const mocks = vi.hoisted(() => ({
  debouncedUpdate: vi.fn(),
  outboundEndpoints: vi.fn(async () => [
    {
      id: 'squad.webhook',
      type: 'squad-webhook',
      displayName: 'Squad Chat webhook',
      url: 'https://example.com/webhook',
      enabled: true,
      auth: {
        type: 'hmac-sha256',
        headerName: 'X-VK-Signature',
        secretRef: 'featureSettings.squadWebhook.secret',
        hasSecret: true,
      },
      validation: { valid: true },
      updatedAt: '2026-06-04T08:00:00.000Z',
    },
    {
      id: 'notifications.failureAlert',
      type: 'failure-alert-webhook',
      displayName: 'Failure alert webhook',
      url: 'https://example.com/failure-alerts',
      enabled: true,
      auth: { type: 'none' },
      validation: { valid: true },
      updatedAt: '2026-06-04T08:00:00.000Z',
    },
  ]),
  outboundDeliveries: vi.fn(async () => [
    {
      id: 'delivery_1',
      endpointId: 'squad.webhook',
      endpointType: 'squad-webhook',
      displayName: 'Squad Chat webhook',
      method: 'POST',
      sanitizedUrl: 'https://example.com/webhook',
      status: 'success',
      responseStatus: 202,
      responseClass: '2xx',
      durationMs: 42,
      attempt: 1,
      startedAt: '2026-06-04T08:00:00.000Z',
      completedAt: '2026-06-04T08:00:01.000Z',
    },
    {
      id: 'delivery_2',
      endpointId: 'notifications.failureAlert',
      endpointType: 'failure-alert-webhook',
      displayName: 'Failure alert webhook',
      method: 'POST',
      sanitizedUrl: 'https://example.com/failure-alerts',
      status: 'failed',
      responseStatus: 500,
      responseClass: '5xx',
      durationMs: 57,
      attempt: 1,
      startedAt: '2026-06-04T08:00:00.000Z',
      completedAt: '2026-06-04T08:00:02.000Z',
    },
  ]),
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
      webhookUrl: 'https://example.com/failure-alerts?token=hidden',
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

vi.mock('@/lib/api', () => ({
  api: {
    integrations: {
      outboundEndpoints: mocks.outboundEndpoints,
      outboundDeliveries: mocks.outboundDeliveries,
    },
  },
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

  it('renders Notifications text and select controls through direct Mantine primitives', async () => {
    const { container } = renderWithProviders(<NotificationsTab />);

    expect(await screen.findByText('Communication Health')).toBeDefined();
    expect(screen.getByText('Local Squad Chat')).toBeDefined();
    expect(screen.getAllByText('Squad Chat Webhook').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Visually verified: not recorded in VK/).length).toBeGreaterThan(0);
    expect(screen.getByText('X-VK-Signature')).toBeDefined();
    expect(await screen.findByText(/success 202/)).toBeDefined();
    expect(screen.getByLabelText('Channel')).toBeDefined();
    expect(screen.getByLabelText('Failure Webhook URL')).toBeDefined();
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
