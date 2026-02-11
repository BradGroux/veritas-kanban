/**
 * Documentation Freshness API Routes
 *
 * GET    /api/doc-freshness                 — List tracked documents
 * GET    /api/doc-freshness/:id             — Get one tracked document
 * POST   /api/doc-freshness                 — Track a new document
 * PATCH  /api/doc-freshness/:id             — Update metadata
 * DELETE /api/doc-freshness/:id             — Stop tracking
 * POST   /api/doc-freshness/:id/review      — Mark as freshly reviewed
 * GET    /api/doc-freshness/alerts          — List freshness alerts
 * POST   /api/doc-freshness/alerts/:id/acknowledge — Acknowledge an alert
 * GET    /api/doc-freshness/summary         — Freshness health summary
 */

import { Router, type Router as RouterType } from 'express';
import { asyncHandler } from '../middleware/async-handler.js';
import { NotFoundError } from '../middleware/error-handler.js';
import {
  AcknowledgeAlertSchema,
  CreateTrackedDocumentSchema,
  DocAlertSeveritySchema,
  ReviewDocumentSchema,
  UpdateTrackedDocumentSchema,
} from '../schemas/doc-freshness-schemas.js';
import { getDocFreshnessService } from '../services/doc-freshness-service.js';
import type { TrackedDocument } from '@veritas-kanban/shared';

const router: RouterType = Router();
/**
 * GET /api/doc-freshness
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const service = getDocFreshnessService();
    const project = typeof req.query.project === 'string' ? req.query.project : undefined;
    const type = typeof req.query.type === 'string' ? req.query.type : undefined;
    const stale = typeof req.query.stale === 'string' && req.query.stale === 'true';

    const documents = await service.listDocuments({
      project,
      type: type as TrackedDocument['type'] | undefined,
      stale,
    });
    res.json(documents);
  })
);

/**
 * GET /api/doc-freshness/summary
 */
router.get(
  '/summary',
  asyncHandler(async (_req, res) => {
    const service = getDocFreshnessService();
    await service.scanForAlerts();
    const summary = await service.getSummary();
    res.json(summary);
  })
);

/**
 * GET /api/doc-freshness/alerts
 */
router.get(
  '/alerts',
  asyncHandler(async (req, res) => {
    const service = getDocFreshnessService();
    await service.scanForAlerts();
    const severityParam = typeof req.query.severity === 'string' ? req.query.severity : undefined;
    const acknowledgedParam =
      typeof req.query.acknowledged === 'string' ? req.query.acknowledged : undefined;

    const alerts = await service.listAlerts({
      severity: severityParam ? DocAlertSeveritySchema.parse(severityParam) : undefined,
      acknowledged: acknowledgedParam ? acknowledgedParam === 'true' : undefined,
    });
    res.json(alerts);
  })
);

/**
 * POST /api/doc-freshness
 */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const payload = CreateTrackedDocumentSchema.parse(req.body);
    const service = getDocFreshnessService();
    const document = await service.createDocument(payload);
    res.status(201).json(document);
  })
);

/**
 * GET /api/doc-freshness/:id
 */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const service = getDocFreshnessService();
    const document = await service.getDocument(id);
    if (!document) throw new NotFoundError('Tracked document not found');
    res.json(document);
  })
);

/**
 * PATCH /api/doc-freshness/:id
 */
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const update = UpdateTrackedDocumentSchema.parse(req.body);
    const service = getDocFreshnessService();
    const document = await service.updateDocument(id, update);
    if (!document) throw new NotFoundError('Tracked document not found');
    res.json(document);
  })
);

/**
 * DELETE /api/doc-freshness/:id
 */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const service = getDocFreshnessService();
    const success = await service.deleteDocument(id);
    if (!success) throw new NotFoundError('Tracked document not found');
    res.json({ success: true });
  })
);

/**
 * POST /api/doc-freshness/:id/review
 */
router.post(
  '/:id/review',
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const payload = ReviewDocumentSchema.parse(req.body || {});
    const service = getDocFreshnessService();
    const document = await service.markReviewed(id, payload.reviewer, payload.reviewedAt);
    if (!document) throw new NotFoundError('Tracked document not found');
    res.json(document);
  })
);

/**
 * POST /api/doc-freshness/alerts/:id/acknowledge
 */
router.post(
  '/alerts/:id/acknowledge',
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const payload = AcknowledgeAlertSchema.parse(req.body || {});
    const service = getDocFreshnessService();
    const alert = await service.acknowledgeAlert(id, payload.acknowledgedBy);
    if (!alert) throw new NotFoundError('Alert not found');
    res.json(alert);
  })
);

export { router as docFreshnessRoutes };
