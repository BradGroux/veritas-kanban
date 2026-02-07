/**
 * Broadcast API Routes
 *
 * POST   /api/broadcasts         — Create a broadcast
 * GET    /api/broadcasts         — List broadcasts (with filters)
 * GET    /api/broadcasts/:id     — Get a single broadcast
 * PATCH  /api/broadcasts/:id/read — Mark as read by an agent
 */

import { Router, type Router as RouterType } from 'express';
import { asyncHandler } from '../middleware/async-handler.js';
import { NotFoundError } from '../middleware/error-handler.js';
import { getBroadcastStorageService } from '../services/broadcast-storage-service.js';
import type { CreateBroadcastRequest } from '@veritas-kanban/shared';
import {
  createBroadcastSchema,
  markReadSchema,
  getBroadcastsQuerySchema,
} from '../schemas/broadcast-schemas.js';
import { broadcastNewMessage } from '../services/broadcast-service.js';

const router: RouterType = Router();

/**
 * POST /api/broadcasts
 * Create a new broadcast message
 */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const validated = createBroadcastSchema.parse(req.body);
    const service = getBroadcastStorageService();

    const broadcast = await service.create(validated as CreateBroadcastRequest);

    // Emit WebSocket event for real-time notification
    broadcastNewMessage(broadcast);

    res.status(201).json(broadcast);
  })
);

/**
 * GET /api/broadcasts
 * List broadcasts with optional filters:
 *   - since: ISO timestamp (only broadcasts after this time)
 *   - unread: boolean (requires agent parameter)
 *   - agent: string (agent name for unread filtering)
 *   - priority: info|action-required|urgent
 *   - limit: number (max results)
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = getBroadcastsQuerySchema.parse(req.query);
    const service = getBroadcastStorageService();

    // Validation: unread filter requires agent parameter
    if (query.unread && !query.agent) {
      return res.status(400).json({
        error: 'agent parameter is required when unread=true',
      });
    }

    const broadcasts = await service.list(query);
    res.json(broadcasts);
  })
);

/**
 * GET /api/broadcasts/:id
 * Get a single broadcast by ID
 */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const service = getBroadcastStorageService();
    const broadcast = await service.getById(id);

    if (!broadcast) {
      throw new NotFoundError('Broadcast not found');
    }

    res.json(broadcast);
  })
);

/**
 * PATCH /api/broadcasts/:id/read
 * Mark a broadcast as read by an agent
 */
router.patch(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const { agent } = markReadSchema.parse(req.body);
    const service = getBroadcastStorageService();

    const success = await service.markRead(id, agent);

    if (!success) {
      throw new NotFoundError('Broadcast not found');
    }

    res.json({ success: true });
  })
);

export { router as broadcastRoutes };
