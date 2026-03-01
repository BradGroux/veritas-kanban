import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { TemplateService } from '../services/template-service.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { NotFoundError, ValidationError } from '../middleware/error-handler.js';

const router: RouterType = Router();
const templateService = new TemplateService();

// Validation schemas
const subtaskTemplateSchema = z.object({
  title: z.string(),
  order: z.number(),
});

const blueprintTaskSchema = z.object({
  refId: z.string(),
  title: z.string(),
  taskDefaults: z.object({
    type: z.string().optional(),
    priority: z.enum(['low', 'medium', 'high']).optional(),
    project: z.string().optional(),
    descriptionTemplate: z.string().optional(),
    agent: z.enum(['claude-code', 'amp', 'copilot', 'gemini', 'veritas']).optional(),
  }),
  subtaskTemplates: z.array(subtaskTemplateSchema).optional(),
  blockedByRefs: z.array(z.string()).optional(),
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
    agent: z.enum(['claude-code', 'amp', 'copilot', 'gemini', 'veritas']).optional(),
  }),
  subtaskTemplates: z.array(subtaskTemplateSchema).optional(),
  blueprint: z.array(blueprintTaskSchema).optional(),
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
      agent: z.enum(['claude-code', 'amp', 'copilot', 'gemini', 'veritas']).optional(),
    })
    .optional(),
  subtaskTemplates: z.array(subtaskTemplateSchema).optional(),
  blueprint: z.array(blueprintTaskSchema).optional(),
});

// GET /api/templates - List all templates
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const templates = await templateService.getTemplates();
    res.json(templates);
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
