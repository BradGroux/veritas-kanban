import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  WORK_PRODUCT_HTML_PREVIEW_CSP,
  type WorkProductArtifactPreview,
} from '@veritas-kanban/shared';
import { ArtifactPreviewModal } from '@/components/task/ArtifactPreviewModal';
import { renderWithProviders } from './test-utils';

const mocks = vi.hoisted(() => ({
  previewArtifact: vi.fn(),
  downloadArtifact: vi.fn(),
  recordPreviewAudit: vi.fn(),
  navigateToTask: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: {
    workProducts: {
      previewArtifact: mocks.previewArtifact,
      downloadArtifact: mocks.downloadArtifact,
      recordPreviewAudit: mocks.recordPreviewAudit,
    },
  },
}));

vi.mock('@/lib/api/work-products', () => ({
  workProductsApi: {
    previewArtifact: mocks.previewArtifact,
    downloadArtifact: mocks.downloadArtifact,
    recordPreviewAudit: mocks.recordPreviewAudit,
  },
}));

vi.mock('@/contexts/ViewContext', () => ({
  useView: () => ({ navigateToTask: mocks.navigateToTask }),
}));

describe('ArtifactPreviewModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.downloadArtifact.mockResolvedValue(new Blob(['safe bytes']));
    mocks.recordPreviewAudit.mockResolvedValue(undefined);
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

  it('renders HTML only in the exact passive sandbox and audits its lifecycle', async () => {
    mocks.previewArtifact.mockResolvedValue(
      preview(
        {
          kind: 'html',
          document: '<!doctype html><h1>Isolated report</h1>',
          interactive: false,
          contentSecurityPolicy:
            "default-src 'none'; base-uri 'none'; child-src 'none'; connect-src 'none'; font-src 'none'; form-action 'none'; frame-src 'none'; img-src 'none'; manifest-src 'none'; media-src 'none'; navigate-to 'none'; object-src 'none'; script-src 'none'; style-src 'unsafe-inline'; worker-src 'none'",
          sandbox: '',
        },
        'html'
      )
    );
    const user = userEvent.setup();
    const rendered = renderWithProviders(
      <ArtifactPreviewModal
        opened
        productId="wp_html"
        version={2}
        title="HTML report"
        onClose={vi.fn()}
      />
    );

    const frame = await screen.findByTitle('preview.bin HTML preview');
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame.getAttribute('src')).toBeNull();
    expect(frame.getAttribute('srcdoc')).toContain('Isolated report');
    await waitFor(() =>
      expect(mocks.recordPreviewAudit).toHaveBeenCalledWith('wp_html', 'open', 2)
    );

    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(mocks.recordPreviewAudit).toHaveBeenCalledWith('wp_html', 'refresh', 2);
    rendered.unmount();
    await waitFor(() =>
      expect(mocks.recordPreviewAudit).toHaveBeenCalledWith('wp_html', 'close', 2)
    );
  });

  it('serializes causal navigation against refresh until its audit settles', async () => {
    mocks.previewArtifact.mockResolvedValue(
      preview(
        {
          kind: 'html',
          document: '<h1>Report</h1>',
          interactive: false,
          contentSecurityPolicy: WORK_PRODUCT_HTML_PREVIEW_CSP,
          sandbox: '',
        },
        'html'
      )
    );
    let finishNavigation!: () => void;
    mocks.recordPreviewAudit.mockImplementation((_id, action) =>
      action === 'navigate'
        ? new Promise<void>((resolve) => {
            finishNavigation = resolve;
          })
        : Promise.resolve()
    );
    const onClose = vi.fn();
    renderWithProviders(<ArtifactPreviewModal opened productId="wp_navigate" onClose={onClose} />);
    await screen.findByTitle('preview.bin HTML preview');
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Causal event' }));
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    });
    expect((screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement).disabled).toBe(
      true
    );
    expect(
      mocks.recordPreviewAudit.mock.calls.filter((call) => call[1] === 'refresh')
    ).toHaveLength(0);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.navigateToTask).not.toHaveBeenCalled();
    await act(async () => {
      finishNavigation();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mocks.navigateToTask).toHaveBeenCalledWith('task_preview', {
      tab: 'timeline',
      timelineAttemptId: 'attempt_preview',
      timelineEventId: 'event_preview',
    });
    expect(mocks.previewArtifact).toHaveBeenCalledTimes(1);
  });

  it('owns refresh through audit and refetch, retaining the dialog on failure', async () => {
    const response = preview(
      {
        kind: 'html',
        document: '<h1>Report</h1>',
        interactive: false,
        contentSecurityPolicy: WORK_PRODUCT_HTML_PREVIEW_CSP,
        sandbox: '',
      },
      'html'
    );
    let finishAudit!: () => void;
    let failRefresh!: (error: Error) => void;
    mocks.recordPreviewAudit.mockImplementation((_id, action) =>
      action === 'refresh'
        ? new Promise<void>((resolve) => {
            finishAudit = resolve;
          })
        : Promise.resolve()
    );
    mocks.previewArtifact
      .mockResolvedValueOnce(response)
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            failRefresh = reject;
          })
      )
      .mockResolvedValue(response);
    const onClose = vi.fn();
    renderWithProviders(<ArtifactPreviewModal opened productId="wp_refresh" onClose={onClose} />);
    await screen.findByTitle('preview.bin HTML preview');
    const refresh = screen.getByRole('button', { name: 'Refresh' });
    act(() => {
      fireEvent.click(refresh);
      fireEvent.click(refresh);
    });
    expect((refresh as HTMLButtonElement).disabled).toBe(true);
    expect(
      mocks.recordPreviewAudit.mock.calls.filter((call) => call[1] === 'refresh')
    ).toHaveLength(1);
    expect(mocks.previewArtifact).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => {
      finishAudit();
    });
    await waitFor(() => expect(mocks.previewArtifact).toHaveBeenCalledTimes(2));
    expect((refresh as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      failRefresh(new Error('Preview service unavailable'));
    });
    expect(await screen.findByText('Preview service unavailable')).toBeDefined();
    await waitFor(() => expect((refresh as HTMLButtonElement).disabled).toBe(false));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(refresh);
    await act(async () => {
      finishAudit();
    });
    await waitFor(() => expect(mocks.previewArtifact).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.queryByText('Preview service unavailable')).toBeNull());
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
        renderer === 'image'
          ? 'image/png'
          : renderer === 'pdf'
            ? 'application/pdf'
            : renderer === 'html'
              ? 'text/html'
              : 'text/plain',
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
