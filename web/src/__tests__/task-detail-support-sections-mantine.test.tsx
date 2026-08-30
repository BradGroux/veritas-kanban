import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AttachmentsSection } from '@/components/task/AttachmentsSection';
import { CommentsSection } from '@/components/task/CommentsSection';
import { ObservationsSection } from '@/components/task/ObservationsSection';
import { TimeTrackingSection } from '@/components/task/TimeTrackingSection';
import { createMockTask, renderWithProviders } from './test-utils';

const mocks = vi.hoisted(() => ({
  addComment: vi.fn(),
  editComment: vi.fn(),
  deleteComment: vi.fn(),
  uploadAttachment: vi.fn(),
  deleteAttachment: vi.fn(),
  getAttachmentText: vi.fn(),
  timeStart: vi.fn(),
  timeStop: vi.fn(),
  timeAddEntry: vi.fn(),
  timeDeleteEntry: vi.fn(),
  getTask: vi.fn(),
}));

vi.mock('@/hooks/useTasks', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useTasks')>('@/hooks/useTasks');
  return {
    ...actual,
    useAddComment: () => ({ mutateAsync: mocks.addComment, isPending: false }),
    useEditComment: () => ({ mutateAsync: mocks.editComment, isPending: false }),
    useDeleteComment: () => ({ mutateAsync: mocks.deleteComment, isPending: false }),
  };
});

vi.mock('@/hooks/useFeatureSettings', () => ({
  useFeatureSettings: () => ({
    settings: {
      markdown: {
        enableMarkdown: false,
      },
    },
  }),
}));

vi.mock('@/hooks/useAttachments', () => ({
  useUploadAttachment: () => ({ mutateAsync: mocks.uploadAttachment, isPending: false }),
  useDeleteAttachment: () => ({ mutateAsync: mocks.deleteAttachment, isPending: false }),
}));

vi.mock('@/lib/api', () => ({
  api: {
    tasks: {
      get: mocks.getTask,
    },
    time: {
      start: mocks.timeStart,
      stop: mocks.timeStop,
      addEntry: mocks.timeAddEntry,
      deleteEntry: mocks.timeDeleteEntry,
    },
    attachments: {
      getText: mocks.getAttachmentText,
    },
  },
}));

describe('task detail support sections Mantine migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    mocks.addComment.mockResolvedValue(undefined);
    mocks.editComment.mockResolvedValue(undefined);
    mocks.deleteComment.mockResolvedValue(undefined);
    mocks.uploadAttachment.mockResolvedValue(undefined);
    mocks.deleteAttachment.mockResolvedValue(undefined);
    mocks.getAttachmentText.mockResolvedValue({
      attachmentId: 'attachment-1',
      text: 'Extracted design notes',
      hasText: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders comments through direct Mantine controls and keeps mutations wired', async () => {
    const user = userEvent.setup();
    const task = createMockTask({
      id: 'task-comments',
      comments: [
        {
          id: 'comment-1',
          author: 'Veritas',
          text: 'Initial review note',
          timestamp: '2026-06-01T09:00:00Z',
        },
      ],
    });

    const { baseElement, container } = renderWithProviders(<CommentsSection task={task} />);

    expect(container.querySelector('.mantine-TextInput-root')).toBeDefined();
    expect(container.querySelector('.mantine-Paper-root')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="input"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="textarea"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="button"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="alert-dialog-content"]')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Edit comment by Veritas' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit comment text' }), {
      target: { value: 'Edited review note' },
    });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    fireEvent.change(screen.getByRole('textbox', { name: 'Comment author' }), {
      target: { value: 'Reviewer' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Comment text' }), {
      target: { value: 'New follow-up' },
    });
    await user.click(screen.getByRole('button', { name: 'Add Comment' }));

    await user.click(screen.getByRole('button', { name: 'Delete comment by Veritas' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete comment?' });
    expect(baseElement.querySelector('.mantine-Modal-content')).toBeDefined();
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(mocks.editComment).toHaveBeenCalledWith({
      taskId: task.id,
      commentId: 'comment-1',
      text: 'Edited review note',
    });
    expect(mocks.addComment).toHaveBeenCalledWith({
      taskId: task.id,
      author: 'Reviewer',
      text: 'New follow-up',
    });
    expect(mocks.deleteComment).toHaveBeenCalledWith({
      taskId: task.id,
      commentId: 'comment-1',
    });
  });

  it('renders attachments through direct Mantine controls and preserves upload, preview, and delete', async () => {
    const user = userEvent.setup();
    const task = createMockTask({
      id: 'task-attachments',
      attachments: [
        {
          id: 'attachment-1',
          filename: 'design.md',
          originalName: 'Design Notes.md',
          mimeType: 'text/markdown',
          size: 2048,
          uploaded: '2026-06-01T09:00:00Z',
        },
        {
          id: 'attachment-2',
          filename: 'screenshot.png',
          originalName: 'Screenshot.png',
          mimeType: 'image/png',
          size: 4096,
          uploaded: '2026-06-01T09:05:00Z',
        },
      ],
    });

    const { baseElement, container } = renderWithProviders(<AttachmentsSection task={task} />);

    expect(container.querySelector('.mantine-Alert-root')).toBeDefined();
    expect(container.querySelector('.mantine-ActionIcon-root')).toBeDefined();
    expect(container.querySelector('.mantine-Paper-root')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="button"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="label"]')).toBeNull();

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['notes'], 'notes.md', { type: 'text/markdown' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await user.click(screen.getByRole('button', { name: 'Expand text preview' }));
    expect(await screen.findByText('Extracted design notes')).toBeDefined();

    await user.click(screen.getAllByRole('button', { name: 'Delete attachment' })[0]);
    const dialog = screen.getByRole('dialog', { name: 'Delete attachment?' });
    expect(baseElement.querySelector('.mantine-Modal-content')).toBeDefined();
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(mocks.uploadAttachment).toHaveBeenCalledWith({
      taskId: task.id,
      formData: expect.any(FormData),
    });
    expect(mocks.getAttachmentText).toHaveBeenCalledWith(task.id, 'attachment-1');
    expect(mocks.deleteAttachment).toHaveBeenCalledWith({
      taskId: task.id,
      attachmentId: 'attachment-1',
    });
  });

  it('renders observations through direct Mantine select, slider, textarea, badges, and modal', async () => {
    const user = userEvent.setup();
    const onAddObservation = vi.fn().mockResolvedValue(undefined);
    const onDeleteObservation = vi.fn().mockResolvedValue(undefined);
    const task = createMockTask({
      id: 'task-observations',
      observations: [
        {
          id: 'obs-1',
          type: 'insight',
          content: 'Documented rollout risk',
          score: 7,
          timestamp: '2026-06-01T09:00:00Z',
          agent: 'planner',
        },
      ],
    });

    const { baseElement, container } = renderWithProviders(
      <ObservationsSection
        task={task}
        onAddObservation={onAddObservation}
        onDeleteObservation={onDeleteObservation}
      />
    );

    expect(container.querySelector('.mantine-Badge-root')).toBeDefined();
    expect(container.querySelector('.mantine-Paper-root')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="select-trigger"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="textarea"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="alert-dialog-content"]')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Add Observation' }));
    expect(container.querySelector('.mantine-Select-root')).toBeDefined();
    expect(container.querySelector('.mantine-Slider-root')).toBeDefined();
    expect(container.querySelector('.mantine-Textarea-root')).toBeDefined();

    fireEvent.change(
      screen.getByPlaceholderText('Record a decision, blocker, insight, or context...'),
      {
        target: { value: 'Keep mobile QA in scope' },
      }
    );
    await user.click(screen.getByRole('button', { name: 'Add Observation' }));

    await user.click(
      screen.getByRole('button', { name: 'Delete observation: Documented rollout risk' })
    );
    const dialog = screen.getByRole('dialog', { name: 'Delete Observation' });
    expect(baseElement.querySelector('.mantine-Modal-content')).toBeDefined();
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(onAddObservation).toHaveBeenCalledWith({
      type: 'context',
      content: 'Keep mobile QA in scope',
      score: 5,
    });
    expect(onDeleteObservation).toHaveBeenCalledWith('obs-1');
  });

  it('renders time tracking through direct Mantine controls and keeps manual entry mutations wired', async () => {
    const user = userEvent.setup();
    const task = createMockTask({
      id: 'task-time',
      timeTracking: {
        totalSeconds: 1800,
        isRunning: false,
        entries: [
          {
            id: 'entry-1',
            startTime: '2026-06-01T09:00:00Z',
            endTime: '2026-06-01T09:30:00Z',
            duration: 1800,
            description: 'Initial QA pass',
            manual: true,
          },
        ],
      },
    });

    mocks.timeAddEntry.mockResolvedValue({
      ...task,
      timeTracking: {
        totalSeconds: 4500,
        isRunning: false,
        entries: [
          ...(task.timeTracking?.entries ?? []),
          {
            id: 'entry-2',
            startTime: '2026-06-01T10:00:00Z',
            endTime: '2026-06-01T10:45:00Z',
            duration: 2700,
            description: 'Manual QA',
            manual: true,
          },
        ],
      },
    });
    mocks.timeDeleteEntry.mockResolvedValue({
      ...task,
      timeTracking: {
        totalSeconds: 0,
        isRunning: false,
        entries: [],
      },
    });

    const { baseElement, container } = renderWithProviders(<TimeTrackingSection task={task} />);

    expect(container.querySelector('.mantine-Paper-root')).toBeDefined();
    expect(container.querySelector('.mantine-ScrollArea-root')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="dialog-content"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="input"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="button"]')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Add Time' }));
    expect(baseElement.querySelector('.mantine-Modal-content')).toBeDefined();
    fireEvent.change(screen.getByRole('textbox', { name: 'Duration' }), {
      target: { value: '45m' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Description (optional)' }), {
      target: { value: 'Manual QA' },
    });
    await user.click(screen.getByRole('button', { name: 'Add Entry' }));

    await waitFor(() => {
      expect(mocks.timeAddEntry).toHaveBeenCalledWith(task.id, 2700, 'Manual QA');
    });

    await user.click(screen.getAllByRole('button', { name: 'Delete time entry' })[0]);

    expect(mocks.timeDeleteEntry).toHaveBeenCalledWith(task.id, 'entry-2');
  });
});
