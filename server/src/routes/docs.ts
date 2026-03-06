/**
 * Docs API Routes
 *
 * GET    /api/docs                 — List all docs
 * GET    /api/docs/stats           — Docs directory statistics
 * GET    /api/docs/directories     — List subdirectories
 * GET    /api/docs/search?q=       — Search docs by name/content
 * GET    /api/docs/file/*          — Get file with content
 * PUT    /api/docs/file/*          — Create/update file
 * DELETE /api/docs/file/*          — Delete file
 */

import { Router, type Router as RouterType } from 'express';
import { getDocsService } from '../services/docs-service.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { NotFoundError } from '../middleware/error-handler.js';

const router: RouterType = Router();

/**
 * GET /api/docs
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const service = getDocsService();
    const files = await service.listFiles({
      directory: req.query.directory as string,
      extension: req.query.extension as string,
      sortBy: req.query.sortBy as 'name' | 'modified' | 'size' | undefined,
      sortOrder: req.query.sortOrder as 'asc' | 'desc' | undefined,
    });
    res.json(files);
  })
);

/**
 * GET /api/docs/stats
 */
router.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const service = getDocsService();
    const stats = await service.getStats();
    res.json(stats);
  })
);

/**
 * GET /api/docs/directories
 */
router.get(
  '/directories',
  asyncHandler(async (_req, res) => {
    const service = getDocsService();
    const dirs = await service.listDirectories();
    res.json(dirs);
  })
);

/**
 * GET /api/docs/search?q=<query>
 */
router.get(
  '/search',
  asyncHandler(async (req, res) => {
    const q = (req.query.q as string) || '';
    if (!q) return res.json([]);
    const service = getDocsService();
    const results = await service.search(q, {
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json(results);
  })
);

/**
 * GET /api/docs/file/* — Get file with content
 */
router.get(
  '/file/*path',
  asyncHandler(async (req, res) => {
    const filePath = (req.params as any).path || req.params[0];
    if (!filePath) return res.status(400).json({ error: 'File path required' });

    const service = getDocsService();
    const file = await service.getFile(filePath);
    if (!file) throw new NotFoundError('File not found');
    res.json(file);
  })
);

/**
 * PUT /api/docs/file/* — Create or update file
 */
router.put(
  '/file/*path',
  asyncHandler(async (req, res) => {
    const filePath = (req.params as any).path || req.params[0];
    if (!filePath) return res.status(400).json({ error: 'File path required' });

    const content = req.body.content;
    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'content (string) required in body' });
    }

    const service = getDocsService();
    const file = await service.saveFile(filePath, content);
    res.json(file);
  })
);

/**
 * DELETE /api/docs/file/* — Delete file
 */
router.delete(
  '/file/*path',
  asyncHandler(async (req, res) => {
    const filePath = (req.params as any).path || req.params[0];
    if (!filePath) return res.status(400).json({ error: 'File path required' });

    const service = getDocsService();
    const success = await service.deleteFile(filePath);
    if (!success) throw new NotFoundError('File not found');
    res.json({ success: true });
  })
);

export { router as docsRoutes };
