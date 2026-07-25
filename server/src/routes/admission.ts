import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import {
  ADMISSION_LAUNCH_SOURCES,
  ADMISSION_QUEUE_STATES,
  ADMISSION_SCOPES,
} from '@veritas-kanban/shared';
import { asyncHandler } from '../middleware/async-handler.js';
import { ValidationError } from '../middleware/error-handler.js';
import { AdmissionReservationListQuerySchema } from '../schemas/admission-control-schemas.js';
import { getAdmissionControlService } from '../services/admission-control-service.js';

const router: RouterType = Router();
const admission = getAdmissionControlService();

const listQuerySchema = z
  .object({
    workspaceId: z.string().trim().min(1).max(240).optional(),
    taskId: z.string().trim().min(1).max(240).optional(),
    rootTaskId: z.string().trim().min(1).max(240).optional(),
    provider: z.string().trim().min(1).max(80).optional(),
    hostId: z.string().trim().min(1).max(240).optional(),
    workflowRunId: z.string().trim().min(1).max(240).optional(),
    workflowStepId: z.string().trim().min(1).max(240).optional(),
    rootReservationId: z.string().trim().min(1).max(240).optional(),
    rootObjectiveId: z.string().trim().min(1).max(240).optional(),
    nodeId: z.string().trim().min(1).max(240).optional(),
    parentNodeId: z.string().trim().min(1).max(240).optional(),
    state: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .transform((value) =>
        value === undefined ? undefined : Array.isArray(value) ? value : value.split(',')
      ),
    limit: z.coerce.number().int().min(1).max(1_000).optional(),
  })
  .strict();

const queueListQuerySchema = z
  .object({
    workspaceId: z.string().trim().min(1).max(240).optional(),
    rootObjectiveId: z.string().trim().min(1).max(240).optional(),
    nodeId: z.string().trim().min(1).max(240).optional(),
    source: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .transform((value) =>
        value === undefined ? undefined : Array.isArray(value) ? value : value.split(',')
      )
      .pipe(
        z.array(z.enum(ADMISSION_LAUNCH_SOURCES)).max(ADMISSION_LAUNCH_SOURCES.length).optional()
      ),
    state: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .transform((value) =>
        value === undefined ? undefined : Array.isArray(value) ? value : value.split(',')
      )
      .pipe(z.array(z.enum(ADMISSION_QUEUE_STATES)).max(ADMISSION_QUEUE_STATES.length).optional()),
    priority: z.coerce.number().int().min(0).max(15).optional(),
    limitingScope: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .transform((value) =>
        value === undefined ? undefined : Array.isArray(value) ? value : value.split(',')
      )
      .pipe(z.array(z.enum(ADMISSION_SCOPES)).max(ADMISSION_SCOPES.length).optional()),
    minAgeMs: z.coerce.number().int().min(0).max(31_536_000_000).optional(),
    maxAgeMs: z.coerce.number().int().min(0).max(31_536_000_000).optional(),
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.minAgeMs !== undefined &&
      value.maxAgeMs !== undefined &&
      value.minAgeMs > value.maxAgeMs
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'minAgeMs must be less than or equal to maxAgeMs',
        path: ['minAgeMs'],
      });
    }
  });

router.get(
  '/queue',
  asyncHandler(async (req, res) => {
    try {
      const query = queueListQuerySchema.parse(req.query);
      res.json(
        await admission.inspectQueue({
          workspaceId: query.workspaceId,
          rootObjectiveId: query.rootObjectiveId,
          nodeId: query.nodeId,
          sources: query.source,
          states: query.state,
          priority: query.priority,
          limitingScopes: query.limitingScope,
          minAgeMs: query.minAgeMs,
          maxAgeMs: query.maxAgeMs,
          page: query.page,
          limit: query.limit,
        })
      );
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.issues);
      }
      throw error;
    }
  })
);

router.get(
  '/queue/:id',
  asyncHandler(async (req, res) => {
    try {
      const id = z.string().trim().min(1).max(240).parse(req.params.id);
      res.json(await admission.inspectQueueEntry(id));
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.issues);
      }
      throw error;
    }
  })
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    try {
      const raw = listQuerySchema.parse(req.query);
      const query = AdmissionReservationListQuerySchema.parse({
        workspaceId: raw.workspaceId,
        taskId: raw.taskId,
        rootTaskId: raw.rootTaskId,
        provider: raw.provider,
        hostId: raw.hostId,
        workflowRunId: raw.workflowRunId,
        workflowStepId: raw.workflowStepId,
        rootReservationId: raw.rootReservationId,
        rootObjectiveId: raw.rootObjectiveId,
        nodeId: raw.nodeId,
        parentNodeId: raw.parentNodeId,
        states: raw.state,
        limit: raw.limit,
      });
      res.json({
        generatedAt: new Date().toISOString(),
        reservations: await admission.list(query),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.issues);
      }
      throw error;
    }
  })
);

router.get(
  '/tree/:rootObjectiveId',
  asyncHandler(async (req, res) => {
    try {
      const rootObjectiveId = z.string().trim().min(1).max(240).parse(req.params.rootObjectiveId);
      const limit = z.coerce.number().int().min(1).max(1_000).default(100).parse(req.query.limit);
      res.json(await admission.getExecutionTreeSummary(rootObjectiveId, limit));
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.issues);
      }
      throw error;
    }
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    try {
      const id = z.string().trim().min(1).max(240).parse(req.params.id);
      res.json(await admission.get(id));
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.issues);
      }
      throw error;
    }
  })
);

export { router as admissionRoutes };
