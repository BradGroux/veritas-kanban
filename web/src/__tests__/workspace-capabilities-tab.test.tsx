import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { WorkspaceCapabilitiesTab } from '@/components/settings/tabs/WorkspaceCapabilitiesTab';
import { renderWithProviders } from './test-utils';

const mocks = vi.hoisted(() => ({
  refetchDiscovery: vi.fn(),
  mutateIntake: vi.fn(),
  discovery: {
    local: {
      id: 'local-board',
      schemaVersion: 'workspace-capability/v1',
      workspaceId: 'local',
      name: 'Local Board',
      enabled: true,
      capabilities: [
        {
          id: 'docs',
          name: 'Documentation',
          acceptedTaskTypes: ['docs'],
          defaultPriority: 'medium',
          defaultProject: 'handbook',
          requiredContextFields: ['acceptance'],
          intakeTargets: ['task'],
        },
      ],
    },
    trusted: [
      {
        id: 'source-board',
        schemaVersion: 'workspace-capability/v1',
        workspaceId: 'source',
        name: 'Source Board',
        enabled: true,
        capabilities: [
          {
            id: 'ops',
            name: 'Ops',
            acceptedTaskTypes: ['feature'],
            intakeTargets: ['task'],
          },
        ],
      },
    ],
  },
}));

vi.mock('@/hooks/useIdentity', () => ({
  useIdentity: () => ({
    hasPermission: (permission: string) => ['workspace:read', 'task:write'].includes(permission),
  }),
}));

vi.mock('@/hooks/useWorkspaceCapabilities', () => ({
  useWorkspaceCapabilityDiscovery: () => ({
    data: mocks.discovery,
    isLoading: false,
    refetch: mocks.refetchDiscovery,
  }),
  useWorkspaceDelegations: () => ({
    data: [],
    isLoading: false,
  }),
  useWorkspaceDelegatedIntake: () => ({
    mutateAsync: mocks.mutateIntake,
    isPending: false,
  }),
}));

describe('WorkspaceCapabilitiesTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mutateIntake.mockResolvedValue({
      taskId: 'task_20260626_target',
      record: { id: 'delegation_20260626_abc123' },
    });
  });

  it('renders discovery data and submits delegated intake with required context', async () => {
    renderWithProviders(<WorkspaceCapabilitiesTab />);

    expect(screen.getByText('Local Board')).toBeTruthy();
    expect(screen.getAllByText('Source Board')[0]).toBeTruthy();
    expect(screen.getAllByText('Documentation')[0]).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Write handoff docs' },
    });
    fireEvent.change(screen.getByLabelText('Context'), {
      target: { value: 'Document the delegated workflow.' },
    });
    fireEvent.change(screen.getByLabelText('acceptance'), {
      target: { value: 'Includes handoff and rollback steps' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Intake' }));

    await waitFor(() => {
      expect(mocks.mutateIntake).toHaveBeenCalledWith(
        expect.objectContaining({
          source: { workspaceId: 'source', workspaceName: 'Source Board' },
          capabilityId: 'docs',
          title: 'Write handoff docs',
          context: 'Document the delegated workflow.',
          contextFields: { acceptance: 'Includes handoff and rollback steps' },
          type: 'docs',
          project: 'handbook',
          priority: 'medium',
        })
      );
    });
  });
});
