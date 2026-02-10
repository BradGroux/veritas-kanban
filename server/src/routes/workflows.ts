/**
 * Workflow API Routes — CRUD operations on workflows and workflow runs
 * Phase 1: Core Engine with RBAC and audit logging
 */

import { Router } from 'express';
import { z } from 'zod';
import type { WorkflowDefinition, WorkflowACL } from '../types/workflow.js';
import { getWorkflowService } from '../services/workflow-service.js';
import { getWorkflowRunService } from '../services/workflow-run-service.js';
import { asyncHandler } from '../middleware/async-handler.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { NotFoundError, ValidationError, BadRequestError } from '../middleware/error-handler.js';
import { checkWorkflowPermission, assertWorkflowPermission } from '../middleware/workflow-auth.js';
import { diffWorkflows } from '../utils/workflow-diff.js';

const router = Router();
const workflowService = getWorkflowService();
const workflowRunService = getWorkflowRunService();

// Helper to extract string param (handles Express types)
function getStringParam(param: string | string[] | undefined): string {
  if (Array.isArray(param)) return param[0];
  return param || '';
}

// Helper to get user ID from request
function getUserId(req: AuthenticatedRequest): string {
  return req.auth?.keyName || 'unknown';
}

// Validation schemas
const startRunSchema = z.object({
  taskId: z.string().optional(),
  context: z.record(z.unknown()).optional(),
});

const resumeRunSchema = z.object({
  context: z.record(z.unknown()).optional(),
});

// Basic input validation - detailed validation happens in WorkflowService
const workflowCreateSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  version: z.number().int().min(0),
  description: z.string().max(2000),
  config: z.unknown().optional(),
  agents: z.array(z.unknown()).min(1).max(20),
  steps: z.array(z.unknown()).min(1).max(50),
  variables: z.record(z.unknown()).optional(),
  schemas: z.record(z.unknown()).optional(),
});

// ==================== Workflow CRUD Routes ====================

/**
 * GET /api/workflows — List all workflows (filtered by user permissions)
 * Returns metadata only for efficiency
 */
router.get(
  '/',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const userId = getUserId(req);
    const allWorkflows = await workflowService.listWorkflowsMetadata();

    // Filter by permissions
    const visibleWorkflows = [];
    for (const workflow of allWorkflows) {
      const hasPermission = await checkWorkflowPermission(workflow.id, userId, 'view');
      if (hasPermission) {
        visibleWorkflows.push(workflow);
      }
    }

    res.json(visibleWorkflows);
  })
);

/**
 * GET /api/workflows/:id — Get a specific workflow
 */
router.get(
  '/:id',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const workflowId = getStringParam(req.params.id);
    const userId = getUserId(req);

    const workflow = await workflowService.loadWorkflow(workflowId);
    if (!workflow) {
      throw new NotFoundError(`Workflow ${workflowId} not found`);
    }

    // Check view permission
    await assertWorkflowPermission(workflowId, userId, 'view');

    res.json(workflow);
  })
);

/**
 * POST /api/workflows — Create a new workflow
 */
router.post(
  '/',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const userId = getUserId(req);

    // Validate input
    const workflow = workflowCreateSchema.parse(req.body) as WorkflowDefinition;

    // Save workflow
    await workflowService.saveWorkflow(workflow);

    // Create ACL entry (owner = current user)
    const acl: WorkflowACL = {
      workflowId: workflow.id,
      owner: userId,
      editors: [],
      viewers: [],
      executors: [],
      isPublic: false,
    };
    await workflowService.saveACL(acl);

    // Audit log
    await workflowService.auditChange({
      timestamp: new Date().toISOString(),
      userId,
      action: 'create',
      workflowId: workflow.id,
      workflowVersion: workflow.version,
    });

    res.status(201).json({ success: true, workflowId: workflow.id });
  })
);

/**
 * PUT /api/workflows/:id — Update a workflow
 */
router.put(
  '/:id',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const urlWorkflowId = getStringParam(req.params.id);
    const userId = getUserId(req);

    // Validate input
    const workflow = workflowCreateSchema.parse(req.body) as WorkflowDefinition;

    // Enforce URL ID takes precedence over body ID
    if (workflow.id !== urlWorkflowId) {
      throw new BadRequestError(
        `Workflow ID mismatch: URL specifies '${urlWorkflowId}' but body contains '${workflow.id}'`
      );
    }

    // Check edit permission
    await assertWorkflowPermission(urlWorkflowId, userId, 'edit');

    // Load previous version for versioning and change tracking
    const previousVersion = await workflowService.loadWorkflow(workflow.id);
    workflow.version = (previousVersion?.version || 0) + 1;

    // Save workflow
    await workflowService.saveWorkflow(workflow);

    // Audit log with changes
    await workflowService.auditChange({
      timestamp: new Date().toISOString(),
      userId,
      action: 'edit',
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      changes: diffWorkflows(previousVersion, workflow),
    });

    res.json({ success: true, version: workflow.version });
  })
);

/**
 * DELETE /api/workflows/:id — Delete a workflow
 */
router.delete(
  '/:id',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const workflowId = getStringParam(req.params.id);
    const userId = getUserId(req);

    // Check delete permission (owner only)
    await assertWorkflowPermission(workflowId, userId, 'delete');

    // Delete workflow
    await workflowService.deleteWorkflow(workflowId);

    // Audit log
    await workflowService.auditChange({
      timestamp: new Date().toISOString(),
      userId,
      action: 'delete',
      workflowId,
    });

    res.status(204).send();
  })
);

// ==================== Workflow Run Routes ====================

/**
 * POST /api/workflows/:id/runs — Start a workflow run
 */
router.post(
  '/:id/runs',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const workflowId = getStringParam(req.params.id);
    const userId = getUserId(req);

    // Check execute permission
    await assertWorkflowPermission(workflowId, userId, 'execute');

    // Validate input
    const { taskId, context } = startRunSchema.parse(req.body);

    // Start run
    const run = await workflowRunService.startRun(workflowId, taskId, context);

    // Audit log
    await workflowService.auditChange({
      timestamp: new Date().toISOString(),
      userId,
      action: 'run',
      workflowId,
      workflowVersion: run.workflowVersion,
      runId: run.id,
    });

    res.status(201).json(run);
  })
);

/**
 * GET /api/workflow-runs — List workflow runs (filtered by permissions)
 * Returns metadata only for efficiency
 */
router.get(
  '/runs',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const userId = getUserId(req);

    const filters = {
      taskId: typeof req.query.taskId === 'string' ? req.query.taskId : undefined,
      workflowId: typeof req.query.workflowId === 'string' ? req.query.workflowId : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
    };

    const runs = await workflowRunService.listRunsMetadata(filters);

    // Filter by workflow view permissions
    const visibleRuns = [];
    for (const run of runs) {
      const hasPermission = await checkWorkflowPermission(run.workflowId, userId, 'view');
      if (hasPermission) {
        visibleRuns.push(run);
      }
    }

    res.json(visibleRuns);
  })
);

/**
 * GET /api/workflow-runs/:id — Get a specific workflow run
 */
router.get(
  '/runs/:id',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const runId = getStringParam(req.params.id);
    const userId = getUserId(req);

    const run = await workflowRunService.getRun(runId);
    if (!run) {
      throw new NotFoundError(`Workflow run ${runId} not found`);
    }

    // Check view permission on the workflow
    await assertWorkflowPermission(run.workflowId, userId, 'view');

    res.json(run);
  })
);

/**
 * POST /api/workflow-runs/:id/resume — Resume a blocked workflow run
 */
router.post(
  '/runs/:id/resume',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const runId = getStringParam(req.params.id);
    const userId = getUserId(req);

    const run = await workflowRunService.getRun(runId);
    if (!run) {
      throw new NotFoundError(`Workflow run ${runId} not found`);
    }

    // Check execute permission on the workflow
    await assertWorkflowPermission(run.workflowId, userId, 'execute');

    if (run.status !== 'blocked') {
      throw new ValidationError(`Run ${runId} is not blocked (current status: ${run.status})`);
    }

    // Validate input
    const { context } = resumeRunSchema.parse(req.body || {});

    // Resume run
    const resumed = await workflowRunService.resumeRun(runId, context);

    res.json(resumed);
  })
);

/**
 * POST /api/workflow-runs/:runId/steps/:stepId/approve — Approve a gate step
 * Phase 4: Gate approval endpoint
 */
router.post(
  '/runs/:runId/steps/:stepId/approve',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const runId = getStringParam(req.params.runId);
    const stepId = getStringParam(req.params.stepId);
    const userId = getUserId(req);

    const run = await workflowRunService.getRun(runId);
    if (!run) {
      throw new NotFoundError(`Workflow run ${runId} not found`);
    }

    // Check execute permission on the workflow
    await assertWorkflowPermission(run.workflowId, userId, 'execute');

    // Find the step
    const stepRun = run.steps.find((s) => s.stepId === stepId);
    if (!stepRun) {
      throw new NotFoundError(`Step ${stepId} not found in run ${runId}`);
    }

    if (stepRun.status !== 'failed') {
      throw new ValidationError(
        `Step ${stepId} is not awaiting approval (current status: ${stepRun.status})`
      );
    }

    // Security: Verify this is actually a gate step
    const workflow = await workflowService.loadWorkflow(run.workflowId);
    if (!workflow) {
      throw new NotFoundError(`Workflow ${run.workflowId} not found`);
    }

    const stepDef = workflow.steps.find((s) => s.id === stepId);
    if (!stepDef || stepDef.type !== 'gate') {
      throw new ValidationError(
        `Step ${stepId} is not a gate step (type: ${stepDef?.type || 'unknown'})`
      );
    }

    // Approve: add approval to context and resume
    const approvalContext = {
      ...run.context,
      _gateApproval: {
        stepId,
        approved: true,
        approvedBy: userId,
        approvedAt: new Date().toISOString(),
      },
    };

    const resumed = await workflowRunService.resumeRun(runId, approvalContext);

    res.json(resumed);
  })
);

/**
 * POST /api/workflow-runs/:runId/steps/:stepId/reject — Reject a gate step
 * Phase 4: Gate rejection endpoint
 */
router.post(
  '/runs/:runId/steps/:stepId/reject',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const runId = getStringParam(req.params.runId);
    const stepId = getStringParam(req.params.stepId);
    const userId = getUserId(req);

    const run = await workflowRunService.getRun(runId);
    if (!run) {
      throw new NotFoundError(`Workflow run ${runId} not found`);
    }

    // Check execute permission on the workflow
    await assertWorkflowPermission(run.workflowId, userId, 'execute');

    // Find the step
    const stepRun = run.steps.find((s) => s.stepId === stepId);
    if (!stepRun) {
      throw new NotFoundError(`Step ${stepId} not found in run ${runId}`);
    }

    if (stepRun.status !== 'failed') {
      throw new ValidationError(
        `Step ${stepId} is not awaiting approval (current status: ${stepRun.status})`
      );
    }

    // Security: Verify this is actually a gate step
    const workflow = await workflowService.loadWorkflow(run.workflowId);
    if (!workflow) {
      throw new NotFoundError(`Workflow ${run.workflowId} not found`);
    }

    const stepDef = workflow.steps.find((s) => s.id === stepId);
    if (!stepDef || stepDef.type !== 'gate') {
      throw new ValidationError(
        `Step ${stepId} is not a gate step (type: ${stepDef?.type || 'unknown'})`
      );
    }

    // Reject: mark run as failed
    run.status = 'failed';
    run.error = `Step ${stepId} rejected by ${userId}`;
    run.completedAt = new Date().toISOString();

    // This would be saved by the workflow run service
    // For now, just return the updated run
    res.json(run);
  })
);

/**
 * GET /api/workflow-runs/:runId/steps/:stepId/status — Get detailed step status
 * Phase 4: Step status endpoint (useful for parallel sub-steps)
 */
router.get(
  '/runs/:runId/steps/:stepId/status',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const runId = getStringParam(req.params.runId);
    const stepId = getStringParam(req.params.stepId);
    const userId = getUserId(req);

    const run = await workflowRunService.getRun(runId);
    if (!run) {
      throw new NotFoundError(`Workflow run ${runId} not found`);
    }

    // Check view permission on the workflow
    await assertWorkflowPermission(run.workflowId, userId, 'view');

    // Find the step
    const stepRun = run.steps.find((s) => s.stepId === stepId);
    if (!stepRun) {
      throw new NotFoundError(`Step ${stepId} not found in run ${runId}`);
    }

    res.json(stepRun);
  })
);

export { router as workflowRoutes };
