/**
 * Notification API Routes
 *
 * GET    /api/notifications              — Get notifications
 * POST   /api/notifications              — Create a notification
 * POST   /api/notifications/check        — CLI compatibility no-op check
 * GET    /api/notifications/pending      — CLI compatibility pending notifications
 * POST   /api/notifications/mark-sent    — CLI compatibility delivered marker
 * DELETE /api/notifications              — Clear notifications
 * POST   /api/notifications/:id/delivered — Mark as delivered
 * POST   /api/notifications/delivered-all — Mark all as delivered for an agent
 * POST   /api/notifications/process      — Process a comment for @mentions
 * GET    /api/notifications/stats         — Notification statistics
 * GET    /api/notifications/subscriptions/:taskId — Thread subscriptions
 */

import { Router, type NextFunction, type Response, type Router as RouterType } from 'express';
import { z } from 'zod';
import { getNotificationService } from '../services/notification-service.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { NotFoundError } from '../middleware/error-handler.js';
import { authorize, type AuthenticatedRequest } from '../middleware/auth.js';

const router: RouterType = Router();
const requireAdmin = authorize('admin');

function requireAdminForGlobalNotifications(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  if (req.query.agent) {
    return next();
  }
  return requireAdmin(req, res, next);
}

/**
 * POST /api/notifications
 * Create a notification directly.
 */
router.post(
  '/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const schema = z.object({
      type: z.string().optional(),
      title: z.string().optional(),
      message: z.string().min(1),
      taskId: z.string().optional(),
      taskTitle: z.string().optional(),
      project: z.string().optional(),
    });

    const data = schema.parse(req.body);
    const service = getNotificationService();
    const notification = await service.createNotification(data);
    res.status(201).json(notification);
  })
);

/**
 * GET /api/notifications?agent=<name>&undelivered=true&taskId=<id>&limit=<n>
 */
router.get(
  '/',
  requireAdminForGlobalNotifications,
  asyncHandler(async (req, res) => {
    const agent = String(req.query.agent || '');
    if (!agent) {
      const service = getNotificationService();
      const notifications = await service.getAllNotifications({
        undelivered: req.query.undelivered === 'true' || req.query.unsent === 'true',
        limit: req.query.limit ? Number(String(req.query.limit)) : undefined,
      });
      return res.json(notifications);
    }

    const service = getNotificationService();
    const notifications = await service.getNotifications({
      agent,
      undelivered: req.query.undelivered === 'true',
      taskId: String(req.query.taskId || ''),
      limit: req.query.limit ? Number(String(req.query.limit)) : undefined,
    });

    res.json(notifications);
  })
);

/**
 * POST /api/notifications/check
 * Compatibility endpoint for the CLI's notify:check command. The current
 * server does not synthesize task notifications here, so this is explicit
 * no-op behavior instead of a 404.
 */
router.post(
  '/check',
  asyncHandler(async (_req, res) => {
    res.json({ checked: 0, created: 0 });
  })
);

/**
 * GET /api/notifications/pending
 * Compatibility endpoint for CLI Teams formatting.
 */
router.get(
  '/pending',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const service = getNotificationService();
    const notifications = await service.getAllNotifications({ undelivered: true });
    res.json({
      count: notifications.length,
      messages: notifications.map((notification) => ({
        id: notification.id,
        type: notification.type,
        text: notification.content,
        timestamp: notification.createdAt,
      })),
    });
  })
);

/**
 * POST /api/notifications/mark-sent
 * Compatibility endpoint for the CLI's --mark-sent flag.
 */
router.post(
  '/mark-sent',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const schema = z.object({ ids: z.array(z.string().min(1)).min(1) });
    const { ids } = schema.parse(req.body);
    const service = getNotificationService();
    const count = await service.markManyDelivered(ids);
    res.json({ success: true, count });
  })
);

/**
 * DELETE /api/notifications
 * Compatibility endpoint for CLI clear.
 */
router.delete(
  '/',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const service = getNotificationService();
    const count = await service.clearNotifications();
    res.json({ success: true, count });
  })
);

/**
 * GET /api/notifications/stats
 */
router.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const service = getNotificationService();
    const stats = await service.getStats();
    res.json(stats);
  })
);

/**
 * GET /api/notifications/subscriptions/:taskId
 */
router.get(
  '/subscriptions/:taskId',
  asyncHandler(async (req, res) => {
    const service = getNotificationService();
    const subs = await service.getSubscriptions(String(req.params.taskId));
    res.json(subs);
  })
);

/**
 * POST /api/notifications/process
 * Process a comment for @mentions and create notifications
 */
router.post(
  '/process',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      taskId: z.string().min(1),
      fromAgent: z.string().min(1),
      content: z.string().min(1),
      allAgents: z.array(z.string()).optional(),
    });

    const data = schema.parse(req.body);
    const service = getNotificationService();
    const notifications = await service.processComment(data);
    res.status(201).json(notifications);
  })
);

/**
 * POST /api/notifications/:id/delivered
 */
router.post(
  '/:id/delivered',
  asyncHandler(async (req, res) => {
    const service = getNotificationService();
    const success = await service.markDelivered(String(req.params.id));
    if (!success) throw new NotFoundError('Notification not found');
    res.json({ success: true });
  })
);

/**
 * POST /api/notifications/delivered-all
 * Mark all notifications delivered for an agent
 */
router.post(
  '/delivered-all',
  asyncHandler(async (req, res) => {
    const schema = z.object({ agent: z.string().min(1) });
    const { agent } = schema.parse(req.body);
    const service = getNotificationService();
    const count = await service.markAllDelivered(agent);
    res.json({ success: true, count });
  })
);

export { router as notificationRoutes };
