import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { TaskService } from '../services/task-service.js';
import { WorktreeService } from '../services/worktree-service.js';
import type { CreateTaskInput, UpdateTaskInput } from '@veritas-kanban/shared';

const router: RouterType = Router();
const taskService = new TaskService();
const worktreeService = new WorktreeService();

// Validation schemas
const createTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional().default(''),
  type: z.enum(['code', 'research', 'content', 'automation']).optional().default('code'),
  priority: z.enum(['low', 'medium', 'high']).optional().default('medium'),
  project: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const gitSchema = z.object({
  repo: z.string().optional(),
  branch: z.string().optional(),
  baseBranch: z.string().optional(),
  worktreePath: z.string().optional(),
}).optional();

const attemptSchema = z.object({
  id: z.string(),
  agent: z.enum(['claude-code', 'amp', 'copilot', 'gemini']),
  status: z.enum(['pending', 'running', 'complete', 'failed']),
  started: z.string().optional(),
  ended: z.string().optional(),
}).optional();

const reviewCommentSchema = z.object({
  id: z.string(),
  file: z.string(),
  line: z.number(),
  content: z.string(),
  created: z.string(),
});

const updateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  type: z.enum(['code', 'research', 'content', 'automation']).optional(),
  status: z.enum(['todo', 'in-progress', 'review', 'done']).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  project: z.string().optional(),
  tags: z.array(z.string()).optional(),
  git: gitSchema,
  attempt: attemptSchema,
  reviewComments: z.array(reviewCommentSchema).optional(),
});

// GET /api/tasks - List all tasks
router.get('/', async (_req, res) => {
  try {
    const tasks = await taskService.listTasks();
    res.json(tasks);
  } catch (error) {
    console.error('Error listing tasks:', error);
    res.status(500).json({ error: 'Failed to list tasks' });
  }
});

// GET /api/tasks/:id - Get single task
router.get('/:id', async (req, res) => {
  try {
    const task = await taskService.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json(task);
  } catch (error) {
    console.error('Error getting task:', error);
    res.status(500).json({ error: 'Failed to get task' });
  }
});

// POST /api/tasks - Create task
router.post('/', async (req, res) => {
  try {
    const input = createTaskSchema.parse(req.body) as CreateTaskInput;
    const task = await taskService.createTask(input);
    res.status(201).json(task);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }
    console.error('Error creating task:', error);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// PATCH /api/tasks/:id - Update task
router.patch('/:id', async (req, res) => {
  try {
    const input = updateTaskSchema.parse(req.body) as UpdateTaskInput;
    const task = await taskService.updateTask(req.params.id, input);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json(task);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }
    console.error('Error updating task:', error);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// DELETE /api/tasks/:id - Delete task (move to archive)
router.delete('/:id', async (req, res) => {
  try {
    const success = await taskService.deleteTask(req.params.id);
    if (!success) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

// POST /api/tasks/:id/archive - Archive task
router.post('/:id/archive', async (req, res) => {
  try {
    const success = await taskService.archiveTask(req.params.id);
    if (!success) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json({ archived: true });
  } catch (error) {
    console.error('Error archiving task:', error);
    res.status(500).json({ error: 'Failed to archive task' });
  }
});

// === Worktree Routes ===

// POST /api/tasks/:id/worktree - Create worktree
router.post('/:id/worktree', async (req, res) => {
  try {
    const worktree = await worktreeService.createWorktree(req.params.id);
    res.status(201).json(worktree);
  } catch (error: any) {
    console.error('Error creating worktree:', error);
    res.status(400).json({ error: error.message || 'Failed to create worktree' });
  }
});

// GET /api/tasks/:id/worktree - Get worktree status
router.get('/:id/worktree', async (req, res) => {
  try {
    const status = await worktreeService.getWorktreeStatus(req.params.id);
    res.json(status);
  } catch (error: any) {
    console.error('Error getting worktree status:', error);
    res.status(400).json({ error: error.message || 'Failed to get worktree status' });
  }
});

// DELETE /api/tasks/:id/worktree - Delete worktree
router.delete('/:id/worktree', async (req, res) => {
  try {
    const force = req.query.force === 'true';
    await worktreeService.deleteWorktree(req.params.id, force);
    res.status(204).send();
  } catch (error: any) {
    console.error('Error deleting worktree:', error);
    res.status(400).json({ error: error.message || 'Failed to delete worktree' });
  }
});

// POST /api/tasks/:id/worktree/rebase - Rebase worktree
router.post('/:id/worktree/rebase', async (req, res) => {
  try {
    const status = await worktreeService.rebaseWorktree(req.params.id);
    res.json(status);
  } catch (error: any) {
    console.error('Error rebasing worktree:', error);
    res.status(400).json({ error: error.message || 'Failed to rebase worktree' });
  }
});

// POST /api/tasks/:id/worktree/merge - Merge worktree to base branch
router.post('/:id/worktree/merge', async (req, res) => {
  try {
    await worktreeService.mergeWorktree(req.params.id);
    res.json({ merged: true });
  } catch (error: any) {
    console.error('Error merging worktree:', error);
    res.status(400).json({ error: error.message || 'Failed to merge worktree' });
  }
});

// GET /api/tasks/:id/worktree/open - Get VS Code open command
router.get('/:id/worktree/open', async (req, res) => {
  try {
    const command = await worktreeService.openInVSCode(req.params.id);
    res.json({ command });
  } catch (error: any) {
    console.error('Error getting open command:', error);
    res.status(400).json({ error: error.message || 'Failed to get open command' });
  }
});

export { router as taskRoutes };
