import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { ConfigService } from '../services/config-service.js';
import type { RepoConfig, AgentConfig, AgentType } from '@veritas-kanban/shared';
import { asyncHandler } from '../middleware/async-handler.js';
import { ValidationError, BadRequestError } from '../middleware/error-handler.js';
import { authorize } from '../middleware/auth.js';

const router: RouterType = Router();
const configService = new ConfigService();

// Validation schemas
const repoSchema = z.object({
  name: z.string().min(1).max(50),
  path: z.string().min(1),
  defaultBranch: z.string().min(1).default('main'),
});

const agentSchema = z.object({
  type: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Agent type must be lowercase alphanumeric with dashes'),
  name: z.string().min(1).max(100),
  command: z.string().min(1),
  args: z.array(z.string()),
  enabled: z.boolean(),
});

const setDefaultAgentSchema = z.object({
  agent: z.string().min(1, 'Agent type is required'),
});

const validateRepoPathSchema = z.object({
  path: z.string().min(1, 'Path is required'),
});

// GET /api/config - Get full config
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const config = await configService.getConfig();
    res.json(config);
  })
);

// GET /api/config/repos - List repos
router.get(
  '/repos',
  asyncHandler(async (_req, res) => {
    const config = await configService.getConfig();
    res.json(config.repos);
  })
);

// POST /api/config/repos - Add repo
router.post(
  '/repos',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    let repo: RepoConfig;
    try {
      repo = repoSchema.parse(req.body) as RepoConfig;
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.issues);
      }
      throw error;
    }
    try {
      const config = await configService.addRepo(repo);
      res.status(201).json(config);
    } catch (error: any) {
      throw new BadRequestError(error.message || 'Failed to add repo');
    }
  })
);

// PATCH /api/config/repos/:name - Update repo
router.patch(
  '/repos/:name',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    let updates;
    try {
      updates = repoSchema.partial().parse(req.body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.issues);
      }
      throw error;
    }
    try {
      const config = await configService.updateRepo(req.params.name as string, updates);
      res.json(config);
    } catch (error: any) {
      throw new BadRequestError(error.message || 'Failed to update repo');
    }
  })
);

// DELETE /api/config/repos/:name - Remove repo
router.delete(
  '/repos/:name',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    try {
      const config = await configService.removeRepo(req.params.name as string);
      res.json(config);
    } catch (error: any) {
      throw new BadRequestError(error.message || 'Failed to remove repo');
    }
  })
);

// POST /api/config/repos/validate - Validate repo path
router.post(
  '/repos/validate',
  asyncHandler(async (req, res) => {
    let path: string;
    try {
      ({ path } = validateRepoPathSchema.parse(req.body));
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.issues);
      }
      throw error;
    }
    try {
      const result = await configService.validateRepoPath(path);
      res.json(result);
    } catch (error: any) {
      throw new BadRequestError(error.message || 'Failed to validate path', { valid: false });
    }
  })
);

// GET /api/config/repos/:name/branches - Get repo branches
router.get(
  '/repos/:name/branches',
  asyncHandler(async (req, res) => {
    try {
      const branches = await configService.getRepoBranches(req.params.name as string);
      res.json(branches);
    } catch (error: any) {
      throw new BadRequestError(error.message || 'Failed to get branches');
    }
  })
);

// GET /api/config/agents - List agents
router.get(
  '/agents',
  asyncHandler(async (_req, res) => {
    const config = await configService.getConfig();
    res.json(config.agents);
  })
);

// PUT /api/config/agents - Update all agents
router.put(
  '/agents',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    let agents: AgentConfig[];
    try {
      agents = z.array(agentSchema).parse(req.body) as AgentConfig[];
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.issues);
      }
      throw error;
    }
    const config = await configService.updateAgents(agents);
    res.json(config);
  })
);

// PUT /api/config/default-agent - Set default agent
router.put(
  '/default-agent',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    let agent: string;
    try {
      ({ agent } = setDefaultAgentSchema.parse(req.body));
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.issues);
      }
      throw error;
    }
    const config = await configService.setDefaultAgent(agent as AgentType);
    res.json(config);
  })
);

export { router as configRoutes };
