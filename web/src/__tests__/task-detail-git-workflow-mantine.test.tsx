import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { GitSection } from '@/components/task/GitSection';
import { RunModeGateSection } from '@/components/task/RunModeGateSection';
import { WorkflowSection } from '@/components/task/WorkflowSection';
import { WorktreeStatus } from '@/components/task/git/WorktreeStatus';
import { createMockTask, renderWithProviders } from './test-utils';

const mocks = vi.hoisted(() => ({
  useConfig: vi.fn(),
  useRepoBranches: vi.fn(),
  hasPermission: vi.fn(),
  useWorktreeStatus: vi.fn(),
  useGitHubStatus: vi.fn(),
  useConflictStatus: vi.fn(),
  createWorktreeMutate: vi.fn(),
  deleteWorktreeMutate: vi.fn(),
  rebaseWorktreeMutate: vi.fn(),
  mergeWorktreeMutate: vi.fn(),
  createPRMutateAsync: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/hooks/useConfig', () => ({
  useConfig: mocks.useConfig,
  useRepoBranches: mocks.useRepoBranches,
}));

vi.mock('@/hooks/useIdentity', () => ({
  useIdentity: () => ({
    hasPermission: mocks.hasPermission,
  }),
}));

vi.mock('@/hooks/useWorktree', () => ({
  useWorktreeStatus: mocks.useWorktreeStatus,
  useCreateWorktree: () => ({
    mutate: mocks.createWorktreeMutate,
    isPending: false,
    error: null,
  }),
  useDeleteWorktree: () => ({
    mutate: mocks.deleteWorktreeMutate,
    isPending: false,
  }),
  useRebaseWorktree: () => ({
    mutate: mocks.rebaseWorktreeMutate,
    isPending: false,
  }),
  useMergeWorktree: () => ({
    mutate: mocks.mergeWorktreeMutate,
    isPending: false,
  }),
}));

vi.mock('@/hooks/useGitHub', () => ({
  useGitHubStatus: mocks.useGitHubStatus,
  useCreatePR: () => ({
    mutateAsync: mocks.createPRMutateAsync,
    isPending: false,
    error: null,
  }),
}));

vi.mock('@/hooks/useConflicts', () => ({
  useConflictStatus: mocks.useConflictStatus,
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock('@/components/task/ConflictResolver', () => ({
  ConflictResolver: ({ open }: { open: boolean }) => (open ? <div>Conflict resolver</div> : null),
}));

function createJsonResponse(data: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: vi.fn().mockResolvedValue({ data }),
    text: vi.fn().mockResolvedValue(ok ? '' : 'Request failed'),
  };
}

describe('task detail Git and workflow Mantine migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    mocks.useConfig.mockReturnValue({
      data: {
        repos: [
          {
            name: 'veritas',
            path: '/repo/veritas',
            defaultBranch: 'main',
          },
        ],
      },
      isLoading: false,
    });
    mocks.useRepoBranches.mockReturnValue({ data: ['main', 'develop'], isLoading: false });
    mocks.hasPermission.mockReturnValue(true);
    mocks.useWorktreeStatus.mockReturnValue({
      data: {
        path: '/tmp/veritas-worktree',
        branch: 'feature/mantine-git',
        baseBranch: 'main',
        aheadBehind: { ahead: 2, behind: 1 },
        hasChanges: false,
        changedFiles: 0,
      },
      isLoading: false,
      error: null,
    });
    mocks.useGitHubStatus.mockReturnValue({ data: { authenticated: true } });
    mocks.useConflictStatus.mockReturnValue({
      data: { hasConflicts: false, conflictingFiles: [], rebaseInProgress: false },
    });
    mocks.createPRMutateAsync.mockResolvedValue({ url: 'https://github.com/example/pr/1' });
    vi.stubGlobal('open', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders Git selection through direct Mantine controls and keeps task Git updates wired', async () => {
    const user = userEvent.setup();
    const onGitChange = vi.fn();
    const task = createMockTask({
      id: 'task-git-selection',
      title: 'Migrate Git controls',
      git: {
        repo: 'veritas',
        baseBranch: 'main',
        branch: 'feature/mantine-git',
      },
    });

    const { baseElement, container } = renderWithProviders(
      <GitSection task={task} onGitChange={onGitChange} />
    );

    expect(container.querySelector('.mantine-Select-root')).toBeDefined();
    expect(container.querySelector('.mantine-TextInput-root')).toBeDefined();
    expect(container.querySelector('.mantine-Button-root')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="select-trigger"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="input"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="button"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="label"]')).toBeNull();

    fireEvent.change(screen.getByRole('textbox', { name: 'Feature Branch' }), {
      target: { value: 'feature/updated-git-controls' },
    });
    await user.click(screen.getByRole('button', { name: 'Clear' }));

    expect(onGitChange).toHaveBeenCalledWith({
      repo: 'veritas',
      baseBranch: 'main',
      branch: 'feature/updated-git-controls',
    });
    expect(onGitChange).toHaveBeenCalledWith(undefined);
  });

  it('renders worktree status and PR creation through direct Mantine buttons and modals', async () => {
    const user = userEvent.setup();
    const task = createMockTask({
      id: 'task-worktree',
      git: {
        repo: 'veritas',
        baseBranch: 'main',
        branch: 'feature/mantine-git',
        worktreePath: '/tmp/veritas-worktree',
      },
    });

    const { baseElement, container } = renderWithProviders(<WorktreeStatus task={task} />);

    expect(screen.getByText('Worktree active')).toBeDefined();
    expect(container.querySelector('.mantine-Badge-root')).toBeDefined();
    expect(container.querySelector('.mantine-Button-root')).toBeDefined();
    expect(container.querySelector('.mantine-Code-root')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="alert-dialog-content"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="button"]')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Create PR' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create Pull Request' });
    expect(baseElement.querySelector('.mantine-Modal-content')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="dialog-content"]')).toBeNull();

    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Title' }), {
      target: { value: 'Migrate Git controls' },
    });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Description' }), {
      target: { value: 'Direct Mantine controls for Git workflow.' },
    });
    await user.click(within(dialog).getByRole('checkbox', { name: 'Create as draft PR' }));
    await user.click(within(dialog).getByRole('button', { name: 'Create PR' }));

    expect(mocks.createPRMutateAsync).toHaveBeenCalledWith({
      taskId: 'task-worktree',
      title: 'Migrate Git controls',
      body: 'Direct Mantine controls for Git workflow.',
      draft: true,
    });
    expect(window.open).toHaveBeenCalledWith(
      'https://github.com/example/pr/1',
      '_blank',
      'noopener,noreferrer'
    );
  });

  it('renders workflow runs through direct Mantine modal controls and starts a run', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST') {
        return createJsonResponse({
          id: 'run-new',
          workflowId: 'workflow-1',
          status: 'running',
          startedAt: '2026-06-01T09:15:00Z',
        });
      }
      if (url.endsWith('/workflows')) {
        return createJsonResponse([
          {
            id: 'workflow-1',
            name: 'Release Workflow',
            version: 3,
            description: 'Run release checks',
            agents: [{ id: 'agent-1', name: 'QA' }],
            steps: [{ id: 'step-1', name: 'Smoke' }],
          },
        ]);
      }
      if (url.includes('/workflows/launch-recommendations')) {
        return createJsonResponse({
          generatedAt: '2026-06-05T12:00:00.000Z',
          context: {
            workflowId: 'workflow-1',
            taskId: 'task-workflow',
            project: 'veritas-kanban',
            taskType: 'feature',
            cwd: '/tmp/veritas-worktree',
            verificationGates: [],
          },
          recommendations: [
            {
              id: 'template:release',
              kind: 'template',
              label: 'Reviewed launch template',
              detail: 'Active launch template matches prior successful run signals.',
              confidence: 0.86,
              reasonCodes: ['workflow:matched', 'source-run:matched'],
              provenance: [{ type: 'run', id: 'run-success' }],
              templateId: 'template-release',
              templateStatus: 'active',
              overrides: { templateId: 'template-release', agent: 'codex' },
            },
          ],
        });
      }
      return createJsonResponse([
        {
          id: 'run-active',
          workflowId: 'workflow-1',
          status: 'blocked',
          currentStep: 'Manual QA',
          startedAt: '2026-06-01T09:00:00Z',
        },
      ]);
    });
    vi.stubGlobal('fetch', fetchMock);

    const task = createMockTask({
      id: 'task-workflow',
      type: 'feature',
      project: 'veritas-kanban',
      git: {
        repo: 'veritas',
        baseBranch: 'main',
        branch: 'feature/mantine-git',
        worktreePath: '/tmp/veritas-worktree',
      },
    });
    const { baseElement, container } = renderWithProviders(
      <WorkflowSection task={task} open onOpenChange={vi.fn()} />
    );

    expect(await screen.findByText('Release Workflow')).toBeDefined();
    expect(await screen.findByText('Reviewed launch template')).toBeDefined();
    expect(screen.getByText('86%')).toBeDefined();
    expect(screen.getByText('workflow:matched')).toBeDefined();
    expect(screen.getByText('1 source')).toBeDefined();
    expect(screen.getByText('run-active')).toBeDefined();
    expect(container.querySelector('.mantine-Modal-content')).toBeDefined();
    expect(container.querySelector('.mantine-Badge-root')).toBeDefined();
    expect(container.querySelector('.mantine-Paper-root')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="dialog-content"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="badge"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="button"]')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Start' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(
          '/workflows/launch-recommendations?workflowId=workflow-1&taskId=task-workflow'
        ),
        expect.anything()
      );
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/workflows/workflow-1/runs'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ taskId: 'task-workflow' }),
        })
      );
    });
    expect(mocks.toast).toHaveBeenCalledWith({
      title: 'Workflow run started',
      description: 'Run ID: run-new',
    });
  });

  it('renders run mode and QA gate controls through direct Mantine primitives', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
    const task = createMockTask({
      id: 'task-run-mode',
      runMode: undefined,
      qaGate: { required: false, passed: false },
    });

    const { baseElement, container } = renderWithProviders(
      <RunModeGateSection task={task} onUpdate={onUpdate} />
    );

    expect(container.querySelector('.mantine-Select-root')).toBeDefined();
    expect(container.querySelector('.mantine-Switch-root')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="select-trigger"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="switch"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="button"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="label"]')).toBeNull();

    await user.click(screen.getByRole('combobox', { name: 'Run Mode' }));
    await user.click(await screen.findByText(/Eng Review/));
    await user.click(screen.getByRole('switch', { name: 'Require QA before done' }));

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith('runMode', 'eng-review');
    });
    expect(onUpdate).toHaveBeenCalledWith('qaGate', {
      required: true,
      passed: false,
      passedAt: undefined,
      passedBy: undefined,
    });
  });
});
