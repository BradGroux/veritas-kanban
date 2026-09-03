import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { TemplateService } from '../../services/template-service.js';
import { SqliteDatabase } from '../../storage/sqlite/database.js';
import { errorHandler } from '../../middleware/error-handler.js';

vi.mock('../../services/session-template-service.js', () => ({
  getSessionTemplateService: () => ({}),
}));
import templatesRouter from '../../routes/templates.js';

describe.each(['file', 'sqlite'] as const)('Template clearing through JSON (%s)', (storageType) => {
  let root: string;
  let database: SqliteDatabase;
  let app: express.Express;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'vk-template-api-clear-'));
    database = new SqliteDatabase({ databasePath: join(root, 'templates.db') });
    const service = new TemplateService({
      storageType,
      templatesDir: join(root, 'templates'),
      sqliteDatabase: database,
    });
    // Route calls use the real service and storage, redirected only to this test's data.
    const createTemplate = service.createTemplate.bind(service);
    const updateTemplate = service.updateTemplate.bind(service);
    const getTemplate = service.getTemplate.bind(service);
    vi.spyOn(TemplateService.prototype, 'createTemplate').mockImplementation(createTemplate);
    vi.spyOn(TemplateService.prototype, 'updateTemplate').mockImplementation(updateTemplate);
    vi.spyOn(TemplateService.prototype, 'getTemplate').mockImplementation(getTemplate);
    app = express().use(express.json()).use('/api/templates', templatesRouter).use(errorHandler);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    database.close();
    await rm(root, { recursive: true, force: true });
  });

  it('clears explicit null fields, preserves omitted fields, and reopens the persisted result', async () => {
    const created = await request(app)
      .post('/api/templates')
      .send({
        name: 'Clear regression',
        description: 'Old summary',
        category: 'feature',
        taskDefaults: {
          type: 'code',
          priority: 'high',
          project: 'old-project',
          descriptionTemplate: 'Old Markdown',
          agent: 'custom-agent',
        },
      })
      .expect(201);
    const url = `/api/templates/${created.body.id}`;
    await request(app)
      .patch(url)
      .send({ description: null, taskDefaults: { project: null, descriptionTemplate: null } })
      .expect(200);
    const partial = await request(app).get(url).expect(200);
    expect(partial.body).not.toHaveProperty('description');
    expect(partial.body.category).toBe('feature');
    expect(partial.body.taskDefaults).toEqual({
      type: 'code',
      priority: 'high',
      agent: 'custom-agent',
    });

    await request(app)
      .patch(url)
      .send({ category: null, taskDefaults: { type: null, priority: null, agent: null } })
      .expect(200);
    const empty = await request(app).get(url).expect(200);
    expect(empty.body).not.toHaveProperty('category');
    expect(empty.body.taskDefaults).toEqual({});
    expect(empty.body.name).toBe('Clear regression');

    await request(app)
      .patch(url)
      .send({ taskDefaults: { project: 'new-project' } })
      .expect(200);
    const restored = await request(app).get(url).expect(200);
    expect(restored.body.taskDefaults).toEqual({ project: 'new-project' });
  });

  it('rejects null names and null defaults containers without modifying the template', async () => {
    const created = await request(app)
      .post('/api/templates')
      .send({ name: 'Keep name', taskDefaults: { priority: 'high' } })
      .expect(201);
    const url = `/api/templates/${created.body.id}`;
    await request(app).patch(url).send({ name: null }).expect(400);
    await request(app).patch(url).send({ taskDefaults: null }).expect(400);
    const reopened = await request(app).get(url).expect(200);
    expect(reopened.body.name).toBe('Keep name');
    expect(reopened.body.taskDefaults).toEqual({ priority: 'high' });
  });
});
