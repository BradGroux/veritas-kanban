import { Router, type Router as RouterType } from 'express';
import type { TimeBreakdownFilters, TimeBreakdownPreset } from '@veritas-kanban/shared';
import { asyncHandler } from '../middleware/async-handler.js';
import { qNumD, qStr } from '../lib/query-helpers.js';
import { TimeBreakdownService } from '../services/time-breakdown-service.js';

const router: RouterType = Router();

const PRESETS = new Set<TimeBreakdownPreset>(['daily', 'weekly', 'monthly', 'custom']);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const preset = qStr(req.query.preset);
    const filters: TimeBreakdownFilters = {
      from: qStr(req.query.from),
      to: qStr(req.query.to),
      taskId: qStr(req.query.taskId),
      project: qStr(req.query.project),
      repo: qStr(req.query.repo),
      cwd: qStr(req.query.cwd),
      actor: qStr(req.query.actor),
      includeInferred: qBoolD(req.query.includeInferred, true),
      limit: qNumD(req.query.limit, 200),
    };

    if (preset && PRESETS.has(preset as TimeBreakdownPreset)) {
      filters.preset = preset as TimeBreakdownPreset;
    }

    const service = new TimeBreakdownService();
    res.json(await service.generate(filters));
  })
);

export { router as timeBreakdownRoutes };

function qBoolD(value: unknown, defaultValue: boolean): boolean {
  const raw = qStr(value);
  if (raw === undefined) return defaultValue;
  return raw !== 'false' && raw !== '0';
}
