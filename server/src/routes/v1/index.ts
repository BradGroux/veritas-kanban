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
import {
  activityAccess,
  adminAccess,
  agentSelfServiceAccess,
  agentStatusAccess,
  agentTaskAccess,
  backupAccess,
  broadcastAccess,
  configAccess,
  costPredictionAccess,
  delegationAccess,
  feedbackAccess,
  notificationAccess,
  policyAccess,
  promptRegistryAccess,
  reportAccess,
  reportRoutesAccess,
  scoringAccess,
  searchAccess,
  settingsAccess,
  statusHistoryAccess,
  taskAccess,
  taskCommentAccess,
  taskReadAccess,
  telemetryAccess,
  transcriptAccess,
  workflowAccess,
  workProductAccess,
  workspaceAccess,
} from './permissions.js';

// Task routes (order-sensitive — see note above)
import { taskArchiveRoutes } from '../task-archive.js';
import { taskTimeRoutes } from '../task-time.js';
import { taskRoutes } from '../tasks.js';
import { taskCommentRoutes } from '../task-comments.js';
import { taskObservationRoutes, observationSearchRouter } from '../task-observations.js';
import { taskSubtaskRoutes } from '../task-subtasks.js';
import { taskVerificationRoutes } from '../task-verification.js';
import { taskDeliverableRoutes } from '../task-deliverables.js';
import { taskWorkProductRoutes, workProductRoutes } from '../work-products.js';
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
import driftRoutes from '../drift.js';
import { settingsRoutes } from '../settings.js';
import { agentStatusRoutes } from '../agent-status.js';
import { agentRegistryRoutes } from '../agent-registry.js';
import { agentPermissionRoutes } from '../agent-permissions.js';
import { costPredictionRoutes } from '../cost-prediction.js';
import { errorLearningRoutes } from '../error-learning.js';
import { docsRoutes } from '../docs.js';
import { searchRoutes } from '../search.js';
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
import policyRoutes from '../policies.js';
import { integrationsRoutes } from '../integrations.js';
import { systemHealthRouter } from '../system-health.js';
import { transcriptRoutes } from '../transcripts.js';
import { decisionRoutes } from '../decisions.js';
import { scoringRoutes } from '../scoring.js';
import { feedbackRoutes } from '../feedback.js';
import promptRegistryRoutes from '../prompt-registry.js';
import { sqlitePortabilityRoutes } from '../sqlite-portability.js';
import { identityRoutes } from '../identity.js';

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
v1Router.use('/tasks', taskAccess, taskArchiveRoutes);
v1Router.use('/tasks', taskAccess, taskTimeRoutes);
v1Router.use('/tasks', taskAccess, taskRoutes);
v1Router.use('/tasks', taskCommentAccess, taskCommentRoutes);
v1Router.use('/tasks', taskAccess, taskObservationRoutes);
v1Router.use('/tasks', taskAccess, taskSubtaskRoutes);
v1Router.use('/tasks', taskAccess, taskVerificationRoutes);
v1Router.use('/tasks', taskAccess, taskDeliverableRoutes);
v1Router.use('/tasks', workProductAccess, taskWorkProductRoutes);

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
  taskAccess,
  attachmentRoutes
);

// ── Backlog routes ───────────────────────────────────────────
v1Router.use('/backlog', taskAccess, backlogRoutes);

// ── Observation search ───────────────────────────────────────
v1Router.use('/observations', taskReadAccess, observationSearchRouter);

// ── Feature routes ───────────────────────────────────────────
v1Router.use('/config', configAccess, configRoutes);
v1Router.use('/changes', taskReadAccess, changesRoutes); // Efficient agent polling endpoint
v1Router.use('/chat', taskCommentAccess, chatRoutes); // Chat interface - must be before agent routes
v1Router.use('/agents/register', agentSelfServiceAccess, agentRegistryRoutes); // Before agentRoutes (/:taskId catches "register")
v1Router.use('/agents/permissions', agentSelfServiceAccess, agentPermissionRoutes);
v1Router.use('/agents', agentSelfServiceAccess, agentRoutingRoutes); // Must be before agentRoutes (/:taskId would match "route"/"routing")
v1Router.use('/agents', agentTaskAccess, agentRoutes);
v1Router.use('/diff', taskReadAccess, diffRoutes);
v1Router.use('/automation', taskAccess, automationRoutes);
v1Router.use('/summary', reportAccess, summaryRoutes);
v1Router.use('/notifications', notificationAccess, notificationRoutes);
v1Router.use('/broadcasts', broadcastAccess, broadcastRoutes);
v1Router.use('/templates', settingsAccess, templateRoutes);
v1Router.use('/task-types', settingsAccess, taskTypeRoutes);
v1Router.use('/projects', settingsAccess, projectRoutes);
v1Router.use('/sprints', settingsAccess, sprintRoutes);
v1Router.use('/activity', activityAccess, activityRoutes);
v1Router.use('/github', taskAccess, githubRoutes);
v1Router.use('/preview', taskReadAccess, previewRoutes);
v1Router.use('/conflicts', taskAccess, conflictRoutes);
v1Router.use('/telemetry', telemetryAccess, telemetryRoutes);
v1Router.use('/metrics', reportAccess, metricsRoutes);
v1Router.use('/analytics', reportAccess, analyticsRoutes);
v1Router.use('/traces', telemetryAccess, tracesRoutes);
v1Router.use('/drift', telemetryAccess, driftRoutes);
v1Router.use('/settings/transition-hooks', adminAccess, transitionHooksRoutes);
v1Router.use('/settings', settingsAccess, settingsRoutes);
v1Router.use('/agent/status', agentStatusAccess, agentStatusRoutes);
v1Router.use('/cost-prediction', costPredictionAccess, costPredictionRoutes);
v1Router.use('/deliverables', taskAccess, scheduledDeliverablesRoutes);
v1Router.use('/reports', reportRoutesAccess, reportRoutes);
v1Router.use('/doc-freshness', settingsAccess, docFreshnessRoutes);
v1Router.use('/docs', settingsAccess, docsRoutes);
v1Router.use('/errors', telemetryAccess, errorLearningRoutes);
v1Router.use('/search', searchAccess, searchRoutes);
v1Router.use('/work-products', workProductAccess, workProductRoutes);
v1Router.use('/hooks', settingsAccess, lifecycleHooksRoutes);
v1Router.use('/shared-resources', settingsAccess, sharedResourcesRoutes);
v1Router.use('/status-history', statusHistoryAccess, statusHistoryRoutes);
v1Router.use('/digest', reportAccess, digestRoutes);
v1Router.use('/audit', adminAccess, auditRoutes);
v1Router.use('/lessons', taskReadAccess, lessonsRoutes);
v1Router.use('/delegation', delegationAccess, delegationRoutes);
v1Router.use('/workflows', workflowAccess, workflowRoutes);
v1Router.use('/tool-policies', policyAccess, toolPolicyRoutes);
v1Router.use('/policies', policyAccess, policyRoutes);
v1Router.use('/integrations', settingsAccess, integrationsRoutes);
v1Router.use('/transcripts', transcriptAccess, transcriptRoutes);
v1Router.use('/scoring', scoringAccess, scoringRoutes);
v1Router.use('/system/health', workspaceAccess, systemHealthRouter);
v1Router.use('/decisions', taskAccess, decisionRoutes);
v1Router.use('/feedback', feedbackAccess, feedbackRoutes);
v1Router.use('/prompt-registry', promptRegistryAccess, promptRegistryRoutes);
v1Router.use('/sqlite', backupAccess, sqlitePortabilityRoutes);
v1Router.use('/identity', workspaceAccess, identityRoutes);

export { v1Router };
