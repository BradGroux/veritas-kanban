/**
 * Accessibility tests — WCAG 2.1 AA compliance checks.
 *
 * Tests ARIA attributes on key components. Follows existing test patterns.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMockTask, createTestQueryClient } from './test-utils';
import type { Task } from '@veritas-kanban/shared';

afterEach(cleanup);

// ── Shared mock factory ──────────────────────────────────────

const mutationMock = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });

// Full useTasks mock covering all exports used by components
vi.mock('@/hooks/useTasks', () => ({
  useTasks: () => ({ data: [], isLoading: false, error: null }),
  useTask: () => ({ data: null }),
  useTasksByStatus: (tasks: Task[]) => {
    const result: Record<string, Task[]> = {
      todo: [],
      planning: [],
      'in-progress': [],
      blocked: [],
      done: [],
    };
    for (const t of tasks) {
      if (result[t.status]) result[t.status].push(t);
    }
    return result;
  },
  useUpdateTask: () => mutationMock(),
  useReorderTasks: () => mutationMock(),
  useAddComment: () => mutationMock(),
  useEditComment: () => mutationMock(),
  useDeleteComment: () => mutationMock(),
  useAddSubtask: () => mutationMock(),
  useUpdateSubtask: () => mutationMock(),
  useDeleteSubtask: () => mutationMock(),
}));

vi.mock('@/hooks/useChat', () => ({
  useChatSession: () => ({ data: null }),
  useChatSessions: () => ({ data: [] }),
  useSendChatMessage: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteChatSession: () => ({ mutate: vi.fn() }),
  useChatStream: () => ({ streamingMessage: null }),
}));

vi.mock('@/hooks/useTaskSync', () => ({
  chatEventTarget: new EventTarget(),
}));

// ── Helper ───────────────────────────────────────────────────

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = createTestQueryClient();
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

// ── Tests ────────────────────────────────────────────────────

describe('CommentsSection accessibility', () => {
  it('renders section with aria-label', async () => {
    const { CommentsSection } = await import('@/components/task/CommentsSection');
    const task = createMockTask({ comments: [] });
    renderWithQuery(<CommentsSection task={task} />);

    expect(screen.getByRole('region', { name: 'Comments' })).toBeDefined();
  });

  it('renders comment textarea with aria-label', async () => {
    const { CommentsSection } = await import('@/components/task/CommentsSection');
    const task = createMockTask({ comments: [] });
    renderWithQuery(<CommentsSection task={task} />);

    expect(screen.getByLabelText('New comment')).toBeDefined();
  });

  it('renders author input with aria-label', async () => {
    const { CommentsSection } = await import('@/components/task/CommentsSection');
    const task = createMockTask({ comments: [] });
    renderWithQuery(<CommentsSection task={task} />);

    expect(screen.getByLabelText('Comment author name')).toBeDefined();
  });
});

describe('SubtasksSection accessibility', () => {
  it('renders section with aria-label', async () => {
    const { SubtasksSection } = await import('@/components/task/SubtasksSection');
    const task = createMockTask({ subtasks: [] });
    renderWithQuery(<SubtasksSection task={task} onAutoCompleteChange={vi.fn()} />);

    expect(screen.getByRole('region', { name: 'Subtasks' })).toBeDefined();
  });

  it('renders add subtask button with aria-label', async () => {
    const { SubtasksSection } = await import('@/components/task/SubtasksSection');
    const task = createMockTask({ subtasks: [] });
    renderWithQuery(<SubtasksSection task={task} onAutoCompleteChange={vi.fn()} />);

    expect(screen.getByLabelText('Add subtask')).toBeDefined();
  });

  it('renders subtask input with aria-label', async () => {
    const { SubtasksSection } = await import('@/components/task/SubtasksSection');
    const task = createMockTask({ subtasks: [] });
    renderWithQuery(<SubtasksSection task={task} onAutoCompleteChange={vi.fn()} />);

    expect(screen.getByLabelText('New subtask title')).toBeDefined();
  });

  it('renders checkbox with descriptive aria-label per subtask', async () => {
    const { SubtasksSection } = await import('@/components/task/SubtasksSection');
    const task = createMockTask({
      subtasks: [
        { id: 's1', title: 'Write tests', completed: false, created: '2026-01-01T00:00:00Z' },
        { id: 's2', title: 'Review code', completed: true, created: '2026-01-01T00:00:00Z' },
      ],
    });
    renderWithQuery(<SubtasksSection task={task} onAutoCompleteChange={vi.fn()} />);

    expect(screen.getByLabelText('Mark "Write tests" as complete')).toBeDefined();
    expect(screen.getByLabelText('Mark "Review code" as incomplete')).toBeDefined();
  });

  it('renders delete button with descriptive aria-label per subtask', async () => {
    const { SubtasksSection } = await import('@/components/task/SubtasksSection');
    const task = createMockTask({
      subtasks: [
        { id: 's1', title: 'Write tests', completed: false, created: '2026-01-01T00:00:00Z' },
      ],
    });
    renderWithQuery(<SubtasksSection task={task} onAutoCompleteChange={vi.fn()} />);

    expect(screen.getByLabelText('Delete subtask: Write tests')).toBeDefined();
  });
});

describe('FloatingChat accessibility', () => {
  it('renders open button with aria-label', async () => {
    const { FloatingChat } = await import('@/components/chat/FloatingChat');
    renderWithQuery(<FloatingChat />);

    expect(screen.getByLabelText('Open chat')).toBeDefined();
  });
});
