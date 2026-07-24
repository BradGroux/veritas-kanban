import { Router, type Router as RouterType } from 'express';
import type { ToolInvocationRequest, ToolServerDefinitionInput } from '@veritas-kanban/shared';
import { asyncHandler } from '../middleware/async-handler.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { ConflictError, NotFoundError } from '../middleware/error-handler.js';
import { validate, type ValidatedRequest } from '../middleware/validate.js';
import {
  toolDiscoveryRequestSchema,
  toolInvocationRequestSchema,
  toolServerDefinitionInputSchema,
  toolServerParamsSchema,
} from '../schemas/tool-control-plane-schemas.js';
import { getTaskService } from '../services/task-service.js';
import { getToolControlPlaneService } from '../services/tool-control-plane-service.js';

const router: RouterType = Router();
const service = getToolControlPlaneService();
const runCatalogParamsSchema = toolInvocationRequestSchema.pick({
  taskId: true,
  attemptId: true,
});

function actorId(req: AuthenticatedRequest): string {
  const auth = req.auth;
  return (
    auth?.userId ||
    auth?.tokenName ||
    auth?.keyName ||
    auth?.clientId ||
    auth?.deviceId ||
    auth?.role ||
    'operator'
  );
}

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json(await service.listDefinitions());
  })
);

router.post(
  '/',
  validate({ body: toolServerDefinitionInputSchema }),
  asyncHandler(async (req: ValidatedRequest<unknown, unknown, ToolServerDefinitionInput>, res) => {
    res
      .status(201)
      .json(await service.createDefinition(req.validated.body as ToolServerDefinitionInput));
  })
);

router.get(
  '/runs/:taskId/:attemptId/catalog',
  validate({ params: runCatalogParamsSchema }),
  asyncHandler(async (req: ValidatedRequest<{ taskId: string; attemptId: string }>, res) => {
    const { taskId, attemptId } = req.validated.params as {
      taskId: string;
      attemptId: string;
    };
    res.json(await service.getRunCatalog(taskId, attemptId));
  })
);

router.post(
  '/call',
  validate({ body: toolInvocationRequestSchema }),
  asyncHandler(async (req: ValidatedRequest<unknown, unknown, ToolInvocationRequest>, res) => {
    const input = req.validated.body as ToolInvocationRequest;
    const task = await getTaskService().getTask(input.taskId);
    if (!task) throw new NotFoundError('Task not found.');
    if (task.attempt?.id !== input.attemptId || task.attempt.status !== 'running') {
      throw new ConflictError('Tool calls require the exact active task attempt.');
    }
    const catalog = await service.getRunCatalog(input.taskId, input.attemptId);
    if (task.attempt.runLaunchManifest?.tools.catalogDigest !== catalog.digest) {
      throw new ConflictError('Active launch evidence does not match the run tool catalog.');
    }
    res.json(
      await service.invoke(
        input,
        actorId(req as AuthenticatedRequest),
        task.git?.worktreePath,
        task.attempt.runLaunchManifest.digest
      )
    );
  })
);

router.get(
  '/:id',
  validate({ params: toolServerParamsSchema }),
  asyncHandler(async (req: ValidatedRequest<{ id: string }>, res) => {
    const { id } = req.validated.params as { id: string };
    res.json(await service.getDefinition(id));
  })
);

router.put(
  '/:id',
  validate({ params: toolServerParamsSchema, body: toolServerDefinitionInputSchema }),
  asyncHandler(
    async (req: ValidatedRequest<{ id: string }, unknown, ToolServerDefinitionInput>, res) => {
      const { id } = req.validated.params as { id: string };
      res.json(await service.updateDefinition(id, req.validated.body as ToolServerDefinitionInput));
    }
  )
);

router.delete(
  '/:id',
  validate({ params: toolServerParamsSchema }),
  asyncHandler(async (req: ValidatedRequest<{ id: string }>, res) => {
    const { id } = req.validated.params as { id: string };
    await service.deleteDefinition(id);
    res.json({ deleted: id });
  })
);

router.post(
  '/:id/discover',
  validate({ params: toolServerParamsSchema, body: toolDiscoveryRequestSchema }),
  asyncHandler(async (req: ValidatedRequest<{ id: string }>, res) => {
    const { id } = req.validated.params as { id: string };
    const body = req.validated.body as { force?: boolean };
    res.json(await service.discover(id, body.force === true));
  })
);

export { router as toolControlPlaneRoutes };
