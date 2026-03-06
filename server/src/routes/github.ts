import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { GitHubService } from '../services/github-service.js';
import { getGitHubSyncService } from '../services/github-sync-service.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { ValidationError } from '../middleware/error-handler.js';

const router: RouterType = Router();
const githubService = new GitHubService();

// ── Validation schemas ──────────────────────────────────────

const createPRSchema = z.object({
  taskId: z.string().min(1),
  title: z.string().optional(),
  body: z.string().optional(),
  targetBranch: z.string().optional(),
  draft: z.boolean().optional(),
});

const syncConfigSchema = z.object({
  enabled: z.boolean().optional(),
  repo: z.string().min(1).optional(),
  syncMode: z.enum(['inbound', 'outbound', 'bidirectional']).optional(),
  labelFilter: z.string().min(1).optional(),
  pollIntervalMs: z.number().int().min(10_000).optional(),
});

// ── Existing PR routes ──────────────────────────────────────

// GET /api/github/status - Check gh CLI status
router.get(
  '/status',
  asyncHandler(async (_req, res) => {
    const status = await githubService.checkGhCli();
    res.json(status);
  })
);

// POST /api/github/pr - Create a PR for a task
router.post(
  '/pr',
  asyncHandler(async (req, res) => {
    let input;
    try {
      input = createPRSchema.parse(req.body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.issues);
      }
      throw error;
    }
    const pr = await githubService.createPR(input);
    res.status(201).json(pr);
  })
);

// POST /api/github/pr/:taskId/open - Open PR in browser
router.post(
  '/pr/:taskId/open',
  asyncHandler(async (req, res) => {
    await githubService.openPRInBrowser(req.params.taskId as string);
    res.json({ success: true });
  })
);

// ── GitHub Issues Sync routes ───────────────────────────────

// POST /api/github/sync - Trigger a manual sync
router.post(
  '/sync',
  asyncHandler(async (_req, res) => {
    const syncService = getGitHubSyncService();
    const result = await syncService.sync();
    res.json(result);
  })
);

// GET /api/github/sync/status - Get last sync info
router.get(
  '/sync/status',
  asyncHandler(async (_req, res) => {
    const syncService = getGitHubSyncService();
    const state = await syncService.getSyncState();
    const config = await syncService.getConfig();
    res.json({
      lastSyncAt: state.lastSyncAt,
      mappedIssues: Object.keys(state.issueMappings).length,
      enabled: config.github.enabled,
      syncMode: config.github.syncMode,
      repo: config.github.repo,
    });
  })
);

// GET /api/github/sync/config - Get sync configuration
router.get(
  '/sync/config',
  asyncHandler(async (_req, res) => {
    const syncService = getGitHubSyncService();
    const config = await syncService.getConfig();
    res.json(config.github);
  })
);

// PUT /api/github/sync/config - Update sync configuration
router.put(
  '/sync/config',
  asyncHandler(async (req, res) => {
    let input;
    try {
      input = syncConfigSchema.parse(req.body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.issues);
      }
      throw error;
    }
    const syncService = getGitHubSyncService();
    const updated = await syncService.updateConfig(input);
    res.json(updated.github);
  })
);

// GET /api/github/sync/mappings - List issue↔task mappings
router.get(
  '/sync/mappings',
  asyncHandler(async (_req, res) => {
    const syncService = getGitHubSyncService();
    const state = await syncService.getSyncState();
    res.json(state.issueMappings);
  })
);

export default router;
