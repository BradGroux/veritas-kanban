import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WorkProductArtifactPreview } from '@veritas-kanban/shared';
import { ArtifactPreviewModal } from '@/components/task/ArtifactPreviewModal';
import { renderWithProviders } from './test-utils';

const mocks = vi.hoisted(() => ({
  previewArtifact: vi.fn(),
  downloadArtifact: vi.fn(),
  navigateToTask: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: {
    workProducts: {
      previewArtifact: mocks.previewArtifact,
      downloadArtifact: mocks.downloadArtifact,
    },
  },
}));

vi.mock('@/contexts/ViewContext', () => ({
  useView: () => ({ navigateToTask: mocks.navigateToTask }),
}));

vi.mock('@/hooks/useFeatureSettings', () => ({
  useFeatureSettings: () => ({ settings: { markdown: { enableCodeHighlighting: false } } }),
}));

describe('ArtifactPreviewModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.downloadArtifact.mockResolvedValue(new Blob(['safe bytes']));
  });

  afterEach(() => cleanup());

  it('renders inert Markdown and routes back to exact causal evidence', async () => {
    mocks.previewArtifact.mockResolvedValue(
      preview({ kind: 'text', text: '# Reviewed\n[remote](https://example.com)' }, 'markdown')
    );
    const user = userEvent.setup();
    renderWithProviders(
      <ArtifactPreviewModal
        opened
        productId="wp_preview"
        version={2}
        title="Reviewed report"
        onClose={vi.fn()}
      />
    );

    const dialog = await screen.findByRole('dialog', { name: 'Preview: Reviewed report' });
    expect(await within(dialog).findByRole('heading', { name: 'Reviewed' })).toBeDefined();
    expect(within(dialog).getByText(/remote.*external link omitted/)).toBeDefined();
    expect(within(dialog).queryByRole('link', { name: 'remote' })).toBeNull();

    await user.click(within(dialog).getByRole('button', { name: 'Causal event' }));
    expect(mocks.navigateToTask).toHaveBeenCalledWith('task_preview', {
      tab: 'timeline',
      timelineAttemptId: 'attempt_preview',
      timelineEventId: 'event_preview',
    });
  });

  it('renders text, raster, PDF, and formula-marked table contracts', async () => {
    const user = userEvent.setup();
    const cases: Array<{
      response: WorkProductArtifactPreview;
      assertion: () => void;
    }> = [
      {
        response: preview({ kind: 'text', text: 'plain output' }, 'text'),
        assertion: () => expect(screen.getByText('plain output')).toBeDefined(),
      },
      {
        response: preview(
          { kind: 'image', base64: 'iVBORw0KGgo=', width: 10, height: 10, animated: false },
          'image'
        ),
        assertion: () => expect(screen.getByRole('img', { name: 'preview.bin' })).toBeDefined(),
      },
      {
        response: preview({ kind: 'pdf', base64: 'JVBERg==', pages: 1 }, 'pdf'),
        assertion: () => {
          const frame = screen.getByTitle('preview.bin PDF preview');
          expect(frame.getAttribute('sandbox')).toBe('');
          expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
        },
      },
      {
        response: preview(
          {
            kind: 'table',
            sheets: [
              {
                name: 'Sheet 1',
                rows: [[{ text: '=SUM(1,2)', formula: true, truncated: false }]],
                totalRows: 1,
                totalColumns: 1,
                truncated: false,
              },
            ],
          },
          'table'
        ),
        assertion: () => expect(screen.getByText('=SUM(1,2)')).toBeDefined(),
      },
    ];

    for (const [index, testCase] of cases.entries()) {
      mocks.previewArtifact.mockResolvedValueOnce(testCase.response);
      const rendered = renderWithProviders(
        <ArtifactPreviewModal
          opened
          productId={`wp_preview_${index}`}
          version={2}
          title={`Preview ${index}`}
          onClose={vi.fn()}
        />
      );
      await screen.findByRole('dialog', { name: `Preview: Preview ${index}` });
      await waitFor(testCase.assertion);
      if (testCase.response.renderer === 'image') {
        await user.click(screen.getByRole('button', { name: 'Zoom preview in' }));
        expect(screen.getByLabelText('Preview zoom 125 percent')).toBeDefined();
      }
      rendered.unmount();
    }
  });

  it('announces blocked fallback state and disables unauthorized download', async () => {
    mocks.previewArtifact.mockResolvedValue({
      ...preview(null, 'none'),
      status: 'policy-blocked',
      message: 'Active document content is blocked.',
      actions: { downloadAllowed: false, openAssociatedAppAllowed: false },
    });
    renderWithProviders(
      <ArtifactPreviewModal
        opened
        productId="wp_blocked"
        title="Blocked report"
        onClose={vi.fn()}
      />
    );

    const dialog = await screen.findByRole('dialog', { name: 'Preview: Blocked report' });
    expect(await within(dialog).findByText('Active document content is blocked.')).toBeDefined();
    expect(
      (within(dialog).getByRole('button', { name: 'Download' }) as HTMLButtonElement).disabled
    ).toBe(true);
  });
});

function preview(
  content: WorkProductArtifactPreview['content'],
  renderer: WorkProductArtifactPreview['renderer']
): WorkProductArtifactPreview {
  return {
    schemaVersion: 'work-product-artifact-preview/v1',
    status: 'ready',
    renderer,
    message: 'Preview is ready.',
    artifact: {
      schemaVersion: 'work-product-artifact/v1',
      id: 'wpa_preview',
      productId: 'wp_preview',
      version: 2,
      workspaceId: 'local',
      taskId: 'task_preview',
      runId: 'run_preview',
      attemptId: 'attempt_preview',
      producingEventId: 'event_preview',
      requestIdDigest: `sha256:${'a'.repeat(64)}`,
      launchManifestDigest: `sha256:${'b'.repeat(64)}`,
      mediaType:
        renderer === 'image' ? 'image/png' : renderer === 'pdf' ? 'application/pdf' : 'text/plain',
      byteSize: 12,
      sha256: 'c'.repeat(64),
      safeName: 'preview.bin',
      state: 'available',
      redaction: { state: 'none' },
      createdAt: '2026-08-30T00:00:00.000Z',
    },
    sourceRunId: 'run_preview',
    redactionState: 'none',
    causalEvent: {
      taskId: 'task_preview',
      runId: 'run_preview',
      attemptId: 'attempt_preview',
      eventId: 'event_preview',
    },
    limits: { maxBytes: 1024 },
    truncation: { truncated: false, reasons: [] },
    actions: { downloadAllowed: true, openAssociatedAppAllowed: true },
    content,
  };
}
