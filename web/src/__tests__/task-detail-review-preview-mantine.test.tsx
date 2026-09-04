import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { ConflictResolver } from '@/components/task/ConflictResolver';
import { PreviewPanel } from '@/components/task/PreviewPanel';
import { ReviewPanel } from '@/components/task/ReviewPanel';
import { DiffLineView } from '@/components/task/diff/DiffLine';
import { CommentDisplay, CommentInput } from '@/components/task/diff/ReviewComment';
import { createMockTask, renderWithProviders } from './test-utils';

const mocks = vi.hoisted(() => ({
  mergeWorktreeMutate: vi.fn(),
  usePreviewStatus: vi.fn(),
  usePreviewOutput: vi.fn(),
  startPreviewMutate: vi.fn(),
  stopPreviewMutate: vi.fn(),
  useConflictStatus: vi.fn(),
  useFileConflict: vi.fn(),
  resolveConflictMutateAsync: vi.fn(),
  abortConflictMutateAsync: vi.fn(),
  continueConflictMutateAsync: vi.fn(),
  createDecisionReviewMutateAsync: vi.fn(),
  recordDecisionReviewResponseMutateAsync: vi.fn(),
  recordDecisionReviewCritiqueMutateAsync: vi.fn(),
  finalizeDecisionReviewMutateAsync: vi.fn(),
  cancelDecisionReviewMutate: vi.fn(),
  exportDecisionReviewMutateAsync: vi.fn(),
  useDecisionReviews: vi.fn(),
}));

vi.mock('@/hooks/useWorktree', () => ({
  useMergeWorktree: () => ({
    mutate: mocks.mergeWorktreeMutate,
    mutateAsync: mocks.mergeWorktreeMutate,
    isPending: false,
  }),
}));

vi.mock('@/hooks/usePreview', () => ({
  usePreviewStatus: mocks.usePreviewStatus,
  usePreviewOutput: mocks.usePreviewOutput,
  useStartPreview: () => ({
    mutate: mocks.startPreviewMutate,
    mutateAsync: mocks.startPreviewMutate,
    isPending: false,
    error: null,
  }),
  useStopPreview: () => ({
    mutate: mocks.stopPreviewMutate,
    mutateAsync: mocks.stopPreviewMutate,
    isPending: false,
  }),
}));

vi.mock('@/hooks/useConflicts', () => ({
  useConflictStatus: mocks.useConflictStatus,
  useFileConflict: mocks.useFileConflict,
  useResolveConflict: () => ({
    mutateAsync: mocks.resolveConflictMutateAsync,
    isPending: false,
  }),
  useAbortConflict: () => ({
    mutateAsync: mocks.abortConflictMutateAsync,
    isPending: false,
  }),
  useContinueConflict: () => ({
    mutateAsync: mocks.continueConflictMutateAsync,
    isPending: false,
  }),
}));

vi.mock('@/hooks/useConfig', () => ({
  useAgentProfiles: () => ({ data: [], isLoading: false }),
}));

vi.mock('@/hooks/useDecisionReviews', () => ({
  useDecisionReviews: mocks.useDecisionReviews,
  useCreateDecisionReview: () => ({
    mutateAsync: mocks.createDecisionReviewMutateAsync,
    isPending: false,
  }),
  useRecordDecisionReviewResponse: () => ({
    mutateAsync: mocks.recordDecisionReviewResponseMutateAsync,
    isPending: false,
  }),
  useRecordDecisionReviewCritique: () => ({
    mutateAsync: mocks.recordDecisionReviewCritiqueMutateAsync,
    isPending: false,
  }),
  useFinalizeDecisionReview: () => ({
    mutateAsync: mocks.finalizeDecisionReviewMutateAsync,
    isPending: false,
  }),
  useCancelDecisionReview: () => ({
    mutate: mocks.cancelDecisionReviewMutate,
    isPending: false,
  }),
  useExportDecisionReview: () => ({
    mutateAsync: mocks.exportDecisionReviewMutateAsync,
    isPending: false,
  }),
}));

describe('task detail review and preview Mantine migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal('open', vi.fn());
    mocks.mergeWorktreeMutate.mockReset().mockResolvedValue(undefined);
    mocks.startPreviewMutate.mockReset().mockResolvedValue(undefined);
    mocks.stopPreviewMutate.mockReset().mockResolvedValue(undefined);
    mocks.resolveConflictMutateAsync.mockResolvedValue({ success: true });
    mocks.abortConflictMutateAsync.mockResolvedValue({ success: true });
    mocks.continueConflictMutateAsync.mockResolvedValue({ success: true });
    mocks.useDecisionReviews.mockReturnValue({ data: [], isLoading: false });
    mocks.createDecisionReviewMutateAsync.mockResolvedValue({
      id: 'decision_review_new',
      taskId: 'task-review',
      title: 'Decision Review: Review task',
      prompt: 'Review task',
      context: 'Review task',
      sourceType: 'task',
      rounds: 1,
      participants: [
        { id: 'architect', label: 'Architect' },
        { id: 'reviewer', label: 'Reviewer' },
      ],
      status: 'collecting',
      initialResponses: [],
      critiqueRounds: [],
      createdAt: '2026-06-01T09:00:00Z',
      updatedAt: '2026-06-01T09:00:00Z',
    });
    mocks.recordDecisionReviewResponseMutateAsync.mockResolvedValue({ id: 'decision_review_new' });
    mocks.recordDecisionReviewCritiqueMutateAsync.mockResolvedValue({ id: 'decision_review_new' });
    mocks.finalizeDecisionReviewMutateAsync.mockResolvedValue({
      id: 'decision_review_new',
      taskId: 'task-review',
      status: 'synthesized',
      finalPacket: {
        recommendation: 'Use staged rollout',
        dissentingViews: [],
        assumptions: [],
        risks: [],
        validationPlan: [],
        followUpTasks: [],
        confidenceLevel: 80,
        riskScore: 35,
        workProductId: 'wp_decision_review',
        decisionId: 'decision_review_audit',
      },
    });
    mocks.exportDecisionReviewMutateAsync.mockResolvedValue('# Decision Review');
    mocks.usePreviewStatus.mockReturnValue({
      data: { status: 'stopped' },
      isLoading: false,
    });
    mocks.usePreviewOutput.mockReturnValue({ data: { output: [] } });
    mocks.useConflictStatus.mockReturnValue({
      data: {
        hasConflicts: true,
        conflictingFiles: ['src/App.tsx', 'src/routes.ts'],
        rebaseInProgress: true,
        mergeInProgress: false,
      },
      isLoading: false,
    });
    mocks.useFileConflict.mockReturnValue({
      data: {
        filePath: 'src/App.tsx',
        content: 'resolved content',
        oursContent: 'ours content',
        theirsContent: 'theirs content',
        markers: [],
      },
      isLoading: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('retains review merge until completion and recovers from failure', async () => {
    let rejectMerge!: (error: Error) => void;
    mocks.mergeWorktreeMutate
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectMerge = reject;
          })
      )
      .mockResolvedValueOnce(undefined);
    const onMergeComplete = vi.fn();
    const task = createMockTask({
      id: 'task-review-merge',
      git: { repo: 'fixture', branch: 'feature', baseBranch: 'main', worktreePath: '/tmp' },
      review: { decision: 'approved' },
    });
    renderWithProviders(
      <ReviewPanel task={task} onReview={vi.fn()} onMergeComplete={onMergeComplete} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Merge & Close Task' }));
    const dialog = screen.getByRole('dialog', { name: 'Merge changes to main?' });
    const submit = within(dialog).getByRole('button', { name: 'Merge & Close' });
    fireEvent.click(submit);
    expect(screen.queryByRole('dialog', { name: 'Merge changes to main?' })).toBe(dialog);
    fireEvent.click(submit);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close dialog' }));
    expect(
      (within(dialog).getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(mocks.mergeWorktreeMutate).toHaveBeenCalledExactlyOnceWith(task.id);
    expect(onMergeComplete).not.toHaveBeenCalled();
    await act(async () => rejectMerge(new Error('Fixture merge failed')));
    expect(within(dialog).getByRole('alert').textContent).toContain('Fixture merge failed');
    expect(onMergeComplete).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(submit));
    expect(mocks.mergeWorktreeMutate).toHaveBeenCalledTimes(2);
    expect(onMergeComplete).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog', { name: 'Merge changes to main?' })).toBeNull();
  });

  it('renders review decisions and merge confirmation through direct Mantine controls', async () => {
    const user = userEvent.setup();
    const onReview = vi.fn();
    const onMergeComplete = vi.fn();
    const task = createMockTask({
      id: 'task-review',
      git: {
        repo: 'veritas',
        branch: 'feature/review',
        baseBranch: 'main',
        worktreePath: '/tmp/veritas-review',
      },
      reviewComments: [
        {
          id: 'review-comment-1',
          file: 'src/App.tsx',
          line: 12,
          content: 'Check this branch',
          created: '2026-06-01T09:00:00Z',
        },
      ],
    });

    const { baseElement, container, rerender } = renderWithProviders(
      <ReviewPanel task={task} onReview={onReview} onMergeComplete={onMergeComplete} />
    );

    expect(container.querySelector('.mantine-Button-root')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="button"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="textarea"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="alert-dialog-content"]')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Request Changes' }));
    expect(container.querySelector('.mantine-Textarea-root')).toBeDefined();
    fireEvent.change(screen.getByPlaceholderText('Describe the changes needed...'), {
      target: { value: 'Add regression coverage' },
    });
    await user.click(screen.getByRole('button', { name: 'Submit Changes Requested' }));

    expect(onReview).toHaveBeenCalledWith({
      decision: 'changes-requested',
      decidedAt: expect.any(String),
      summary: 'Add regression coverage',
    });

    rerender(
      <ReviewPanel
        task={{
          ...task,
          review: {
            decision: 'approved',
            decidedAt: '2026-06-01T10:00:00Z',
            summary: 'Ready to merge',
          },
        }}
        onReview={onReview}
        onMergeComplete={onMergeComplete}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Merge & Close Task' }));
    const dialog = await screen.findByRole('dialog', { name: 'Merge changes to main?' });
    expect(baseElement.querySelector('.mantine-Modal-content')).toBeDefined();
    await user.click(within(dialog).getByRole('button', { name: 'Merge & Close' }));

    expect(mocks.mergeWorktreeMutate).toHaveBeenCalledWith('task-review');
    expect(onMergeComplete).toHaveBeenCalled();
  });

  it('starts and records a task decision review session from the review tab', async () => {
    const user = userEvent.setup();
    const task = createMockTask({
      id: 'task-review',
      title: 'Review task',
      description: 'Choose the release path',
      git: {
        repo: 'veritas',
        branch: 'feature/review',
        baseBranch: 'main',
        worktreePath: '/tmp/veritas-review',
      },
    });

    renderWithProviders(<ReviewPanel task={task} onReview={vi.fn()} />);

    expect(await screen.findByText('Decision Review Sessions')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Start Decision Review' }));

    await waitFor(() =>
      expect(mocks.createDecisionReviewMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-review',
          participants: expect.arrayContaining([
            expect.objectContaining({ id: 'architect' }),
            expect.objectContaining({ id: 'reviewer' }),
          ]),
        })
      )
    );
  });

  it('finalizes a completed decision review session into a packet', async () => {
    const user = userEvent.setup();
    mocks.useDecisionReviews.mockReturnValue({
      isLoading: false,
      data: [
        {
          id: 'decision_review_ready',
          taskId: 'task-review',
          title: 'Release approach',
          prompt: 'Choose release approach',
          context: 'All issue PRs are queued.',
          sourceType: 'task',
          sourceId: 'task-review',
          rounds: 1,
          participants: [
            { id: 'architect', label: 'Architect' },
            { id: 'reviewer', label: 'Reviewer' },
          ],
          status: 'critiquing',
          initialResponses: [
            {
              id: 'turn_1',
              participantId: 'architect',
              phase: 'initial',
              round: 0,
              prompt: 'p',
              response: 'Release after CI passes.',
              createdAt: '2026-06-01T09:00:00Z',
            },
            {
              id: 'turn_2',
              participantId: 'reviewer',
              phase: 'initial',
              round: 0,
              prompt: 'p',
              response: 'Require docs and artifacts.',
              createdAt: '2026-06-01T09:01:00Z',
            },
          ],
          critiqueRounds: [
            {
              id: 'turn_3',
              participantId: 'architect',
              phase: 'critique',
              round: 1,
              prompt: 'p',
              response: 'Docs are a valid blocker.',
              createdAt: '2026-06-01T09:02:00Z',
            },
            {
              id: 'turn_4',
              participantId: 'reviewer',
              phase: 'critique',
              round: 1,
              prompt: 'p',
              response: 'CI alone is not enough.',
              createdAt: '2026-06-01T09:03:00Z',
            },
          ],
          createdAt: '2026-06-01T09:00:00Z',
          updatedAt: '2026-06-01T09:03:00Z',
        },
      ],
    });
    const task = createMockTask({
      id: 'task-review',
      title: 'Review task',
      description: 'Choose the release path',
      git: {
        repo: 'veritas',
        branch: 'feature/review',
        baseBranch: 'main',
        worktreePath: '/tmp/veritas-review',
      },
    });

    renderWithProviders(<ReviewPanel task={task} onReview={vi.fn()} />);

    fireEvent.change(await screen.findByLabelText('Recommendation'), {
      target: { value: 'Use staged release after docs and artifacts pass.' },
    });
    fireEvent.change(screen.getByLabelText('Assumptions'), {
      target: { value: 'CI remains green' },
    });
    fireEvent.change(screen.getByLabelText('Risks'), {
      target: { value: 'Tap metadata can drift' },
    });
    await user.click(screen.getByRole('button', { name: 'Finalize Packet' }));

    await waitFor(() =>
      expect(mocks.finalizeDecisionReviewMutateAsync).toHaveBeenCalledWith({
        id: 'decision_review_ready',
        input: expect.objectContaining({
          recommendation: 'Use staged release after docs and artifacts pass.',
          assumptions: ['CI remains green'],
          risks: ['Tap metadata can drift'],
          attachWorkProduct: true,
        }),
      })
    );
  });

  it('renders inline review comments through direct Mantine textarea, button, and action icon', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    const onRemove = vi.fn();

    const { baseElement, container, rerender } = renderWithProviders(
      <CommentInput onSubmit={onSubmit} onCancel={onCancel} />
    );

    expect(container.querySelector('.mantine-Textarea-root')).toBeDefined();
    expect(container.querySelector('.mantine-Button-root')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="textarea"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="button"]')).toBeNull();

    fireEvent.change(screen.getByPlaceholderText('Add review comment...'), {
      target: { value: 'Tighten this branch' },
    });
    await user.click(screen.getByRole('button', { name: 'Add Comment' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onSubmit).toHaveBeenCalledWith('Tighten this branch');
    expect(onCancel).toHaveBeenCalled();

    rerender(
      <CommentDisplay
        comment={{
          id: 'review-comment-2',
          file: 'src/App.tsx',
          line: 42,
          content: 'Existing comment',
          created: '2026-06-01T09:00:00Z',
        }}
        onRemove={onRemove}
      />
    );

    expect(container.querySelector('.mantine-ActionIcon-root')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Remove review comment on line 42' }));
    expect(onRemove).toHaveBeenCalled();
  });

  it('keeps secondary diff actions discoverable by keyboard and coarse pointers', async () => {
    const user = userEvent.setup();
    const onStartAddComment = vi.fn();
    const globalsCss = readFileSync(path.resolve(process.cwd(), 'src/globals.css'), 'utf8');
    expect(globalsCss).toContain('.group:focus-within .veritas-secondary-action');
    expect(globalsCss).toMatch(/@media \(hover: none\), \(pointer: coarse\)/);

    const { container } = renderWithProviders(
      <DiffLineView
        line={{ type: 'add', content: 'const ready = true;', newNumber: 42 }}
        comments={[]}
        addingCommentAtLine={null}
        onStartAddComment={onStartAddComment}
        onSubmitComment={vi.fn()}
        onCancelComment={vi.fn()}
        onRemoveComment={vi.fn()}
      />
    );

    const addComment = screen.getByRole('button', { name: 'Add comment to line 42' });
    expect(addComment.className).toContain('veritas-secondary-action');
    expect(addComment.className).not.toContain('opacity-0');

    await user.tab();
    expect(document.activeElement).toBe(addComment);
    await user.keyboard('{Enter}');
    expect(onStartAddComment).toHaveBeenCalledWith(42);
    await user.keyboard('[Space]');
    expect(onStartAddComment).toHaveBeenCalledTimes(2);
    expect(container.querySelector('.veritas-secondary-action')).toBe(addComment);
  });

  it.each(['start', 'stop'] as const)(
    'retains preview %s ownership through failure and retry',
    async (operation) => {
      let rejectRequest!: (error: Error) => void;
      const mutation = operation === 'start' ? mocks.startPreviewMutate : mocks.stopPreviewMutate;
      mutation.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectRequest = reject;
          })
      );
      mocks.usePreviewStatus.mockReturnValue({
        data:
          operation === 'start'
            ? { status: 'error', error: 'Previous preview failed' }
            : { status: 'running', url: 'http://localhost:4321', output: [] },
        isLoading: false,
      });
      const onOpenChange = vi.fn();
      renderWithProviders(
        <PreviewPanel
          task={createMockTask({
            id: 'task-preview-pending',
            git: { repo: 'veritas', branch: 'fixture', baseBranch: 'main' },
          })}
          open
          onOpenChange={onOpenChange}
        />
      );
      await waitFor(() =>
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close dialog' }))
      );
      const submit = screen.getByRole('button', {
        name: operation === 'start' ? 'Start Preview' : 'Stop preview',
      });
      fireEvent.click(submit);
      fireEvent.click(submit);
      if (operation === 'start') fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
      fireEvent.keyDown(document.body, { key: 'Escape' });
      fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(mutation).toHaveBeenCalledExactlyOnceWith('task-preview-pending');
      expect((submit as HTMLButtonElement).disabled).toBe(true);
      if (operation === 'stop') {
        for (const name of ['Refresh preview', 'Open preview externally', 'Toggle preview output'])
          expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
      }
      await act(async () => rejectRequest(new Error(`Fixture ${operation} request failed`)));
      const error = screen.getByRole('alert', { name: 'Preview request failed' });
      expect(error.textContent).toContain(`Fixture ${operation} request failed`);
      expect(document.activeElement).toBe(error);
      expect((submit as HTMLButtonElement).disabled).toBe(false);
      await act(async () => fireEvent.click(submit));
      expect(mutation).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole('alert', { name: 'Preview request failed' })).toBeNull();
      expect(onOpenChange).not.toHaveBeenCalled();
      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    }
  );

  it('renders preview drawer controls through direct Mantine primitives', async () => {
    const user = userEvent.setup();
    mocks.usePreviewStatus.mockReturnValue({
      data: {
        status: 'running',
        url: 'http://127.0.0.1:5173',
        output: ['ready'],
      },
      isLoading: false,
    });
    mocks.usePreviewOutput.mockReturnValue({
      data: { output: ['vite ready', 'compiled successfully'] },
    });
    const task = createMockTask({
      id: 'task-preview',
      git: { repo: 'veritas', branch: 'feature/preview', baseBranch: 'main' },
    });

    const { baseElement, container } = renderWithProviders(
      <PreviewPanel task={task} open onOpenChange={vi.fn()} />
    );

    expect(screen.getByText('Preview')).toBeDefined();
    expect(container.querySelector('.mantine-Drawer-content')).toBeDefined();
    expect(container.querySelector('.mantine-ActionIcon-root')).toBeDefined();
    expect(container.querySelector('.mantine-Code-root')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="sheet-content"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="button"]')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Toggle preview output' }));
    expect(screen.getByText('compiled successfully')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Open preview externally' }));
    await user.click(screen.getByRole('button', { name: 'Stop preview' }));

    expect(window.open).toHaveBeenCalledWith(
      'http://127.0.0.1:5173',
      '_blank',
      'noopener,noreferrer'
    );
    expect(mocks.stopPreviewMutate).toHaveBeenCalledWith('task-preview');
  });

  it('renders conflict resolution drawer and abort modal through direct Mantine controls', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const task = createMockTask({
      id: 'task-conflict',
      git: {
        repo: 'veritas',
        branch: 'feature/conflict',
        baseBranch: 'main',
        worktreePath: '/tmp/veritas-conflict',
      },
    });

    const { baseElement, container } = renderWithProviders(
      <ConflictResolver task={task} open onOpenChange={onOpenChange} />
    );

    expect(await screen.findByText('Merge Conflicts')).toBeDefined();
    expect(screen.getByText('App.tsx')).toBeDefined();
    expect(container.querySelector('.mantine-Drawer-content')).toBeDefined();
    expect(container.querySelector('.mantine-Tabs-root')).toBeDefined();
    expect(container.querySelector('.mantine-Button-root')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="sheet-content"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="tabs-list"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="textarea"]')).toBeNull();
    expect(baseElement.querySelector('[data-slot="alert-dialog-content"]')).toBeNull();

    await user.click(screen.getByRole('tab', { name: 'Manual Edit' }));
    fireEvent.change(screen.getByPlaceholderText('Edit the file content to resolve conflicts...'), {
      target: { value: 'manually resolved' },
    });
    await user.click(screen.getByRole('button', { name: 'Save Resolution' }));

    expect(mocks.resolveConflictMutateAsync).toHaveBeenCalledWith({
      taskId: 'task-conflict',
      filePath: 'src/App.tsx',
      resolution: 'manual',
      manualContent: 'manually resolved',
    });

    await user.click(screen.getByRole('button', { name: 'Abort' }));
    const dialog = await screen.findByRole('dialog', { name: 'Abort Rebase?' });
    expect(baseElement.querySelector('.mantine-Modal-content')).toBeDefined();
    await user.click(within(dialog).getByRole('button', { name: 'Abort' }));

    expect(mocks.abortConflictMutateAsync).toHaveBeenCalledWith('task-conflict');
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
