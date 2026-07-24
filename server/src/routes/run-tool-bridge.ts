import { Router, type Request, type Router as RouterType } from 'express';
import type { ToolInvocationRequest } from '@veritas-kanban/shared';
import { asyncHandler } from '../middleware/async-handler.js';
import { ConflictError, NotFoundError } from '../middleware/error-handler.js';
import { validate, type ValidatedRequest } from '../middleware/validate.js';
import { toolInvocationRequestSchema } from '../schemas/tool-control-plane-schemas.js';
import { getRunToolBridgeService } from '../services/run-tool-bridge-service.js';
import { getTaskService } from '../services/task-service.js';
import { getToolControlPlaneService } from '../services/tool-control-plane-service.js';

const router: RouterType = Router();
const bridge = getRunToolBridgeService();
const tools = getToolControlPlaneService();
const bridgeCallSchema = toolInvocationRequestSchema.omit({
  taskId: true,
  attemptId: true,
});

function handle(req: Request): string | undefined {
  const value = req.headers['x-vk-run-tool-bridge'];
  return typeof value === 'string' ? value : undefined;
}

router.get(
  '/catalog',
  asyncHandler(async (req, res) => {
    const authority = bridge.authorize(handle(req), 'catalog.read');
    const { catalog } = await activeContext(authority);
    res.json(catalog);
  })
);

router.post(
  '/call',
  validate({ body: bridgeCallSchema }),
  asyncHandler(
    async (
      req: ValidatedRequest<unknown, unknown, Omit<ToolInvocationRequest, 'taskId' | 'attemptId'>>,
      res
    ) => {
      const authority = bridge.authorize(handle(req), 'tool.call');
      const input = req.validated.body as Omit<ToolInvocationRequest, 'taskId' | 'attemptId'>;
      const { task } = await activeContext(authority);
      res.json(
        await tools.invoke(
          {
            ...input,
            taskId: authority.taskId,
            attemptId: authority.attemptId,
          },
          authority.handleId,
          task.git?.worktreePath,
          authority.runLaunchManifestDigest
        )
      );
    }
  )
);

async function activeContext(authority: ReturnType<typeof bridge.authorize>) {
  const task = await getTaskService().getTask(authority.taskId);
  if (!task) {
    bridge.revokeRun(authority.taskId, authority.attemptId);
    throw new NotFoundError('Run tool bridge task not found.');
  }
  if (task.attempt?.id !== authority.attemptId || task.attempt.status !== 'running') {
    bridge.revokeRun(authority.taskId, authority.attemptId);
    throw new ConflictError('Run tool bridge authority does not match an active attempt.');
  }
  const catalog = await tools
    .getRunCatalog(authority.taskId, authority.attemptId)
    .catch((error) => {
      bridge.revokeRun(authority.taskId, authority.attemptId);
      throw error;
    });
  if (
    catalog.digest !== authority.catalogDigest ||
    task.attempt.runLaunchManifest?.digest !== authority.runLaunchManifestDigest ||
    task.attempt.runLaunchManifest.tools.catalogDigest !== authority.catalogDigest
  ) {
    bridge.revokeRun(authority.taskId, authority.attemptId);
    throw new ConflictError('Run tool bridge launch evidence drifted from the active attempt.');
  }
  return { task, catalog };
}

export { router as runToolBridgeRoutes };
