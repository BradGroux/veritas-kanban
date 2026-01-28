import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { TaskService } from '../services/task-service.js';
import { WorktreeService } from '../services/worktree-service.js';
import { activityService } from '../services/activity-service.js';
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
  agent: z.enum(['claude-code', 'amp', 'copilot', 'gemini', 'veritas']),
  status: z.enum(['pending', 'running', 'complete', 'failed']),
  started: z.string().optional(),
  ended: z.string().optional(),
}).optional();

const automationSchema = z.object({
  sessionKey: z.string().optional(),
  spawnedAt: z.string().optional(),
  completedAt: z.string().optional(),
  result: z.string().optional(),
}).optional();

const reviewCommentSchema = z.object({
  id: z.string(),
  file: z.string(),
  line: z.number(),
  content: z.string(),
  created: z.string(),
});

const reviewStateSchema = z.object({
  decision: z.enum(['approved', 'changes-requested', 'rejected']).optional(),
  decidedAt: z.string().optional(),
  summary: z.string().optional(),
});

const subtaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  completed: z.boolean(),
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
  review: reviewStateSchema.optional(),
  subtasks: z.array(subtaskSchema).optional(),
  autoCompleteOnSubtasks: z.boolean().optional(),
  blockedBy: z.array(z.string()).optional(),
  automation: automationSchema,
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

// GET /api/tasks/archived - List archived tasks
router.get('/archived', async (_req, res) => {
  try {
    const tasks = await taskService.listArchivedTasks();
    res.json(tasks);
  } catch (error) {
    console.error('Error listing archived tasks:', error);
    res.status(500).json({ error: 'Failed to list archived tasks' });
  }
});

// GET /api/tasks/archive/suggestions - Get projects ready to archive
router.get('/archive/suggestions', async (_req, res) => {
  try {
    const suggestions = await taskService.getArchiveSuggestions();
    res.json(suggestions);
  } catch (error) {
    console.error('Error getting archive suggestions:', error);
    res.status(500).json({ error: 'Failed to get archive suggestions' });
  }
});

// POST /api/tasks/archive/project/:project - Archive all tasks in a project
router.post('/archive/project/:project', async (req, res) => {
  try {
    const result = await taskService.archiveProject(req.params.project);
    
    // Log activity
    await activityService.logActivity('project_archived', req.params.project, req.params.project, {
      taskCount: result.archived,
    });
    
    res.json(result);
  } catch (error: any) {
    console.error('Error archiving project:', error);
    res.status(400).json({ error: error.message || 'Failed to archive project' });
  }
});

// GET /api/tasks/time/summary - Get time summary by project (must be before /:id)
router.get('/time/summary', async (_req, res) => {
  try {
    const summary = await taskService.getTimeSummary();
    res.json(summary);
  } catch (error) {
    console.error('Error getting time summary:', error);
    res.status(500).json({ error: 'Failed to get time summary' });
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

// GET /api/tasks/:id/blocking-status - Get task blocking status
router.get('/:id/blocking-status', async (req, res) => {
  try {
    const task = await taskService.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    if (!task.blockedBy?.length) {
      return res.json({ isBlocked: false, blockers: [] });
    }

    const allTasks = await taskService.listTasks();
    const blockingTasks = allTasks.filter(t => task.blockedBy?.includes(t.id));
    const incompleteBlockers = blockingTasks.filter(t => t.status !== 'done');
    
    res.json({
      isBlocked: incompleteBlockers.length > 0,
      blockers: incompleteBlockers.map(t => ({ id: t.id, title: t.title, status: t.status })),
      completedBlockers: blockingTasks.filter(t => t.status === 'done').map(t => ({ id: t.id, title: t.title })),
    });
  } catch (error) {
    console.error('Error getting blocking status:', error);
    res.status(500).json({ error: 'Failed to get blocking status' });
  }
});

// POST /api/tasks - Create task
router.post('/', async (req, res) => {
  try {
    const input = createTaskSchema.parse(req.body) as CreateTaskInput;
    const task = await taskService.createTask(input);
    
    // Log activity
    await activityService.logActivity('task_created', task.id, task.title, {
      type: task.type,
      priority: task.priority,
      project: task.project,
    });
    
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
    const oldTask = await taskService.getTask(req.params.id);
    if (!oldTask) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Check if trying to move blocked task to in-progress
    if (input.status === 'in-progress' && oldTask.status === 'todo' && oldTask.blockedBy?.length) {
      const allTasks = await taskService.listTasks();
      const blockingTasks = allTasks.filter(t => oldTask.blockedBy?.includes(t.id));
      const incompleteBlockers = blockingTasks.filter(t => t.status !== 'done');
      
      if (incompleteBlockers.length > 0) {
        return res.status(400).json({ 
          error: 'Task is blocked',
          blockedBy: incompleteBlockers.map(t => ({ id: t.id, title: t.title })),
        });
      }
    }

    const task = await taskService.updateTask(req.params.id, input);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    // Log activity for status changes
    if (input.status && oldTask.status !== input.status) {
      await activityService.logActivity('status_changed', task.id, task.title, {
        from: oldTask.status,
        status: input.status,
      });
    } else {
      await activityService.logActivity('task_updated', task.id, task.title);
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
    const task = await taskService.getTask(req.params.id);
    const success = await taskService.deleteTask(req.params.id);
    if (!success) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    // Log activity
    if (task) {
      await activityService.logActivity('task_deleted', task.id, task.title);
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
    const task = await taskService.getTask(req.params.id);
    const success = await taskService.archiveTask(req.params.id);
    if (!success) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    // Log activity
    if (task) {
      await activityService.logActivity('task_archived', task.id, task.title);
    }
    
    res.json({ archived: true });
  } catch (error) {
    console.error('Error archiving task:', error);
    res.status(500).json({ error: 'Failed to archive task' });
  }
});

// POST /api/tasks/bulk-archive - Archive multiple tasks by project
router.post('/bulk-archive', async (req, res) => {
  try {
    const { project } = req.body as { project: string };
    if (!project) {
      return res.status(400).json({ error: 'Project is required' });
    }

    const tasks = await taskService.listTasks();
    const projectTasks = tasks.filter(t => t.project === project && t.status === 'done');
    
    if (projectTasks.length === 0) {
      return res.status(400).json({ error: 'No completed tasks found for this project' });
    }

    const archived: string[] = [];
    for (const task of projectTasks) {
      const success = await taskService.archiveTask(task.id);
      if (success) {
        archived.push(task.id);
        await activityService.logActivity('task_archived', task.id, task.title);
      }
    }

    res.json({ archived, count: archived.length });
  } catch (error) {
    console.error('Error bulk archiving tasks:', error);
    res.status(500).json({ error: 'Failed to archive tasks' });
  }
});

// POST /api/tasks/:id/restore - Restore task from archive
router.post('/:id/restore', async (req, res) => {
  try {
    const task = await taskService.restoreTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Archived task not found' });
    }
    
    // Log activity
    await activityService.logActivity('status_changed', task.id, task.title, {
      from: 'archived',
      status: 'done',
    });
    
    res.json(task);
  } catch (error) {
    console.error('Error restoring task:', error);
    res.status(500).json({ error: 'Failed to restore task' });
  }
});

// === Subtask Routes ===

const addSubtaskSchema = z.object({
  title: z.string().min(1).max(200),
});

const updateSubtaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  completed: z.boolean().optional(),
});

// POST /api/tasks/:id/subtasks - Add subtask
router.post('/:id/subtasks', async (req, res) => {
  try {
    const { title } = addSubtaskSchema.parse(req.body);
    const task = await taskService.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const subtask = {
      id: `subtask_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title,
      completed: false,
      created: new Date().toISOString(),
    };

    const subtasks = [...(task.subtasks || []), subtask];
    const updatedTask = await taskService.updateTask(req.params.id, { subtasks });
    
    res.status(201).json(updatedTask);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }
    console.error('Error adding subtask:', error);
    res.status(500).json({ error: 'Failed to add subtask' });
  }
});

// PATCH /api/tasks/:id/subtasks/:subtaskId - Update subtask
router.patch('/:id/subtasks/:subtaskId', async (req, res) => {
  try {
    const updates = updateSubtaskSchema.parse(req.body);
    const task = await taskService.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const subtasks = task.subtasks || [];
    const subtaskIndex = subtasks.findIndex(s => s.id === req.params.subtaskId);
    if (subtaskIndex === -1) {
      return res.status(404).json({ error: 'Subtask not found' });
    }

    subtasks[subtaskIndex] = { ...subtasks[subtaskIndex], ...updates };

    // Check if we should auto-complete the parent task
    let taskUpdates: any = { subtasks };
    if (task.autoCompleteOnSubtasks && subtasks.every(s => s.completed)) {
      taskUpdates.status = 'done';
    }

    const updatedTask = await taskService.updateTask(req.params.id, taskUpdates);
    
    res.json(updatedTask);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }
    console.error('Error updating subtask:', error);
    res.status(500).json({ error: 'Failed to update subtask' });
  }
});

// DELETE /api/tasks/:id/subtasks/:subtaskId - Delete subtask
router.delete('/:id/subtasks/:subtaskId', async (req, res) => {
  try {
    const task = await taskService.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const subtasks = (task.subtasks || []).filter(s => s.id !== req.params.subtaskId);
    const updatedTask = await taskService.updateTask(req.params.id, { subtasks });
    
    res.json(updatedTask);
  } catch (error) {
    console.error('Error deleting subtask:', error);
    res.status(500).json({ error: 'Failed to delete subtask' });
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

// === Template Application Routes ===

// POST /api/tasks/:id/apply-template - Apply template to existing task
router.post('/:id/apply-template', async (req, res) => {
  try {
    const { templateId, templateName, fieldsChanged } = req.body;
    
    if (!templateId) {
      return res.status(400).json({ error: 'Template ID is required' });
    }

    const task = await taskService.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Log activity for template application
    await activityService.logActivity('template_applied', task.id, task.title, {
      templateId,
      templateName: templateName || 'Unknown',
      fieldsChanged: fieldsChanged || [],
    });

    res.json({ success: true });
  } catch (error: any) {
    console.error('Error logging template application:', error);
    res.status(500).json({ error: error.message || 'Failed to log template application' });
  }
});

// === Time Tracking Routes ===

// POST /api/tasks/:id/time/start - Start timer for a task
router.post('/:id/time/start', async (req, res) => {
  try {
    const task = await taskService.startTimer(req.params.id);
    res.json(task);
  } catch (error: any) {
    console.error('Error starting timer:', error);
    res.status(400).json({ error: error.message || 'Failed to start timer' });
  }
});

// POST /api/tasks/:id/time/stop - Stop timer for a task
router.post('/:id/time/stop', async (req, res) => {
  try {
    const task = await taskService.stopTimer(req.params.id);
    res.json(task);
  } catch (error: any) {
    console.error('Error stopping timer:', error);
    res.status(400).json({ error: error.message || 'Failed to stop timer' });
  }
});

// POST /api/tasks/:id/time/entry - Add manual time entry
router.post('/:id/time/entry', async (req, res) => {
  try {
    const { duration, description } = req.body;
    if (typeof duration !== 'number' || duration <= 0) {
      return res.status(400).json({ error: 'Duration must be a positive number (in seconds)' });
    }
    const task = await taskService.addTimeEntry(req.params.id, duration, description);
    res.json(task);
  } catch (error: any) {
    console.error('Error adding time entry:', error);
    res.status(400).json({ error: error.message || 'Failed to add time entry' });
  }
});

// DELETE /api/tasks/:id/time/entry/:entryId - Delete a time entry
router.delete('/:id/time/entry/:entryId', async (req, res) => {
  try {
    const task = await taskService.deleteTimeEntry(req.params.id, req.params.entryId);
    res.json(task);
  } catch (error: any) {
    console.error('Error deleting time entry:', error);
    res.status(400).json({ error: error.message || 'Failed to delete time entry' });
  }
});

export { router as taskRoutes };
