/**
 * Task Time Tracking Route Integration Tests
 * Tests time tracking: start, stop, entry, summary
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import express from 'express';
import { TaskService } from '../../services/task-service.js';
import { errorHandler, ValidationError, NotFoundError } from '../../middleware/error-handler.js';
import { asyncHandler } from '../../middleware/async-handler.js';

describe('Task Time Routes', () => {
  let app: express.Express;
  let testRoot: string;
  let tasksDir: string;
  let archiveDir: string;
  let taskService: TaskService;

  beforeEach(async () => {
    // Create fresh test directories
    const uniqueSuffix = Math.random().toString(36).substring(7);
    testRoot = path.join(os.tmpdir(), `veritas-test-time-${uniqueSuffix}`);
    tasksDir = path.join(testRoot, 'active');
    archiveDir = path.join(testRoot, 'archive');
    
    await fs.mkdir(tasksDir, { recursive: true });
    await fs.mkdir(archiveDir, { recursive: true });
    
    // Create TaskService with test directories
    taskService = new TaskService({ tasksDir, archiveDir });
    
    // Create app with test routes
    app = express();
    app.use(express.json());
    
    const router = express.Router();
    
    // GET /api/tasks/time/summary - Get time summary by project
    router.get('/time/summary', asyncHandler(async (_req, res) => {
      const summary = await taskService.getTimeSummary();
      res.json(summary);
    }));
    
    // POST /api/tasks/:id/time/start - Start timer for a task
    router.post('/:id/time/start', asyncHandler(async (req, res) => {
      try {
        const task = await taskService.startTimer(req.params.id as string);
        res.json(task);
      } catch (error: any) {
        if (error.message === 'Task not found') {
          throw new NotFoundError('Task not found');
        }
        if (error.message === 'Timer is already running for this task') {
          throw new ValidationError(error.message);
        }
        throw error;
      }
    }));
    
    // POST /api/tasks/:id/time/stop - Stop timer for a task
    router.post('/:id/time/stop', asyncHandler(async (req, res) => {
      try {
        const task = await taskService.stopTimer(req.params.id as string);
        res.json(task);
      } catch (error: any) {
        if (error.message === 'Task not found') {
          throw new NotFoundError('Task not found');
        }
        if (error.message === 'No timer is running for this task') {
          throw new ValidationError(error.message);
        }
        throw error;
      }
    }));
    
    // POST /api/tasks/:id/time/entry - Add manual time entry
    router.post('/:id/time/entry', asyncHandler(async (req, res) => {
      const { duration, description } = req.body;
      if (typeof duration !== 'number' || duration <= 0) {
        throw new ValidationError('Duration must be a positive number (in seconds)');
      }
      try {
        const task = await taskService.addTimeEntry(req.params.id as string, duration, description);
        res.json(task);
      } catch (error: any) {
        if (error.message === 'Task not found') {
          throw new NotFoundError('Task not found');
        }
        throw error;
      }
    }));
    
    // DELETE /api/tasks/:id/time/entry/:entryId - Delete a time entry
    router.delete('/:id/time/entry/:entryId', asyncHandler(async (req, res) => {
      try {
        const task = await taskService.deleteTimeEntry(req.params.id as string, req.params.entryId as string);
        res.json(task);
      } catch (error: any) {
        if (error.message === 'Task not found') {
          throw new NotFoundError('Task not found');
        }
        if (error.message === 'Time entry not found') {
          throw new NotFoundError('Time entry not found');
        }
        throw error;
      }
    }));
    
    app.use('/api/tasks', router);
    app.use(errorHandler);
  });

  afterEach(async () => {
    if (testRoot) {
      await fs.rm(testRoot, { recursive: true, force: true }).catch(() => {});
    }
  });

  describe('POST /api/tasks/:id/time/start', () => {
    it('should start a timer for a task', async () => {
      const task = await taskService.createTask({ title: 'Timed Task' });
      
      const res = await request(app)
        .post(`/api/tasks/${task.id}/time/start`);
      
      expect(res.status).toBe(200);
      expect(res.body.timeTracking).toBeDefined();
      expect(res.body.timeTracking.isRunning).toBe(true);
      expect(res.body.timeTracking.activeEntryId).toBeDefined();
      expect(res.body.timeTracking.entries).toHaveLength(1);
      expect(res.body.timeTracking.entries[0].startTime).toBeDefined();
    });

    it('should return 404 for non-existent task', async () => {
      const res = await request(app)
        .post('/api/tasks/nonexistent_id/time/start');
      
      expect(res.status).toBe(404);
    });

    it('should not allow starting already running timer', async () => {
      const task = await taskService.createTask({ title: 'Running Task' });
      
      // Start the timer
      await request(app).post(`/api/tasks/${task.id}/time/start`);
      
      // Try to start again
      const res = await request(app)
        .post(`/api/tasks/${task.id}/time/start`);
      
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/tasks/:id/time/stop', () => {
    it('should stop a running timer', async () => {
      const task = await taskService.createTask({ title: 'Timed Task' });
      
      // Start the timer
      await request(app).post(`/api/tasks/${task.id}/time/start`);
      
      // Wait a tiny bit to ensure some time passes
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Stop the timer
      const res = await request(app)
        .post(`/api/tasks/${task.id}/time/stop`);
      
      expect(res.status).toBe(200);
      expect(res.body.timeTracking.isRunning).toBe(false);
      expect(res.body.timeTracking.activeEntryId).toBeUndefined();
      expect(res.body.timeTracking.entries[0].endTime).toBeDefined();
      expect(res.body.timeTracking.entries[0].duration).toBeGreaterThanOrEqual(0);
    });

    it('should return 404 for non-existent task', async () => {
      const res = await request(app)
        .post('/api/tasks/nonexistent_id/time/stop');
      
      expect(res.status).toBe(404);
    });

    it('should fail when no timer is running', async () => {
      const task = await taskService.createTask({ title: 'No Timer Task' });
      
      const res = await request(app)
        .post(`/api/tasks/${task.id}/time/stop`);
      
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/tasks/:id/time/entry', () => {
    it('should add a manual time entry', async () => {
      const task = await taskService.createTask({ title: 'Manual Entry Task' });
      
      const res = await request(app)
        .post(`/api/tasks/${task.id}/time/entry`)
        .send({ duration: 3600, description: 'Worked on feature' });
      
      expect(res.status).toBe(200);
      expect(res.body.timeTracking.entries).toHaveLength(1);
      expect(res.body.timeTracking.entries[0].duration).toBe(3600);
      expect(res.body.timeTracking.entries[0].description).toBe('Worked on feature');
      expect(res.body.timeTracking.entries[0].manual).toBe(true);
      expect(res.body.timeTracking.totalSeconds).toBe(3600);
    });

    it('should add entry without description', async () => {
      const task = await taskService.createTask({ title: 'Manual Entry Task' });
      
      const res = await request(app)
        .post(`/api/tasks/${task.id}/time/entry`)
        .send({ duration: 1800 });
      
      expect(res.status).toBe(200);
      expect(res.body.timeTracking.entries[0].duration).toBe(1800);
    });

    it('should reject negative duration', async () => {
      const task = await taskService.createTask({ title: 'Test Task' });
      
      const res = await request(app)
        .post(`/api/tasks/${task.id}/time/entry`)
        .send({ duration: -100 });
      
      expect(res.status).toBe(400);
    });

    it('should reject zero duration', async () => {
      const task = await taskService.createTask({ title: 'Test Task' });
      
      const res = await request(app)
        .post(`/api/tasks/${task.id}/time/entry`)
        .send({ duration: 0 });
      
      expect(res.status).toBe(400);
    });

    it('should reject non-numeric duration', async () => {
      const task = await taskService.createTask({ title: 'Test Task' });
      
      const res = await request(app)
        .post(`/api/tasks/${task.id}/time/entry`)
        .send({ duration: 'not-a-number' });
      
      expect(res.status).toBe(400);
    });

    it('should return 404 for non-existent task', async () => {
      const res = await request(app)
        .post('/api/tasks/nonexistent_id/time/entry')
        .send({ duration: 3600 });
      
      expect(res.status).toBe(404);
    });

    it('should accumulate total time with multiple entries', async () => {
      const task = await taskService.createTask({ title: 'Multi-entry Task' });
      
      await request(app)
        .post(`/api/tasks/${task.id}/time/entry`)
        .send({ duration: 1800 });
      
      const res = await request(app)
        .post(`/api/tasks/${task.id}/time/entry`)
        .send({ duration: 1200 });
      
      expect(res.status).toBe(200);
      expect(res.body.timeTracking.entries).toHaveLength(2);
      expect(res.body.timeTracking.totalSeconds).toBe(3000);
    });
  });

  describe('DELETE /api/tasks/:id/time/entry/:entryId', () => {
    it('should delete a time entry', async () => {
      const task = await taskService.createTask({ title: 'Delete Entry Task' });
      
      // Add an entry
      const addRes = await request(app)
        .post(`/api/tasks/${task.id}/time/entry`)
        .send({ duration: 3600 });
      
      const entryId = addRes.body.timeTracking.entries[0].id;
      
      // Delete it
      const res = await request(app)
        .delete(`/api/tasks/${task.id}/time/entry/${entryId}`);
      
      expect(res.status).toBe(200);
      expect(res.body.timeTracking.entries).toHaveLength(0);
      expect(res.body.timeTracking.totalSeconds).toBe(0);
    });

    it('should return 404 for non-existent task', async () => {
      const res = await request(app)
        .delete('/api/tasks/nonexistent_id/time/entry/entry_123');
      
      expect(res.status).toBe(404);
    });

    it('should succeed silently for non-existent entry (no error thrown)', async () => {
      // Note: The TaskService doesn't throw for non-existent entries, it just filters
      const task = await taskService.createTask({ title: 'Test Task' });
      
      const res = await request(app)
        .delete(`/api/tasks/${task.id}/time/entry/nonexistent_entry`);
      
      // TaskService doesn't throw for non-existent entries, just returns task as-is
      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/tasks/time/summary', () => {
    it('should return empty summary when no tasks', async () => {
      const res = await request(app)
        .get('/api/tasks/time/summary');
      
      expect(res.status).toBe(200);
      expect(res.body.byProject).toEqual([]);
      expect(res.body.total).toBe(0);
    });

    it('should return summary grouped by project', async () => {
      // Create tasks in different projects with time
      const task1 = await taskService.createTask({ title: 'Task 1', project: 'project-a' });
      const task2 = await taskService.createTask({ title: 'Task 2', project: 'project-a' });
      const task3 = await taskService.createTask({ title: 'Task 3', project: 'project-b' });
      
      // Add time to each
      await request(app)
        .post(`/api/tasks/${task1.id}/time/entry`)
        .send({ duration: 3600 });
      
      await request(app)
        .post(`/api/tasks/${task2.id}/time/entry`)
        .send({ duration: 1800 });
      
      await request(app)
        .post(`/api/tasks/${task3.id}/time/entry`)
        .send({ duration: 7200 });
      
      const res = await request(app)
        .get('/api/tasks/time/summary');
      
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(12600);
      expect(res.body.byProject).toHaveLength(2);
      
      // byProject is sorted by totalSeconds descending
      const projectB = res.body.byProject.find((p: any) => p.project === 'project-b');
      const projectA = res.body.byProject.find((p: any) => p.project === 'project-a');
      
      expect(projectA.totalSeconds).toBe(5400);
      expect(projectA.taskCount).toBe(2);
      expect(projectB.totalSeconds).toBe(7200);
      expect(projectB.taskCount).toBe(1);
    });

    it('should handle tasks without project', async () => {
      const task = await taskService.createTask({ title: 'No Project Task' });
      
      await request(app)
        .post(`/api/tasks/${task.id}/time/entry`)
        .send({ duration: 1800 });
      
      const res = await request(app)
        .get('/api/tasks/time/summary');
      
      expect(res.status).toBe(200);
      expect(res.body.byProject).toHaveLength(1);
      expect(res.body.byProject[0].project).toBe('(No Project)');
      expect(res.body.byProject[0].totalSeconds).toBe(1800);
    });
  });
});
