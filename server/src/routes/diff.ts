import { Router, type Router as RouterType } from 'express';
import { DiffService } from '../services/diff-service.js';

const router: RouterType = Router();
const diffService = new DiffService();

// GET /api/diff/:taskId - Get diff summary for task
router.get('/:taskId', async (req, res) => {
  try {
    const summary = await diffService.getDiffSummary(req.params.taskId);
    res.json(summary);
  } catch (error: any) {
    console.error('Error getting diff summary:', error);
    res.status(400).json({ error: error.message || 'Failed to get diff summary' });
  }
});

// GET /api/diff/:taskId/file - Get diff for specific file
router.get('/:taskId/file', async (req, res) => {
  try {
    const { path } = req.query;
    if (!path || typeof path !== 'string') {
      return res.status(400).json({ error: 'File path is required' });
    }
    const diff = await diffService.getFileDiff(req.params.taskId, path);
    res.json(diff);
  } catch (error: any) {
    console.error('Error getting file diff:', error);
    res.status(400).json({ error: error.message || 'Failed to get file diff' });
  }
});

// GET /api/diff/:taskId/full - Get full diff for all files
router.get('/:taskId/full', async (req, res) => {
  try {
    const diffs = await diffService.getFullDiff(req.params.taskId);
    res.json(diffs);
  } catch (error: any) {
    console.error('Error getting full diff:', error);
    res.status(400).json({ error: error.message || 'Failed to get full diff' });
  }
});

export { router as diffRoutes };
