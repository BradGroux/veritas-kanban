/**
 * Workflow API Routes — CRUD operations on workflows and workflow runs
 * Phase 1: Core Engine
 */

import { Router } from 'express';
import { z } from 'zod';
import type { WorkflowDefinition } from '../types/workflow.js';
import { getWorkflowService } from '../services/workflow-service.js';
import { getWorkflowRunService } from '../services/workflow-run-service.js';
import { asyncHandler } from '../middleware/async-handler.js';

const router = Router();
const workflowService = getWorkflowService();
const workflowRunService = getWorkflowRunService();

// Helper to extract string param (handles Express types)
function getStringParam(param: string | string[] | undefined): string {
  if (Array.isArray(param)) return param[0];
  return param || '';
}

// Validation schemas
const startRunSchema = z.object({
  taskId: z.string().optional(),
  context: z.record(z.any()).optional(),
});

const resumeRunSchema = z.object({
  context: z.record(z.any()).optional(),
});

// ==================== Workflow CRUD Routes ====================

/**
 * GET /api/workflows — List all workflows
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const workflows = await workflowService.listWorkflows();
    res.json(workflows);
  })
);

/**
 * GET /api/workflows/:id — Get a specific workflow
 */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const workflow = await workflowService.loadWorkflow(getStringParam(req.params.id));
    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }
    res.json(workflow);
  })
);

/**
 * POST /api/workflows — Create a new workflow
 */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const workflow = req.body as WorkflowDefinition;
    await workflowService.saveWorkflow(workflow);
    res.status(201).json({ success: true });
  })
);

/**
 * PUT /api/workflows/:id — Update a workflow
 */
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const workflow = req.body as WorkflowDefinition;

    // Load previous version for versioning
    const previousVersion = await workflowService.loadWorkflow(workflow.id);
    workflow.version = (previousVersion?.version || 0) + 1;

    await workflowService.saveWorkflow(workflow);
    res.json({ success: true });
  })
);

/**
 * DELETE /api/workflows/:id — Delete a workflow
 */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await workflowService.deleteWorkflow(getStringParam(req.params.id));
    res.status(204).send();
  })
);

// ==================== Workflow Run Routes ====================

/**
 * POST /api/workflows/:id/runs — Start a workflow run
 */
router.post(
  '/:id/runs',
  asyncHandler(async (req, res) => {
    const { taskId, context } = startRunSchema.parse(req.body);
    const run = await workflowRunService.startRun(getStringParam(req.params.id), taskId, context);
    res.status(201).json(run);
  })
);

/**
 * GET /api/workflow-runs — List workflow runs
 */
router.get(
  '/runs',
  asyncHandler(async (req, res) => {
    const filters = {
      taskId: typeof req.query.taskId === 'string' ? req.query.taskId : undefined,
      workflowId: typeof req.query.workflowId === 'string' ? req.query.workflowId : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
    };

    const runs = await workflowRunService.listRuns(filters);
    res.json(runs);
  })
);

/**
 * GET /api/workflow-runs/:id — Get a specific workflow run
 */
router.get(
  '/runs/:id',
  asyncHandler(async (req, res) => {
    const run = await workflowRunService.getRun(getStringParam(req.params.id));
    if (!run) {
      return res.status(404).json({ error: 'Workflow run not found' });
    }
    res.json(run);
  })
);

/**
 * POST /api/workflow-runs/:id/resume — Resume a blocked workflow run
 */
router.post(
  '/runs/:id/resume',
  asyncHandler(async (req, res) => {
    const { context } = resumeRunSchema.parse(req.body || {});
    const resumed = await workflowRunService.resumeRun(getStringParam(req.params.id), context);
    res.json(resumed);
  })
);

export { router as workflowRoutes };
