import { z } from 'zod';
import { SprintService } from '../services/sprint-service.js';
import { getTaskService } from '../services/task-service.js';
import { createManagedListRouter } from './managed-list-routes.js';
import { createLogger } from '../lib/logger.js';
const log = createLogger('sprints');

// Validation schemas
const createSprintSchema = z.object({
  label: z.string().min(1),
  description: z.string().optional(),
});

const updateSprintSchema = z.object({
  label: z.string().min(1).optional(),
  description: z.string().optional(),
  isHidden: z.boolean().optional(),
});

// Create service instances
const taskService = getTaskService();
const sprintService = new SprintService(taskService);

// Initialize service
sprintService.init().catch((err) => {
  log.error('Failed to initialize SprintService:', err);
});

// Create router using the generic factory
const router = createManagedListRouter(sprintService, createSprintSchema, updateSprintSchema);

export default router;
