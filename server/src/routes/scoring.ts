import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/async-handler.js';
import { BadRequestError, NotFoundError, ValidationError } from '../middleware/error-handler.js';
import { scoringService } from '../services/scoring-service.js';
import { paramStr, qNum, qStr } from '../lib/query-helpers.js';

const router: RouterType = Router();

const scorerSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    weight: z.number().min(0),
    target: z.enum(['action', 'output', 'combined']).optional(),
    type: z.literal('RegexMatch'),
    pattern: z.string().min(1),
    flags: z.string().optional(),
    scoreOnMatch: z.number().min(0).max(1).optional(),
    scoreOnMiss: z.number().min(0).max(1).optional(),
    invert: z.boolean().optional(),
  }),
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    weight: z.number().min(0),
    target: z.enum(['action', 'output', 'combined']).optional(),
    type: z.literal('KeywordContains'),
    keywords: z.array(z.string().min(1)).min(1),
    matchMode: z.enum(['all', 'any']).optional(),
    caseSensitive: z.boolean().optional(),
    partialCredit: z.boolean().optional(),
  }),
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    weight: z.number().min(0),
    target: z.enum(['action', 'output', 'combined']).optional(),
    type: z.literal('NumericRange'),
    valuePath: z.string().min(1),
    min: z.number().optional(),
    max: z.number().optional(),
    scoreOnMiss: z.number().min(0).max(1).optional(),
  }),
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    weight: z.number().min(0),
    target: z.enum(['action', 'output', 'combined']).optional(),
    type: z.literal('CustomExpression'),
    expression: z.string().min(1),
  }),
]);

const createProfileSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  scorers: z.array(scorerSchema).min(1),
  compositeMethod: z.enum(['weightedAvg', 'minimum', 'geometricMean']),
});

const updateProfileSchema = createProfileSchema.partial();

const evaluateSchema = z.object({
  profileId: z.string().min(1),
  action: z.string().optional(),
  output: z.string().min(1),
  agent: z.string().optional(),
  taskId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
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

router.get(
  '/profiles',
  asyncHandler(async (_req, res) => {
    const profiles = await scoringService.listProfiles();
    res.json(profiles);
  })
);

router.get(
  '/profiles/:id',
  asyncHandler(async (req, res) => {
    const profile = await scoringService.getProfile(paramStr(req.params.id));
    if (!profile) {
      throw new NotFoundError('Scoring profile not found');
    }
    res.json(profile);
  })
);

router.post(
  '/profiles',
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(createProfileSchema, req.body);
    const profile = await scoringService.createProfile(input);
    res.status(201).json(profile);
  })
);

router.put(
  '/profiles/:id',
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(updateProfileSchema, req.body);
    let profile;
    try {
      profile = await scoringService.updateProfile(paramStr(req.params.id), input);
    } catch (error) {
      if (error instanceof Error && error.message.includes('Built-in')) {
        throw new BadRequestError(error.message);
      }
      throw error;
    }
    if (!profile) {
      throw new NotFoundError('Scoring profile not found');
    }
    res.json(profile);
  })
);

router.delete(
  '/profiles/:id',
  asyncHandler(async (req, res) => {
    try {
      const deleted = await scoringService.deleteProfile(paramStr(req.params.id));
      if (!deleted) {
        throw new NotFoundError('Scoring profile not found');
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('Built-in')) {
        throw new BadRequestError(error.message);
      }
      throw error;
    }
    res.status(204).send();
  })
);

router.post(
  '/evaluate',
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(evaluateSchema, req.body);
    const result = await scoringService.evaluate(input);
    res.status(201).json(result);
  })
);

router.get(
  '/history',
  asyncHandler(async (req, res) => {
    const limit = qNum(req.query.limit);
    const history = await scoringService.getHistory({
      profileId: qStr(req.query.profileId),
      agent: qStr(req.query.agent),
      taskId: qStr(req.query.taskId),
      limit: limit && limit > 0 ? limit : undefined,
    });
    res.json(history);
  })
);

export { router as scoringRoutes };
