import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { KanbanColumn } from '@/components/board/KanbanColumn';
import { getTypeColorToken, normalizeTaskTypeColorToken } from '@/hooks/useTaskTypes';
import type { TaskTypeConfig } from '@veritas-kanban/shared';

const { dropState } = vi.hoisted(() => ({ dropState: { isOver: false } }));

vi.mock('@dnd-kit/core', () => ({
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: dropState.isOver }),
}));

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  verticalListSortingStrategy: {},
}));

vi.mock('@/hooks/useFeatureSettings', () => ({
  useFeatureSettings: () => ({ settings: { board: { showDoneMetrics: false } } }),
}));

vi.mock('@/hooks/useBulkActions', () => ({
  useBulkActions: () => ({
    isSelecting: false,
    selectedIds: new Set<string>(),
    toggleGroup: vi.fn(),
  }),
}));

vi.mock('@/hooks/useBulkTaskMetrics', () => ({
  useBulkTaskMetrics: () => ({ data: undefined }),
}));

vi.mock('@/hooks/useTasks', () => ({
  isTaskBlocked: () => false,
  getTaskBlockers: () => [],
}));

vi.mock('@/components/task/TaskCard', () => ({
  TaskCard: () => null,
}));

afterEach(() => {
  cleanup();
  dropState.isOver = false;
});

describe('board color system', () => {
  it('uses a localized status plate instead of a full-width column rail', () => {
    render(<KanbanColumn id="in-progress" title="In Progress" tasks={[]} allTasks={[]} />);

    const column = screen.getByRole('region', { name: 'In Progress' });
    const plate = screen.getByRole('heading', { name: 'In Progress' }).parentElement;
    expect(column.className).toContain('vk-kanban-column');
    expect(column.className).not.toContain('border-t-2');
    expect(plate?.getAttribute('data-status-tone')).toBe('active');
    expect(screen.getByLabelText('0 tasks').textContent).toBe('0');
  });

  it('keeps custom review columns meaningful and gives drop targets interaction color', () => {
    dropState.isOver = true;
    render(<KanbanColumn id="awaiting-review" title="Awaiting Review" tasks={[]} allTasks={[]} />);

    const column = screen.getByRole('region', { name: 'Awaiting Review' });
    expect(column.getAttribute('data-drop-target')).toBe('true');
    expect(column.className).toContain('vk-kanban-column--drop-target');
    expect(screen.getByRole('heading', { name: 'Awaiting Review' }).parentElement).toHaveProperty(
      'dataset.statusTone',
      'review'
    );
  });

  it('maps legacy persisted Tailwind colors into semantic identities', () => {
    const legacyTypes: TaskTypeConfig[] = [
      {
        id: 'legacy-research',
        label: 'Legacy Research',
        icon: 'Search',
        color: 'border-l-cyan-500',
        order: 0,
        created: '2026-01-01T00:00:00.000Z',
        updated: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'semantic-code',
        label: 'Semantic Code',
        icon: 'Code',
        colorToken: 'violet',
        color: 'border-l-red-500',
        order: 1,
        created: '2026-01-01T00:00:00.000Z',
        updated: '2026-01-01T00:00:00.000Z',
      },
    ];

    expect(normalizeTaskTypeColorToken('border-l-cyan-500')).toBe('cyan');
    expect(normalizeTaskTypeColorToken('unknown-class')).toBe('neutral');
    expect(getTypeColorToken(legacyTypes, 'legacy-research')).toBe('cyan');
    expect(getTypeColorToken(legacyTypes, 'semantic-code')).toBe('violet');
  });
});
