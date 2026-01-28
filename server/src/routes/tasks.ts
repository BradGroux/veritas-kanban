import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { TaskService } from '../services/task-service.js';
import { WorktreeService } from '../services/worktree-service.js';
import { activityService } from '../services/activity-service.js';
import type { CreateTaskInput, UpdateTaskInput } from '@veritas-kanban/shared';
import { broadcastTaskChange } from '../services/broadcast-service.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { NotFoundError, ValidationError } from '../middleware/error-handler.js';

const router: RouterType = Router();
const taskService = new TaskService();
const worktreeService = new WorktreeService();

// Validation schemas
const createTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional().default(''),
  type: z.string().optional().default('code'),
  priority: z.enum(['low', 'medium', 'high']).optional().default('medium'),
  project: z.string().optional(),
  sprint: z.string().optional(),
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

const blockedReasonSchema = z.object({
  category: z.enum(['waiting-on-feedback', 'technical-snag', 'prerequisite', 'other']),
  note: z.string().optional(),
}).optional().nullable();

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
  type: z.string().optional(),
  status: z.enum(['todo', 'in-progress', 'blocked', 'done']).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  project: z.string().optional(),
  sprint: z.string().optional(),
  git: gitSchema,
  attempt: attemptSchema,
  reviewComments: z.array(reviewCommentSchema).optional(),
  review: reviewStateSchema.optional(),
  subtasks: z.array(subtaskSchema).optional(),
  autoCompleteOnSubtasks: z.boolean().optional(),
  blockedBy: z.array(z.string()).optional(),
  blockedReason: blockedReasonSchema,
  automation: automationSchema,
  position: z.number().optional(),
});

// GET /api/tasks - List all tasks
router.get('/', asyncHandler(async (_req, res) => {
  const tasks = await taskService.listTasks();
  res.json(tasks);
}));

// GET /api/tasks/archived - List archived tasks
router.get('/archived', asyncHandler(async (_req, res) => {
  const tasks = await taskService.listArchivedTasks();
  res.json(tasks);
}));

// GET /api/tasks/archive/suggestions - Get sprints ready to archive
router.get('/archive/suggestions', asyncHandler(async (_req, res) => {
  const suggestions = await taskService.getArchiveSuggestions();
  res.json(suggestions);
}));

// POST /api/tasks/archive/sprint/:sprint - Archive all tasks in a sprint
router.post('/archive/sprint/:sprint', asyncHandler(async (req, res) => {
  const result = await taskService.archiveSprint(req.params.sprint as string);
  
  // Log activity
  await activityService.logActivity('sprint_archived', (req.params.sprint as string), (req.params.sprint as string), {
    taskCount: result.archived,
  });
  
  res.json(result);
}));

// POST /api/tasks/reorder - Reorder tasks within a column
router.post('/reorder', asyncHandler(async (req, res) => {
  const { orderedIds } = req.body as { orderedIds: string[] };
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    throw new ValidationError('orderedIds must be a non-empty array of task IDs');
  }
  const updated = await taskService.reorderTasks(orderedIds);
  broadcastTaskChange('reordered');
  res.json({ updated: updated.length });
}));

// GET /api/tasks/time/summary - Get time summary by project (must be before /:id)
router.get('/time/summary', asyncHandler(async (_req, res) => {
  const summary = await taskService.getTimeSummary();
  res.json(summary);
}));

// GET /api/tasks/:id - Get single task
router.get('/:id', asyncHandler(async (req, res) => {
  const task = await taskService.getTask(req.params.id as string);
  if (!task) {
    throw new NotFoundError('Task not found');
  }
  res.json(task);
}));

// GET /api/tasks/:id/blocking-status - Get task blocking status
router.get('/:id/blocking-status', asyncHandler(async (req, res) => {
  const task = await taskService.getTask(req.params.id as string);
  if (!task) {
    throw new NotFoundError('Task not found');
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
}));

// POST /api/tasks - Create task
router.post('/', asyncHandler(async (req, res) => {
  try {
    var input = createTaskSchema.parse(req.body) as CreateTaskInput;
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ValidationError('Validation failed', error.errors);
    }
    throw error;
  }
  const task = await taskService.createTask(input);
  broadcastTaskChange('created', task.id);
  
  // Log activity
  await activityService.logActivity('task_created', task.id, task.title, {
    type: task.type,
    priority: task.priority,
    project: task.project,
  });
  
  res.status(201).json(task);
}));

// PATCH /api/tasks/:id - Update task
router.patch('/:id', asyncHandler(async (req, res) => {
  let input: UpdateTaskInput;
  try {
    input = updateTaskSchema.parse(req.body) as UpdateTaskInput;
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ValidationError('Validation failed', error.errors);
    }
    throw error;
  }
  
  const oldTask = await taskService.getTask(req.params.id as string);
  if (!oldTask) {
    throw new NotFoundError('Task not found');
  }

  // Check if trying to move blocked task to in-progress
  if (input.status === 'in-progress' && oldTask.status === 'todo' && oldTask.blockedBy?.length) {
    const allTasks = await taskService.listTasks();
    const blockingTasks = allTasks.filter(t => oldTask.blockedBy?.includes(t.id));
    const incompleteBlockers = blockingTasks.filter(t => t.status !== 'done');
    
    if (incompleteBlockers.length > 0) {
      throw new ValidationError('Task is blocked', {
        blockedBy: incompleteBlockers.map(t => ({ id: t.id, title: t.title })),
      });
    }
  }

  // Auto-clear blockedReason when task moves out of blocked status
  if (input.status && input.status !== 'blocked' && oldTask.status === 'blocked') {
    input.blockedReason = null;
  }

  const task = await taskService.updateTask((req.params.id as string), input);
  if (!task) {
    throw new NotFoundError('Task not found');
  }
  broadcastTaskChange('updated', task.id);
  
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
}));

// DELETE /api/tasks/:id - Delete task (move to archive)
router.delete('/:id', asyncHandler(async (req, res) => {
  const task = await taskService.getTask(req.params.id as string);
  const success = await taskService.deleteTask(req.params.id as string);
  if (!success) {
    throw new NotFoundError('Task not found');
  }
  broadcastTaskChange('deleted', (req.params.id as string));
  
  // Log activity
  if (task) {
    await activityService.logActivity('task_deleted', task.id, task.title);
  }
  
  res.status(204).send();
}));

// POST /api/tasks/:id/archive - Archive task
router.post('/:id/archive', asyncHandler(async (req, res) => {
  const task = await taskService.getTask(req.params.id as string);
  const success = await taskService.archiveTask(req.params.id as string);
  if (!success) {
    throw new NotFoundError('Task not found');
  }
  broadcastTaskChange('archived', (req.params.id as string));
  
  // Log activity
  if (task) {
    await activityService.logActivity('task_archived', task.id, task.title);
  }
  
  res.json({ archived: true });
}));

// POST /api/tasks/bulk-archive - Archive multiple tasks by sprint
router.post('/bulk-archive', asyncHandler(async (req, res) => {
  const { sprint } = req.body as { sprint: string };
  if (!sprint) {
    throw new ValidationError('Sprint is required');
  }

  const tasks = await taskService.listTasks();
  const sprintTasks = tasks.filter(t => t.sprint === sprint && t.status === 'done');
  
  if (sprintTasks.length === 0) {
    throw new ValidationError('No completed tasks found for this sprint');
  }

  const archived: string[] = [];
  for (const task of sprintTasks) {
    const success = await taskService.archiveTask(task.id);
    if (success) {
      archived.push(task.id);
      await activityService.logActivity('task_archived', task.id, task.title);
    }
  }

  res.json({ archived, count: archived.length });
}));

// POST /api/tasks/:id/restore - Restore task from archive
router.post('/:id/restore', asyncHandler(async (req, res) => {
  const task = await taskService.restoreTask(req.params.id as string);
  if (!task) {
    throw new NotFoundError('Archived task not found');
  }
  broadcastTaskChange('restored', task.id);
  
  // Log activity
  await activityService.logActivity('status_changed', task.id, task.title, {
    from: 'archived',
    status: 'done',
  });
  
  res.json(task);
}));

// === Subtask Routes ===

const addSubtaskSchema = z.object({
  title: z.string().min(1).max(200),
});

const updateSubtaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  completed: z.boolean().optional(),
});

const addCommentSchema = z.object({
  author: z.string().min(1).max(100),
  text: z.string().min(1).max(2000),
});

// POST /api/tasks/:id/subtasks - Add subtask
router.post('/:id/subtasks', asyncHandler(async (req, res) => {
  let title: string;
  try {
    ({ title } = addSubtaskSchema.parse(req.body));
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

  const subtask = {
    id: `subtask_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title,
    completed: false,
    created: new Date().toISOString(),
  };

  const subtasks = [...(task.subtasks || []), subtask];
  const updatedTask = await taskService.updateTask((req.params.id as string), { subtasks });
  
  res.status(201).json(updatedTask);
}));

// PATCH /api/tasks/:id/subtasks/:subtaskId - Update subtask
router.patch('/:id/subtasks/:subtaskId', asyncHandler(async (req, res) => {
  let updates;
  try {
    updates = updateSubtaskSchema.parse(req.body);
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

  const subtasks = task.subtasks || [];
  const subtaskIndex = subtasks.findIndex(s => s.id === (req.params.subtaskId as string));
  if (subtaskIndex === -1) {
    throw new NotFoundError('Subtask not found');
  }

  subtasks[subtaskIndex] = { ...subtasks[subtaskIndex], ...updates };

  // Check if we should auto-complete the parent task
  let taskUpdates: any = { subtasks };
  if (task.autoCompleteOnSubtasks && subtasks.every(s => s.completed)) {
    taskUpdates.status = 'done';
  }

  const updatedTask = await taskService.updateTask((req.params.id as string), taskUpdates);
  
  res.json(updatedTask);
}));

// DELETE /api/tasks/:id/subtasks/:subtaskId - Delete subtask
router.delete('/:id/subtasks/:subtaskId', asyncHandler(async (req, res) => {
  const task = await taskService.getTask(req.params.id as string);
  if (!task) {
    throw new NotFoundError('Task not found');
  }

  const subtasks = (task.subtasks || []).filter(s => s.id !== (req.params.subtaskId as string));
  const updatedTask = await taskService.updateTask((req.params.id as string), { subtasks });
  
  res.json(updatedTask);
}));

// === Comment Routes ===

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
  const updatedTask = await taskService.updateTask((req.params.id as string), { comments });
  
  // Log activity
  await activityService.logActivity('comment_added', task.id, task.title, {
    author,
    preview: text.slice(0, 50) + (text.length > 50 ? '...' : ''),
  });
  
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
  const commentIndex = comments.findIndex(c => c.id === (req.params.commentId as string));
  if (commentIndex === -1) {
    throw new NotFoundError('Comment not found');
  }

  comments[commentIndex] = {
    ...comments[commentIndex],
    text,
    timestamp: comments[commentIndex].timestamp, // preserve original timestamp
  };

  const updatedTask = await taskService.updateTask((req.params.id as string), { comments });
  res.json(updatedTask);
}));

// DELETE /api/tasks/:id/comments/:commentId - Delete comment
router.delete('/:id/comments/:commentId', asyncHandler(async (req, res) => {
  const task = await taskService.getTask(req.params.id as string);
  if (!task) {
    throw new NotFoundError('Task not found');
  }

  const comments = task.comments || [];
  const filtered = comments.filter(c => c.id !== (req.params.commentId as string));
  if (filtered.length === comments.length) {
    throw new NotFoundError('Comment not found');
  }

  const updatedTask = await taskService.updateTask((req.params.id as string), { comments: filtered });

  await activityService.logActivity('comment_deleted', task.id, task.title, {
    commentId: (req.params.commentId as string),
  });

  res.json(updatedTask);
}));

// === Worktree Routes ===

// POST /api/tasks/:id/worktree - Create worktree
router.post('/:id/worktree', asyncHandler(async (req, res) => {
  const worktree = await worktreeService.createWorktree(req.params.id as string);
  res.status(201).json(worktree);
}));

// GET /api/tasks/:id/worktree - Get worktree status
router.get('/:id/worktree', asyncHandler(async (req, res) => {
  const status = await worktreeService.getWorktreeStatus(req.params.id as string);
  res.json(status);
}));

// DELETE /api/tasks/:id/worktree - Delete worktree
router.delete('/:id/worktree', asyncHandler(async (req, res) => {
  const force = req.query.force === 'true';
  await worktreeService.deleteWorktree((req.params.id as string), force);
  res.status(204).send();
}));

// POST /api/tasks/:id/worktree/rebase - Rebase worktree
router.post('/:id/worktree/rebase', asyncHandler(async (req, res) => {
  const status = await worktreeService.rebaseWorktree(req.params.id as string);
  res.json(status);
}));

// POST /api/tasks/:id/worktree/merge - Merge worktree to base branch
router.post('/:id/worktree/merge', asyncHandler(async (req, res) => {
  await worktreeService.mergeWorktree(req.params.id as string);
  res.json({ merged: true });
}));

// GET /api/tasks/:id/worktree/open - Get VS Code open command
router.get('/:id/worktree/open', asyncHandler(async (req, res) => {
  const command = await worktreeService.openInVSCode(req.params.id as string);
  res.json({ command });
}));

// === Template Application Routes ===

// POST /api/tasks/:id/apply-template - Apply template to existing task
router.post('/:id/apply-template', asyncHandler(async (req, res) => {
  const { templateId, templateName, fieldsChanged } = req.body;
  
  if (!templateId) {
    throw new ValidationError('Template ID is required');
  }

  const task = await taskService.getTask(req.params.id as string);
  if (!task) {
    throw new NotFoundError('Task not found');
  }

  // Log activity for template application
  await activityService.logActivity('template_applied', task.id, task.title, {
    templateId,
    templateName: templateName || 'Unknown',
    fieldsChanged: fieldsChanged || [],
  });

  res.json({ success: true });
}));

// === Time Tracking Routes ===

// POST /api/tasks/:id/time/start - Start timer for a task
router.post('/:id/time/start', asyncHandler(async (req, res) => {
  const task = await taskService.startTimer(req.params.id as string);
  res.json(task);
}));

// POST /api/tasks/:id/time/stop - Stop timer for a task
router.post('/:id/time/stop', asyncHandler(async (req, res) => {
  const task = await taskService.stopTimer(req.params.id as string);
  res.json(task);
}));

// POST /api/tasks/:id/time/entry - Add manual time entry
router.post('/:id/time/entry', asyncHandler(async (req, res) => {
  const { duration, description } = req.body;
  if (typeof duration !== 'number' || duration <= 0) {
    throw new ValidationError('Duration must be a positive number (in seconds)');
  }
  const task = await taskService.addTimeEntry((req.params.id as string), duration, description);
  res.json(task);
}));

// DELETE /api/tasks/:id/time/entry/:entryId - Delete a time entry
router.delete('/:id/time/entry/:entryId', asyncHandler(async (req, res) => {
  const task = await taskService.deleteTimeEntry((req.params.id as string), (req.params.entryId as string));
  res.json(task);
}));

// === Attachment Context Route ===

// GET /api/tasks/:id/context - Get full task context for agent consumption
router.get('/:id/context', asyncHandler(async (req, res) => {
  const { getAttachmentService } = await import('../services/attachment-service.js');
  const attachmentService = getAttachmentService();
  
  const task = await taskService.getTask(req.params.id as string);
  if (!task) {
    throw new NotFoundError('Task not found');
  }

  // Collect all extracted text and image paths
  const attachments = task.attachments || [];
  const extractedTexts: { filename: string; text: string }[] = [];
  const imagePaths: string[] = [];

  for (const attachment of attachments) {
    // Get extracted text if available
    const text = await attachmentService.getExtractedText(task.id, attachment.id);
    if (text) {
      extractedTexts.push({
        filename: attachment.originalName,
        text,
      });
    }

    // Collect image paths
    if (attachment.mimeType.startsWith('image/')) {
      const filepath = attachmentService.getAttachmentPath(task.id, attachment.filename);
      imagePaths.push(filepath);
    }
  }

  // Build context object
  const context = {
    taskId: task.id,
    title: task.title,
    description: task.description,
    type: task.type,
    status: task.status,
    priority: task.priority,
    project: task.project,
    sprint: task.sprint,
    attachments: {
      count: attachments.length,
      documents: extractedTexts,
      images: imagePaths,
    },
    created: task.created,
    updated: task.updated,
  };

  res.json(context);
}));

export { router as taskRoutes };
