import { Router, type Router as RouterType } from 'express';
import type {
  EvidenceTimelineEventSource,
  EvidenceTimelineEventType,
  EvidenceTimelineFilters,
} from '@veritas-kanban/shared';
import { asyncHandler } from '../middleware/async-handler.js';
import { qNumD, qStr } from '../lib/query-helpers.js';
import { EvidenceTimelineService } from '../services/evidence-timeline-service.js';

const router: RouterType = Router();

const EVENT_TYPES = new Set<EvidenceTimelineEventType>([
  'task',
  'status',
  'comment',
  'time',
  'agent_run',
  'telemetry',
  'work_product',
  'deliverable',
  'github',
  'attachment',
  'observation',
]);

const EVENT_SOURCES = new Set<EvidenceTimelineEventSource>([
  'task',
  'activity',
  'status-history',
  'telemetry',
  'work-product',
  'deliverable',
]);

router.get(
  '/timeline',
  asyncHandler(async (req, res) => {
    const type = qStr(req.query.type);
    const source = qStr(req.query.source);
    const filters: EvidenceTimelineFilters = {
      taskId: qStr(req.query.taskId),
      project: qStr(req.query.project),
      repo: qStr(req.query.repo),
      cwd: qStr(req.query.cwd),
      from: qStr(req.query.from),
      to: qStr(req.query.to),
      actor: qStr(req.query.actor),
      page: qNumD(req.query.page, 1),
      limit: qNumD(req.query.limit, 50),
    };

    if (type && EVENT_TYPES.has(type as EvidenceTimelineEventType)) {
      filters.type = type as EvidenceTimelineEventType;
    }
    if (source && EVENT_SOURCES.has(source as EvidenceTimelineEventSource)) {
      filters.source = source as EvidenceTimelineEventSource;
    }

    const service = new EvidenceTimelineService();
    res.json(await service.getTimeline(filters));
  })
);

export { router as evidenceRoutes };
