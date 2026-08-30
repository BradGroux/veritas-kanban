import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import { errorHandler } from '../../middleware/error-handler.js';
import { workProductRoutes } from '../../routes/work-products.js';

const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  inspect: vi.fn(),
  list: vi.fn(),
  download: vi.fn(),
  listVersions: vi.fn(),
  purge: vi.fn(),
  preview: vi.fn(),
  workProducts: {
    get: vi.fn(),
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    archive: vi.fn(),
    listVersions: vi.fn(),
    restoreVersion: vi.fn(),
    toPreview: vi.fn((product) => product),
    exportProduct: vi.fn(),
    maintenancePreview: vi.fn(),
  },
}));

vi.mock('../../services/work-product-artifact-service.js', () => ({
  getWorkProductArtifactService: () => mocks,
}));

vi.mock('../../services/work-product-artifact-preview-service.js', () => ({
  getWorkProductArtifactPreviewService: () => ({ preview: mocks.preview }),
}));

vi.mock('../../services/work-product-service.js', () => ({
  getWorkProductService: () => mocks.workProducts,
}));

describe('work product artifact routes', () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as AuthenticatedRequest).auth = {
      role: 'agent',
      isLocalhost: true,
      workspaceId: 'local',
      userId: 'local-user',
    };
    next();
  });
  app.use('/api/work-products', workProductRoutes);
  app.use(errorHandler);

  beforeEach(() => vi.clearAllMocks());

  it('registers against the authenticated workspace instead of caller-supplied host state', async () => {
    mocks.register.mockResolvedValue({ product: { id: 'wp_1' }, metadata: { id: 'wpa_1' } });

    const response = await request(app).post('/api/work-products/artifacts/register').send({
      taskId: 'task_1247',
      runId: 'run_1247',
      attemptId: 'attempt_1247',
      requestId: 'request_1247',
      producingEventId: 'runevt_1247',
      relativePath: 'report.pdf',
      title: 'Release report',
      mediaType: 'application/pdf',
    });

    expect(response.status).toBe(201);
    expect(mocks.register).toHaveBeenCalledWith({
      workspaceId: 'local',
      taskId: 'task_1247',
      runId: 'run_1247',
      attemptId: 'attempt_1247',
      requestId: 'request_1247',
      producingEventId: 'runevt_1247',
      relativePath: 'report.pdf',
      title: 'Release report',
      mediaType: 'application/pdf',
    });
  });

  it('lists immutable versions and downloads only server-resolved bytes', async () => {
    mocks.listVersions.mockResolvedValue([{ id: 'wpa_1', version: 1 }]);
    mocks.download.mockResolvedValue({
      metadata: {
        mediaType: 'application/pdf',
        safeName: 'release-report.pdf',
        sha256: 'abc123',
      },
      content: Buffer.from('download bytes'),
    });

    const versions = await request(app).get('/api/work-products/wp_1/artifact/versions');
    const download = await request(app).get('/api/work-products/wp_1/artifact/download?version=1');

    expect(versions.status).toBe(200);
    expect(versions.body).toEqual([{ id: 'wpa_1', version: 1 }]);
    expect(mocks.listVersions).toHaveBeenCalledWith({
      workspaceId: 'local',
      productId: 'wp_1',
    });
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toContain('application/pdf');
    expect(download.headers['content-disposition']).toContain('release-report.pdf');
    expect(download.headers['content-digest']).toBe(
      `sha-256=:${Buffer.from('abc123', 'hex').toString('base64')}:`
    );
    expect(download.headers['x-artifact-sha256']).toBe('abc123');
    expect(download.headers.etag).toBe('"sha256-abc123"');
    expect(download.headers['cache-control']).toBe('private, immutable');
    expect(download.body).toEqual(Buffer.from('download bytes'));
    expect(mocks.download).toHaveBeenCalledWith({
      workspaceId: 'local',
      productId: 'wp_1',
      version: 1,
    });
  });

  it('returns bounded preview contracts from the authenticated workspace', async () => {
    mocks.preview.mockResolvedValue({
      schemaVersion: 'work-product-artifact-preview/v1',
      status: 'ready',
      renderer: 'text',
    });

    const response = await request(app).get('/api/work-products/wp_1/artifact/preview?version=2');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body).toMatchObject({
      schemaVersion: 'work-product-artifact-preview/v1',
      status: 'ready',
    });
    expect(mocks.preview).toHaveBeenCalledWith({
      workspaceId: 'local',
      productId: 'wp_1',
      version: 2,
    });
  });

  it('inspects and lists file products in the authenticated workspace', async () => {
    const product = {
      id: 'wp_123456789012345678901234',
      workspaceId: 'local',
      kind: 'file',
    };
    mocks.inspect.mockResolvedValue(product);
    mocks.list.mockResolvedValue([product]);

    const inspected = await request(app).get(`/api/work-products/${product.id}/artifact`);
    const listed = await request(app).get(
      '/api/work-products/artifacts?taskId=task_1247&includeArchived=true&limit=25'
    );

    expect(inspected.status).toBe(200);
    expect(inspected.body).toEqual(product);
    expect(mocks.inspect).toHaveBeenCalledWith({
      workspaceId: 'local',
      productId: product.id,
    });
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual([product]);
    expect(mocks.list).toHaveBeenCalledWith({
      workspaceId: 'local',
      taskId: 'task_1247',
      sourceRunId: undefined,
      includeArchived: true,
      limit: 25,
    });
  });

  it('blocks generic Work Product routes from bypassing artifact workspace scope', async () => {
    const localProduct = {
      id: 'wp_local12345678901234567890',
      workspaceId: 'local',
      kind: 'file',
      title: 'Local artifact',
    };
    const foreignProduct = {
      id: 'wp_foreign1234567890123456',
      workspaceId: 'foreign',
      kind: 'file',
      title: 'Foreign artifact',
    };
    mocks.workProducts.list.mockResolvedValue([localProduct, foreignProduct]);
    mocks.workProducts.get.mockResolvedValue(foreignProduct);

    const listed = await request(app).get('/api/work-products');
    const inspected = await request(app).get(`/api/work-products/${foreignProduct.id}`);
    const archived = await request(app).delete(`/api/work-products/${foreignProduct.id}`);

    expect(listed.status).toBe(200);
    expect(listed.body).toEqual([localProduct]);
    expect(inspected.status).toBe(404);
    expect(archived.status).toBe(404);
    expect(mocks.workProducts.archive).not.toHaveBeenCalled();
  });

  it('binds generic Work Product creation to the authenticated workspace', async () => {
    mocks.workProducts.create.mockImplementation(async (input) => input);

    const response = await request(app)
      .post('/api/work-products')
      .send({
        kind: 'text',
        title: 'Workspace-bound product',
        render: { schemaVersion: 1, kind: 'text', text: 'safe' },
        workspaceId: 'foreign',
      });

    expect(response.status).toBe(201);
    expect(mocks.workProducts.create).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'local' })
    );
  });

  it('blocks generic updates from changing governed file product provenance', async () => {
    const productId = `wp_${'f'.repeat(24)}`;
    mocks.workProducts.get.mockResolvedValue({
      id: productId,
      workspaceId: 'local',
      kind: 'file',
    });

    const response = await request(app)
      .patch(`/api/work-products/${productId}`)
      .send({ taskId: 'task_moved', sourceRunId: 'run_moved' });

    expect(response.status).toBe(400);
    expect(mocks.workProducts.update).not.toHaveBeenCalled();
  });

  it('requires an exact confirmation value for physical artifact purge', async () => {
    const productId = `wp_${'a'.repeat(24)}`;
    mocks.purge.mockResolvedValue({ productId, artifactsDeleted: 1, bytesDeleted: 14 });

    const missing = await request(app).delete(`/api/work-products/${productId}/artifact`);
    const purged = await request(app).delete(
      `/api/work-products/${productId}/artifact?confirm=${productId}`
    );

    expect(missing.status).toBe(400);
    expect(purged.status).toBe(200);
    expect(purged.body).toEqual({ productId, artifactsDeleted: 1, bytesDeleted: 14 });
    expect(mocks.purge).toHaveBeenCalledWith({
      workspaceId: 'local',
      productId,
      confirmation: productId,
    });
  });
});
