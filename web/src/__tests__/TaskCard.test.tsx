/**
 * Tests for components/task/TaskCard.tsx — rendering, badges, and interactions.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TaskCard } from '@/components/task/TaskCard';
import { createMockTask } from './test-utils';
import type { Task } from '@veritas-kanban/shared';

// ── Mocks ────────────────────────────────────────────────────

// Mock @dnd-kit/sortable — card uses useSortable
vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
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

function renderCard(task: Task, props: Partial<React.ComponentProps<typeof TaskCard>> = {}) {
  return render(<TaskCard task={task} {...props} />);
}

// ── Tests ────────────────────────────────────────────────────

describe('TaskCard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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

  it('handles Enter key press', () => {
    const onClick = vi.fn();
    const task = createMockTask();
    renderCard(task, { onClick });

    const card = screen.getByRole('article');
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('handles Space key press', () => {
    const onClick = vi.fn();
    const task = createMockTask();
    renderCard(task, { onClick });

    const card = screen.getByRole('article');
    fireEvent.keyDown(card, { key: ' ' });
    expect(onClick).toHaveBeenCalledOnce();
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

  it('shows Auto as routing only rather than concrete execution', () => {
    const task = createMockTask({ agent: 'auto', attempt: undefined });
    renderCard(task);
    expect(screen.getByText('Auto route')).toBeDefined();
    expect(screen.queryByText(/Auto running/)).toBeNull();
  });

  it('shows concrete Hermes profile assignment on the card', () => {
    const task = createMockTask({ agent: 'aura', attempt: undefined });
    renderCard(task);
    expect(screen.getByText('Profile: Aura')).toBeDefined();
  });

  it('shows concrete attempt profile/status when execution is running', () => {
    const task = createMockTask({
      agent: 'auto',
      attempt: {
        id: 'attempt-1',
        agent: 'aura',
        status: 'running',
        started: '2025-01-01T00:00:00Z',
      },
    });
    renderCard(task);
    expect(screen.getByText(/Aura running/)).toBeDefined();
    expect(screen.queryByText('Auto route')).toBeNull();
  });

  it('shows Hermes profile instead of Veritas bridge owner for bridged execution', () => {
    const task = createMockTask({
      agent: 'aura',
      attempt: {
        id: 'claim_hermes-kanban:t_123',
        agent: 'veritas',
        status: 'running',
        started: '2025-01-01T00:00:00Z',
      },
      claim: {
        agent: 'aura',
        sessionId: 'hermes-kanban:t_123',
        claimedAt: '2025-01-01T00:00:00Z',
        leaseExpiresAt: '2025-01-01T01:00:00Z',
        routingRule: 'veritas-hermes-kanban-bridge',
      },
    });
    renderCard(task);
    expect(screen.getByText(/Aura running/)).toBeDefined();
    expect(screen.queryByText(/Veritas running/)).toBeNull();
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
});
