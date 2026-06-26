import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { ReflectionTab } from '@/components/settings/tabs/ReflectionTab';
import { renderWithProviders } from './test-utils';

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  toast: vi.fn(),
  list: vi.fn(async () => ({
    candidates: [
      {
        id: 'reflection_1',
        status: 'pending',
        category: 'team',
        promotionTarget: 'task-lesson',
        confidence: 0.9,
        source: {
          kind: 'user-correction',
          taskId: 'task_20260626_reflect',
          messageId: 'msg_1',
        },
        summary: 'Inspect live schema before changing route code.',
        previousApproach: 'Guessed route fields from memory.',
        correction: 'Read the local schema and nearby route tests.',
        nextAttempt: 'Inspect the live schema first and make the smallest matching edit.',
        evidence: [
          {
            kind: 'note',
            title: 'Correction',
            content: 'The route field was corrected during review.',
          },
        ],
        tags: ['workflow'],
        duplicateKey: 'team|task-lesson|schema',
        duplicateOf: 'reflection_0',
        duplicateCount: 2,
        appliedTargets: [],
        redaction: { redacted: false, notes: [] },
        createdAt: '2026-06-26T12:00:00.000Z',
        updatedAt: '2026-06-26T12:00:00.000Z',
      },
    ],
    duplicateGroups: [
      {
        duplicateKey: 'team|task-lesson|schema',
        representativeId: 'reflection_0',
        candidateIds: ['reflection_0', 'reflection_1'],
        statusCounts: { pending: 2 },
      },
    ],
    total: 1,
  })),
  accept: vi.fn(async () => ({ id: 'reflection_1', status: 'accepted' })),
  reject: vi.fn(async () => ({ id: 'reflection_1', status: 'rejected' })),
  merge: vi.fn(async () => ({ id: 'reflection_1', status: 'deleted' })),
  remove: vi.fn(async () => ({ id: 'reflection_1', status: 'deleted' })),
}));

vi.mock('@/hooks/useIdentity', () => ({
  useIdentity: () => ({ hasPermission: mocks.hasPermission }),
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock('@/lib/api', () => ({
  api: {
    reflections: {
      list: mocks.list,
      accept: mocks.accept,
      reject: mocks.reject,
      merge: mocks.merge,
      delete: mocks.remove,
    },
  },
}));

describe('Reflection settings tab', () => {
  beforeEach(() => {
    mocks.hasPermission.mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders reflection candidates with evidence and review actions', async () => {
    renderWithProviders(<ReflectionTab />);

    expect(await screen.findByText('Reflection Promotion Queue')).toBeDefined();
    expect(screen.getByText('Inspect live schema before changing route code.')).toBeDefined();
    expect(screen.getByText(/Correction: The route field was corrected/)).toBeDefined();
    expect(screen.getByText('2 duplicates')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /Accept/ }));

    await waitFor(() => {
      expect(mocks.accept).toHaveBeenCalledWith(
        'reflection_1',
        expect.objectContaining({ reviewedBy: 'operator', promotionTarget: 'task-lesson' })
      );
    });
  });

  it('exposes duplicate merge from the queue', async () => {
    renderWithProviders(<ReflectionTab />);

    expect(
      await screen.findByText('Inspect live schema before changing route code.')
    ).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /Merge/ }));

    await waitFor(() => {
      expect(mocks.merge).toHaveBeenCalledWith('reflection_1', { mergedBy: 'operator' });
    });
  });
});
