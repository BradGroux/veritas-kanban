import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/config', () => ({
  API_BASE: 'http://test-api',
}));

const { workProductsApi } = await import('@/lib/api/work-products');

function jsonResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ success: true, data, meta: { timestamp: '2026-08-30T00:00:00Z' } }),
  } as unknown as Response;
}

describe('workProductsApi', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([])));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('loads maintenance, task previews, and versions with encoded query parameters', async () => {
    await workProductsApi.maintenancePreview();
    await workProductsApi.listForTask('task/one', { includeArchived: true, limit: 25 });
    await workProductsApi.listVersions('wp/one');

    expect(fetch).toHaveBeenNthCalledWith(1, 'http://test-api/work-products/maintenance-preview', {
      credentials: 'include',
    });
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'http://test-api/tasks/task%2Fone/work-products?view=preview&includeArchived=true&limit=25',
      { credentials: 'include' }
    );
    expect(fetch).toHaveBeenNthCalledWith(3, 'http://test-api/work-products/wp%2Fone/versions', {
      credentials: 'include',
    });
  });

  it('downloads the selected artifact version as a blob', async () => {
    const artifact = new Blob(['artifact']);
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      blob: async () => artifact,
    } as Response);

    await expect(workProductsApi.downloadArtifact('wp/one', 3)).resolves.toBe(artifact);
    expect(fetch).toHaveBeenCalledWith(
      'http://test-api/work-products/wp%2Fone/artifact/download?version=3',
      { credentials: 'include' }
    );
  });

  it('updates work-product metadata with the JSON API contract', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ id: 'wp-one', title: 'Updated' }));

    await workProductsApi.update('wp/one', { title: 'Updated' });

    expect(fetch).toHaveBeenCalledWith('http://test-api/work-products/wp%2Fone', {
      credentials: 'include',
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Updated' }),
    });
  });

  it('exports reviewed Markdown with safe defaults', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '# Work product',
    } as Response);

    await expect(workProductsApi.export('wp/one')).resolves.toBe('# Work product');
    expect(fetch).toHaveBeenCalledWith(
      'http://test-api/work-products/wp%2Fone/export?format=markdown&redacted=true',
      { credentials: 'include' }
    );
  });
});
