/**
 * API v1 Router
 *
 * Aggregates all route modules into a single Express Router.
 * This router is mounted at both `/api/v1` (canonical) and `/api` (backwards-compatible alias).
 *
 * Route ordering matters:
 *   - Archive and time routes MUST come before main taskRoutes so that
 *     /archived and /time/summary are matched before the /:id param.
 *
 * Rate limiting tiers (applied per-route):
 *   - readRateLimit   — 300 req/min (GET endpoints)
 *   - writeRateLimit  — 60 req/min  (POST/PUT/PATCH/DELETE)
 *   - uploadRateLimit — 20 req/min  (file upload endpoints)
 *   Global apiRateLimit (300 req/min, localhost exempt) is applied upstream in index.ts.
 */
import { Router, type IRouter, type Request } from 'express';
import { readRateLimit, writeRateLimit, uploadRateLimit } from '../../middleware/rate-limit.js';

// Task routes (order-sensitive — see note above)
import { taskArchiveRoutes } from '../task-archive.js';
import { taskTimeRoutes } from '../task-time.js';
import { taskRoutes } from '../tasks.js';
import { taskCommentRoutes } from '../task-comments.js';
import { taskSubtaskRoutes } from '../task-subtasks.js';
import { taskVerificationRoutes } from '../task-verification.js';
import { taskDeliverableRoutes } from '../task-deliverables.js';
import attachmentRoutes from '../attachments.js';
import { backlogRoutes } from '../backlog.js';

// Feature routes
import { configRoutes } from '../config.js';
import { chatRoutes } from '../chat.js';
import { agentRoutes } from '../agents.js';
import { agentRoutingRoutes } from '../agent-routing.js';
import { diffRoutes } from '../diff.js';
import { automationRoutes } from '../automation.js';
import { summaryRoutes } from '../summary.js';
import { notificationRoutes } from '../notifications.js';
import { changesRoutes } from '../changes.js';
import { broadcastRoutes } from '../broadcasts.js';
import templateRoutes from '../templates.js';
import taskTypeRoutes from '../task-types.js';
import projectRoutes from '../projects.js';
import sprintRoutes from '../sprints.js';
import activityRoutes from '../activity.js';
import githubRoutes from '../github.js';
import previewRoutes from '../preview.js';
import conflictRoutes from '../conflicts.js';
import telemetryRoutes from '../telemetry.js';
import metricsRoutes from '../metrics.js';
import { analyticsRoutes } from '../analytics.js';
import tracesRoutes from '../traces.js';
import { settingsRoutes } from '../settings.js';
import { agentStatusRoutes } from '../agent-status.js';
import { agentRegistryRoutes } from '../agent-registry.js';
import { agentPermissionRoutes } from '../agent-permissions.js';
import { costPredictionRoutes } from '../cost-prediction.js';
import { errorLearningRoutes } from '../error-learning.js';
import { docsRoutes } from '../docs.js';
import { docFreshnessRoutes } from '../doc-freshness.js';
import { reportRoutes } from '../reports.js';
import { scheduledDeliverablesRoutes } from '../scheduled-deliverables.js';
import { lifecycleHooksRoutes } from '../lifecycle-hooks.js';
import { sharedResourcesRoutes } from '../shared-resources.js';
import { statusHistoryRoutes } from '../status-history.js';
import digestRoutes from '../digest.js';
import auditRoutes from '../audit.js';
import transitionHooksRoutes from '../transition-hooks.js';
import lessonsRoutes from '../lessons.js';
import delegationRoutes from '../delegation.js';
import { workflowRoutes } from '../workflows.js';
import toolPolicyRoutes from '../tool-policies.js';

const v1Router: IRouter = Router();

// ── Tiered rate limiting by HTTP method ──────────────────────
// GET → readRateLimit (300 req/min)
// POST/PUT/PATCH/DELETE → writeRateLimit (60 req/min)
// The global apiRateLimit (applied upstream) acts as an outer cap.
v1Router.use((req: Request, _res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') {
    return readRateLimit(req, _res, next);
  }
  return writeRateLimit(req, _res, next);
});

// ── Task routes (order-sensitive) ────────────────────────────
v1Router.use('/tasks', taskArchiveRoutes);
v1Router.use('/tasks', taskTimeRoutes);
v1Router.use('/tasks', taskRoutes);
v1Router.use('/tasks', taskCommentRoutes);
v1Router.use('/tasks', taskSubtaskRoutes);
v1Router.use('/tasks', taskVerificationRoutes);
v1Router.use('/tasks', taskDeliverableRoutes);

// Attachment routes get the stricter upload rate limit (20 req/min)
// applied BEFORE the route handler for upload (POST) requests.
v1Router.use(
  '/tasks',
  (req: Request, _res, next) => {
    // Only apply upload limit to POST on attachment paths
    if (req.method === 'POST' && req.path.match(/\/[^/]+\/attachments/)) {
      return uploadRateLimit(req, _res, next);
    }
    next();
  },
  attachmentRoutes
);

// ── Backlog routes ───────────────────────────────────────────
v1Router.use('/backlog', backlogRoutes);

// ── Feature routes ───────────────────────────────────────────
v1Router.use('/config', configRoutes);
v1Router.use('/changes', changesRoutes); // Efficient agent polling endpoint
v1Router.use('/chat', chatRoutes); // Chat interface - must be before agent routes
v1Router.use('/agents/register', agentRegistryRoutes); // Before agentRoutes (/:taskId catches "register")
v1Router.use('/agents/permissions', agentPermissionRoutes);
v1Router.use('/agents', agentRoutingRoutes); // Must be before agentRoutes (/:taskId would match "route"/"routing")
v1Router.use('/agents', agentRoutes);
v1Router.use('/diff', diffRoutes);
v1Router.use('/automation', automationRoutes);
v1Router.use('/summary', summaryRoutes);
v1Router.use('/notifications', notificationRoutes);
v1Router.use('/broadcasts', broadcastRoutes);
v1Router.use('/templates', templateRoutes);
v1Router.use('/task-types', taskTypeRoutes);
v1Router.use('/projects', projectRoutes);
v1Router.use('/sprints', sprintRoutes);
v1Router.use('/activity', activityRoutes);
v1Router.use('/github', githubRoutes);
v1Router.use('/preview', previewRoutes);
v1Router.use('/conflicts', conflictRoutes);
v1Router.use('/telemetry', telemetryRoutes);
v1Router.use('/metrics', metricsRoutes);
v1Router.use('/analytics', analyticsRoutes);
v1Router.use('/traces', tracesRoutes);
v1Router.use('/settings', settingsRoutes);
v1Router.use('/settings/transition-hooks', transitionHooksRoutes);
v1Router.use('/agent/status', agentStatusRoutes);
v1Router.use('/cost-prediction', costPredictionRoutes);
v1Router.use('/deliverables', scheduledDeliverablesRoutes);
v1Router.use('/reports', reportRoutes);
v1Router.use('/doc-freshness', docFreshnessRoutes);
v1Router.use('/docs', docsRoutes);
v1Router.use('/errors', errorLearningRoutes);
v1Router.use('/hooks', lifecycleHooksRoutes);
v1Router.use('/shared-resources', sharedResourcesRoutes);
v1Router.use('/status-history', statusHistoryRoutes);
v1Router.use('/digest', digestRoutes);
v1Router.use('/audit', auditRoutes);
v1Router.use('/lessons', lessonsRoutes);
v1Router.use('/delegation', delegationRoutes);
v1Router.use('/workflows', workflowRoutes);
v1Router.use('/tool-policies', toolPolicyRoutes);

export { v1Router };
