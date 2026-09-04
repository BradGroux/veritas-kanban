/**
 * Templates Route Coverage Tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

const { mockTemplateService } = vi.hoisted(() => ({
  mockTemplateService: {
    getTemplates: vi.fn(),
    getTemplate: vi.fn(),
    createTemplate: vi.fn(),
    updateTemplate: vi.fn(),
    deleteTemplate: vi.fn(),
  },
}));

vi.mock('../../services/template-service.js', () => ({
  TemplateService: function () {
    return mockTemplateService;
  },
}));

import templatesRouter from '../../routes/templates.js';

describe('Templates Routes (actual module)', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/templates', templatesRouter);
  });

  describe('GET /api/templates', () => {
    it('should list templates', async () => {
      mockTemplateService.getTemplates.mockResolvedValue([{ id: 't1', name: 'Bug' }]);
      const res = await request(app).get('/api/templates');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    it('should handle error', async () => {
      mockTemplateService.getTemplates.mockRejectedValue(new Error('fail'));
      const res = await request(app).get('/api/templates');
      expect(res.status).toBe(500);
    });
  });

  describe('GET /api/templates/:id', () => {
    it('should get a template', async () => {
      mockTemplateService.getTemplate.mockResolvedValue({ id: 't1', name: 'Bug' });
      const res = await request(app).get('/api/templates/t1');
      expect(res.status).toBe(200);
    });

    it('should return 404 for missing template', async () => {
      mockTemplateService.getTemplate.mockResolvedValue(null);
      const res = await request(app).get('/api/templates/missing');
      expect(res.status).toBe(404);
    });

    it('should handle error', async () => {
      mockTemplateService.getTemplate.mockRejectedValue(new Error('fail'));
      const res = await request(app).get('/api/templates/t1');
      expect(res.status).toBe(500);
    });
  });

  describe('POST /api/templates', () => {
    it('should create a template', async () => {
      const template = { name: 'Bug Fix', taskDefaults: { type: 'bug' } };
      mockTemplateService.createTemplate.mockResolvedValue({ id: 't1', ...template });
      const res = await request(app).post('/api/templates').send(template);
      expect(res.status).toBe(201);
    });

    it('should reject invalid data', async () => {
      const res = await request(app).post('/api/templates').send({ taskDefaults: {} });
      expect(res.status).toBe(400);
    });

    it('should handle service error', async () => {
      mockTemplateService.createTemplate.mockRejectedValue(new Error('fail'));
      const res = await request(app)
        .post('/api/templates')
        .send({ name: 'Test', taskDefaults: {} });
      expect(res.status).toBe(500);
    });
  });

  describe('PATCH /api/templates/:id', () => {
    it('should update a template', async () => {
      mockTemplateService.updateTemplate.mockResolvedValue({ id: 't1', name: 'Updated' });
      const res = await request(app).patch('/api/templates/t1').send({ name: 'Updated' });
      expect(res.status).toBe(200);
    });

    it('should return 404 for missing template', async () => {
      mockTemplateService.updateTemplate.mockResolvedValue(null);
      const res = await request(app).patch('/api/templates/missing').send({ name: 'Updated' });
      expect(res.status).toBe(404);
    });

    it('should reject invalid data', async () => {
      const res = await request(app).patch('/api/templates/t1').send({ name: '' });
      expect(res.status).toBe(400);
    });

    it('should handle service error', async () => {
      mockTemplateService.updateTemplate.mockRejectedValue(new Error('fail'));
      const res = await request(app).patch('/api/templates/t1').send({ name: 'Updated' });
      expect(res.status).toBe(500);
    });
  });

  describe('DELETE /api/templates/:id', () => {
    it('should delete a template', async () => {
      mockTemplateService.deleteTemplate.mockResolvedValue(true);
      const res = await request(app).delete('/api/templates/t1');
      expect(res.status).toBe(204);
    });

    it('should return 404 for missing template', async () => {
      mockTemplateService.deleteTemplate.mockResolvedValue(false);
      const res = await request(app).delete('/api/templates/missing');
      expect(res.status).toBe(404);
    });

    it('should handle error', async () => {
      mockTemplateService.deleteTemplate.mockRejectedValue(new Error('fail'));
      const res = await request(app).delete('/api/templates/t1');
      expect(res.status).toBe(500);
    });
  });

  describe.each(['post', 'patch'] as const)('%s priority validation', (method) => {
    it.each(['low', 'medium', 'high', 'critical'])(
      'accepts %s in defaults and blueprints',
      async (priority) => {
        const input = {
          name: 'Priority template',
          taskDefaults: { priority },
          blueprint: [{ refId: 'first', title: 'First task', taskDefaults: { priority } }],
        };
        const service =
          method === 'post'
            ? mockTemplateService.createTemplate
            : mockTemplateService.updateTemplate;
        service.mockResolvedValue({ id: 't1', ...input });
        const client = request(app);
        const res = await client[method](
          method === 'post' ? '/api/templates' : '/api/templates/t1'
        ).send(input);
        expect(res.status).toBe(method === 'post' ? 201 : 200);
        expect(res.body.taskDefaults.priority).toBe(priority);
        expect(service).toHaveBeenCalledWith(...(method === 'post' ? [input] : ['t1', input]));
      }
    );

    it.each(['defaults', 'blueprint'])(
      'rejects unsupported priorities in %s without translating them',
      async (location) => {
        const input = {
          name: 'Invalid priority',
          taskDefaults: { priority: location === 'defaults' ? 'urgent' : 'high' },
          blueprint: [
            {
              refId: 'first',
              title: 'First task',
              taskDefaults: { priority: location === 'blueprint' ? 'urgent' : 'high' },
            },
          ],
        };
        const client = request(app);
        const res = await client[method](
          method === 'post' ? '/api/templates' : '/api/templates/t1'
        ).send(input);
        expect(res.status).toBe(400);
        expect(mockTemplateService.createTemplate).not.toHaveBeenCalled();
        expect(mockTemplateService.updateTemplate).not.toHaveBeenCalled();
      }
    );
  });
});
