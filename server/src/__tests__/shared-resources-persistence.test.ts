import fs, { readFile, rename } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SharedResource } from '@veritas-kanban/shared';
import * as serviceModule from '../services/shared-resources-service.js';
import { SharedResourcesService } from '../services/shared-resources-service.js';
import { FileSharedResourceRepository } from '../storage/shared-resource-repository.js';
import { errorHandler, InternalError } from '../middleware/error-handler.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readFile: vi.fn(actual.readFile), rename: vi.fn(actual.rename) };
});

const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
const roots: string[] = [];
const resource: SharedResource = {
  id: 'shared_retained',
  name: 'Retained resource',
  type: 'prompt',
  content: 'Retained café 😊 content',
  tags: ['retained'],
  mountedIn: ['original'],
  createdAt: '2026-10-23T00:00:00.000Z',
  updatedAt: '2026-10-23T00:00:00.000Z',
  version: 1,
};

afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(readFile).mockImplementation(actualFs.readFile);
  vi.mocked(rename).mockImplementation(actualFs.rename);
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture(content?: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-shared-resources-'));
  roots.push(root);
  const filePath = path.join(root, 'shared-resources.json');
  if (content !== undefined) await fs.writeFile(filePath, content);
  const reopen = () => new SharedResourcesService(new FileSharedResourceRepository(filePath));
  return { root, filePath, service: reopen(), reopen };
}

describe('shared resource persistence', () => {
  it.each([
    '[{"id":"shared_retained","content":"kept bytes"}',
    '{}',
    JSON.stringify([{ ...resource, tags: 'invalid' }]),
    JSON.stringify([{ ...resource, version: 'invalid' }]),
  ])('preserves invalid saved content and rejects reads and mutations: %s', async (content) => {
    const { service, filePath } = await fixture(content);
    await expect(service.listResources()).rejects.toThrow(/file is invalid.*preserved/);
    await expect(service.getResource(resource.id)).rejects.toBeInstanceOf(InternalError);
    await expect(
      service.createResource({ name: 'New', type: 'prompt', content: 'New' })
    ).rejects.toThrow(/repair/i);
    expect(await fs.readFile(filePath, 'utf8')).toBe(content);
  });

  it('preserves a valid saved file when its read fails and permits retry', async () => {
    const content = JSON.stringify([resource]);
    const { service, filePath } = await fixture(content);
    vi.mocked(readFile).mockImplementation((async (
      file: Parameters<typeof readFile>[0],
      options: Parameters<typeof readFile>[1]
    ) => {
      if (String(file) === filePath)
        throw Object.assign(new Error('fixture read denied'), { code: 'EACCES' });
      return actualFs.readFile(file, options);
    }) as typeof readFile);
    await expect(service.listResources()).rejects.toThrow(/permissions.*preserved/);
    expect(await fs.readFile(filePath, 'utf8')).toBe(content);
    vi.mocked(readFile).mockImplementation(actualFs.readFile);
    expect(await service.getResource(resource.id)).toEqual(resource);
  });

  it('initializes only an absent file and reloads the empty collection', async () => {
    const { service, filePath, reopen, root } = await fixture();
    expect(await service.listResources()).toEqual([]);
    expect(await fs.readFile(filePath, 'utf8')).toBe('[]');
    expect(await reopen().listResources()).toEqual([]);
    expect(await fs.readdir(root)).toEqual(['shared-resources.json']);
  });

  it('serializes first access and concurrent creates across service instances', async () => {
    const { service, reopen, filePath } = await fixture();
    const other = reopen();
    const pendingRead = service.listResources();
    const created = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        (index % 2 ? service : other).createResource({
          name: `Resource ${index}`,
          type: 'prompt',
          content: `Content ${index}`,
        })
      )
    );
    await pendingRead;
    const reloaded = await reopen().listResources();
    expect(reloaded).toHaveLength(12);
    expect(reloaded.map((entry) => entry.name).sort()).toEqual(
      created.map((entry) => entry.name).sort()
    );
    expect(JSON.parse(await fs.readFile(filePath, 'utf8'))).toHaveLength(12);
  });

  it('preserves concurrent successful field and mount changes through restart', async () => {
    const { service, reopen } = await fixture(JSON.stringify([resource]));
    const other = reopen();
    const changes = await Promise.all([
      service.updateResource(resource.id, { name: 'Renamed' }),
      other.updateResource(resource.id, { content: 'New content' }),
      service.mountResource(resource.id, ['project-a']),
      other.mountResource(resource.id, ['project-b']),
      service.unmountResource(resource.id, ['original']),
    ]);
    expect(changes.every(Boolean)).toBe(true);
    const reloaded = await reopen().getResource(resource.id);
    expect(reloaded).toMatchObject({ name: 'Renamed', content: 'New content', version: 6 });
    expect(reloaded?.mountedIn.sort()).toEqual(['project-a', 'project-b']);
  });

  it.each(['create', 'update', 'delete', 'mount', 'unmount'] as const)(
    'preserves disk and readable state after a failed %s replacement, then retries cleanly',
    async (operation) => {
      const content = JSON.stringify([resource]);
      const { service, filePath, root } = await fixture(content);
      const mutate = () => {
        switch (operation) {
          case 'create':
            return service.createResource({ name: 'New', type: 'prompt', content: 'New' });
          case 'update':
            return service.updateResource(resource.id, { content: 'New' });
          case 'delete':
            return service.deleteResource(resource.id);
          case 'mount':
            return service.mountResource(resource.id, ['new-project']);
          case 'unmount':
            return service.unmountResource(resource.id, ['original']);
        }
      };
      vi.mocked(rename).mockImplementation(async (source, destination) => {
        if (String(destination) === filePath)
          throw Object.assign(new Error('fixture rename failed'), { code: 'EIO' });
        await actualFs.rename(source, destination);
      });
      await expect(mutate()).rejects.toThrow(/could not be saved.*preserved/);
      expect(await fs.readFile(filePath, 'utf8')).toBe(content);
      expect(await service.listResources()).toEqual([resource]);
      expect(await fs.readdir(root)).toEqual(['shared-resources.json']);
      vi.mocked(rename).mockImplementation(actualFs.rename);
      await mutate();
      const saved = await service.listResources();
      if (operation === 'delete') expect(saved).toEqual([]);
      else if (operation === 'create') expect(saved).toHaveLength(2);
      else expect(saved[0].version).toBe(2);
    }
  );

  it('preserves additional saved metadata and existing list/get/not-found behavior', async () => {
    const extended = { ...resource, futureMetadata: { retained: true } };
    const { service, filePath } = await fixture(JSON.stringify([extended]));
    expect(
      await service.listResources({
        type: 'prompt',
        project: 'original',
        tag: 'retained',
        name: 'resource',
      })
    ).toEqual([extended]);
    expect(await service.getResource('missing')).toBeNull();
    expect(await service.updateResource('missing', { name: 'Missing' })).toBeNull();
    expect(await service.deleteResource('missing')).toBe(false);
    await service.updateResource(resource.id, { name: 'Renamed' });
    expect(JSON.parse(await fs.readFile(filePath, 'utf8'))[0]).toMatchObject({
      futureMetadata: { retained: true },
    });
  });

  it('returns actionable HTTP read errors without erasing content and recovers after repair', async () => {
    const content = '[{"id":"shared_retained","content":"recoverable bytes"}';
    const { service, filePath } = await fixture(content);
    vi.spyOn(serviceModule, 'getSharedResourcesService').mockReturnValue(service);
    const { sharedResourcesRoutes } = await import('../routes/shared-resources.js');
    const app = express();
    app.use('/api/shared-resources', sharedResourcesRoutes);
    app.use(errorHandler);
    for (const url of ['/api/shared-resources', `/api/shared-resources/${resource.id}`]) {
      const response = await request(app).get(url);
      expect(response.status).toBe(500);
      expect(response.body).toMatchObject({
        code: 'INTERNAL_ERROR',
        message: expect.stringMatching(/repair.*preserved/i),
      });
      expect(response.body.message).not.toContain('recoverable bytes');
      expect(await fs.readFile(filePath, 'utf8')).toBe(content);
    }
    await fs.writeFile(filePath, JSON.stringify([resource]));
    const repaired = await request(app).get('/api/shared-resources');
    expect(repaired.status).toBe(200);
    expect(repaired.body).toEqual([resource]);
  });
});
