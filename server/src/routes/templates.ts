import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { TemplateService } from '../services/template-service.js';
import { getSessionTemplateService } from '../services/session-template-service.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { NotFoundError, ValidationError } from '../middleware/error-handler.js';

const router: RouterType = Router();
const templateService = new TemplateService();
const sessionTemplateService = getSessionTemplateService();

// Validation schemas
const subtaskTemplateSchema = z.object({
  title: z.string(),
  order: z.number(),
  acceptanceCriteria: z.array(z.string()).optional(),
});

const blueprintTaskSchema = z.object({
  refId: z.string(),
  title: z.string(),
  taskDefaults: z.object({
    type: z.string().optional(),
    priority: z.enum(['low', 'medium', 'high']).optional(),
    project: z.string().optional(),
    descriptionTemplate: z.string().optional(),
    agent: z.string().min(1).max(80).optional(),
  }),
  subtaskTemplates: z.array(subtaskTemplateSchema).optional(),
  blockedByRefs: z.array(z.string()).optional(),
});

const provenanceLinkSchema = z.object({
  type: z.enum(['run', 'workflow', 'task', 'issue', 'timeline', 'artifact']),
  id: z.string().min(1).max(300),
  label: z.string().max(300).optional(),
  url: z.string().max(1000).optional(),
  path: z.string().max(1000).optional(),
});

const launchMetadataSchema = z.object({
  status: z.enum(['draft', 'active', 'archived']),
  distilledFromRunId: z.string().max(120).optional(),
  sourceWorkflowId: z.string().max(120).optional(),
  sourceTaskId: z.string().max(120).optional(),
  promptTemplate: z.string().max(12000).optional(),
  contextRequirements: z.array(z.string().max(300)).max(50).optional(),
  session: z
    .object({
      agent: z.string().max(80).optional(),
      model: z.string().max(120).optional(),
      provider: z.string().max(80).optional(),
      hostId: z.string().max(120).optional(),
      hostName: z.string().max(200).optional(),
      cwd: z.string().max(1000).optional(),
      project: z.string().max(200).optional(),
      sandbox: z.string().max(120).optional(),
      mode: z.enum(['fresh', 'reuse']).optional(),
      context: z.enum(['minimal', 'full', 'custom']).optional(),
      cleanup: z.enum(['delete', 'keep']).optional(),
      timeout: z.number().int().positive().max(86400).optional(),
      includeOutputsFrom: z.array(z.string().max(120)).max(50).optional(),
    })
    .optional(),
  verificationGates: z.array(z.string().max(500)).max(50).optional(),
  expectedArtifacts: z.array(z.string().max(500)).max(50).optional(),
  knownGotchas: z.array(z.string().max(500)).max(50).optional(),
  reasonCodes: z.array(z.string().max(120)).max(50).optional(),
  confidence: z.number().min(0).max(1).optional(),
  provenance: z.array(provenanceLinkSchema).max(100).optional(),
  inheritsProjectDefaults: z.boolean().optional(),
  reviewedAt: z.string().max(120).optional(),
  reviewedBy: z.string().max(120).optional(),
});

const createTemplateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  taskDefaults: z.object({
    type: z.string().optional(),
    priority: z.enum(['low', 'medium', 'high']).optional(),
    project: z.string().optional(),
    descriptionTemplate: z.string().optional(),
    agent: z.string().min(1).max(80).optional(),
  }),
  subtaskTemplates: z.array(subtaskTemplateSchema).optional(),
  blueprint: z.array(blueprintTaskSchema).optional(),
  launch: launchMetadataSchema.optional(),
});

const updateTemplateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  taskDefaults: z
    .object({
      type: z.string().optional(),
      priority: z.enum(['low', 'medium', 'high']).optional(),
      project: z.string().optional(),
      descriptionTemplate: z.string().optional(),
      agent: z.string().min(1).max(80).optional(),
    })
    .optional(),
  subtaskTemplates: z.array(subtaskTemplateSchema).optional(),
  blueprint: z.array(blueprintTaskSchema).optional(),
  launch: launchMetadataSchema.optional(),
});

const distillTemplateFromRunSchema = z.object({
  runId: z.string().min(1).max(120),
  name: z.string().min(1).max(200).optional(),
});

// GET /api/templates - List all templates
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const templates = await templateService.getTemplates();
    res.json(templates);
  })
);

// POST /api/templates/distill-from-run - Create a review-required draft template from a completed run
router.post(
  '/distill-from-run',
  asyncHandler(async (req, res) => {
    let input;
    try {
      input = distillTemplateFromRunSchema.parse(req.body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.issues);
      }
      throw error;
    }

    const template = await sessionTemplateService.distillTemplateFromRun(input);
    res.status(201).json(template);
  })
);

// GET /api/templates/:id - Get single template
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const template = await templateService.getTemplate(req.params.id as string);
    if (!template) {
      throw new NotFoundError('Template not found');
    }
    res.json(template);
  })
);

// POST /api/templates - Create template
router.post(
  '/',
  asyncHandler(async (req, res) => {
    let input;
    try {
      input = createTemplateSchema.parse(req.body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.issues);
      }
      throw error;
    }
    const template = await templateService.createTemplate(input);
    res.status(201).json(template);
  })
);

// PATCH /api/templates/:id - Update template
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    let input;
    try {
      input = updateTemplateSchema.parse(req.body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.issues);
      }
      throw error;
    }
    const template = await templateService.updateTemplate(req.params.id as string, input);
    if (!template) {
      throw new NotFoundError('Template not found');
    }
    res.json(template);
  })
);

// DELETE /api/templates/:id - Delete template
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const deleted = await templateService.deleteTemplate(req.params.id as string);
    if (!deleted) {
      throw new NotFoundError('Template not found');
    }
    res.status(204).send();
  })
);

export default router;
