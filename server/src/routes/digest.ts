import { Router, type Router as RouterType } from 'express';
import { getDigestService } from '../services/digest-service.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { qStrD } from '../lib/query-helpers.js';

const router: RouterType = Router();

/**
 * GET /api/digest/daily
 * Get the daily digest summary for the last 24 hours
 *
 * Query params:
 * - format: 'json' | 'teams' (default: 'json')
 *
 * Returns either raw JSON data or Teams-formatted markdown
 */
router.get(
  '/daily',
  asyncHandler(async (req, res) => {
    const format = qStrD(req.query.format, 'json');
    const digestService = getDigestService();

    const digest = await digestService.generateDigest();

    if (format === 'teams') {
      const teamsMessage = digestService.formatForTeams(digest);

      if (teamsMessage.isEmpty) {
        res.json({
          isEmpty: true,
          message: 'No activity in the last 24 hours',
        });
        return;
      }

      res.json({
        isEmpty: false,
        markdown: teamsMessage.markdown,
      });
      return;
    }

    // Default: return raw JSON
    res.json(digest);
  })
);

/**
 * GET /api/digest/daily/preview
 * Preview the Teams-formatted digest (for testing)
 * Returns the markdown as plain text
 */
router.get(
  '/daily/preview',
  asyncHandler(async (_req, res) => {
    const digestService = getDigestService();
    const digest = await digestService.generateDigest();
    const teamsMessage = digestService.formatForTeams(digest);

    if (teamsMessage.isEmpty) {
      res.type('text/plain').send('No activity in the last 24 hours - digest would be skipped.');
      return;
    }

    res.type('text/markdown').send(teamsMessage.markdown);
  })
);

export default router;
