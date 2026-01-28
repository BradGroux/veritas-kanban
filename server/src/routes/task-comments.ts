import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { TaskService } from '../services/task-service.js';
import { activityService } from '../services/activity-service.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { NotFoundError, ValidationError } from '../middleware/error-handler.js';
import { sanitizeCommentText, sanitizeAuthor } from '../utils/sanitize.js';

const router: RouterType = Router();
const taskService = new TaskService();

// Validation schemas
const addCommentSchema = z.object({
  author: z.string().min(1).max(100),
  text: z.string().min(1).max(2000),
});

// POST /api/tasks/:id/comments - Add comment
router.post(
  '/:id/comments',
  asyncHandler(async (req, res) => {
    let author: string, text: string;
    try {
      ({ author, text } = addCommentSchema.parse(req.body));
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.errors);
      }
      throw error;
    }
    // Sanitize user-provided text fields to prevent stored XSS
    author = sanitizeAuthor(author);
    text = sanitizeCommentText(text);

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

    // Log activity
    await activityService.logActivity('comment_added', task.id, task.title, {
      author,
      preview: text.slice(0, 50) + (text.length > 50 ? '...' : ''),
    });

    res.status(201).json(updatedTask);
  })
);

// PATCH /api/tasks/:id/comments/:commentId - Edit comment
router.patch(
  '/:id/comments/:commentId',
  asyncHandler(async (req, res) => {
    let text: string;
    try {
      ({ text } = z.object({ text: z.string().min(1) }).parse(req.body));
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.errors);
      }
      throw error;
    }
    // Sanitize user-provided text to prevent stored XSS
    text = sanitizeCommentText(text);

    const task = await taskService.getTask(req.params.id as string);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    const comments = task.comments || [];
    const commentIndex = comments.findIndex((c) => c.id === (req.params.commentId as string));
    if (commentIndex === -1) {
      throw new NotFoundError('Comment not found');
    }

    comments[commentIndex] = {
      ...comments[commentIndex],
      text,
      timestamp: comments[commentIndex].timestamp, // preserve original timestamp
    };

    const updatedTask = await taskService.updateTask(req.params.id as string, { comments });
    res.json(updatedTask);
  })
);

// DELETE /api/tasks/:id/comments/:commentId - Delete comment
router.delete(
  '/:id/comments/:commentId',
  asyncHandler(async (req, res) => {
    const task = await taskService.getTask(req.params.id as string);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    const comments = task.comments || [];
    const filtered = comments.filter((c) => c.id !== (req.params.commentId as string));
    if (filtered.length === comments.length) {
      throw new NotFoundError('Comment not found');
    }

    const updatedTask = await taskService.updateTask(req.params.id as string, {
      comments: filtered,
    });

    await activityService.logActivity('comment_deleted', task.id, task.title, {
      commentId: req.params.commentId as string,
    });

    res.json(updatedTask);
  })
);

export { router as taskCommentRoutes };
