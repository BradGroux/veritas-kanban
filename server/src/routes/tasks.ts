import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { TaskService } from '../services/task-service.js';
import { WorktreeService } from '../services/worktree-service.js';
import { activityService } from '../services/activity-service.js';
import { getBlockingService } from '../services/blocking-service.js';
import type { CreateTaskInput, UpdateTaskInput, Task, TaskSummary } from '@veritas-kanban/shared';
import { broadcastTaskChange } from '../services/broadcast-service.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { NotFoundError, ValidationError } from '../middleware/error-handler.js';
import { setLastModified } from '../middleware/cache-control.js';
import { sanitizeTaskFields } from '../utils/sanitize.js';

const router: RouterType = Router();
const taskService = new TaskService();
const worktreeService = new WorktreeService();
const blockingService = getBlockingService();

// Validation schemas
const createTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional().default(''),
  type: z.string().optional().default('code'),
  priority: z.enum(['low', 'medium', 'high']).optional().default('medium'),
  project: z.string().optional(),
  sprint: z.string().optional(),
});

const gitSchema = z
  .object({
    repo: z.string().optional(),
    branch: z.string().optional(),
    baseBranch: z.string().optional(),
    worktreePath: z.string().optional(),
  })
  .optional();

const attemptSchema = z
  .object({
    id: z.string(),
    agent: z.enum(['claude-code', 'amp', 'copilot', 'gemini', 'veritas']),
    status: z.enum(['pending', 'running', 'complete', 'failed']),
    started: z.string().optional(),
    ended: z.string().optional(),
  })
  .optional();

const automationSchema = z
  .object({
    sessionKey: z.string().optional(),
    spawnedAt: z.string().optional(),
    completedAt: z.string().optional(),
    result: z.string().optional(),
  })
  .optional();

const blockedReasonSchema = z
  .object({
    category: z.enum(['waiting-on-feedback', 'technical-snag', 'prerequisite', 'other']),
    note: z.string().optional(),
  })
  .optional()
  .nullable();

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

// === Core CRUD Routes ===

// GET /api/tasks - List tasks with optional pagination, filtering, and field selection
//
// Query parameters:
//   Pagination:
//     page   - Page number (1-indexed, default: 1). When omitted AND limit is omitted,
//              returns all tasks (backward-compatible).
//     limit  - Items per page (default: 50, max: 200)
//
//   Filtering:
//     status   - Filter by status (comma-separated: "todo,in-progress")
//     priority - Filter by priority (comma-separated: "high,medium")
//     type     - Filter by type (comma-separated)
//     project  - Filter by project name (exact match)
//
//   Field selection (mutually exclusive — fields takes precedence):
//     view   - "summary" returns TaskSummary (lightweight board view)
//     fields - Comma-separated field names to include (always includes "id")
//
router.get(
  '/',
  asyncHandler(async (req, res) => {
    let tasks = await taskService.listTasks();

    // --- Filtering ---
    const statusFilter = req.query.status as string | undefined;
    const priorityFilter = req.query.priority as string | undefined;
    const typeFilter = req.query.type as string | undefined;
    const projectFilter = req.query.project as string | undefined;

    if (statusFilter) {
      const statuses = statusFilter.split(',').map((s) => s.trim());
      tasks = tasks.filter((t) => statuses.includes(t.status));
    }
    if (priorityFilter) {
      const priorities = priorityFilter.split(',').map((s) => s.trim());
      tasks = tasks.filter((t) => priorities.includes(t.priority));
    }
    if (typeFilter) {
      const types = typeFilter.split(',').map((s) => s.trim());
      tasks = tasks.filter((t) => types.includes(t.type));
    }
    if (projectFilter) {
      tasks = tasks.filter((t) => t.project === projectFilter);
    }

    const total = tasks.length;

    // --- Last-Modified (computed before slicing) ---
    if (tasks.length > 0) {
      const newest = tasks.reduce((a, b) =>
        new Date(a.updated || a.created) > new Date(b.updated || b.created) ? a : b
      );
      setLastModified(res, newest.updated || newest.created);
    }

    // --- Pagination ---
    // Only paginate when the caller explicitly requests it (page or limit present).
    // This preserves backward compatibility for existing clients that expect a flat array.
    const pageParam = req.query.page as string | undefined;
    const limitParam = req.query.limit as string | undefined;
    const paginate = pageParam !== undefined || limitParam !== undefined;

    let page = 1;
    let limit = 50;

    if (paginate) {
      page = Math.max(1, parseInt(pageParam || '1', 10) || 1);
      limit = Math.min(200, Math.max(1, parseInt(limitParam || '50', 10) || 50));
      const start = (page - 1) * limit;
      tasks = tasks.slice(start, start + limit);
    }

    // --- Field selection / summary view ---
    const viewParam = req.query.view as string | undefined;
    const fieldsParam = req.query.fields as string | undefined;

    let result: unknown[];

    if (fieldsParam) {
      // Explicit field selection — always include "id"
      const requestedFields = new Set(fieldsParam.split(',').map((f) => f.trim()));
      requestedFields.add('id');

      result = tasks.map((task) => {
        const picked: Record<string, unknown> = {};
        for (const field of requestedFields) {
          if (field in task) {
            picked[field] = (task as unknown as Record<string, unknown>)[field];
          }
        }
        return picked;
      });
    } else if (viewParam === 'summary') {
      // Summary mode: lightweight board-view payload
      result = tasks.map(
        (task): TaskSummary => ({
          id: task.id,
          title: task.title,
          status: task.status,
          priority: task.priority,
          type: task.type,
          project: task.project,
          sprint: task.sprint,
          created: task.created,
          updated: task.updated,
          subtasks: task.subtasks,
          blockedBy: task.blockedBy,
          blockedReason: task.blockedReason,
          position: task.position,
          attachmentCount: task.attachments?.length ?? 0,
          timeTracking: task.timeTracking
            ? {
                totalSeconds: task.timeTracking.totalSeconds,
                isRunning: task.timeTracking.isRunning,
              }
            : undefined,
          attempt: task.attempt,
        })
      );
    } else {
      // Full response — strip empty arrays to reduce payload
      result = tasks.map((task) => {
        const out: Record<string, unknown> = { ...task };
        // Remove empty reviewComments
        if (Array.isArray(out.reviewComments) && (out.reviewComments as unknown[]).length === 0) {
          delete out.reviewComments;
        }
        return out;
      });
    }

    // --- Response ---
    if (paginate) {
      const totalPages = Math.ceil(total / limit);

      // RFC 5988 Link headers for pagination
      const links: string[] = [];
      const baseUrl = `${req.protocol}://${req.get('host')}${req.baseUrl}${req.path}`;
      const buildLink = (p: number, rel: string) => {
        const url = new URL(baseUrl);
        // Preserve existing query params
        for (const [k, v] of Object.entries(req.query)) {
          if (k !== 'page') url.searchParams.set(k, String(v));
        }
        url.searchParams.set('page', String(p));
        links.push(`<${url.toString()}>; rel="${rel}"`);
      };

      if (page > 1) buildLink(1, 'first');
      if (page > 1) buildLink(page - 1, 'prev');
      if (page < totalPages) buildLink(page + 1, 'next');
      if (totalPages > 0) buildLink(totalPages, 'last');

      if (links.length > 0) {
        res.set('Link', links.join(', '));
      }

      res.json({
        data: result,
        pagination: { page, limit, total, totalPages },
      });
    } else {
      // Backward-compatible flat array response
      res.json(result);
    }
  })
);

// POST /api/tasks/reorder - Reorder tasks within a column
router.post(
  '/reorder',
  asyncHandler(async (req, res) => {
    const { orderedIds } = req.body as { orderedIds: string[] };
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      throw new ValidationError('orderedIds must be a non-empty array of task IDs');
    }
    const updated = await taskService.reorderTasks(orderedIds);
    broadcastTaskChange('reordered');
    res.json({ updated: updated.length });
  })
);

// GET /api/tasks/:id - Get single task
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const task = await taskService.getTask(req.params.id as string);
    if (!task) {
      throw new NotFoundError('Task not found');
    }
    setLastModified(res, task.updated || task.created);
    res.json(task);
  })
);

// GET /api/tasks/:id/blocking-status - Get task blocking status
router.get(
  '/:id/blocking-status',
  asyncHandler(async (req, res) => {
    const task = await taskService.getTask(req.params.id as string);
    if (!task) {
      throw new NotFoundError('Task not found');
    }

    const allTasks = await taskService.listTasks();
    const blockingStatus = blockingService.getBlockingStatus(task, allTasks);

    res.json(blockingStatus);
  })
);

// POST /api/tasks - Create task
router.post(
  '/',
  asyncHandler(async (req, res) => {
    try {
      var input = createTaskSchema.parse(req.body) as CreateTaskInput;
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.errors);
      }
      throw error;
    }
    // Sanitize user-provided text fields to prevent stored XSS
    sanitizeTaskFields(input);
    const task = await taskService.createTask(input);
    broadcastTaskChange('created', task.id);

    // Log activity
    await activityService.logActivity('task_created', task.id, task.title, {
      type: task.type,
      priority: task.priority,
      project: task.project,
    });

    res.status(201).json(task);
  })
);

// PATCH /api/tasks/:id - Update task
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    let input: UpdateTaskInput;
    try {
      input = updateTaskSchema.parse(req.body) as UpdateTaskInput;
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.errors);
      }
      throw error;
    }
    // Sanitize user-provided text fields to prevent stored XSS
    sanitizeTaskFields(input);

    const oldTask = await taskService.getTask(req.params.id as string);
    if (!oldTask) {
      throw new NotFoundError('Task not found');
    }

    // Check if trying to move blocked task to in-progress
    if (input.status === 'in-progress' && oldTask.status === 'todo' && oldTask.blockedBy?.length) {
      const allTasks = await taskService.listTasks();
      const { allowed, blockers } = blockingService.canMoveToInProgress(oldTask, allTasks);

      if (!allowed) {
        throw new ValidationError('Task is blocked', { blockedBy: blockers });
      }
    }

    // Auto-clear blockedReason when task moves out of blocked status
    if (input.status && input.status !== 'blocked' && oldTask.status === 'blocked') {
      input.blockedReason = null;
    }

    const task = await taskService.updateTask(req.params.id as string, input);
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
  })
);

// DELETE /api/tasks/:id - Delete task (move to archive)
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const task = await taskService.getTask(req.params.id as string);
    const success = await taskService.deleteTask(req.params.id as string);
    if (!success) {
      throw new NotFoundError('Task not found');
    }
    broadcastTaskChange('deleted', req.params.id as string);

    // Log activity
    if (task) {
      await activityService.logActivity('task_deleted', task.id, task.title);
    }

    res.status(204).send();
  })
);

// === Worktree Routes ===

// POST /api/tasks/:id/worktree - Create worktree
router.post(
  '/:id/worktree',
  asyncHandler(async (req, res) => {
    const worktree = await worktreeService.createWorktree(req.params.id as string);
    res.status(201).json(worktree);
  })
);

// GET /api/tasks/:id/worktree - Get worktree status
router.get(
  '/:id/worktree',
  asyncHandler(async (req, res) => {
    const status = await worktreeService.getWorktreeStatus(req.params.id as string);
    res.json(status);
  })
);

// DELETE /api/tasks/:id/worktree - Delete worktree
router.delete(
  '/:id/worktree',
  asyncHandler(async (req, res) => {
    const force = req.query.force === 'true';
    await worktreeService.deleteWorktree(req.params.id as string, force);
    res.status(204).send();
  })
);

// POST /api/tasks/:id/worktree/rebase - Rebase worktree
router.post(
  '/:id/worktree/rebase',
  asyncHandler(async (req, res) => {
    const status = await worktreeService.rebaseWorktree(req.params.id as string);
    res.json(status);
  })
);

// POST /api/tasks/:id/worktree/merge - Merge worktree to base branch
router.post(
  '/:id/worktree/merge',
  asyncHandler(async (req, res) => {
    await worktreeService.mergeWorktree(req.params.id as string);
    res.json({ merged: true });
  })
);

// GET /api/tasks/:id/worktree/open - Get VS Code open command
router.get(
  '/:id/worktree/open',
  asyncHandler(async (req, res) => {
    const command = await worktreeService.openInVSCode(req.params.id as string);
    res.json({ command });
  })
);

// === Template Application Route ===

// POST /api/tasks/:id/apply-template - Apply template to existing task
router.post(
  '/:id/apply-template',
  asyncHandler(async (req, res) => {
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
  })
);

// === Attachment Context Route ===

// GET /api/tasks/:id/context - Get full task context for agent consumption
router.get(
  '/:id/context',
  asyncHandler(async (req, res) => {
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
  })
);

export { router as taskRoutes };
