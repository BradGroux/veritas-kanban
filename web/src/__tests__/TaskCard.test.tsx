/**
 * Tests for components/task/TaskCard.tsx — rendering, badges, and interactions.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskCard } from '@/components/task/TaskCard';
import { createMockTask } from './test-utils';
import { MantineRoot } from '@/theme/MantineRoot';
import type { Task } from '@veritas-kanban/shared';

// ── Mocks ────────────────────────────────────────────────────

const { sortableKeyDown } = vi.hoisted(() => ({ sortableKeyDown: vi.fn() }));

// Mock @dnd-kit/sortable — card uses useSortable
vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {},
    listeners: { onKeyDown: sortableKeyDown },
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}));

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => undefined } },
}));

// Mock useBulkActions
vi.mock('@/hooks/useBulkActions', () => ({
  useBulkActions: () => ({
    isSelecting: false,
    toggleSelect: vi.fn(),
    toggleGroup: vi.fn(),
    isSelected: () => false,
    selectedIds: new Set(),
  }),
}));

// Mock useFeatureSettings
vi.mock('@/hooks/useFeatureSettings', () => ({
  useFeatureSettings: () => ({
    settings: {
      board: {
        cardDensity: 'normal',
        showPriorityIndicators: true,
        showProjectBadges: true,
        showSprintBadges: true,
      },
    },
  }),
}));

// Mock useTaskConfig context
vi.mock('@/contexts/TaskConfigContext', () => ({
  useTaskConfig: () => ({
    taskTypes: [
      { id: 'feature', label: 'Feature', icon: 'Code', order: 0, created: '', updated: '' },
      { id: 'bug', label: 'Bug', icon: 'Bug', order: 1, created: '', updated: '' },
    ],
    projects: [
      {
        id: 'proj-1',
        label: 'Project One',
        order: 0,
        color: 'bg-blue-500/20 text-blue-400',
        created: '',
        updated: '',
      },
    ],
    sprints: [{ id: 'sprint-1', label: 'Sprint 1', order: 0, created: '', updated: '' }],
    isLoading: false,
  }),
}));

// Mock hooks that TaskCard imports
vi.mock('@/hooks/useTimeTracking', () => ({
  formatDuration: (seconds: number) => `${Math.floor(seconds / 60)}m`,
}));

vi.mock('@/hooks/useTaskTypes', () => ({
  getTypeIcon: () => () => React.createElement('span', { 'data-testid': 'type-icon' }),
  getTypeColor: () => 'border-l-violet-500',
}));

vi.mock('@/hooks/useProjects', () => ({
  getProjectColor: () => 'bg-blue-500/20 text-blue-400',
  getProjectLabel: () => 'Project One',
}));

vi.mock('@/hooks/useSprints', () => ({
  getSprintLabel: () => 'Sprint 1',
}));

vi.mock('@/lib/sanitize', () => ({
  sanitizeText: (text: string) => text,
}));

// ── Helpers ──────────────────────────────────────────────────

function ensureMantineBrowserApis() {
  if (typeof window.matchMedia !== 'function') {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }

  if (typeof window.ResizeObserver !== 'function') {
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    });
  }

  if (typeof Element.prototype.scrollIntoView !== 'function') {
    Element.prototype.scrollIntoView = () => {};
  }
}

function renderCard(task: Task, props: Partial<React.ComponentProps<typeof TaskCard>> = {}) {
  ensureMantineBrowserApis();
  return render(
    <MantineRoot env="test">
      <TaskCard task={task} {...props} />
    </MantineRoot>
  );
}

// ── Tests ────────────────────────────────────────────────────

describe('TaskCard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sortableKeyDown.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders task title', () => {
    const task = createMockTask({ title: 'Implement login' });
    renderCard(task);
    expect(screen.getByText('Implement login')).toBeDefined();
  });

  it('renders task description when not compact', () => {
    const task = createMockTask({ description: 'Add OAuth2 support' });
    renderCard(task);
    expect(screen.getByText('Add OAuth2 support')).toBeDefined();
  });

  it('renders priority badge', () => {
    const task = createMockTask({ priority: 'high' });
    renderCard(task);
    expect(screen.getByText('high')).toBeDefined();
  });

  it('renders type label', () => {
    const task = createMockTask({ type: 'feature' });
    renderCard(task);
    expect(screen.getByText('Feature')).toBeDefined();
  });

  it('renders project badge when project is set', () => {
    const task = createMockTask({ project: 'proj-1' });
    renderCard(task);
    expect(screen.getByText('Project One')).toBeDefined();
  });

  it('renders sprint badge when sprint is set', () => {
    const task = createMockTask({ sprint: 'sprint-1' });
    renderCard(task);
    expect(screen.getByText('Sprint 1')).toBeDefined();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    const task = createMockTask();
    renderCard(task, { onClick });

    const card = screen.getByRole('article');
    fireEvent.click(card);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('dismisses its tooltip when activated and keeps it suppressed until pointer exit', async () => {
    const onClick = vi.fn();
    const task = createMockTask({ title: 'Open task details' });
    const { baseElement } = renderCard(task, { onClick });
    const card = screen.getByRole('article');

    fireEvent.mouseEnter(card);
    await waitFor(() => expect(baseElement.querySelector('[role="tooltip"]')).not.toBeNull(), {
      timeout: 1000,
    });

    fireEvent.click(card);

    await waitFor(() => expect(baseElement.querySelector('[role="tooltip"]')).toBeNull());
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('supports touch status changes without opening the task card', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const onStatusChange = vi.fn();
    const task = createMockTask({ title: 'Touch status task', status: 'todo' });

    renderCard(task, {
      canChangeStatus: true,
      onClick,
      onStatusChange,
      showStatusControl: true,
      statusOptions: [
        { value: 'todo', label: 'To Do' },
        { value: 'in-progress', label: 'In Progress' },
        { value: 'blocked', label: 'Blocked' },
        { value: 'done', label: 'Done' },
      ],
    });

    await user.click(screen.getByRole('combobox', { name: 'Change status for Touch status task' }));
    await user.click(await screen.findByRole('option', { name: 'In Progress' }));

    expect(onStatusChange).toHaveBeenCalledWith('in-progress');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('handles Enter key press', () => {
    const onClick = vi.fn();
    const task = createMockTask();
    renderCard(task, { onClick });

    const card = screen.getByRole('article');
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('opens with Space when drag and drop is disabled', () => {
    const onClick = vi.fn();
    const task = createMockTask();
    renderCard(task, { dragEnabled: false, onClick });

    const card = screen.getByRole('article');
    fireEvent.keyDown(card, { key: ' ' });
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('delegates Space to the keyboard drag sensor when drag and drop is enabled', () => {
    const onClick = vi.fn();
    const task = createMockTask();
    renderCard(task, { dragEnabled: true, onClick });

    const card = screen.getByRole('article');
    fireEvent.keyDown(card, { key: ' ' });

    expect(sortableKeyDown).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
    expect(card.getAttribute('data-task-id')).toBe(task.id);
  });

  it('applies selected ring when isSelected', () => {
    const task = createMockTask();
    renderCard(task, { isSelected: true });

    const card = screen.getByRole('article');
    expect(card.className).toContain('ring-2');
    expect(card.className).toContain('ring-primary');
  });

  it('shows blocked badge when isBlocked', () => {
    const task = createMockTask();
    renderCard(task, { isBlocked: true, blockerTitles: ['Dependency A'] });

    expect(screen.getByText('Blocked')).toBeDefined();
  });

  it('shows agent running indicator', () => {
    const task = createMockTask({
      attempt: {
        id: 'attempt-1',
        agent: 'claude-code',
        status: 'running',
        started: '2025-01-01T00:00:00Z',
      },
    });
    renderCard(task);
    expect(screen.getByText(/Claude running/)).toBeDefined();
  });

  it('shows subtask progress', () => {
    const task = createMockTask({
      subtasks: [
        { id: 's1', title: 'Sub 1', completed: true, created: '2025-01-01T00:00:00Z' },
        { id: 's2', title: 'Sub 2', completed: false, created: '2025-01-01T00:00:00Z' },
        { id: 's3', title: 'Sub 3', completed: true, created: '2025-01-01T00:00:00Z' },
      ],
    });
    renderCard(task);
    expect(screen.getByText('2/3')).toBeDefined();
  });

  it('shows time tracking indicator when time is tracked', () => {
    const task = createMockTask({
      timeTracking: {
        entries: [],
        totalSeconds: 300,
        isRunning: false,
      },
    });
    renderCard(task);
    expect(screen.getByText('5m')).toBeDefined();
  });

  it('shows attachment count', () => {
    const task = createMockTask({
      attachments: [
        {
          id: 'att1',
          filename: 'f1.pdf',
          originalName: 'f1.pdf',
          mimeType: 'application/pdf',
          size: 100,
          uploaded: '2025-01-01T00:00:00Z',
        },
        {
          id: 'att2',
          filename: 'f2.png',
          originalName: 'f2.png',
          mimeType: 'image/png',
          size: 200,
          uploaded: '2025-01-01T00:00:00Z',
        },
      ],
    });
    renderCard(task);
    expect(screen.getByText('2')).toBeDefined();
  });

  it('has correct aria-label', () => {
    const task = createMockTask({
      title: 'Aria Task',
      priority: 'high',
    });
    renderCard(task);

    const card = screen.getByRole('article');
    expect(card.getAttribute('aria-label')).toContain('Aria Task');
    expect(card.getAttribute('aria-label')).toContain('high');
  });

  it('shows blocked reason category in blocked status', () => {
    const task = createMockTask({
      status: 'blocked',
      blockedReason: {
        category: 'technical-snag',
        note: 'DB migration pending',
      },
    });
    renderCard(task);
    expect(screen.getByText('Snag')).toBeDefined();
  });

  it('shows readiness metadata for code tasks', () => {
    const task = createMockTask({
      title: 'Fix',
      description: 'Too short',
      type: 'code',
      git: {
        repo: 'BradGroux/veritas-kanban',
        branch: 'readiness',
        baseBranch: 'main',
      },
    });

    renderCard(task);

    expect(screen.getByText('38% ready')).toBeDefined();
    expect(screen.getByRole('article').getAttribute('aria-label')).toContain('Readiness: 38%');
  });
});
