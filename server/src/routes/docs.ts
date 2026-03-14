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
import { qStr, qStrD, qNum, paramStr } from '../lib/query-helpers.js';

const router: RouterType = Router();

/**
 * GET /api/docs
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const service = getDocsService();
    const sortBy = qStr(req.query.sortBy);
    const sortOrder = qStr(req.query.sortOrder);
    const files = await service.listFiles({
      directory: qStr(req.query.directory),
      extension: qStr(req.query.extension),
      sortBy: sortBy === 'name' || sortBy === 'modified' || sortBy === 'size' ? sortBy : undefined,
      sortOrder: sortOrder === 'asc' || sortOrder === 'desc' ? sortOrder : undefined,
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
    const q = qStrD(req.query.q, '');
    if (!q) return res.json([]);
    const service = getDocsService();
    const results = await service.search(q, {
      limit: qNum(req.query.limit),
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
    const filePath = paramStr(req.params.path);
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
    const filePath = paramStr(req.params.path);
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
    const filePath = paramStr(req.params.path);
    if (!filePath) return res.status(400).json({ error: 'File path required' });

    const service = getDocsService();
    const success = await service.deleteFile(filePath);
    if (!success) throw new NotFoundError('File not found');
    res.json({ success: true });
  })
);

export { router as docsRoutes };
