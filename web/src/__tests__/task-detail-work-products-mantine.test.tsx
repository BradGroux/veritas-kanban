import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { WorkProductsSection } from '@/components/task/WorkProductsSection';
import { api } from '@/lib/api';
import { renderWithProviders } from './test-utils';
import type { WorkProductPreview, WorkProductVersion } from '@veritas-kanban/shared';

const mocks = vi.hoisted(() => ({
  clipboardWrite: vi.fn(),
  execCommand: vi.fn(),
  exportWorkProduct: vi.fn(),
  listForTask: vi.fn(),
  listVersions: vi.fn(),
  updateWorkProduct: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: {
    workProducts: {
      export: mocks.exportWorkProduct,
      listForTask: mocks.listForTask,
      listVersions: mocks.listVersions,
      update: mocks.updateWorkProduct,
    },
  },
}));

const listForTaskMock = vi.mocked(api.workProducts.listForTask);
const exportWorkProductMock = vi.mocked(api.workProducts.export);
const listVersionsMock = vi.mocked(api.workProducts.listVersions);
const updateWorkProductMock = vi.mocked(api.workProducts.update);

const product: WorkProductPreview = {
  id: 'wp_launch_readiness',
  workspaceId: 'local',
  kind: 'report',
  title: 'Launch readiness report',
  status: 'active',
  version: 2,
  taskId: 'task-work-products',
  sourceRunId: 'run-123',
  agent: 'codex',
  model: 'gpt-5',
  sourceLinks: [{ label: 'Source run', href: '/runs/run-123', type: 'run' }],
  redacted: true,
  snippet: 'Redacted launch summary with checklist evidence.',
  createdAt: '2026-06-01T10:00:00.000Z',
  updatedAt: '2026-06-01T11:00:00.000Z',
};

const versions: WorkProductVersion[] = [
  {
    id: 'wpv-2',
    productId: product.id,
    workspaceId: 'local',
    version: 2,
    changeType: 'refine',
    changeSummary: 'Added QA evidence',
    render: { schemaVersion: 1, kind: 'markdown', markdown: '# Redacted' },
    title: product.title,
    kind: 'report',
    agent: 'codex',
    model: 'gpt-5',
    createdAt: '2026-06-01T11:00:00.000Z',
  },
  {
    id: 'wpv-1',
    productId: product.id,
    workspaceId: 'local',
    version: 1,
    changeType: 'create',
    render: { schemaVersion: 1, kind: 'markdown', markdown: '# Initial' },
    title: product.title,
    kind: 'report',
    createdAt: '2026-06-01T10:00:00.000Z',
  },
];

describe('task detail work products surface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listForTaskMock.mockResolvedValue([product]);
    listVersionsMock.mockResolvedValue(versions);
    exportWorkProductMock.mockResolvedValue('# Redacted launch report');
    updateWorkProductMock.mockResolvedValue({
      id: product.id,
      workspaceId: product.workspaceId,
      kind: 'markdown',
      title: 'Edited launch report',
      status: 'active',
      render: { schemaVersion: 1, kind: 'markdown', markdown: '# Edited launch report' },
      version: 3,
      taskId: product.taskId,
      sourceRunId: product.sourceRunId,
      agent: product.agent,
      model: product.model,
      createdAt: product.createdAt,
      updatedAt: '2026-06-01T12:00:00.000Z',
    });
    mocks.clipboardWrite.mockResolvedValue(undefined);
    mocks.execCommand.mockReturnValue(true);

    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: mocks.clipboardWrite,
      },
    });

    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:work-product'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: mocks.execCommand,
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders task work products with Mantine cards, provenance, and redaction labels', async () => {
    const { baseElement, container } = renderWithProviders(
      <WorkProductsSection taskId="task-work-products" />
    );

    expect(await screen.findByText('Launch readiness report')).toBeDefined();
    expect(screen.getByText('Redacted launch summary with checklist evidence.')).toBeDefined();
    expect(screen.getByText('Redacted preview')).toBeDefined();
    expect(screen.getByText('Run run-123')).toBeDefined();
    expect(screen.getByRole('link', { name: /source run/i }).getAttribute('href')).toBe(
      '/runs/run-123'
    );
    expect(container.querySelector('.mantine-Paper-root')).toBeDefined();
    expect(container.querySelector('.mantine-Badge-root')).toBeDefined();
    expect(container.querySelector('.mantine-ActionIcon-root')).toBeDefined();
    expect(baseElement.querySelector('[data-slot="button"]')).toBeNull();
    expect(listForTaskMock).toHaveBeenCalledWith('task-work-products', {
      includeArchived: true,
      limit: 20,
    });
  });

  it('requests redacted markdown when copying', async () => {
    const user = userEvent.setup();
    renderWithProviders(<WorkProductsSection taskId="task-work-products" />);

    await user.click(await screen.findByRole('button', { name: /copy redacted/i }));

    await waitFor(() =>
      expect(exportWorkProductMock).toHaveBeenCalledWith(product.id, {
        format: 'markdown',
        redacted: true,
      })
    );
  });

  it('exports redacted markdown by default', async () => {
    const user = userEvent.setup();
    const appendSpy = vi.spyOn(document.body, 'appendChild');
    const removeSpy = vi.spyOn(document.body, 'removeChild');

    renderWithProviders(<WorkProductsSection taskId="task-work-products" />);

    await user.click(await screen.findByRole('button', { name: /export redacted/i }));

    await waitFor(() =>
      expect(exportWorkProductMock).toHaveBeenCalledWith(product.id, {
        format: 'markdown',
        redacted: true,
      })
    );
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:work-product');
    expect(appendSpy).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalled();
  });

  it('loads redacted markdown for manual edits and saves a new version', async () => {
    const user = userEvent.setup();
    renderWithProviders(<WorkProductsSection taskId="task-work-products" />);

    await user.click(await screen.findByRole('button', { name: /edit launch readiness report/i }));

    const dialog = await screen.findByRole('dialog', {
      name: 'Edit: Launch readiness report',
    });
    await waitFor(() =>
      expect(exportWorkProductMock).toHaveBeenCalledWith(product.id, {
        format: 'markdown',
        redacted: true,
      })
    );

    const title = within(dialog).getByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'Edited launch report');

    const body = within(dialog).getByLabelText('Redacted markdown');
    await user.clear(body);
    await user.type(body, '# Edited launch report');

    await user.click(within(dialog).getByRole('button', { name: 'Save Version' }));

    await waitFor(() =>
      expect(updateWorkProductMock).toHaveBeenCalledWith(
        product.id,
        expect.objectContaining({
          title: 'Edited launch report',
          render: {
            schemaVersion: 1,
            kind: 'markdown',
            markdown: '# Edited launch report',
          },
          changeType: 'manual',
          changeSummary: 'Manual edit before handoff',
        })
      )
    );
  });

  it('opens version history without rendering raw version payloads', async () => {
    const user = userEvent.setup();
    renderWithProviders(<WorkProductsSection taskId="task-work-products" />);

    await user.click(await screen.findByRole('button', { name: /open version history/i }));

    const dialog = await screen.findByRole('dialog', {
      name: 'Version history: Launch readiness report',
    });
    expect(listVersionsMock).toHaveBeenCalledWith(product.id);
    expect(within(dialog).getByText('Refine v2')).toBeDefined();
    expect(within(dialog).getByText('Create v1')).toBeDefined();
    expect(within(dialog).getByText('Added QA evidence')).toBeDefined();
    expect(within(dialog).queryByText('# Redacted')).toBeNull();
    expect(within(dialog).queryByText('# Initial')).toBeNull();
  });
});
