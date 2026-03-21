import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/async-handler.js';
import { BadRequestError, NotFoundError, ValidationError } from '../middleware/error-handler.js';
import { feedbackService } from '../services/feedback-service.js';
import { paramStr, qNum, qStr } from '../lib/query-helpers.js';

const router: RouterType = Router();

const CATEGORIES = ['quality', 'performance', 'accuracy', 'safety', 'ux'] as const;
const SENTIMENTS = ['positive', 'neutral', 'negative'] as const;

const createFeedbackSchema = z.object({
  taskId: z.string().min(1),
  agent: z.string().optional(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(5000).optional(),
  categories: z.array(z.enum(CATEGORIES)).optional(),
});

const updateFeedbackSchema = z.object({
  rating: z.number().int().min(1).max(5).optional(),
  comment: z.string().max(5000).optional(),
  categories: z.array(z.enum(CATEGORIES)).optional(),
  resolved: z.boolean().optional(),
});

const parseOrThrow = <T>(schema: z.ZodType<T>, value: unknown): T => {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ValidationError('Validation failed', error.issues);
    }
    throw error;
  }
};

// ─── List feedback ────────────────────────────────────────────────────────────

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = qNum(req.query.limit);
    const resolvedRaw = qStr(req.query.resolved);
    const resolved =
      resolvedRaw === 'true' ? true : resolvedRaw === 'false' ? false : undefined;

    const items = await feedbackService.list({
      taskId: qStr(req.query.taskId),
      agent: qStr(req.query.agent),
      category: qStr(req.query.category) as (typeof CATEGORIES)[number] | undefined,
      sentiment: qStr(req.query.sentiment) as (typeof SENTIMENTS)[number] | undefined,
      resolved,
      since: qStr(req.query.since),
      until: qStr(req.query.until),
      limit: limit && limit > 0 ? limit : undefined,
    });

    res.json(items);
  })
);

// ─── Analytics ────────────────────────────────────────────────────────────────

router.get(
  '/analytics',
  asyncHandler(async (req, res) => {
    const analytics = await feedbackService.getAnalytics({
      taskId: qStr(req.query.taskId),
      agent: qStr(req.query.agent),
      category: qStr(req.query.category) as (typeof CATEGORIES)[number] | undefined,
      sentiment: qStr(req.query.sentiment) as (typeof SENTIMENTS)[number] | undefined,
      since: qStr(req.query.since),
      until: qStr(req.query.until),
    });
    res.json(analytics);
  })
);

// ─── Unresolved queue ─────────────────────────────────────────────────────────

router.get(
  '/unresolved',
  asyncHandler(async (req, res) => {
    const limit = qNum(req.query.limit);
    const items = await feedbackService.listUnresolved(limit && limit > 0 ? limit : 100);
    res.json(items);
  })
);

// ─── Get single ───────────────────────────────────────────────────────────────

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const item = await feedbackService.get(paramStr(req.params.id));
    if (!item) throw new NotFoundError('Feedback not found');
    res.json(item);
  })
);

// ─── Create ───────────────────────────────────────────────────────────────────

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(createFeedbackSchema, req.body);
    const item = await feedbackService.create(input);
    res.status(201).json(item);
  })
);

// ─── Update ───────────────────────────────────────────────────────────────────

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(updateFeedbackSchema, req.body);
    const item = await feedbackService.update(paramStr(req.params.id), input);
    if (!item) throw new NotFoundError('Feedback not found');
    res.json(item);
  })
);

// ─── Delete ───────────────────────────────────────────────────────────────────

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const deleted = await feedbackService.delete(paramStr(req.params.id));
    if (!deleted) throw new NotFoundError('Feedback not found');
    res.status(204).send();
  })
);

export { router as feedbackRoutes };
