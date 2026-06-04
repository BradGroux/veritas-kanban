import { z } from 'zod';
import { ProjectService } from '../services/project-service.js';
import { getTaskService } from '../services/task-service.js';
import { createManagedListRouter } from './managed-list-routes.js';
import { createLogger } from '../lib/logger.js';
const log = createLogger('projects');

// Validation schemas
const createProjectSchema = z.object({
  label: z.string().min(1),
  description: z.string().optional(),
  color: z.string().optional(),
});

const updateProjectSchema = z.object({
  label: z.string().min(1).optional(),
  description: z.string().optional(),
  color: z.string().optional(),
  isHidden: z.boolean().optional(),
});

// Create service instances
const taskService = getTaskService();
const projectService = new ProjectService(taskService);

// Initialize service
projectService.init().catch((err) => {
  log.error('Failed to initialize ProjectService:', err);
});

// Create router using the generic factory
const router = createManagedListRouter(projectService, createProjectSchema, updateProjectSchema);

export default router;
