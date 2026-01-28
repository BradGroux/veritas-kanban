import { Router, type Router as RouterType } from 'express';
import { ConfigService } from '../services/config-service.js';

const router: RouterType = Router();
const configService = new ConfigService();

// GET /api/settings/features — returns full feature settings with defaults merged
router.get('/features', async (_req, res) => {
  try {
    const features = await configService.getFeatureSettings();
    res.json(features);
  } catch (error) {
    console.error('Error getting feature settings:', error);
    res.status(500).json({ error: 'Failed to get feature settings' });
  }
});

// PATCH /api/settings/features — deep merge partial updates
router.patch('/features', async (req, res) => {
  try {
    const patch = req.body;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      return res.status(400).json({ error: 'Body must be a JSON object with feature settings' });
    }
    const updated = await configService.updateFeatureSettings(patch);
    res.json(updated);
  } catch (error) {
    console.error('Error updating feature settings:', error);
    res.status(500).json({ error: 'Failed to update feature settings' });
  }
});

export { router as settingsRoutes };
