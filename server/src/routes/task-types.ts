import { TASK_TYPE_COLOR_TOKENS } from '@veritas-kanban/shared';
import { z } from 'zod';
import { TaskTypeService } from '../services/task-type-service.js';
import { getTaskService } from '../services/task-service.js';
import { createManagedListRouter } from './managed-list-routes.js';
import { createLogger } from '../lib/logger.js';
const log = createLogger('task-types');

// Validation schemas
const createTaskTypeSchema = z.object({
  label: z.string().min(1),
  icon: z.string().min(1),
  colorToken: z.enum(TASK_TYPE_COLOR_TOKENS).optional(),
  color: z.string().optional(),
});

const updateTaskTypeSchema = z.object({
  label: z.string().min(1).optional(),
  icon: z.string().min(1).optional(),
  colorToken: z.enum(TASK_TYPE_COLOR_TOKENS).optional(),
  color: z.string().optional(),
  isHidden: z.boolean().optional(),
});

// Create service instances
const taskService = getTaskService();
const taskTypeService = new TaskTypeService(taskService);

// Initialize service
taskTypeService.init().catch((err) => {
  log.error('Failed to initialize TaskTypeService:', err);
});

// Create router using the generic factory
const router = createManagedListRouter(taskTypeService, createTaskTypeSchema, updateTaskTypeSchema);

export default router;
