import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MaintenanceTab } from '@/components/settings/tabs/MaintenanceTab';
import { renderWithProviders } from './test-utils';
import type { MaintenanceSummary } from '@veritas-kanban/shared';

const mocks = vi.hoisted(() => ({
  summary: vi.fn(),
  tailLog: vi.fn(),
  createDebugBundle: vi.fn(),
  exportSqlite: vi.fn(),
  importSqlite: vi.fn(),
  toast: vi.fn(),
}));

const summary: MaintenanceSummary = {
  generatedAt: '2026-06-03T12:00:00.000Z',
  mode: 'local',
  storageMode: 'sqlite',
  health: [
    {
      id: 'storage',
      label: 'Storage',
      state: 'ok',
      detail: 'Runtime storage is readable and writable.',
      checkedAt: '2026-06-03T12:00:00.000Z',
    },
    {
      id: 'logs',
      label: 'Logs',
      state: 'ok',
      detail: 'Log directory is available.',
      checkedAt: '2026-06-03T12:00:00.000Z',
    },
  ],
  storage: {
    totalBytes: 4096,
    categories: [
      {
        id: 'logs',
        label: 'Logs',
        bytes: 2048,
        itemCount: 2,
        cleanupEligibleCount: 2,
        retainedReason: 'Logs are redacted before support bundle inclusion.',
        lastUsedAt: '2026-06-03T11:00:00.000Z',
      },
      {
        id: 'work-products',
        label: 'Work products and versions',
        bytes: 2048,
        itemCount: 1,
        cleanupEligibleCount: 1,
        retainedReason: 'Archived generated outputs are cleanup candidates.',
        lastUsedAt: '2026-06-03T10:00:00.000Z',
      },
    ],
  },
  logs: [
    {
      id: 'server',
      label: 'Server log',
      path: '/Users/redacted/logs/server.log',
      exists: true,
      sizeBytes: 120,
      updatedAt: '2026-06-03T11:00:00.000Z',
      redacted: true,
    },
  ],
  lifecycle: [
    {
      id: 'workProducts',
      label: 'Work products and versions',
      tables: ['work_products', 'work_product_versions'],
      rowCount: 2,
      defaultRetention: 'Retained until cleanup.',
      exportBehavior: 'Included in exports.',
      deleteBehavior: 'Preview before cleanup.',
      redaction: 'Redact generated sensitive text.',
      containsSecrets: false,
      containsPrivatePaths: true,
      containsGeneratedContent: true,
      workspaceScoped: true,
    },
  ],
  cleanupPreview: {
    destructiveActionsEnabled: false,
    confirmationRequired: true,
    notes: ['Preview only.'],
    items: [
      {
        id: 'work-product:wp_1',
        label: 'Archived report',
        category: 'work-products',
        cleanupEligible: true,
        affectedCount: 3,
        estimatedBytes: 2048,
        retainedReason: 'Archived generated output eligible for explicit cleanup.',
        sourceHref: '/tasks/task-1',
        lastUsedAt: '2026-06-03T10:00:00.000Z',
      },
    ],
  },
  workProducts: {
    generatedAt: '2026-06-03T12:00:00.000Z',
    workspaceId: 'local',
    totals: {
      products: 1,
      active: 0,
      archived: 1,
      versions: 3,
      cleanupCandidates: 1,
      estimatedBytes: 2048,
    },
    byKind: [{ kind: 'report', products: 1, versions: 3, estimatedBytes: 2048 }],
    cleanupCandidates: [],
    retained: [],
    notes: ['Preview only.'],
  },
};

vi.mock('@/lib/api', () => ({
  api: {
    maintenance: {
      summary: mocks.summary,
      tailLog: mocks.tailLog,
      createDebugBundle: mocks.createDebugBundle,
      exportSqlite: mocks.exportSqlite,
      importSqlite: mocks.importSqlite,
    },
  },
}));

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

describe('Maintenance settings tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.summary.mockResolvedValue(summary);
    mocks.tailLog.mockResolvedValue({
      source: summary.logs[0],
      lines: ['startup ok', 'Bearer [REDACTED]'],
      truncated: false,
      redacted: true,
    });
    mocks.createDebugBundle.mockResolvedValue({
      id: 'debug-bundle-1',
      createdAt: '2026-06-03T12:00:00.000Z',
      outputPath: '/tmp/debug-bundle-1',
      redacted: true,
      manifest: {
        includedCategories: ['health', 'storage'],
        excludedCategories: ['raw tokens'],
        redactionRules: ['tokens redacted'],
        files: [summary.logs[0]],
      },
    });
    mocks.exportSqlite.mockResolvedValue({
      operation: 'sqlite-export',
      dryRun: false,
      startedAt: '2026-06-03T12:00:00.000Z',
      completedAt: '2026-06-03T12:00:01.000Z',
      sqlitePath: '/tmp/veritas.db',
      bundlePath: '/tmp/export',
      counts: [{ entity: 'table.tasks', scanned: 1, written: 1, skipped: 0 }],
      warnings: [],
    });
    mocks.importSqlite.mockResolvedValue({
      operation: 'sqlite-import',
      dryRun: false,
      startedAt: '2026-06-03T12:00:00.000Z',
      completedAt: '2026-06-03T12:00:01.000Z',
      sqlitePath: '/tmp/veritas.db',
      bundlePath: '/tmp/export',
      counts: [{ entity: 'table.tasks', scanned: 1, written: 1, skipped: 0 }],
      warnings: [],
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders health, storage, cleanup preview, logs, lifecycle, and backup controls', async () => {
    renderWithProviders(<MaintenanceTab />);

    expect(await screen.findByText('Maintenance Center')).toBeDefined();
    expect(screen.getByText('Runtime storage is readable and writable.')).toBeDefined();
    expect(screen.getByText('Archived report')).toBeDefined();
    expect(
      (screen.getByRole('textbox', { name: 'Redacted log tail' }) as HTMLTextAreaElement).value
    ).toBe('startup ok\nBearer [REDACTED]');
    expect(screen.getAllByText('Work products and versions').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: 'Export Backup' }).hasAttribute('disabled')).toBe(
      true
    );
  });

  it('creates a redacted debug bundle and reports the output path', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MaintenanceTab />);

    await user.click(await screen.findByRole('button', { name: 'Debug Bundle' }));

    await waitFor(() => expect(mocks.createDebugBundle).toHaveBeenCalled());
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Debug bundle created',
        description: '/tmp/debug-bundle-1',
      })
    );
  });

  it('requires cleanup confirmation while destructive actions remain disabled', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MaintenanceTab />);

    await user.click(await screen.findByRole('button', { name: 'Review Cleanup' }));
    const dialog = await screen.findByRole('dialog', { name: 'Review cleanup' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Confirmation' }), 'DELETE');

    expect(
      within(dialog)
        .getByRole('button', { name: 'Delete Previewed Items' })
        .hasAttribute('disabled')
    ).toBe(true);
  });

  it('submits backup export with optional workspace scope', async () => {
    renderWithProviders(<MaintenanceTab />);

    await screen.findByText('Maintenance Center');
    fireEvent.change(screen.getByRole('textbox', { name: 'SQLite path' }), {
      target: { value: '/tmp/veritas.db' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Output directory' }), {
      target: { value: '/tmp/export' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Workspace scope' }), {
      target: { value: 'workspace-a' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Export Backup' }));

    await waitFor(() => expect(mocks.exportSqlite).toHaveBeenCalled());
    expect(mocks.exportSqlite.mock.calls[0][0]).toEqual({
      sqlitePath: '/tmp/veritas.db',
      outputDir: '/tmp/export',
      workspaceId: 'workspace-a',
    });
    expect(await screen.findByText('Exported 1 tables to /tmp/export')).toBeDefined();
  });
});
