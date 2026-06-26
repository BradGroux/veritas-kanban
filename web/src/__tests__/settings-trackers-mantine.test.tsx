import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { TrackersTab } from '@/components/settings/tabs/TrackersTab';
import { renderWithProviders } from './test-utils';

const schema = {
  provider: 'mock',
  providerLabel: 'Mock Tracker',
  schemaVersion: 'mock-2026-06-26',
  introspectedAt: '2026-06-26T12:00:00.000Z',
  workItemTypes: [
    { id: 'Bug', name: 'Bug' },
    { id: 'Feature', name: 'Feature' },
    { id: 'Task', name: 'Task' },
  ],
  fields: [
    { id: 'System.Title', name: 'Title', type: 'string', required: true },
    { id: 'System.Description', name: 'Description', type: 'string', required: false },
    {
      id: 'Microsoft.VSTS.Common.Priority',
      name: 'Priority',
      type: 'number',
      required: false,
      allowedValues: [1, 2, 3, 4],
    },
    { id: 'System.State', name: 'State', type: 'picklist', required: false },
    { id: 'System.Tags', name: 'Tags', type: 'tags', required: false },
    { id: 'Custom.VeritasBacklink', name: 'Veritas Backlink', type: 'url', required: false },
  ],
  projects: [{ id: 'project-default', name: 'Veritas', path: 'Veritas', kind: 'project' }],
  areaPaths: [{ id: 'area-platform', name: 'Platform', path: 'Veritas\\Platform', kind: 'area' }],
  iterationPaths: [
    { id: 'iteration-next', name: 'Next', path: 'Veritas\\Next', kind: 'iteration' },
  ],
  teams: [{ id: 'team-core', name: 'Core', path: 'Veritas\\Core', kind: 'team' }],
  priorities: [1, 2, 3, 4],
  states: ['New', 'Active', 'Closed'],
  tags: ['veritas'],
  assignees: [],
  capabilities: {
    canCreate: true,
    canUpdate: true,
    requiresApproval: true,
    supportsDryRun: true,
  },
  connectionPosture: { status: 'connected', hasCredential: false, credentialRedacted: true },
};

const profile = {
  id: 'default-mock-profile',
  name: 'Default Mock Tracker Mapping',
  provider: 'mock',
  enabled: true,
  defaultWorkItemType: 'Task',
  defaultProjectPath: 'Veritas',
  defaultAreaPath: 'Veritas\\Platform',
  defaultTeamPath: 'Veritas\\Core',
  defaultIterationPath: 'Veritas\\Next',
  fieldMappings: [
    { trackerFieldId: 'System.Title', source: 'title', required: true },
    { trackerFieldId: 'System.Description', source: 'description' },
    { trackerFieldId: 'Microsoft.VSTS.Common.Priority', source: 'priority' },
    { trackerFieldId: 'System.State', source: 'status' },
    { trackerFieldId: 'System.Tags', source: 'literal', literalValue: 'veritas' },
  ],
  backlinkFieldId: 'Custom.VeritasBacklink',
  createdAt: '2026-06-26T12:00:00.000Z',
  updatedAt: '2026-06-26T12:00:00.000Z',
};

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  toast: vi.fn(),
  trackerSchema: vi.fn(),
  trackerProfiles: vi.fn(),
  introspectTracker: vi.fn(),
  saveTrackerProfile: vi.fn(),
  validateTrackerProfile: vi.fn(),
  dryRunTrackerCreate: vi.fn(),
}));

vi.mock('@/hooks/useIdentity', () => ({
  useIdentity: () => ({ hasPermission: mocks.hasPermission }),
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock('@/lib/api', () => ({
  api: {
    integrations: {
      trackerSchema: mocks.trackerSchema,
      trackerProfiles: mocks.trackerProfiles,
      introspectTracker: mocks.introspectTracker,
      saveTrackerProfile: mocks.saveTrackerProfile,
      validateTrackerProfile: mocks.validateTrackerProfile,
      dryRunTrackerCreate: mocks.dryRunTrackerCreate,
    },
  },
}));

describe('Trackers settings tab', () => {
  beforeEach(() => {
    mocks.hasPermission.mockReturnValue(true);
    mocks.trackerSchema.mockResolvedValue(schema);
    mocks.trackerProfiles.mockResolvedValue([profile]);
    mocks.introspectTracker.mockResolvedValue(schema);
    mocks.saveTrackerProfile.mockResolvedValue(profile);
    mocks.validateTrackerProfile.mockResolvedValue({ valid: true, errors: [], warnings: [] });
    mocks.dryRunTrackerCreate.mockResolvedValue({
      externalWrite: false,
      profile,
      schema,
      payload: {
        provider: 'mock',
        workItemType: 'Task',
        fields: { 'System.Title': 'Preview tracker mapping' },
        backlinkUrl: 'veritas-kanban://tasks/task_tracker_preview',
      },
      validation: { valid: true, errors: [], warnings: [] },
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders schema, saves the mapping profile, and runs a dry-run create', async () => {
    renderWithProviders(<TrackersTab />);

    expect(await screen.findByText('External Trackers')).toBeDefined();
    expect(screen.getByText('Mock Tracker')).toBeDefined();
    expect(screen.getByText('6 fields')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /Introspect/ }));
    await waitFor(() => {
      expect(mocks.introspectTracker).toHaveBeenCalledWith({ provider: 'mock' });
    });

    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => {
      expect(mocks.saveTrackerProfile).toHaveBeenCalledWith(
        'default-mock-profile',
        expect.objectContaining({
          id: 'default-mock-profile',
          defaultWorkItemType: 'Task',
          backlinkFieldId: 'Custom.VeritasBacklink',
        })
      );
    });

    fireEvent.click(screen.getByRole('button', { name: /Dry Run/ }));
    await waitFor(() => {
      expect(mocks.dryRunTrackerCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          profileId: 'default-mock-profile',
          task: expect.objectContaining({ id: 'task_tracker_preview' }),
        })
      );
    });
  });
});
