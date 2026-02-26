import { Router, type Router as RouterType } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getTaskService } from '../services/task-service.js';
import { activityService } from '../services/activity-service.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { NotFoundError, ValidationError } from '../middleware/error-handler.js';
import { sanitizeCommentText } from '../utils/sanitize.js';
import type { Task, Observation, ObservationType } from '@veritas-kanban/shared';

const router: RouterType = Router();
const taskService = getTaskService();

// Validation schemas
const addObservationSchema = z.object({
  type: z.enum(['decision', 'blocker', 'insight', 'context']),
  content: z.string().min(1).max(5000),
  score: z.number().min(1).max(10).optional().default(5),
  agent: z.string().optional(),
});

// POST /api/tasks/:id/observations - Add observation
router.post(
  '/:id/observations',
  asyncHandler(async (req, res) => {
    let type: ObservationType, content: string, score: number, agent: string | undefined;
    try {
      ({ type, content, score, agent } = addObservationSchema.parse(req.body));
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.errors);
      }
      throw error;
    }
    // Sanitize user-provided text fields to prevent stored XSS
    content = sanitizeCommentText(content);
    if (agent) {
      agent = agent.slice(0, 100); // Simple sanitization for agent name
    }

    const task = await taskService.getTask(req.params.id as string);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    const observation: Observation = {
      id: `obs_${randomUUID()}`,
      type,
      content,
      score,
      timestamp: new Date().toISOString(),
      agent,
    };

    const observations = [...(task.observations || []), observation];
    const updatedTask = await taskService.updateTask(req.params.id as string, { observations });

    // Log activity
    await activityService.logActivity(
      'observation_added',
      task.id,
      task.title,
      {
        type,
        score,
        preview: content.slice(0, 50) + (content.length > 50 ? '...' : ''),
      },
      task.agent
    );

    res.status(201).json(updatedTask);
  })
);

// GET /api/tasks/:id/observations - List observations
router.get(
  '/:id/observations',
  asyncHandler(async (req, res) => {
    const task = await taskService.getTask(req.params.id as string);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    let observations = task.observations || [];

    // Apply filters
    const typeFilter = req.query.type as string | undefined;
    if (typeFilter) {
      observations = observations.filter((o) => o.type === typeFilter);
    }

    const minScore = req.query.minScore ? parseInt(req.query.minScore as string, 10) : undefined;
    if (minScore !== undefined && !isNaN(minScore)) {
      observations = observations.filter((o) => o.score >= minScore);
    }

    // Apply sorting
    const sort = (req.query.sort as string) || 'newest';
    switch (sort) {
      case 'oldest':
        observations.sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
        break;
      case 'score':
        observations.sort((a, b) => b.score - a.score);
        break;
      case 'newest':
      default:
        observations.sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
        break;
    }

    // Apply limit
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    if (limit !== undefined && !isNaN(limit) && limit > 0) {
      observations = observations.slice(0, limit);
    }

    res.json({ observations });
  })
);

// DELETE /api/tasks/:id/observations/:obsId - Remove observation
router.delete(
  '/:id/observations/:obsId',
  asyncHandler(async (req, res) => {
    const task = await taskService.getTask(req.params.id as string);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    const observations = task.observations || [];
    const filtered = observations.filter((o) => o.id !== (req.params.obsId as string));
    if (filtered.length === observations.length) {
      throw new NotFoundError('Observation not found');
    }

    const updatedTask = await taskService.updateTask(req.params.id as string, {
      observations: filtered,
    });

    await activityService.logActivity(
      'observation_deleted',
      task.id,
      task.title,
      {
        observationId: req.params.obsId as string,
      },
      task.agent
    );

    res.json(updatedTask);
  })
);

export { router as taskObservationRoutes };

// Separate router for global observation search (mounted at /api/observations)
const observationSearchRouter: RouterType = Router();

observationSearchRouter.get(
  '/search',
  asyncHandler(async (req, res) => {
    const query = (req.query.q as string) || '';
    if (!query || query.trim().length === 0) {
      res.json({ results: [], total: 0 });
      return;
    }

    const queryLower = query.toLowerCase();
    const allTasks = await taskService.listTasks();

    // NOTE: Full-text search should be replaced with a proper index (e.g., SQLite FTS5)
    // when task count exceeds ~500 for better performance.
    const results: Array<{
      observation: Observation;
      taskId: string;
      taskTitle: string;
    }> = [];

    for (const task of allTasks) {
      if (task.observations) {
        for (const obs of task.observations) {
          if (obs.content.toLowerCase().includes(queryLower)) {
            results.push({
              observation: obs,
              taskId: task.id,
              taskTitle: task.title,
            });
          }
        }
      }
    }

    // Sort by score descending, then by timestamp descending
    results.sort((a, b) => {
      if (b.observation.score !== a.observation.score) {
        return b.observation.score - a.observation.score;
      }
      return (
        new Date(b.observation.timestamp).getTime() - new Date(a.observation.timestamp).getTime()
      );
    });

    // Apply pagination
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;
    const paged = results.slice(offset, offset + limit);

    res.json({ results: paged, total: results.length });
  })
);

export { observationSearchRouter };
