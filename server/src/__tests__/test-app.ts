/**
 * Test App Factory
 * Creates an Express app instance for integration testing without starting the server.
 */
import express from 'express';
import { taskRoutes } from '../routes/tasks.js';
import { taskCommentRoutes } from '../routes/task-comments.js';
import { taskSubtaskRoutes } from '../routes/task-subtasks.js';
import { taskVerificationRoutes } from '../routes/task-verification.js';
import { taskTimeRoutes } from '../routes/task-time.js';
import { agentStatusRoutes, updateAgentStatus, getAgentStatus } from '../routes/agent-status.js';
import { errorHandler } from '../middleware/error-handler.js';

export function createTestApp() {
  const app = express();

  app.use(express.json({ limit: '1mb' }));

  // Mount routes
  app.use('/api/tasks', taskTimeRoutes);
  app.use('/api/tasks', taskCommentRoutes);
  app.use('/api/tasks', taskSubtaskRoutes);
  app.use('/api/tasks', taskVerificationRoutes);
  app.use('/api/tasks', taskRoutes);
  app.use('/api/agent/status', agentStatusRoutes);

  // Error handler
  app.use(errorHandler);

  return app;
}

// Export agent status utilities for testing
export { updateAgentStatus, getAgentStatus };
