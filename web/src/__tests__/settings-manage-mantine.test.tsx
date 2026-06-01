import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { ManageTab } from '@/components/settings/tabs/ManageTab';
import { renderWithProviders } from './test-utils';
import type { ManagedListItem, TaskTemplate } from '@veritas-kanban/shared';

const mocks = vi.hoisted(() => ({
  canDelete: vi.fn(),
  createItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
  reorderItems: vi.fn(),
  createTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
  toast: vi.fn(),
}));

const baseItemFields = {
  order: 0,
  created: '2026-01-01T00:00:00.000Z',
  updated: '2026-01-01T00:00:00.000Z',
} satisfies Omit<ManagedListItem, 'id' | 'label'>;

const taskTemplates: TaskTemplate[] = [
  {
    id: 'template-bug',
    name: 'Bug Fix',
    category: 'bug',
    version: 1,
    taskDefaults: {
      type: 'bug',
      priority: 'high',
      project: 'rubicon',
      agent: 'veritas',
    },
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'template-empty-defaults',
    name: 'Empty Defaults',
    version: 1,
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-01T00:00:00.000Z',
  } as TaskTemplate,
];

vi.mock('@/hooks/useConfig', () => ({
  useConfig: () => ({ data: {}, isLoading: false }),
}));

vi.mock('@/hooks/useTemplates', () => ({
  useTemplates: () => ({ data: taskTemplates, isLoading: false }),
  useCreateTemplate: () => ({
    mutateAsync: mocks.createTemplate,
    isPending: false,
  }),
  useDeleteTemplate: () => ({
    mutate: mocks.deleteTemplate,
  }),
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock('@/hooks/useTaskTypes', async () => {
  const actual =
    await vi.importActual<typeof import('@/hooks/useTaskTypes')>('@/hooks/useTaskTypes');
  return {
    ...actual,
    useTaskTypesManager: () => ({
      items: [
        {
          ...baseItemFields,
          id: 'bug',
          label: 'Bug',
          icon: 'Code',
          color: 'border-l-gray-500',
        },
      ],
      isLoading: false,
      create: mocks.createItem,
      update: mocks.updateItem,
      remove: mocks.deleteItem,
      reorder: mocks.reorderItems,
      canDelete: mocks.canDelete,
    }),
  };
});

vi.mock('@/hooks/useProjects', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useProjects')>('@/hooks/useProjects');
  return {
    ...actual,
    useProjectsManager: () => ({
      items: [
        {
          ...baseItemFields,
          id: 'rubicon',
          label: 'Rubicon',
          description: 'Core project',
          color: 'bg-blue-500/20',
        },
      ],
      isLoading: false,
      create: mocks.createItem,
      update: mocks.updateItem,
      remove: mocks.deleteItem,
      reorder: mocks.reorderItems,
      canDelete: mocks.canDelete,
    }),
  };
});

vi.mock('@/hooks/useSprints', () => ({
  useSprintsManager: () => ({
    items: [
      {
        ...baseItemFields,
        id: 'sprint-1',
        label: 'Sprint 1',
        description: 'Planning',
      },
    ],
    isLoading: false,
    create: mocks.createItem,
    update: mocks.updateItem,
    remove: mocks.deleteItem,
    reorder: mocks.reorderItems,
    canDelete: mocks.canDelete,
  }),
}));

describe('Manage settings Mantine migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canDelete.mockResolvedValue({
      allowed: true,
      referenceCount: 0,
      isDefault: false,
    });
    mocks.createItem.mockResolvedValue({});
    mocks.updateItem.mockResolvedValue({});
    mocks.deleteItem.mockResolvedValue({});
    mocks.reorderItems.mockResolvedValue({});
    mocks.createTemplate.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
  });

  it('renders managed-list extra fields and template actions through direct Mantine primitives', () => {
    const { container } = renderWithProviders(<ManageTab />);

    expect(screen.getByRole('combobox', { name: 'Bug icon' })).toBeDefined();
    expect(screen.getByRole('combobox', { name: 'Bug color' })).toBeDefined();
    expect(screen.getByRole('textbox', { name: 'Rubicon description' })).toBeDefined();
    expect(screen.getByRole('textbox', { name: 'Sprint 1 description' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Toggle template guide' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Delete Bug Fix' })).toBeDefined();
    expect(screen.getByText('Empty Defaults')).toBeDefined();
    expect(screen.getByText('No defaults')).toBeDefined();
    expect(container.querySelectorAll('.mantine-Select-root').length).toBeGreaterThanOrEqual(3);
    expect(container.querySelectorAll('.mantine-TextInput-root').length).toBeGreaterThanOrEqual(5);
    expect(container.querySelectorAll('.mantine-Button-root').length).toBeGreaterThanOrEqual(4);
    expect(container.querySelectorAll('.mantine-ActionIcon-root').length).toBeGreaterThanOrEqual(5);
    expect(container.querySelector('[data-slot="button"]')).toBeNull();
    expect(container.querySelector('[data-slot="input"]')).toBeNull();
    expect(container.querySelector('[data-slot="select-trigger"]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Toggle template guide' }));

    expect(screen.getByText('Template Guide')).toBeDefined();
  });

  it('creates templates through the Mantine form controls', async () => {
    const { container } = renderWithProviders(<ManageTab />);

    fireEvent.click(screen.getByRole('button', { name: 'Add template' }));

    expect(screen.getByRole('textbox', { name: 'Name *' })).toBeDefined();
    expect(screen.getByRole('textbox', { name: 'Description' })).toBeDefined();
    expect(screen.getByRole('combobox', { name: 'Category' })).toBeDefined();
    expect(screen.getByRole('combobox', { name: 'Default Type' })).toBeDefined();
    expect(screen.getByRole('combobox', { name: 'Default Priority' })).toBeDefined();
    expect(screen.getByRole('textbox', { name: 'Default Project' })).toBeDefined();
    expect(screen.getByRole('combobox', { name: 'Preferred Agent' })).toBeDefined();
    expect(screen.getByRole('textbox', { name: 'Description Template' })).toBeDefined();
    expect(container.querySelector('.mantine-Textarea-root')).toBeDefined();

    fireEvent.change(screen.getByRole('textbox', { name: 'Name *' }), {
      target: { value: 'Ops Review' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Template' }));

    await waitFor(() => {
      expect(mocks.createTemplate).toHaveBeenCalledWith({
        name: 'Ops Review',
        description: undefined,
        category: undefined,
        taskDefaults: {
          type: undefined,
          priority: undefined,
          project: undefined,
          agent: undefined,
          descriptionTemplate: undefined,
        },
      });
    });
  });
});
