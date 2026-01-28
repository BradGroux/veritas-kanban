/**
 * Agent Status Route Integration Tests
 * Tests agent status: GET and POST operations
 */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { z } from 'zod';
import { errorHandler, ValidationError } from '../../middleware/error-handler.js';
import { asyncHandler } from '../../middleware/async-handler.js';

// Type definitions matching the route
type AgentStatusState = 'idle' | 'working' | 'thinking' | 'sub-agent' | 'error';

interface AgentStatus {
  status: AgentStatusState;
  activeTask?: {
    id: string;
    title?: string;
  };
  subAgentCount: number;
  lastUpdated: string;
  errorMessage?: string;
}

describe('Agent Status Routes', () => {
  let app: express.Express;
  let currentStatus: AgentStatus;

  beforeEach(async () => {
    // Reset status for each test
    currentStatus = {
      status: 'idle',
      subAgentCount: 0,
      lastUpdated: new Date().toISOString(),
    };
    
    // Create app with test routes
    app = express();
    app.use(express.json());
    
    const router = express.Router();
    
    // Validation schema for POST
    const updateStatusSchema = z.object({
      status: z.enum(['idle', 'working', 'thinking', 'sub-agent', 'error']).optional(),
      activeTask: z.object({
        id: z.string(),
        title: z.string().optional(),
      }).optional().nullable(),
      subAgentCount: z.number().int().min(0).optional(),
      errorMessage: z.string().optional().nullable(),
    });
    
    // Helper to update status
    function updateAgentStatus(update: Partial<AgentStatus>): AgentStatus {
      currentStatus = {
        ...currentStatus,
        ...update,
        lastUpdated: new Date().toISOString(),
      };
      return currentStatus;
    }
    
    // GET /api/agent/status - Get current agent status
    router.get('/', asyncHandler(async (_req, res) => {
      res.json(currentStatus);
    }));
    
    // POST /api/agent/status - Update agent status
    router.post('/', asyncHandler(async (req, res) => {
      const parsed = updateStatusSchema.safeParse(req.body);
      
      if (!parsed.success) {
        throw new ValidationError('Invalid status update', parsed.error.format());
      }

      const update = parsed.data;

      // Build the update object
      const newStatus: Partial<AgentStatus> = {};

      if (update.status !== undefined) {
        newStatus.status = update.status;
      }

      if (update.activeTask !== undefined) {
        newStatus.activeTask = update.activeTask ?? undefined;
      }

      if (update.subAgentCount !== undefined) {
        newStatus.subAgentCount = update.subAgentCount;
      }

      if (update.errorMessage !== undefined) {
        newStatus.errorMessage = update.errorMessage ?? undefined;
      }

      // Clear activeTask and errorMessage when going idle
      if (update.status === 'idle') {
        newStatus.activeTask = undefined;
        newStatus.errorMessage = undefined;
      }

      const result = updateAgentStatus(newStatus);
      
      res.json(result);
    }));
    
    app.use('/api/agent/status', router);
    app.use(errorHandler);
  });

  describe('GET /api/agent/status', () => {
    it('should return initial idle status', async () => {
      const res = await request(app)
        .get('/api/agent/status');
      
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('idle');
      expect(res.body.subAgentCount).toBe(0);
      expect(res.body.lastUpdated).toBeDefined();
    });

    it('should return updated status after POST', async () => {
      // First update the status
      await request(app)
        .post('/api/agent/status')
        .send({ status: 'working' });
      
      // Then get it
      const res = await request(app)
        .get('/api/agent/status');
      
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('working');
    });
  });

  describe('POST /api/agent/status', () => {
    it('should update status to working', async () => {
      const res = await request(app)
        .post('/api/agent/status')
        .send({ status: 'working' });
      
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('working');
      expect(res.body.lastUpdated).toBeDefined();
    });

    it('should update status to thinking', async () => {
      const res = await request(app)
        .post('/api/agent/status')
        .send({ status: 'thinking' });
      
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('thinking');
    });

    it('should update status to sub-agent', async () => {
      const res = await request(app)
        .post('/api/agent/status')
        .send({ status: 'sub-agent', subAgentCount: 2 });
      
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('sub-agent');
      expect(res.body.subAgentCount).toBe(2);
    });

    it('should update status to error with message', async () => {
      const res = await request(app)
        .post('/api/agent/status')
        .send({ status: 'error', errorMessage: 'Something went wrong' });
      
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('error');
      expect(res.body.errorMessage).toBe('Something went wrong');
    });

    it('should set active task', async () => {
      const res = await request(app)
        .post('/api/agent/status')
        .send({
          status: 'working',
          activeTask: { id: 'task_123', title: 'Test Task' },
        });
      
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('working');
      expect(res.body.activeTask).toEqual({ id: 'task_123', title: 'Test Task' });
    });

    it('should clear activeTask and errorMessage when going idle', async () => {
      // First set working with active task
      await request(app)
        .post('/api/agent/status')
        .send({
          status: 'working',
          activeTask: { id: 'task_123' },
          errorMessage: 'Previous error',
        });
      
      // Then go idle
      const res = await request(app)
        .post('/api/agent/status')
        .send({ status: 'idle' });
      
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('idle');
      expect(res.body.activeTask).toBeUndefined();
      expect(res.body.errorMessage).toBeUndefined();
    });

    it('should clear active task with null', async () => {
      // First set active task
      await request(app)
        .post('/api/agent/status')
        .send({
          status: 'working',
          activeTask: { id: 'task_123' },
        });
      
      // Then clear it
      const res = await request(app)
        .post('/api/agent/status')
        .send({ activeTask: null });
      
      expect(res.status).toBe(200);
      expect(res.body.activeTask).toBeUndefined();
    });

    it('should update subAgentCount', async () => {
      const res = await request(app)
        .post('/api/agent/status')
        .send({ subAgentCount: 3 });
      
      expect(res.status).toBe(200);
      expect(res.body.subAgentCount).toBe(3);
    });

    it('should reject invalid status value', async () => {
      const res = await request(app)
        .post('/api/agent/status')
        .send({ status: 'invalid-status' });
      
      expect(res.status).toBe(400);
    });

    it('should reject negative subAgentCount', async () => {
      const res = await request(app)
        .post('/api/agent/status')
        .send({ subAgentCount: -1 });
      
      expect(res.status).toBe(400);
    });

    it('should reject non-integer subAgentCount', async () => {
      const res = await request(app)
        .post('/api/agent/status')
        .send({ subAgentCount: 1.5 });
      
      expect(res.status).toBe(400);
    });

    it('should reject activeTask without id', async () => {
      const res = await request(app)
        .post('/api/agent/status')
        .send({ activeTask: { title: 'No ID' } });
      
      expect(res.status).toBe(400);
    });

    it('should allow partial updates', async () => {
      // Set initial state
      await request(app)
        .post('/api/agent/status')
        .send({
          status: 'working',
          subAgentCount: 2,
        });
      
      // Update only subAgentCount
      const res = await request(app)
        .post('/api/agent/status')
        .send({ subAgentCount: 3 });
      
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('working'); // Preserved
      expect(res.body.subAgentCount).toBe(3); // Updated
    });

    it('should update lastUpdated on each change', async () => {
      const res1 = await request(app)
        .post('/api/agent/status')
        .send({ status: 'working' });
      
      const firstUpdate = res1.body.lastUpdated;
      
      // Wait a small amount
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const res2 = await request(app)
        .post('/api/agent/status')
        .send({ status: 'thinking' });
      
      expect(res2.body.lastUpdated).not.toBe(firstUpdate);
    });
  });
});
