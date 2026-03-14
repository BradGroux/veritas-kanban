/**
 * Error Learning API Routes
 *
 * POST   /api/errors/submit            — Submit an error for analysis
 * PATCH  /api/errors/:id               — Update analysis with root cause + fix
 * GET    /api/errors                    — List analyses (filterable)
 * GET    /api/errors/stats              — Aggregate error pattern stats
 * GET    /api/errors/search             — Search for similar past errors
 * GET    /api/errors/:id               — Get specific analysis
 */

import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { getErrorLearningService, type ErrorType } from '../services/error-learning-service.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { qStr, qStrD, qNum } from '../lib/query-helpers.js';
import { NotFoundError } from '../middleware/error-handler.js';

const router: RouterType = Router();

// ─── Validation Schemas ──────────────────────────────────────────

const submitErrorSchema = z.object({
  taskId: z.string().optional(),
  agent: z.string().optional(),
  errorMessage: z.string().min(1),
  errorType: z
    .enum([
      'runtime',
      'api',
      'validation',
      'timeout',
      'permission',
      'resource',
      'model',
      'git',
      'build',
      'test',
      'configuration',
      'unknown',
    ])
    .optional(),
  rawDetails: z.string().optional(),
  attemptDescription: z.string().optional(),
});

const updateAnalysisSchema = z.object({
  rootCause: z.string().optional(),
  summary: z.string().optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  optionsConsidered: z
    .array(
      z.object({
        option: z.string(),
        pros: z.array(z.string()),
        cons: z.array(z.string()),
        chosen: z.boolean(),
      })
    )
    .optional(),
  chosenFix: z.string().optional(),
  preventionSteps: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  analyzedBy: z.string().optional(),
});

// ─── Routes ──────────────────────────────────────────────────────

/**
 * POST /api/errors/submit
 * Submit an error for structured analysis
 */
router.post(
  '/submit',
  asyncHandler(async (req, res) => {
    const data = submitErrorSchema.parse(req.body);
    const service = getErrorLearningService();
    const analysis = await service.submitError(data);
    res.status(201).json(analysis);
  })
);

/**
 * GET /api/errors/stats
 * Aggregate error pattern statistics
 */
router.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const service = getErrorLearningService();
    const stats = await service.getStats();
    res.json(stats);
  })
);

/**
 * GET /api/errors/search?q=<query>
 * Search for similar past errors
 */
router.get(
  '/search',
  asyncHandler(async (req, res) => {
    const q = qStrD(req.query.q, '');
    if (!q) {
      return res.json([]);
    }
    const service = getErrorLearningService();
    const results = await service.searchSimilar(q, qNum(req.query.limit) ?? 5);
    res.json(results);
  })
);

/**
 * GET /api/errors
 * List error analyses with optional filters
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const service = getErrorLearningService();
    const results = await service.listAnalyses({
      taskId: qStr(req.query.taskId),
      errorType: qStr(req.query.errorType) as ErrorType | undefined,
      severity: qStr(req.query.severity),
      agent: qStr(req.query.agent),
      limit: qNum(req.query.limit),
    });
    res.json(results);
  })
);

/**
 * GET /api/errors/:id
 * Get a specific error analysis
 */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const service = getErrorLearningService();
    const analysis = await service.getAnalysis(String(req.params.id));
    if (!analysis) throw new NotFoundError('Error analysis not found');
    res.json(analysis);
  })
);

/**
 * PATCH /api/errors/:id
 * Update analysis with root cause, fix, and prevention steps
 */
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const update = updateAnalysisSchema.parse(req.body);
    const service = getErrorLearningService();
    const analysis = await service.updateAnalysis(String(req.params.id), update);
    if (!analysis) throw new NotFoundError('Error analysis not found');
    res.json(analysis);
  })
);

export { router as errorLearningRoutes };
