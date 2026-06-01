import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { ArchivePage } from '@/components/archive/ArchivePage';
import { BacklogPage } from '@/components/backlog/BacklogPage';
import {
  createMockProject,
  createMockSprint,
  createMockTask,
  createMockTaskType,
  renderWithProviders,
} from './test-utils';

const mocks = vi.hoisted(() => ({
  bulkPromoteMutateAsync: vi.fn(),
  deleteBacklogMutateAsync: vi.fn(),
  refetchArchivedTasks: vi.fn(),
  restoreTaskMutateAsync: vi.fn(),
  promoteTaskMutateAsync: vi.fn(),
  toast: vi.fn(),
  useArchivedTasks: vi.fn(),
  useBacklogTasks: vi.fn(),
  useProjects: vi.fn(),
  useSprints: vi.fn(),
  useTaskTypes: vi.fn(),
}));

vi.mock('@/hooks/useBacklog', () => ({
  useBacklogTasks: mocks.useBacklogTasks,
  usePromoteTask: () => ({
    mutateAsync: mocks.promoteTaskMutateAsync,
    isPending: false,
  }),
  useBulkPromote: () => ({
    mutateAsync: mocks.bulkPromoteMutateAsync,
    isPending: false,
  }),
  useDeleteBacklogTask: () => ({
    mutateAsync: mocks.deleteBacklogMutateAsync,
    isPending: false,
  }),
}));

vi.mock('@/hooks/useProjects', () => ({
  useProjects: mocks.useProjects,
}));

vi.mock('@/hooks/useSprints', () => ({
  useSprints: mocks.useSprints,
}));

vi.mock('@/hooks/useTaskTypes', () => ({
  useTaskTypes: mocks.useTaskTypes,
}));

vi.mock('@/hooks/useTasks', () => ({
  useArchivedTasks: mocks.useArchivedTasks,
  useRestoreTask: () => ({
    mutateAsync: mocks.restoreTaskMutateAsync,
    isPending: false,
  }),
}));

vi.mock('@/hooks/useToast', () => ({
  toast: mocks.toast,
  useToast: () => ({ toast: mocks.toast }),
}));

describe('Archive and backlog Mantine surfaces', () => {
  beforeEach(() => {
    const projects = [createMockProject({ id: 'veritas', label: 'Veritas' })];
    const taskTypes = [
      createMockTaskType({ id: 'code', label: 'Code', icon: 'Code' }),
      createMockTaskType({ id: 'research', label: 'Research', icon: 'Search' }),
    ];
    const sprints = [createMockSprint({ id: 'v5', label: 'v5 Release' })];

    mocks.useProjects.mockReturnValue({ data: projects });
    mocks.useTaskTypes.mockReturnValue({ data: taskTypes });
    mocks.useSprints.mockReturnValue({ data: sprints });
    mocks.bulkPromoteMutateAsync.mockResolvedValue({ promoted: [], failed: [] });
    mocks.deleteBacklogMutateAsync.mockResolvedValue(undefined);
    mocks.promoteTaskMutateAsync.mockResolvedValue(undefined);
    mocks.refetchArchivedTasks.mockResolvedValue(undefined);
    mocks.restoreTaskMutateAsync.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders backlog filters and cards through direct Mantine components', () => {
    mocks.useBacklogTasks.mockReturnValue({
      data: [
        createMockTask({
          id: 'VK-101',
          title: 'Backlog API importer',
          description: 'Queue import work before sprint planning',
          priority: 'high',
          project: 'veritas',
          sprint: 'v5',
          status: 'todo',
          type: 'code',
        }),
        createMockTask({
          id: 'VK-102',
          title: 'Backlog cleanup workflow',
          description: 'Clean old intake notes',
          priority: 'medium',
          project: 'veritas',
          status: 'todo',
          type: 'research',
        }),
      ],
      isLoading: false,
    });

    const { container } = renderWithProviders(<BacklogPage onBack={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Backlog' })).toBeDefined();
    expect(screen.getByLabelText('Search backlog tasks')).toBeDefined();
    expect(screen.getByText('Backlog API importer')).toBeDefined();
    expect(screen.getByText('Backlog cleanup workflow')).toBeDefined();
    expect(container.querySelector('.mantine-TextInput-root')).toBeDefined();
    expect(container.querySelectorAll('.mantine-Select-root').length).toBeGreaterThanOrEqual(2);
    expect(container.querySelectorAll('.mantine-Checkbox-root').length).toBeGreaterThanOrEqual(1);
    expect(container.querySelectorAll('.mantine-Paper-root').length).toBeGreaterThanOrEqual(2);

    fireEvent.change(screen.getByLabelText('Search backlog tasks'), {
      target: { value: 'API' },
    });

    expect(screen.getByText('Backlog API importer')).toBeDefined();
    expect(screen.queryByText('Backlog cleanup workflow')).toBeNull();

    fireEvent.click(screen.getByLabelText('Select all'));

    expect(screen.getByText('1 selected')).toBeDefined();
  });

  it('renders archive filters, icons, and refresh behavior through direct Mantine components', () => {
    mocks.useArchivedTasks.mockReturnValue({
      data: [
        createMockTask({
          id: 'VK-201',
          title: 'Archived release audit',
          description: 'Evidence retained for the release archive',
          project: 'veritas',
          sprint: 'v5',
          status: 'done',
          type: 'code',
        }),
        createMockTask({
          id: 'VK-202',
          title: 'Archived research packet',
          description: 'Research notes retained for later reference',
          project: 'veritas',
          status: 'done',
          type: 'research',
        }),
      ],
      isLoading: false,
      isRefetching: false,
      refetch: mocks.refetchArchivedTasks,
    });

    const { container } = renderWithProviders(<ArchivePage onBack={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Archive' })).toBeDefined();
    expect(screen.getByLabelText('Search archived tasks')).toBeDefined();
    expect(screen.getByText('Archived release audit')).toBeDefined();
    expect(screen.getByText('Archived research packet')).toBeDefined();
    expect(screen.getAllByText('v5 Release').length).toBeGreaterThanOrEqual(1);
    expect(container.querySelector('.mantine-TextInput-root')).toBeDefined();
    expect(container.querySelectorAll('.mantine-Select-root').length).toBeGreaterThanOrEqual(3);
    expect(container.querySelectorAll('.mantine-Checkbox-root').length).toBeGreaterThanOrEqual(1);
    expect(container.querySelectorAll('.mantine-Paper-root').length).toBeGreaterThanOrEqual(2);
    expect(container.querySelectorAll('.mantine-ThemeIcon-root').length).toBeGreaterThanOrEqual(1);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh archived tasks' }));
    expect(mocks.refetchArchivedTasks).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('Search archived tasks'), {
      target: { value: 'release' },
    });

    expect(screen.getByText('Archived release audit')).toBeDefined();
    expect(screen.queryByText('Archived research packet')).toBeNull();
  });
});
