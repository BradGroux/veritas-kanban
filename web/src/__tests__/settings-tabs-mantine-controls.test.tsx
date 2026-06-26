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
  communicationAdapters: vi.fn(async () => [
    {
      id: 'msteams-default',
      kind: 'msteams',
      displayName: 'Microsoft Teams',
      enabled: true,
      deliveryMode: 'manual',
      replyMode: 'ingest-api',
      destinationType: 'channel',
      teamId: 'team-1',
      channelId: 'channel-1',
      hasCredential: false,
      createdAt: '2026-06-04T08:00:00.000Z',
      updatedAt: '2026-06-04T08:00:00.000Z',
      lastHealth: {
        adapterId: 'msteams-default',
        status: 'ok',
        configured: true,
        canSend: true,
        canReceiveReplies: true,
        checkedAt: '2026-06-04T08:00:00.000Z',
        detail:
          'Adapter can send through the configured delivery path and receive replies through the ingest API.',
      },
    },
  ]),
  communicationHealth: vi.fn(async () => ({
    adapterId: 'msteams-default',
    status: 'ok',
    configured: true,
    canSend: true,
    canReceiveReplies: true,
    checkedAt: '2026-06-04T08:00:00.000Z',
    detail:
      'Adapter can send through the configured delivery path and receive replies through the ingest API.',
  })),
  communicationDeliveries: vi.fn(async () => [
    {
      id: 'comm_1',
      adapterId: 'msteams-default',
      operation: 'send',
      status: 'queued',
      target: { kind: 'notification' },
      createdAt: '2026-06-04T08:00:00.000Z',
    },
  ]),
  configureCommunicationAdapter: vi.fn(async () => ({
    id: 'msteams-default',
    kind: 'msteams',
    displayName: 'Microsoft Teams',
    enabled: true,
    deliveryMode: 'manual',
    replyMode: 'ingest-api',
    destinationType: 'channel',
    hasCredential: false,
    createdAt: '2026-06-04T08:00:00.000Z',
    updatedAt: '2026-06-04T08:00:00.000Z',
  })),
  testCommunicationAdapter: vi.fn(async () => ({
    delivery: {
      id: 'comm_test',
      adapterId: 'msteams-default',
      operation: 'send',
      status: 'queued',
      createdAt: '2026-06-04T08:00:00.000Z',
    },
    mapping: {
      id: 'map_1',
      adapterId: 'msteams-default',
      externalThreadId: 'msteams-default:notification:adapter-test',
      target: { kind: 'notification', notificationId: 'adapter-test' },
      createdAt: '2026-06-04T08:00:00.000Z',
      updatedAt: '2026-06-04T08:00:00.000Z',
    },
  })),
  disconnectCommunicationAdapter: vi.fn(async () => ({
    id: 'msteams-default',
    kind: 'msteams',
    displayName: 'Microsoft Teams',
    enabled: false,
    deliveryMode: 'manual',
    replyMode: 'ingest-api',
    destinationType: 'channel',
    hasCredential: false,
    createdAt: '2026-06-04T08:00:00.000Z',
    updatedAt: '2026-06-04T08:00:00.000Z',
  })),
  ceremonies: vi.fn(async () => [
    {
      id: 'ceremony_1',
      kind: 'design_review',
      status: 'pending',
      enforcementMode: 'warn',
      title: 'Design review required before completion',
      reason: 'Task is high-risk, multi-agent, or review-mode work.',
      target: { taskId: 'task_20260626_demo' },
      trigger: 'task.completion',
      participants: [{ role: 'coordinator' }],
      requiredArtifacts: ['decision-packet', 'risk-list', 'action-items'],
      artifacts: [],
      actionItems: [],
      createdAt: '2026-06-04T08:00:00.000Z',
      updatedAt: '2026-06-04T08:00:00.000Z',
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
      ceremonyDesignReview: 'warn',
      ceremonyFailureRetrospective: 'block',
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
      communicationAdapters: mocks.communicationAdapters,
      communicationHealth: mocks.communicationHealth,
      communicationDeliveries: mocks.communicationDeliveries,
      configureCommunicationAdapter: mocks.configureCommunicationAdapter,
      testCommunicationAdapter: mocks.testCommunicationAdapter,
      disconnectCommunicationAdapter: mocks.disconnectCommunicationAdapter,
    },
    ceremonies: {
      list: mocks.ceremonies,
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
    expect(screen.getByRole('combobox', { name: 'Default task status' })).toBeDefined();
    expect(screen.getByRole('textbox', { name: 'Column 1 status ID' })).toBeDefined();
    expect(screen.getByRole('textbox', { name: 'Column 1 title' })).toBeDefined();
    expect(boardContainer.querySelector('.mantine-Select-root')).toBeDefined();

    cleanup();

    const { container: tasksContainer } = renderWithProviders(<TasksTab />);

    expect(screen.getByRole('combobox', { name: 'Default Priority' })).toBeDefined();
    expect(tasksContainer.querySelector('.mantine-Select-root')).toBeDefined();
  });

  it('updates configured board columns from the Board tab', () => {
    renderWithProviders(<BoardTab />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Column 1 title' }), {
      target: { value: 'Triage' },
    });

    expect(mocks.debouncedUpdate).toHaveBeenCalledWith({
      board: {
        columns: [
          { id: 'todo', title: 'Triage' },
          { id: 'in-progress', title: 'In Progress' },
          { id: 'blocked', title: 'Blocked' },
          { id: 'done', title: 'Done' },
        ],
        defaultStatus: 'todo',
      },
    });
  });

  it('renders Notifications text and select controls through direct Mantine primitives', async () => {
    const { container } = renderWithProviders(<NotificationsTab />);

    expect(await screen.findByText('Communication Health')).toBeDefined();
    expect(screen.getByText('Local Squad Chat')).toBeDefined();
    expect(screen.getByText('Human Reply Adapter')).toBeDefined();
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

  it('renders Enforcement ceremony and agent selection through direct Mantine Select', async () => {
    const { container } = renderWithProviders(<EnforcementTab />);

    expect(
      screen.getByRole('combobox', { name: 'Design Review Ceremony Enforcement' })
    ).toBeDefined();
    expect(
      screen.getByRole('combobox', { name: 'Failure Retrospective Ceremony Enforcement' })
    ).toBeDefined();
    expect(screen.getByRole('combobox', { name: 'Orchestrator Agent' })).toBeDefined();
    expect(await screen.findByText('Design review required before completion')).toBeDefined();
    expect(container.querySelector('.mantine-Select-root')).toBeDefined();
  });
});
