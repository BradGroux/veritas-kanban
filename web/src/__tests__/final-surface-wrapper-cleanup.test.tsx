import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';

import { TemplatesPage } from '@/components/templates/TemplatesPage';
import { renderWithProviders } from './test-utils';
import type { TaskTemplate } from '@/hooks/useTemplates';

const mocks = vi.hoisted(() => ({
  createTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
  updateTemplate: vi.fn(),
  toast: vi.fn(),
}));

const templates: TaskTemplate[] = [
  {
    id: 'template-bug',
    name: 'Bug Fix',
    description: 'Resolve a production defect',
    category: 'bug',
    version: 1,
    taskDefaults: {
      type: 'code',
      priority: 'high',
      project: 'veritas',
      agent: 'veritas',
      descriptionTemplate: 'Fix the reported issue and verify the regression path.',
    },
    subtaskTemplates: [{ title: 'Reproduce issue', order: 1 }],
    created: '2026-06-01T09:00:00.000Z',
    updated: '2026-06-01T09:00:00.000Z',
  },
  {
    id: 'template-release',
    name: 'Release Prep',
    description: 'Ship release readiness work',
    category: 'release',
    version: 1,
    taskDefaults: {
      type: 'research',
      priority: 'medium',
      project: 'veritas',
    },
    created: '2026-06-01T09:00:00.000Z',
    updated: '2026-06-01T09:00:00.000Z',
  },
];

vi.mock('@/hooks/useTemplates', async () => {
  const actual =
    await vi.importActual<typeof import('@/hooks/useTemplates')>('@/hooks/useTemplates');
  return {
    ...actual,
    useTemplates: () => ({ data: templates, isLoading: false }),
    useCreateTemplate: () => ({
      mutateAsync: mocks.createTemplate,
      isPending: false,
    }),
    useUpdateTemplate: () => ({
      mutateAsync: mocks.updateTemplate,
      isPending: false,
    }),
    useDeleteTemplate: () => ({
      mutateAsync: mocks.deleteTemplate,
      isPending: false,
    }),
  };
});

vi.mock('@/hooks/useTaskTypes', async () => {
  const actual =
    await vi.importActual<typeof import('@/hooks/useTaskTypes')>('@/hooks/useTaskTypes');
  return {
    ...actual,
    useTaskTypesManager: () => ({
      items: [
        {
          id: 'code',
          label: 'Code',
          icon: 'Code',
          color: 'border-l-blue-500',
          order: 0,
          created: '2026-06-01T09:00:00.000Z',
          updated: '2026-06-01T09:00:00.000Z',
        },
        {
          id: 'research',
          label: 'Research',
          icon: 'Search',
          color: 'border-l-violet-500',
          order: 1,
          created: '2026-06-01T09:00:00.000Z',
          updated: '2026-06-01T09:00:00.000Z',
        },
      ],
    }),
  };
});

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

describe('final Mantine feature surface cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createTemplate.mockResolvedValue({});
    mocks.updateTemplate.mockResolvedValue({});
    mocks.deleteTemplate.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
  });

  it('keeps active feature surfaces off the compatibility wrappers', () => {
    const componentSources = import.meta.glob('../components/**/*.tsx', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    const allowedCompatibilityInternals = new Set([
      'ui/alert-dialog.tsx',
      'ui/dialog.tsx',
      'ui/sheet.tsx',
    ]);
    const wrapperImportPattern =
      /from ['"](?:@\/components\/ui|(?:\.\.?\/)+ui)\/(button|badge|card|dialog|sheet|alert-dialog|tooltip|tabs|select|input|textarea|checkbox|switch|skeleton|alert|scroll-area|progress|slider|label|popover|number-input)['"]/;

    const offenders = Object.entries(componentSources)
      .map(([path, source]) => {
        const rel = path.replace('../components/', '');
        if (allowedCompatibilityInternals.has(rel)) {
          return null;
        }
        return wrapperImportPattern.test(source) ? rel : null;
      })
      .filter(Boolean);

    expect(offenders).toEqual([]);
  });

  it('renders the standalone templates surface through direct Mantine controls', async () => {
    const { baseElement, container } = renderWithProviders(<TemplatesPage onBack={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Task Templates' })).toBeDefined();
    expect(screen.getByPlaceholderText('Search templates...')).toBeDefined();
    expect(screen.getByText('Bug Fix')).toBeDefined();
    expect(screen.getByText('Release Prep')).toBeDefined();
    expect(container.querySelector('.mantine-TextInput-root')).toBeDefined();
    expect(container.querySelector('.mantine-Select-root')).toBeDefined();
    expect(container.querySelectorAll('.mantine-Button-root').length).toBeGreaterThanOrEqual(3);
    expect(container.querySelectorAll('.mantine-Badge-root').length).toBeGreaterThanOrEqual(3);
    const newTemplate = screen.getByRole('button', { name: 'New Template' });
    expect(newTemplate.getAttribute('data-variant')).toBe('filled');
    expect(newTemplate.getAttribute('data-size')).toBe('sm');
    expect(baseElement.querySelector('[data-slot="button"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="input"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="select-trigger"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="alert-dialog-content"]')).toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: 'Preview' })[0]);

    expect((await screen.findAllByText('TASK PREVIEW')).length).toBeGreaterThanOrEqual(1);
    expect(baseElement.querySelector('.mantine-Modal-root')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    fireEvent.click(screen.getByRole('button', { name: 'Delete Bug Fix' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(mocks.deleteTemplate).toHaveBeenCalledWith('template-bug');
    });
  });
});
