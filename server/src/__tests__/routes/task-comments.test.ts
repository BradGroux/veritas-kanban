/**
 * Task Comments Route Integration Tests
 * Tests comment operations: add, edit, delete
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import express from 'express';
import { TaskService } from '../../services/task-service.js';
import { errorHandler, NotFoundError, ValidationError } from '../../middleware/error-handler.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { z } from 'zod';

// Mock activity service to avoid file system side effects
vi.mock('../../services/activity-service.js', () => ({
  activityService: {
    logActivity: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('Task Comments Routes', () => {
  let app: express.Express;
  let testRoot: string;
  let tasksDir: string;
  let archiveDir: string;
  let taskService: TaskService;

  beforeEach(async () => {
    // Create fresh test directories
    const uniqueSuffix = Math.random().toString(36).substring(7);
    testRoot = path.join(os.tmpdir(), `veritas-test-comments-${uniqueSuffix}`);
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
    
    // Validation schemas
    const addCommentSchema = z.object({
      author: z.string().min(1).max(100),
      text: z.string().min(1).max(2000),
    });
    
    // POST /api/tasks/:id/comments - Add comment
    router.post('/:id/comments', asyncHandler(async (req, res) => {
      let author: string, text: string;
      try {
        ({ author, text } = addCommentSchema.parse(req.body));
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new ValidationError('Validation failed', error.errors);
        }
        throw error;
      }
      
      const task = await taskService.getTask(req.params.id as string);
      if (!task) {
        throw new NotFoundError('Task not found');
      }

      const comment = {
        id: `comment_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        author,
        text,
        timestamp: new Date().toISOString(),
      };

      const comments = [...(task.comments || []), comment];
      const updatedTask = await taskService.updateTask(req.params.id as string, { comments });
      
      res.status(201).json(updatedTask);
    }));
    
    // PATCH /api/tasks/:id/comments/:commentId - Edit comment
    router.patch('/:id/comments/:commentId', asyncHandler(async (req, res) => {
      let text: string;
      try {
        ({ text } = z.object({ text: z.string().min(1) }).parse(req.body));
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new ValidationError('Validation failed', error.errors);
        }
        throw error;
      }
      
      const task = await taskService.getTask(req.params.id as string);
      if (!task) {
        throw new NotFoundError('Task not found');
      }

      const comments = task.comments || [];
      const commentIndex = comments.findIndex(c => c.id === req.params.commentId);
      if (commentIndex === -1) {
        throw new NotFoundError('Comment not found');
      }

      comments[commentIndex] = {
        ...comments[commentIndex],
        text,
        timestamp: comments[commentIndex].timestamp,
      };

      const updatedTask = await taskService.updateTask(req.params.id as string, { comments });
      res.json(updatedTask);
    }));
    
    // DELETE /api/tasks/:id/comments/:commentId - Delete comment
    router.delete('/:id/comments/:commentId', asyncHandler(async (req, res) => {
      const task = await taskService.getTask(req.params.id as string);
      if (!task) {
        throw new NotFoundError('Task not found');
      }

      const comments = task.comments || [];
      const filtered = comments.filter(c => c.id !== req.params.commentId);
      if (filtered.length === comments.length) {
        throw new NotFoundError('Comment not found');
      }

      const updatedTask = await taskService.updateTask(req.params.id as string, { comments: filtered });
      res.json(updatedTask);
    }));
    
    app.use('/api/tasks', router);
    app.use(errorHandler);
  });

  afterEach(async () => {
    if (testRoot) {
      await fs.rm(testRoot, { recursive: true, force: true }).catch(() => {});
    }
  });

  describe('POST /api/tasks/:id/comments', () => {
    it('should add a comment to a task', async () => {
      const task = await taskService.createTask({ title: 'Test Task' });
      
      const res = await request(app)
        .post(`/api/tasks/${task.id}/comments`)
        .send({ author: 'TestUser', text: 'This is a test comment' });
      
      expect(res.status).toBe(201);
      expect(res.body.comments).toHaveLength(1);
      expect(res.body.comments[0].author).toBe('TestUser');
      expect(res.body.comments[0].text).toBe('This is a test comment');
      expect(res.body.comments[0].id).toMatch(/^comment_/);
      expect(res.body.comments[0].timestamp).toBeDefined();
    });

    it('should add multiple comments', async () => {
      const task = await taskService.createTask({ title: 'Test Task' });
      
      await request(app)
        .post(`/api/tasks/${task.id}/comments`)
        .send({ author: 'User1', text: 'First comment' });
      
      const res = await request(app)
        .post(`/api/tasks/${task.id}/comments`)
        .send({ author: 'User2', text: 'Second comment' });
      
      expect(res.status).toBe(201);
      expect(res.body.comments).toHaveLength(2);
      expect(res.body.comments[0].text).toBe('First comment');
      expect(res.body.comments[1].text).toBe('Second comment');
    });

    it('should return 404 for non-existent task', async () => {
      const res = await request(app)
        .post('/api/tasks/nonexistent_id/comments')
        .send({ author: 'TestUser', text: 'Comment' });
      
      expect(res.status).toBe(404);
    });

    it('should reject empty author', async () => {
      const task = await taskService.createTask({ title: 'Test Task' });
      
      const res = await request(app)
        .post(`/api/tasks/${task.id}/comments`)
        .send({ author: '', text: 'Comment' });
      
      expect(res.status).toBe(400);
    });

    it('should reject empty text', async () => {
      const task = await taskService.createTask({ title: 'Test Task' });
      
      const res = await request(app)
        .post(`/api/tasks/${task.id}/comments`)
        .send({ author: 'TestUser', text: '' });
      
      expect(res.status).toBe(400);
    });

    it('should reject missing fields', async () => {
      const task = await taskService.createTask({ title: 'Test Task' });
      
      const res = await request(app)
        .post(`/api/tasks/${task.id}/comments`)
        .send({});
      
      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /api/tasks/:id/comments/:commentId', () => {
    it('should edit a comment', async () => {
      const task = await taskService.createTask({ title: 'Test Task' });
      
      // Add a comment first
      const addRes = await request(app)
        .post(`/api/tasks/${task.id}/comments`)
        .send({ author: 'TestUser', text: 'Original text' });
      
      const commentId = addRes.body.comments[0].id;
      
      // Edit the comment
      const res = await request(app)
        .patch(`/api/tasks/${task.id}/comments/${commentId}`)
        .send({ text: 'Updated text' });
      
      expect(res.status).toBe(200);
      expect(res.body.comments[0].text).toBe('Updated text');
      expect(res.body.comments[0].author).toBe('TestUser'); // Author preserved
    });

    it('should return 404 for non-existent task', async () => {
      const res = await request(app)
        .patch('/api/tasks/nonexistent_id/comments/comment_123')
        .send({ text: 'Updated' });
      
      expect(res.status).toBe(404);
    });

    it('should return 404 for non-existent comment', async () => {
      const task = await taskService.createTask({ title: 'Test Task' });
      
      const res = await request(app)
        .patch(`/api/tasks/${task.id}/comments/nonexistent_comment`)
        .send({ text: 'Updated' });
      
      expect(res.status).toBe(404);
    });

    it('should reject empty text', async () => {
      const task = await taskService.createTask({ title: 'Test Task' });
      
      const addRes = await request(app)
        .post(`/api/tasks/${task.id}/comments`)
        .send({ author: 'TestUser', text: 'Original' });
      
      const commentId = addRes.body.comments[0].id;
      
      const res = await request(app)
        .patch(`/api/tasks/${task.id}/comments/${commentId}`)
        .send({ text: '' });
      
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/tasks/:id/comments/:commentId', () => {
    it('should delete a comment', async () => {
      const task = await taskService.createTask({ title: 'Test Task' });
      
      // Add a comment first
      const addRes = await request(app)
        .post(`/api/tasks/${task.id}/comments`)
        .send({ author: 'TestUser', text: 'To be deleted' });
      
      const commentId = addRes.body.comments[0].id;
      
      // Delete the comment
      const res = await request(app)
        .delete(`/api/tasks/${task.id}/comments/${commentId}`);
      
      expect(res.status).toBe(200);
      expect(res.body.comments).toHaveLength(0);
    });

    it('should delete only the specified comment', async () => {
      const task = await taskService.createTask({ title: 'Test Task' });
      
      // Add two comments
      await request(app)
        .post(`/api/tasks/${task.id}/comments`)
        .send({ author: 'User1', text: 'First' });
      
      const addRes = await request(app)
        .post(`/api/tasks/${task.id}/comments`)
        .send({ author: 'User2', text: 'Second' });
      
      const secondCommentId = addRes.body.comments[1].id;
      
      // Delete the second comment
      const res = await request(app)
        .delete(`/api/tasks/${task.id}/comments/${secondCommentId}`);
      
      expect(res.status).toBe(200);
      expect(res.body.comments).toHaveLength(1);
      expect(res.body.comments[0].text).toBe('First');
    });

    it('should return 404 for non-existent task', async () => {
      const res = await request(app)
        .delete('/api/tasks/nonexistent_id/comments/comment_123');
      
      expect(res.status).toBe(404);
    });

    it('should return 404 for non-existent comment', async () => {
      const task = await taskService.createTask({ title: 'Test Task' });
      
      const res = await request(app)
        .delete(`/api/tasks/${task.id}/comments/nonexistent_comment`);
      
      expect(res.status).toBe(404);
    });
  });
});
