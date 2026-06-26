import { Router, type Router as RouterType } from 'express';
import { getSchedulerService } from '../services/scheduler-service.js';
import { asyncHandler } from '../middleware/async-handler.js';

const router: RouterType = Router();

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json(await getSchedulerService().list());
  })
);

router.get(
  '/items/:itemId',
  asyncHandler(async (req, res) => {
    res.json(await getSchedulerService().getItem(String(req.params.itemId)));
  })
);

router.post(
  '/items/:itemId/run',
  asyncHandler(async (req, res) => {
    res.json(await getSchedulerService().runItem(String(req.params.itemId), 'manual-run'));
  })
);

router.post(
  '/items/:itemId/pause',
  asyncHandler(async (req, res) => {
    res.json(await getSchedulerService().pause(String(req.params.itemId)));
  })
);

router.post(
  '/items/:itemId/resume',
  asyncHandler(async (req, res) => {
    res.json(await getSchedulerService().resume(String(req.params.itemId)));
  })
);

router.post(
  '/items/:itemId/validate',
  asyncHandler(async (req, res) => {
    res.json(await getSchedulerService().validate(String(req.params.itemId)));
  })
);

router.post(
  '/due/run',
  asyncHandler(async (_req, res) => {
    res.json(await getSchedulerService().runDue());
  })
);

export { router as schedulerRoutes };
