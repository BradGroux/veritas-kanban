import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { ManagedListManager } from '@/components/settings/ManagedListManager';
import { renderWithProviders } from './test-utils';
import type { ManagedListItem } from '@veritas-kanban/shared';
import { AVAILABLE_COLORS } from '@/hooks/useTaskTypes';

const baseItems: ManagedListItem[] = [
  {
    id: 'feature',
    label: 'Feature',
    order: 0,
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'bug',
    label: 'Bug',
    order: 1,
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-01T00:00:00.000Z',
  },
];

describe('Managed list Mantine migration', () => {
  const handlers = {
    onCreate: vi.fn(),
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
    onReorder: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    handlers.onCreate.mockResolvedValue({});
    handlers.onUpdate.mockResolvedValue({});
    handlers.onDelete.mockResolvedValue({});
    handlers.onReorder.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
  });

  function renderManagedList() {
    return renderWithProviders(
      <ManagedListManager
        title="Task Types"
        items={baseItems}
        isLoading={false}
        newItemDefaults={{ isHidden: false }}
        {...handlers}
      />
    );
  }

  it('renders add and reorder controls through direct Mantine primitives', async () => {
    const { container } = renderManagedList();

    expect(screen.getByRole('heading', { name: 'Task Types' })).toBeDefined();
    expect(screen.getByPlaceholderText('New item name...')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Add' })).toBeDefined();
    expect(container.querySelector('.mantine-TextInput-root')).toBeDefined();
    expect(container.querySelector('.mantine-Button-root')).toBeDefined();
    expect(container.querySelectorAll('.mantine-ActionIcon-root').length).toBeGreaterThanOrEqual(6);

    fireEvent.change(screen.getByPlaceholderText('New item name...'), {
      target: { value: 'Spike' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(handlers.onCreate).toHaveBeenCalledWith({
        label: 'Spike',
        isHidden: false,
      });
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Move down' })[0]);

    expect(handlers.onReorder).toHaveBeenCalledWith(['bug', 'feature']);
  });

  it('edits item labels through Mantine text input', async () => {
    const { container } = renderManagedList();

    fireEvent.click(screen.getByText('Feature'));

    const editInput = screen.getByRole('textbox', { name: 'Edit Feature' });
    expect(container.querySelectorAll('.mantine-TextInput-root').length).toBeGreaterThanOrEqual(2);

    fireEvent.change(editInput, { target: { value: 'Feature Work' } });
    fireEvent.blur(editInput);

    await waitFor(() => {
      expect(handlers.onUpdate).toHaveBeenCalledWith('feature', {
        label: 'Feature Work',
      });
    });
  });

  it('keeps the task-type default color available in the Manage tab picker', () => {
    expect(AVAILABLE_COLORS).toContainEqual({
      value: 'border-l-gray-500',
      label: 'Gray',
    });
  });
});
