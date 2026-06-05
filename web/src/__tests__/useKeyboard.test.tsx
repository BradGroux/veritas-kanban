/**
 * Tests for hooks/useKeyboard.tsx — KeyboardProvider & keyboard shortcuts.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { Task, TaskStatus } from '@veritas-kanban/shared';
import { createMockTask } from './test-utils';

// Mock toast — vi.mock is hoisted before imports.
// useKeyboard.tsx imports from relative path but vitest resolves @/ aliases in mocks.
vi.mock('@/hooks/useToast', () => ({
  toast: vi.fn(),
  useToast: () => ({ toast: vi.fn(), toasts: [], dismiss: vi.fn() }),
  default: vi.fn(),
}));

const featureSettingsMock = vi.hoisted(() => ({
  settings: {
    board: {
      columns: [
        { id: 'todo', title: 'To Do' },
        { id: 'in-progress', title: 'In Progress' },
        { id: 'blocked', title: 'Blocked' },
        { id: 'done', title: 'Done' },
      ],
    },
  },
}));

vi.mock('@/hooks/useFeatureSettings', () => ({
  useFeatureSettings: () => featureSettingsMock,
}));

import { KeyboardProvider, useKeyboard } from '@/hooks/useKeyboard';

// ── Test Component ───────────────────────────────────────────

/** Stable empty array to avoid infinite re-render loops from default params. */
const EMPTY_TASKS: Task[] = [];

function TestConsumer({
  tasks = EMPTY_TASKS,
  onOpenTask,
  onMoveTask,
}: {
  tasks?: Task[];
  onOpenTask?: (task: Task) => void;
  onMoveTask?: (taskId: string, status: TaskStatus) => void;
}) {
  const { setTasks, setOnOpenTask, setOnMoveTask, selectedTaskId, isHelpOpen, openHelpDialog } =
    useKeyboard();

  React.useEffect(() => {
    setTasks(tasks);
  }, [tasks, setTasks]);

  React.useEffect(() => {
    if (onOpenTask) setOnOpenTask(onOpenTask);
    if (onMoveTask) setOnMoveTask(onMoveTask);
  }, [onOpenTask, onMoveTask, setOnOpenTask, setOnMoveTask]);

  return (
    <div>
      <div data-testid="selected">{selectedTaskId ?? 'none'}</div>
      <div data-testid="help-open">{isHelpOpen ? 'yes' : 'no'}</div>
      <button data-testid="open-help" onClick={openHelpDialog}>
        Open Help
      </button>
    </div>
  );
}

function renderWithProvider(props: React.ComponentProps<typeof TestConsumer> = {}) {
  return render(
    <KeyboardProvider>
      <TestConsumer {...props} />
    </KeyboardProvider>
  );
}

// ── Tests ────────────────────────────────────────────────────

describe('KeyboardProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    featureSettingsMock.settings = {
      board: {
        columns: [
          { id: 'todo', title: 'To Do' },
          { id: 'in-progress', title: 'In Progress' },
          { id: 'blocked', title: 'Blocked' },
          { id: 'done', title: 'Done' },
        ],
      },
    };
  });

  afterEach(() => {
    cleanup();
  });

  it('throws when useKeyboard is used outside provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    function BadConsumer() {
      useKeyboard();
      return null;
    }

    expect(() => render(<BadConsumer />)).toThrow(
      'useKeyboard must be used within KeyboardProvider'
    );
  });

  it('starts with no selected task and help closed', () => {
    renderWithProvider();
    expect(screen.getByTestId('selected').textContent).toBe('none');
    expect(screen.getByTestId('help-open').textContent).toBe('no');
  });

  it('toggles help dialog with ? key', () => {
    renderWithProvider();
    fireEvent.keyDown(window, { key: '?' });
    expect(screen.getByTestId('help-open').textContent).toBe('yes');

    fireEvent.keyDown(window, { key: '?' });
    expect(screen.getByTestId('help-open').textContent).toBe('no');
  });

  it('closes help dialog with Escape', () => {
    renderWithProvider();
    fireEvent.keyDown(window, { key: '?' });
    expect(screen.getByTestId('help-open').textContent).toBe('yes');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('help-open').textContent).toBe('no');
  });

  it('navigates tasks with j/k keys', () => {
    const tasks = [
      createMockTask({ id: 'a', title: 'Alpha', status: 'todo' }),
      createMockTask({ id: 'b', title: 'Beta', status: 'todo' }),
      createMockTask({ id: 'c', title: 'Charlie', status: 'todo' }),
    ];

    renderWithProvider({ tasks });

    fireEvent.keyDown(window, { key: 'j' });
    expect(screen.getByTestId('selected').textContent).toBe('a');

    fireEvent.keyDown(window, { key: 'j' });
    expect(screen.getByTestId('selected').textContent).toBe('b');

    fireEvent.keyDown(window, { key: 'k' });
    expect(screen.getByTestId('selected').textContent).toBe('a');
  });

  it('navigates tasks with arrow keys', () => {
    const tasks = [
      createMockTask({ id: 'x', title: 'X', status: 'todo' }),
      createMockTask({ id: 'y', title: 'Y', status: 'todo' }),
    ];

    renderWithProvider({ tasks });

    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(screen.getByTestId('selected').textContent).toBe('x');

    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(screen.getByTestId('selected').textContent).toBe('y');

    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(screen.getByTestId('selected').textContent).toBe('x');
  });

  it('wraps around when navigating past the last/first task', () => {
    const tasks = [
      createMockTask({ id: 'first', title: 'First', status: 'todo' }),
      createMockTask({ id: 'last', title: 'Last', status: 'todo' }),
    ];

    renderWithProvider({ tasks });

    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'j' });
    expect(screen.getByTestId('selected').textContent).toBe('last');

    fireEvent.keyDown(window, { key: 'j' });
    expect(screen.getByTestId('selected').textContent).toBe('first');
  });

  it('opens task with Enter key', () => {
    const tasks = [createMockTask({ id: 'enter-test', title: 'Enter Task', status: 'todo' })];
    const onOpenTask = vi.fn();

    renderWithProvider({ tasks, onOpenTask });

    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'Enter' });

    expect(onOpenTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'enter-test' }));
  });

  it('moves task to column with number keys 1-4', () => {
    const tasks = [createMockTask({ id: 'move-test', title: 'Move Task', status: 'todo' })];
    const onMoveTask = vi.fn();

    renderWithProvider({ tasks, onMoveTask });

    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: '2' });
    expect(onMoveTask).toHaveBeenCalledWith('move-test', 'in-progress');

    fireEvent.keyDown(window, { key: '4' });
    expect(onMoveTask).toHaveBeenCalledWith('move-test', 'done');
  });

  it('maps number keys to configured custom column order', () => {
    featureSettingsMock.settings = {
      board: {
        columns: [
          { id: 'triage', title: 'Triage' },
          { id: 'todo', title: 'To Do' },
          { id: 'ready', title: 'Ready' },
          { id: 'in-progress', title: 'In Progress' },
          { id: 'done', title: 'Done' },
        ],
      },
    };
    const tasks = [createMockTask({ id: 'custom-move', title: 'Move Task', status: 'triage' })];
    const onMoveTask = vi.fn();

    renderWithProvider({ tasks, onMoveTask });

    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: '3' });

    expect(onMoveTask).toHaveBeenCalledWith('custom-move', 'ready');
  });

  it('clears selection with Escape', () => {
    const tasks = [createMockTask({ id: 'esc', title: 'Esc Task', status: 'todo' })];

    renderWithProvider({ tasks });

    fireEvent.keyDown(window, { key: 'j' });
    expect(screen.getByTestId('selected').textContent).toBe('esc');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('selected').textContent).toBe('none');
  });

  it('ignores shortcuts when typing in an input', () => {
    const tasks = [createMockTask({ id: 'input-test', title: 'Input', status: 'todo' })];

    const { container } = renderWithProvider({ tasks });

    const input = document.createElement('input');
    container.appendChild(input);

    fireEvent.keyDown(input, { key: 'j' });
    expect(screen.getByTestId('selected').textContent).toBe('none');
  });
});
