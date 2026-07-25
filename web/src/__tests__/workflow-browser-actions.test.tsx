import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WorkflowDefinition } from '@veritas-kanban/shared';

import { WorkflowsPage } from '@/components/workflows/WorkflowsPage';
import { renderWithProviders } from './test-utils';

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/hooks/useIdentity', () => ({
  useIdentity: () => ({
    hasPermission: mocks.hasPermission,
  }),
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock('@/hooks/useSandboxPolicies', () => ({
  useSandboxPolicies: () => ({ data: [] }),
}));

function response(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => (status >= 400 ? data : { data }),
  } as Response;
}

function workflow(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    id: 'wf-blueprint',
    name: 'Release blueprint',
    version: 4,
    description: 'Build, verify, and approve a release.',
    variables: {
      releaseChannel: 'stable',
      requireApproval: true,
    },
    outputTargets: [
      { type: 'work-product', label: 'Release report', path: 'work-products/release.md' },
    ],
    agents: [
      {
        id: 'builder',
        name: 'Builder',
        role: 'developer',
        provider: 'codex-cli',
        description: 'Builds the release.',
        tools: ['Read', 'Edit', 'exec'],
      },
      {
        id: 'reviewer',
        name: 'Reviewer',
        role: 'reviewer',
        description: 'Reviews the release evidence.',
      },
    ],
    steps: [
      {
        id: 'build',
        name: 'Build release',
        type: 'agent',
        phase: 'implement',
        agent: 'builder',
        input: 'Build the {{releaseChannel}} release.',
        acceptance_criteria: ['The release artifact exists.'],
        output: { file: 'release.md' },
      },
      {
        id: 'matrix',
        name: 'Verify targets',
        type: 'parallel',
        phase: 'verify',
        parallel: {
          completion: 'all',
          fail_fast: true,
          steps: [
            { id: 'desktop', agent: 'reviewer', input: 'Verify desktop.' },
            { id: 'server', agent: 'reviewer', input: 'Verify server.' },
          ],
        },
      },
      {
        id: 'approval',
        name: 'Release approval',
        type: 'gate',
        phase: 'publish',
        condition: 'verification.passed == true',
        on_false: { escalate_to: 'human' },
      },
    ],
    createdBy: 'system',
    updatedBy: 'system',
    createdAt: '2026-07-01T12:00:00.000Z',
    updatedAt: '2026-07-20T12:00:00.000Z',
    ...overrides,
  };
}

function access(overrides: Record<string, unknown> = {}) {
  return {
    workflowId: 'wf-blueprint',
    canView: true,
    canEdit: false,
    canExecute: true,
    canDuplicate: true,
    readOnlyReason: 'Built-in workflows are read-only. Duplicate this workflow to customize it.',
    provenance: {
      kind: 'built-in',
      owner: 'system',
      createdBy: 'system',
      updatedBy: 'system',
      createdAt: '2026-07-01T12:00:00.000Z',
      updatedAt: '2026-07-20T12:00:00.000Z',
    },
    ...overrides,
  };
}

describe('workflow browser view and edit actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasPermission.mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
    vi.restoreAllMocks();
  });

  it('renders a deep-linked read-only blueprint and returns a direct link to the browser', async () => {
    window.history.replaceState({}, '', '/workflows/wf-blueprint');
    const user = userEvent.setup();
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/workflows')) {
        return response([
          {
            id: 'wf-blueprint',
            name: 'Release blueprint',
            version: 4,
            description: 'Build, verify, and approve a release.',
          },
        ]);
      }
      if (url.endsWith('/workflows/wf-blueprint/access')) return response(access());
      if (url.endsWith('/workflows/wf-blueprint')) return response(workflow());
      return response({ error: 'Not found' }, 404);
    }) as typeof fetch;

    renderWithProviders(<WorkflowsPage onBack={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'Release blueprint' })).toBeDefined();
    expect(screen.getByText('Execution blueprint')).toBeDefined();
    expect(screen.getByText('Built-in')).toBeDefined();
    expect(screen.getByText('Build the {{releaseChannel}} release.')).toBeDefined();
    expect(screen.getByText('The release artifact exists.')).toBeDefined();
    expect(screen.getByText('Parallel branches')).toBeDefined();
    expect(screen.getByText('verification.passed == true')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Duplicate to customize' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Back to workflows' }));

    expect(window.location.pathname).toBe('/workflows');
    expect(await screen.findByPlaceholderText('Search workflows...')).toBeDefined();
  });

  it('keeps an editable draft after validation fails and saves with its loaded version', async () => {
    window.history.replaceState({}, '', '/workflows');
    const user = userEvent.setup();
    let currentName = 'Owned workflow';
    let updateAttempts = 0;
    const ownedWorkflow = () =>
      workflow({
        id: 'wf-owned',
        name: currentName,
        version: 7,
        createdBy: 'user:owner',
        updatedBy: 'user:owner',
      });
    const ownedAccess = access({
      workflowId: 'wf-owned',
      canEdit: true,
      readOnlyReason: undefined,
      provenance: {
        kind: 'user-owned',
        owner: 'owner',
        createdBy: 'user:owner',
        updatedBy: 'user:owner',
      },
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/workflows') && !init?.method) {
        return response([
          {
            id: 'wf-owned',
            name: currentName,
            version: 7,
            description: 'Build, verify, and approve a release.',
          },
        ]);
      }
      if (url.endsWith('/workflows/wf-owned/access') && !init?.method) {
        return response(ownedAccess);
      }
      if (url.endsWith('/workflows/wf-owned') && !init?.method) {
        return response(ownedWorkflow());
      }
      if (url.endsWith('/workflows/authoring/yaml') && init?.method === 'POST') {
        return response({ yaml: 'id: wf-owned\nname: Owned workflow\n' });
      }
      if (url.endsWith('/workflows/wf-owned') && init?.method === 'PUT') {
        updateAttempts += 1;
        const submitted = JSON.parse(String(init.body)) as WorkflowDefinition;
        if (submitted.name.endsWith('!')) {
          return response(
            {
              error: 'Workflow name cannot end with an exclamation point.',
            },
            400
          );
        }
        currentName = submitted.name;
        return response({ success: true, version: 8 });
      }
      return response({ error: 'Not found' }, 404);
    });
    globalThis.fetch = fetchMock as typeof fetch;

    renderWithProviders(<WorkflowsPage onBack={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'View Owned workflow' }));
    expect(window.location.pathname).toBe('/workflows/wf-owned');
    await user.click(await screen.findByRole('button', { name: 'Edit' }));

    expect(window.location.pathname).toBe('/workflows/wf-owned/edit');
    await screen.findByRole('heading', { name: 'Workflow Definition' });
    const nameInput = screen
      .getAllByLabelText('Name')
      .find((input) => (input as HTMLInputElement).value === 'Owned workflow');
    expect(nameInput).toBeDefined();
    if (!nameInput) throw new Error('Workflow name input was not rendered');
    await user.clear(nameInput);
    await user.type(nameInput, 'Owned workflow revised!');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateAttempts).toBe(1));
    expect((nameInput as HTMLInputElement).value).toBe('Owned workflow revised!');
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Workflow update failed',
        description: expect.stringContaining('Workflow name cannot end with an exclamation point'),
      })
    );

    await user.clear(nameInput);
    await user.type(nameInput, 'Owned workflow revised');
    expect((nameInput as HTMLInputElement).value).toBe('Owned workflow revised');

    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(window.location.pathname).toBe('/workflows/wf-owned');
      expect(currentName).toBe('Owned workflow revised');
    });
    const putCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith('/workflows/wf-owned') && init?.method === 'PUT'
    );
    expect(putCall?.[1]?.headers).toMatchObject({
      'X-Resource-Revision': '7',
    });
    expect(await screen.findByRole('heading', { name: 'Owned workflow revised' })).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Back to workflows' }));
    expect(window.location.pathname).toBe('/workflows');
    expect(await screen.findByPlaceholderText('Search workflows...')).toBeDefined();
  });

  it('shows an actionable missing-definition state', async () => {
    window.history.replaceState({}, '', '/workflows/missing-workflow');
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/workflows')) return response([]);
      return response({ error: 'Workflow missing-workflow not found' }, 404);
    }) as typeof fetch;

    renderWithProviders(<WorkflowsPage onBack={vi.fn()} />);

    expect(await screen.findByText('Workflow unavailable')).toBeDefined();
    expect(screen.getByText('Workflow missing-workflow not found')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Back to workflows' })).toBeDefined();
  });
});
