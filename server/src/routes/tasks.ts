import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { getTaskService } from '../services/task-service.js';
import { WorktreeService } from '../services/worktree-service.js';
import { activityService } from '../services/activity-service.js';
import { getBlockingService } from '../services/blocking-service.js';
import { getGitHubSyncService } from '../services/github-sync-service.js';
import { getDelegationService } from '../services/delegation-service.js';
import { getProgressService } from '../services/progress-service.js';
import type { CreateTaskInput, UpdateTaskInput, Task, TaskSummary } from '@veritas-kanban/shared';
import { broadcastTaskChange } from '../services/broadcast-service.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { NotFoundError, ValidationError } from '../middleware/error-handler.js';
import { sendPaginated } from '../middleware/response-envelope.js';
import { setLastModified } from '../middleware/cache-control.js';
import { sanitizeTaskFields } from '../utils/sanitize.js';
import { auditLog } from '../services/audit-service.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

const router: RouterType = Router();
const taskService = getTaskService();
const worktreeService = new WorktreeService();
const blockingService = getBlockingService();
const delegationService = getDelegationService();
const progressService = getProgressService();

// Validation schemas
const reviewCommentSchema = z.object({
  id: z.string(),
  file: z.string(),
  line: z.number(),
  content: z.string(),
  created: z.string(),
});

export const reviewScoresSchema = z.array(z.number().int().min(0).max(10)).length(4);

const createTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional().default(''),
  type: z.string().optional().default('code'),
  priority: z.enum(['low', 'medium', 'high']).optional().default('medium'),
  project: z.string().optional(),
  sprint: z.string().optional(),
  agent: z.string().max(50).optional(), // "auto" | agent type slug
  reviewScores: reviewScoresSchema.optional(),
  reviewComments: z.array(reviewCommentSchema).optional(),
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

const reorderTasksSchema = z.object({
  orderedIds: z.array(z.string().min(1)).min(1, 'orderedIds must be a non-empty array of task IDs'),
});

const applyTemplateSchema = z.object({
  templateId: z.string().min(1, 'Template ID is required'),
  templateName: z.string().optional(),
  fieldsChanged: z.array(z.string()).optional(),
});

// Task ID format validation (production: task_YYYYMMDD_XXXXXX)
const taskIdSchema = z
  .string()
  .regex(/^task_(\d{8}_[a-zA-Z0-9_-]{1,20}|[a-zA-Z0-9_-]+)$/, 'Invalid task ID format');

const addDependencySchema = z
  .object({
    depends_on: taskIdSchema.optional(),
    blocks: taskIdSchema.optional(),
  })
  .refine((data) => (data.depends_on && !data.blocks) || (!data.depends_on && data.blocks), {
    message: 'Must provide either depends_on or blocks (not both)',
  });

const blockedReasonSchema = z
  .object({
    category: z.enum(['waiting-on-feedback', 'technical-snag', 'prerequisite', 'other']),
    note: z.string().optional(),
  })
  .optional()
  .nullable();

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
  acceptanceCriteria: z.array(z.string()).optional(),
  criteriaChecked: z.array(z.boolean()).optional(),
});

const githubSchema = z
  .object({
    issueNumber: z.number().int().positive(),
    repo: z.string().min(1),
  })
  .optional();

const updateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  type: z.string().optional(),
  status: z.enum(['todo', 'in-progress', 'blocked', 'done']).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  project: z.string().optional(),
  sprint: z.string().optional(),
  agent: z.string().max(50).optional(),
  git: gitSchema,
  github: githubSchema,
  attempt: attemptSchema,
  reviewComments: z.array(reviewCommentSchema).optional(),
  reviewScores: reviewScoresSchema.optional(),
  review: reviewStateSchema.optional(),
  subtasks: z.array(subtaskSchema).optional(),
  autoCompleteOnSubtasks: z.boolean().optional(),
  blockedBy: z.array(z.string()).optional(),
  blockedReason: blockedReasonSchema,
  plan: z.string().optional(),
  automation: automationSchema,
  position: z.number().optional(),
});

// Progress schemas
const appendProgressSchema = z.object({
  section: z.string().min(1),
  content: z.string().min(1),
});

// === Core CRUD Routes ===

/**
 * @openapi
 * /api/tasks:
 *   get:
 *     summary: List tasks
 *     description: >
 *       List tasks with optional pagination, filtering, and field selection.
 *       When page/limit are omitted, returns all tasks as a flat array (backward-compatible).
 *       When page or limit is provided, returns a paginated response with Link headers.
 *     tags: [Tasks]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1 }
 *         description: Page number (1-indexed). Enables paginated response.
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 200, default: 50 }
 *         description: Items per page
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *         description: Filter by status (comma-separated, e.g. "todo,in-progress")
 *       - in: query
 *         name: priority
 *         schema: { type: string }
 *         description: Filter by priority (comma-separated, e.g. "high,medium")
 *       - in: query
 *         name: type
 *         schema: { type: string }
 *         description: Filter by type (comma-separated)
 *       - in: query
 *         name: project
 *         schema: { type: string }
 *         description: Filter by project name (exact match)
 *       - in: query
 *         name: agent
 *         schema: { type: string }
 *         description: Filter by agent name (exact match)
 *       - in: query
 *         name: view
 *         schema: { type: string, enum: [summary] }
 *         description: '"summary" returns lightweight TaskSummary objects'
 *       - in: query
 *         name: fields
 *         schema: { type: string }
 *         description: Comma-separated field names to include (always includes "id")
 *     responses:
 *       200:
 *         description: Task list (flat array or paginated object)
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - type: array
 *                   items:
 *                     $ref: '#/components/schemas/Task'
 *                 - $ref: '#/components/schemas/PaginatedResponse'
 */
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
    const agentFilter = (req.query.agent as string | undefined)?.trim().slice(0, 100);
    if (agentFilter) {
      tasks = tasks.filter((t) => t.agent === agentFilter);
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
          verificationSteps: task.verificationSteps,
          blockedBy: task.blockedBy,
          blockedReason: task.blockedReason,
          position: task.position,
          attachmentCount: task.attachments?.length ?? 0,
          deliverableCount: task.deliverables?.length ?? 0,
          github: task.github,
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

      sendPaginated(res, result, { page, limit, total });
    } else {
      // Backward-compatible flat array response
      res.json(result);
    }
  })
);

/**
 * @openapi
 * /api/tasks/counts:
 *   get:
 *     summary: Get task counts by status
 *     description: >
 *       Returns total task counts for each status (backlog, todo, in-progress, blocked, done)
 *       and archived count. NO time filtering — counts ALL tasks across entire history.
 *       Optimized for sidebar display.
 *     tags: [Tasks]
 *     responses:
 *       200:
 *         description: Task counts by status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 backlog:
 *                   type: number
 *                   description: Number of tasks in backlog
 *                 todo:
 *                   type: number
 *                   description: Number of tasks in todo status
 *                 in-progress:
 *                   type: number
 *                   description: Number of tasks in in-progress status
 *                 blocked:
 *                   type: number
 *                   description: Number of tasks in blocked status
 *                 done:
 *                   type: number
 *                   description: Number of tasks in done status
 *                 archived:
 *                   type: number
 *                   description: Number of archived tasks
 */
router.get(
  '/counts',
  asyncHandler(async (_req, res) => {
    const { getBacklogService } = await import('../services/backlog-service.js');
    const backlogService = getBacklogService();

    // Get all active tasks and count by status
    const tasks = await taskService.listTasks();
    const counts = {
      backlog: 0,
      todo: 0,
      'in-progress': 0,
      blocked: 0,
      done: 0,
      archived: 0,
    };

    // Count active tasks by status
    for (const task of tasks) {
      if (task.status in counts) {
        counts[task.status as keyof typeof counts]++;
      }
    }

    // Get backlog count
    counts.backlog = await backlogService.getBacklogCount();

    // Get archived count
    const archived = await taskService.listArchivedTasks();
    counts.archived = archived.length;

    res.json(counts);
  })
);

// POST /api/tasks/reorder - Reorder tasks within a column
router.post(
  '/reorder',
  asyncHandler(async (req, res) => {
    let orderedIds: string[];
    try {
      ({ orderedIds } = reorderTasksSchema.parse(req.body));
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.errors);
      }
      throw error;
    }
    const updated = await taskService.reorderTasks(orderedIds);
    broadcastTaskChange('reordered');
    res.json({ updated: updated.length });
  })
);

/**
 * @openapi
 * /api/tasks/{id}:
 *   get:
 *     summary: Get a single task
 *     description: Retrieve a task by its ID, including all details.
 *     tags: [Tasks]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Task ID
 *     responses:
 *       200:
 *         description: Task details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Task'
 *       404:
 *         description: Task not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
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

/**
 * @openapi
 * /api/tasks:
 *   post:
 *     summary: Create a new task
 *     description: Create a task with the given title, type, priority, and optional project/sprint.
 *     tags: [Tasks]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateTaskInput'
 *     responses:
 *       201:
 *         description: Task created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Task'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
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
    await activityService.logActivity(
      'task_created',
      task.id,
      task.title,
      {
        type: task.type,
        priority: task.priority,
        project: task.project,
      },
      task.agent
    );

    // Audit log
    const authReq = req as AuthenticatedRequest;
    await auditLog({
      action: 'task.create',
      actor: authReq.auth?.keyName || 'unknown',
      resource: task.id,
      details: { title: task.title, type: task.type, priority: task.priority },
    });

    res.status(201).json(task);
  })
);

/**
 * @openapi
 * /api/tasks/{id}:
 *   patch:
 *     summary: Update a task
 *     description: >
 *       Partially update a task. Supports changing status, priority, title, description,
 *       and more. Moving a blocked task to in-progress checks blockedBy dependencies.
 *       Moving out of blocked status auto-clears blockedReason.
 *     tags: [Tasks]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Task ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateTaskInput'
 *     responses:
 *       200:
 *         description: Updated task
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Task'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Task not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
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

    // Check delegation if moving to 'done'
    if (input.status === 'done' && oldTask.status !== 'done') {
      const authReq = req as AuthenticatedRequest;
      const agentName = authReq.auth?.keyName || 'unknown';

      const delegationCheck = await delegationService.canApprove(agentName, {
        id: oldTask.id,
        priority: oldTask.priority,
        project: oldTask.project,
        tags: [], // Tasks don't have tags yet, but delegation supports them
      });

      if (delegationCheck.allowed) {
        // Log delegated approval
        await delegationService.logApproval({
          taskId: oldTask.id,
          taskTitle: oldTask.title,
          agent: agentName,
        });

        // Add activity log entry noting delegation
        await activityService.logActivity(
          'status_changed',
          oldTask.id,
          oldTask.title,
          {
            from: oldTask.status,
            status: 'done',
            delegated: true,
            delegateAgent: agentName,
          },
          agentName
        );
      }
      // If delegation check fails, no special handling — the request proceeds normally
      // (human users can still approve, or API keys with admin/agent role)
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
      await activityService.logActivity(
        'status_changed',
        task.id,
        task.title,
        {
          from: oldTask.status,
          status: input.status,
        },
        task.agent
      );

      // Outbound sync: push status change to linked GitHub issue (fire-and-forget)
      if (task.github) {
        getGitHubSyncService()
          .syncTaskStatusToGitHub(task)
          .catch(() => {
            /* intentionally silent — don't fail the API call */
          });
      }
    } else {
      await activityService.logActivity('task_updated', task.id, task.title, undefined, task.agent);
    }

    res.json(task);
  })
);

/**
 * @openapi
 * /api/tasks/{id}:
 *   delete:
 *     summary: Delete a task
 *     description: Delete (archive) a task by ID.
 *     tags: [Tasks]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Task ID
 *     responses:
 *       204:
 *         description: Task deleted successfully
 *       404:
 *         description: Task not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
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
      await activityService.logActivity('task_deleted', task.id, task.title, undefined, task.agent);
    }

    // Audit log
    const authReqDel = req as AuthenticatedRequest;
    await auditLog({
      action: 'task.delete',
      actor: authReqDel.auth?.keyName || 'unknown',
      resource: req.params.id as string,
      details: task ? { title: task.title } : undefined,
    });

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
    let templateId: string;
    let templateName: string | undefined;
    let fieldsChanged: string[] | undefined;
    try {
      ({ templateId, templateName, fieldsChanged } = applyTemplateSchema.parse(req.body));
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

    // Log activity for template application
    await activityService.logActivity(
      'template_applied',
      task.id,
      task.title,
      {
        templateId,
        templateName: templateName || 'Unknown',
        fieldsChanged: fieldsChanged || [],
      },
      task.agent
    );

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

      // Collect image paths (return download URLs, not filesystem paths)
      if (attachment.mimeType.startsWith('image/')) {
        const url = `/api/tasks/${task.id}/attachments/${attachment.filename}`;
        imagePaths.push(url);
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

// POST /api/tasks/:id/demote - Move active task to backlog
router.post(
  '/:id/demote',
  asyncHandler(async (req, res) => {
    const { getBacklogService } = await import('../services/backlog-service.js');
    const backlogService = getBacklogService();

    const task = await backlogService.demoteToBacklog(req.params.id as string);

    // Broadcast change to websocket clients
    broadcastTaskChange('deleted', task.id);

    // Audit log
    const authReq = req as AuthenticatedRequest;
    await auditLog({
      action: 'task.demoted',
      actor: authReq.auth?.keyName || 'unknown',
      resource: task.id,
      details: { title: task.title },
    });

    res.json({ success: true, data: task });
  })
);

// === Bulk Operations ===

const bulkUpdateSchema = z.object({
  ids: z
    .array(z.string())
    .min(1, 'At least one task ID is required')
    .max(100, 'Maximum 100 tasks per bulk operation'),
  status: z.enum(['todo', 'in-progress', 'blocked', 'done']),
});

const bulkArchiveSchema = z.object({
  ids: z
    .array(z.string())
    .min(1, 'At least one task ID is required')
    .max(100, 'Maximum 100 tasks per bulk operation'),
});

// POST /api/tasks/bulk-update - Bulk update task status
router.post(
  '/bulk-update',
  asyncHandler(async (req, res) => {
    let input: { ids: string[]; status: 'todo' | 'in-progress' | 'blocked' | 'done' };
    try {
      input = bulkUpdateSchema.parse(req.body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.errors);
      }
      throw error;
    }

    const updated: string[] = [];
    const failed: string[] = [];

    // Update tasks in parallel for better performance
    const results = await Promise.allSettled(
      input.ids.map(async (id) => {
        const task = await taskService.updateTask(id, { status: input.status });
        if (task) {
          // Log activity for status change
          await activityService.logActivity(
            'status_changed',
            task.id,
            task.title,
            {
              from: task.status,
              status: input.status,
            },
            task.agent
          );
          return { id, success: true };
        }
        return { id, success: false };
      })
    );

    // Collect results
    results.forEach((result, index) => {
      const id = input.ids[index];
      if (result.status === 'fulfilled' && result.value.success) {
        updated.push(id);
      } else {
        failed.push(id);
      }
    });

    // Single broadcast for all changes
    broadcastTaskChange('updated');

    // Audit log
    const authReq = req as AuthenticatedRequest;
    await auditLog({
      action: 'tasks.bulk_update',
      actor: authReq.auth?.keyName || 'unknown',
      resource: 'bulk',
      details: { updated: updated.length, failed: failed.length, status: input.status },
    });

    res.json({ updated, count: updated.length, failed });
  })
);

// POST /api/tasks/bulk-archive-by-ids - Bulk archive tasks by ID list
router.post(
  '/bulk-archive-by-ids',
  asyncHandler(async (req, res) => {
    let input: { ids: string[] };
    try {
      input = bulkArchiveSchema.parse(req.body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.errors);
      }
      throw error;
    }

    const archived: string[] = [];
    const failed: string[] = [];

    // Archive tasks in parallel for better performance
    const results = await Promise.allSettled(
      input.ids.map(async (id) => {
        const task = await taskService.getTask(id);
        if (task) {
          const success = await taskService.archiveTask(id);
          if (success) {
            // Log activity
            await activityService.logActivity(
              'task_archived',
              task.id,
              task.title,
              undefined,
              task.agent
            );
            return { id, success: true, task };
          }
        }
        return { id, success: false };
      })
    );

    // Collect results
    results.forEach((result, index) => {
      const id = input.ids[index];
      if (result.status === 'fulfilled' && result.value.success) {
        archived.push(id);
      } else {
        failed.push(id);
      }
    });

    // Single broadcast for all changes
    broadcastTaskChange('deleted');

    // Audit log
    const authReq = req as AuthenticatedRequest;
    await auditLog({
      action: 'tasks.bulk_archive',
      actor: authReq.auth?.keyName || 'unknown',
      resource: 'bulk',
      details: { archived: archived.length, failed: failed.length },
    });

    res.json({ archived, count: archived.length, failed });
  })
);

// === Dependency Routes ===

/**
 * POST /api/tasks/:id/dependencies - Add a dependency
 * Body: { depends_on?: string, blocks?: string }
 */
router.post(
  '/:id/dependencies',
  asyncHandler(async (req, res) => {
    const taskId = req.params.id as string;

    // Validate request body with Zod
    let input: { depends_on?: string; blocks?: string };
    try {
      input = addDependencySchema.parse(req.body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.errors);
      }
      throw error;
    }

    const { depends_on, blocks } = input;
    const targetId = depends_on ?? blocks;
    if (!targetId) {
      throw new ValidationError('Must provide either depends_on or blocks');
    }
    const type: 'depends_on' | 'blocks' = depends_on ? 'depends_on' : 'blocks';
    if (!targetId) {
      throw new ValidationError('Either depends_on or blocks is required');
    }

    const task = await taskService.addDependency(taskId, targetId, type);

    // Log activity
    await activityService.logActivity(
      'dependency_added',
      task.id,
      task.title,
      { type, targetId },
      task.agent
    );

    // Broadcast change
    broadcastTaskChange('updated', taskId);

    // Audit log
    const authReq = req as AuthenticatedRequest;
    await auditLog({
      action: 'tasks.add_dependency',
      actor: authReq.auth?.keyName || 'unknown',
      resource: taskId,
      details: { type, targetId },
    });

    setLastModified(res, task.updated);
    res.json(task);
  })
);

/**
 * DELETE /api/tasks/:id/dependencies/:targetId - Remove a dependency
 */
router.delete(
  '/:id/dependencies/:targetId',
  asyncHandler(async (req, res) => {
    const taskId = req.params.id as string;
    const targetId = req.params.targetId as string;

    const task = await taskService.removeDependency(taskId, targetId);

    // Log activity
    await activityService.logActivity(
      'dependency_removed',
      task.id,
      task.title,
      { targetId },
      task.agent
    );

    // Broadcast change
    broadcastTaskChange('updated', taskId);

    // Audit log
    const authReq = req as AuthenticatedRequest;
    await auditLog({
      action: 'tasks.remove_dependency',
      actor: authReq.auth?.keyName || 'unknown',
      resource: taskId,
      details: { targetId },
    });

    setLastModified(res, task.updated);
    res.json(task);
  })
);

/**
 * GET /api/tasks/:id/dependencies - Get all dependencies (both directions)
 */
router.get(
  '/:id/dependencies',
  asyncHandler(async (req, res) => {
    const taskId = req.params.id as string;
    const dependencies = await taskService.getTaskDependencies(taskId);
    res.json(dependencies);
  })
);

/**
 * GET /api/tasks/:id/dependency-graph - Get full dependency tree (recursive)
 */
router.get(
  '/:id/dependency-graph',
  asyncHandler(async (req, res) => {
    const taskId = req.params.id as string;
    const graph = await taskService.getTaskDependencyGraph(taskId);
    res.json(graph);
  })
);

// === Progress Routes ===

/**
 * GET /api/tasks/:id/progress - Get progress file for a task
 */
router.get(
  '/:id/progress',
  asyncHandler(async (req, res) => {
    const taskId = req.params.id as string;
    const task = await taskService.getTask(taskId);

    if (!task) {
      throw new NotFoundError('Task not found');
    }

    const progress = await progressService.getProgress(taskId);

    // Return empty string if no progress file exists yet
    res.json({ content: progress || '' });
  })
);

/**
 * PUT /api/tasks/:id/progress - Update (overwrite) progress file
 */
router.put(
  '/:id/progress',
  asyncHandler(async (req, res) => {
    const taskId = req.params.id as string;
    const task = await taskService.getTask(taskId);

    if (!task) {
      throw new NotFoundError('Task not found');
    }

    const { content } = req.body;

    if (typeof content !== 'string') {
      throw new ValidationError('Content must be a string');
    }

    await progressService.updateProgress(taskId, content);

    res.json({ success: true });
  })
);

/**
 * POST /api/tasks/:id/progress/append - Append content to progress file section
 */
router.post(
  '/:id/progress/append',
  asyncHandler(async (req, res) => {
    const taskId = req.params.id as string;
    const task = await taskService.getTask(taskId);

    if (!task) {
      throw new NotFoundError('Task not found');
    }

    let input: { section: string; content: string };
    try {
      input = appendProgressSchema.parse(req.body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.errors);
      }
      throw error;
    }

    await progressService.appendProgress(taskId, input.section, input.content);

    res.json({ success: true });
  })
);

// === Checkpoint Routes ===

/**
 * Sanitize checkpoint state: remove any field containing sensitive keywords
 * and redact values matching secret patterns
 */
function sanitizeCheckpointState(state: Record<string, any>): Record<string, any> {
  const sensitiveKeys = [
    'key',
    'token',
    'secret',
    'password',
    'apikey',
    'api_key',
    'bearer',
    'auth',
    'authorization',
    'credential',
    'private',
    'jwt',
    'session',
    'cookie',
    'oauth',
    'client_secret',
    'access_token',
    'refresh_token',
    'api_token',
    'webhook',
  ];

  // Patterns for detecting secret-like values
  const SECRET_VALUE_PATTERNS = [
    /ghp_[a-zA-Z0-9]{36}/, // GitHub PAT
    /sk-[a-zA-Z0-9-]{20,}/, // OpenAI key
    /xox[a-z]-[0-9]+-/, // Slack token
    /Bearer\s+[a-zA-Z0-9\-._~+/]+=*/i, // Bearer token
    /[a-zA-Z0-9+/]{40,}={0,2}/, // Base64 tokens (40+ chars)
  ];

  const sanitized: Record<string, any> = {};

  for (const [key, value] of Object.entries(state)) {
    // Check if key contains any sensitive keyword (case-insensitive)
    const keyLower = key.toLowerCase();
    const isSensitive = sensitiveKeys.some((keyword) => keyLower.includes(keyword));

    if (isSensitive) {
      continue; // Skip sensitive fields
    }

    // Handle arrays: recursively sanitize each item (including primitive strings)
    if (Array.isArray(value)) {
      sanitized[key] = value.map((item) => {
        if (item && typeof item === 'object') {
          return sanitizeCheckpointState(item);
        }
        if (typeof item === 'string') {
          const matchesSecretPattern = SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(item));
          return matchesSecretPattern ? '[REDACTED]' : item;
        }
        return item;
      });
    }
    // Recursively sanitize nested objects
    else if (value && typeof value === 'object') {
      sanitized[key] = sanitizeCheckpointState(value as Record<string, any>);
    }
    // Check string values for secret patterns
    else if (typeof value === 'string') {
      const matchesSecretPattern = SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value));
      sanitized[key] = matchesSecretPattern ? '[REDACTED]' : value;
    }
    // Non-sensitive primitive values
    else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

const checkpointSchema = z
  .object({
    step: z.number().int().min(0),
    state: z.record(z.any()),
  })
  .refine(
    (data) => {
      const stateStr = JSON.stringify(data.state);
      return stateStr.length <= 1024 * 1024; // 1MB limit
    },
    {
      message: 'Checkpoint state exceeds 1MB limit',
    }
  );

/**
 * POST /api/tasks/:id/checkpoint - Save checkpoint data
 */
router.post(
  '/:id/checkpoint',
  asyncHandler(async (req, res) => {
    const taskId = req.params.id as string;
    const task = await taskService.getTask(taskId);

    if (!task) {
      throw new NotFoundError('Task not found');
    }

    let input: { step: number; state: Record<string, any> };
    try {
      input = checkpointSchema.parse(req.body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.errors);
      }
      throw error;
    }

    // Sanitize the state to remove secrets
    const sanitizedState = sanitizeCheckpointState(input.state);

    // Prepare checkpoint data
    const checkpoint = {
      step: input.step,
      state: sanitizedState,
      timestamp: new Date().toISOString(),
      resumeCount: task.checkpoint?.resumeCount || 0,
    };

    // Update task with checkpoint
    const updatedTask = await taskService.updateTask(taskId, { checkpoint });

    if (!updatedTask) {
      return res.status(404).json({ error: 'Task update failed - task not found' });
    }

    // Broadcast change
    broadcastTaskChange('updated', updatedTask.id);

    res.json({ success: true, checkpoint });
  })
);

/**
 * GET /api/tasks/:id/checkpoint - Get latest checkpoint
 */
router.get(
  '/:id/checkpoint',
  asyncHandler(async (req, res) => {
    const taskId = req.params.id as string;
    const task = await taskService.getTask(taskId);

    if (!task) {
      throw new NotFoundError('Task not found');
    }

    if (!task.checkpoint) {
      res.json({ checkpoint: null });
      return;
    }

    // Check if checkpoint is expired (older than 24h)
    const checkpointTime = new Date(task.checkpoint.timestamp).getTime();

    // Handle invalid timestamps
    if (isNaN(checkpointTime)) {
      await taskService.updateTask(taskId, { checkpoint: undefined });
      res.json({ checkpoint: null, invalid: true });
      return;
    }

    const now = Date.now();
    const age = now - checkpointTime;
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

    if (age > maxAge) {
      // Clear expired checkpoint
      await taskService.updateTask(taskId, { checkpoint: undefined });
      broadcastTaskChange('updated', taskId);
      res.json({ checkpoint: null, expired: true });
      return;
    }

    res.json({ checkpoint: task.checkpoint });
  })
);

/**
 * DELETE /api/tasks/:id/checkpoint - Clear checkpoint
 */
router.delete(
  '/:id/checkpoint',
  asyncHandler(async (req, res) => {
    const taskId = req.params.id as string;
    const task = await taskService.getTask(taskId);

    if (!task) {
      throw new NotFoundError('Task not found');
    }

    // Clear checkpoint by setting it to undefined
    const updatedTask = await taskService.updateTask(taskId, { checkpoint: undefined });

    if (!updatedTask) {
      return res.status(404).json({ error: 'Task update failed - task not found' });
    }

    // Broadcast change
    broadcastTaskChange('updated', updatedTask.id);

    res.json({ success: true });
  })
);

export { router as taskRoutes };
