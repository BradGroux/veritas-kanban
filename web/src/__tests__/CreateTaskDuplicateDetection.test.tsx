import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { CreateTaskDialog } from '@/components/task/CreateTaskDialog';
import { api } from '@/lib/api';
import { renderWithProviders } from './test-utils';
import { PartialBlueprintCreationError } from '@/hooks/useTemplateForm';

vi.mock('@/lib/api', () => ({
  api: {
    search: {
      query: vi.fn(),
    },
  },
}));

vi.mock('@/hooks/useTaskTypes', () => ({
  useTaskTypes: () => ({
    data: [{ id: 'code', label: 'Code', icon: 'Code', order: 0, created: '', updated: '' }],
  }),
  getTypeIcon: () => null,
}));

vi.mock('@/hooks/useProjects', () => ({
  useProjects: () => ({ data: [] }),
}));

vi.mock('@/hooks/useSprints', () => ({
  useSprints: () => ({ data: [] }),
}));

vi.mock('@/hooks/useConfig', () => ({
  useConfig: () => ({ data: { agents: [] } }),
}));

const templateFormMocks = vi.hoisted(() => ({
  createTasks: vi.fn(),
  clearTemplate: vi.fn(),
  selectedTemplate: null as string | null,
  templates: [] as Array<Record<string, unknown>>,
  customVars: {} as Record<string, string>,
  requiredCustomVars: [] as string[],
}));

vi.mock('@/hooks/useTemplateForm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useTemplateForm')>();
  return {
    ...actual,
    useTemplateForm: () => ({
      selectedTemplate: templateFormMocks.selectedTemplate,
      templates: templateFormMocks.templates,
      subtasks: [],
      customVars: templateFormMocks.customVars,
      requiredCustomVars: templateFormMocks.requiredCustomVars,
      applyTemplate: vi.fn(),
      clearTemplate: templateFormMocks.clearTemplate,
      removeSubtask: vi.fn(),
      setCustomVars: vi.fn(),
      createTasks: templateFormMocks.createTasks,
      isCreating: false,
    }),
  };
});

const navigateToTaskMock = vi.fn();

vi.mock('@/contexts/ViewContext', () => ({
  useView: () => ({
    navigateToTask: navigateToTaskMock,
  }),
}));

const queryMock = vi.mocked(api.search.query);

describe('CreateTaskDialog duplicate detection', () => {
  beforeEach(() => {
    queryMock.mockReset();
    navigateToTaskMock.mockReset();
    templateFormMocks.createTasks.mockReset();
    templateFormMocks.clearTemplate.mockReset();
    templateFormMocks.selectedTemplate = null;
    templateFormMocks.templates = [];
    templateFormMocks.customVars = {};
    templateFormMocks.requiredCustomVars = [];
  });

  afterEach(() => {
    cleanup();
  });

  it('shows likely duplicates without blocking task creation', async () => {
    queryMock.mockResolvedValue({
      query: 'Search duplicate',
      backend: 'keyword',
      degraded: false,
      elapsedMs: 3,
      results: [
        {
          id: 'tasks/active/task_20260504_match-search-duplicate.md',
          title: 'Existing Search Duplicate',
          path: 'tasks/active/task_20260504_match-search-duplicate.md',
          collection: 'tasks-active',
          snippet: 'Already covers duplicate detection.',
          score: 5,
        },
      ],
    });

    const onOpenChange = vi.fn();
    const { container } = renderWithProviders(
      <CreateTaskDialog open onOpenChange={onOpenChange} />
    );

    expect(container.querySelector('.mantine-TextInput-root')).toBeDefined();
    expect(container.querySelector('.mantine-Textarea-root')).toBeDefined();
    expect(container.querySelectorAll('.mantine-Select-root').length).toBeGreaterThanOrEqual(5);

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Search duplicate' },
    });

    await waitFor(() => expect(queryMock).toHaveBeenCalledTimes(1));
    expect(queryMock).toHaveBeenCalledWith({
      query: 'Search duplicate',
      backend: 'auto',
      collections: ['tasks-active', 'tasks-archive'],
      limit: 5,
    });
    expect(await screen.findByText('Existing Search Duplicate')).toBeDefined();
    expect(
      (screen.getByRole('button', { name: /^create task$/i }) as HTMLButtonElement).disabled
    ).toBe(false);
  });

  it('opens a duplicate result for inspection', async () => {
    queryMock.mockResolvedValue({
      query: 'Search duplicate',
      backend: 'keyword',
      degraded: false,
      elapsedMs: 3,
      results: [
        {
          id: 'tasks/archive/task_20260504_match-search-duplicate.md',
          title: 'Archived Search Duplicate',
          path: 'tasks/archive/task_20260504_match-search-duplicate.md',
          collection: 'tasks-archive',
          snippet: '',
          score: 4,
        },
      ],
    });

    const onOpenChange = vi.fn();
    renderWithProviders(<CreateTaskDialog open onOpenChange={onOpenChange} />);

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Search duplicate' },
    });

    fireEvent.click(await screen.findByText('Archived Search Duplicate'));

    expect(navigateToTaskMock).toHaveBeenCalledWith('task_20260504_match');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('hides raw degraded-search backend errors', async () => {
    queryMock.mockResolvedValue({
      query: 'Search duplicate',
      backend: 'keyword',
      degraded: true,
      reason: 'spawn qmd ENOENT',
      elapsedMs: 3,
      results: [],
    });

    renderWithProviders(<CreateTaskDialog open onOpenChange={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Search duplicate' },
    });

    expect(await screen.findByText(/Duplicate search is using a reduced index/i)).toBeDefined();
    expect(screen.queryByText(/spawn qmd ENOENT/i)).toBeNull();
  });

  it('hides raw duplicate-check exceptions', async () => {
    queryMock.mockRejectedValue(new Error('spawn qmd ENOENT'));

    renderWithProviders(<CreateTaskDialog open onOpenChange={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Search duplicate' },
    });

    expect(await screen.findByText(/Duplicate search is unavailable/i)).toBeDefined();
    expect(screen.queryByText(/spawn qmd ENOENT/i)).toBeNull();
  });

  it('retains creation ownership through failure and deliberate retry', async () => {
    let rejectRequest!: (error: Error) => void;
    const pendingRequest = new Promise<void>((_resolve, reject) => {
      rejectRequest = reject;
    });
    templateFormMocks.createTasks
      .mockReturnValueOnce(pendingRequest)
      .mockResolvedValueOnce(undefined);

    const onOpenChange = vi.fn();
    renderWithProviders(<CreateTaskDialog open onOpenChange={onOpenChange} />);

    const title = screen.getByLabelText('Title') as HTMLInputElement;
    fireEvent.change(title, { target: { value: 'Retain this complete draft' } });

    const submit = screen.getByRole('button', { name: 'Create Task' });
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(templateFormMocks.createTasks).toHaveBeenCalledTimes(1);
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(
      true
    );
    expect(
      (screen.getByRole('button', { name: 'Close dialog' }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(title.matches(':disabled')).toBe(true);

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onOpenChange).not.toHaveBeenCalled();

    await act(async () => rejectRequest(new Error('Fixture task creation failed')));
    const error = await screen.findByRole('alert', { name: 'Task not created' });
    await waitFor(() => expect(document.activeElement).toBe(error));
    expect(error.textContent).toContain('Fixture task creation failed');
    expect(title.value).toBe('Retain this complete draft');
    expect(title.matches(':disabled')).toBe(false);
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(submit);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false));
    expect(templateFormMocks.createTasks).toHaveBeenCalledTimes(2);
    expect(templateFormMocks.clearTemplate).toHaveBeenCalledTimes(1);
  });

  it('locks blueprint variables while pending and blocks blind retry after partial creation', async () => {
    let rejectRequest!: (error: Error) => void;
    const pendingRequest = new Promise<void>((_resolve, reject) => {
      rejectRequest = reject;
    });
    templateFormMocks.selectedTemplate = 'release-blueprint';
    templateFormMocks.templates = [
      {
        id: 'release-blueprint',
        name: 'Release blueprint',
        version: 1,
        taskDefaults: {},
        blueprint: [
          { refId: 'build', title: 'Build release', taskDefaults: {} },
          { refId: 'publish', title: 'Publish release', taskDefaults: {} },
        ],
        created: '2026-09-04T00:00:00.000Z',
        updated: '2026-09-04T00:00:00.000Z',
      },
    ];
    templateFormMocks.customVars = { channel: 'stable' };
    templateFormMocks.requiredCustomVars = ['channel'];
    templateFormMocks.createTasks.mockReturnValueOnce(pendingRequest);

    renderWithProviders(<CreateTaskDialog open onOpenChange={vi.fn()} />);

    const variable = screen.getByLabelText('channel') as HTMLInputElement;
    const submit = screen.getByRole('button', { name: 'Create Tasks' }) as HTMLButtonElement;
    fireEvent.click(submit);
    expect(variable.disabled).toBe(true);

    await act(async () => rejectRequest(new PartialBlueprintCreationError(1, 2)));
    const error = await screen.findByRole('alert', { name: 'Task not created' });
    expect(error.textContent).toContain('1 of 2 blueprint tasks were created');
    expect(variable.disabled).toBe(false);
    expect(submit.disabled).toBe(true);
    fireEvent.submit(submit.closest('form') as HTMLFormElement);
    expect(templateFormMocks.createTasks).toHaveBeenCalledTimes(1);
  });
});
