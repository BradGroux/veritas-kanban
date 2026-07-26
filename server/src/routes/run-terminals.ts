import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/async-handler.js';
import { NotFoundError, ValidationError } from '../middleware/error-handler.js';
import {
  RunTerminalHandleParamsSchema,
  RunTerminalOutputQuerySchema,
  RunTerminalScopeParamsSchema,
  RunTerminalWaitManyRequestSchema,
  RunTerminalWaitRequestSchema,
} from '../schemas/run-terminal-schemas.js';
import {
  clawdbotAgentService,
  type ClawdbotAgentService,
} from '../services/clawdbot-agent-service.js';
import {
  getRunTerminalService,
  type RunTerminalService,
} from '../services/run-terminal-service.js';

type RunTerminalApi = Pick<
  RunTerminalService,
  'assertScope' | 'list' | 'output' | 'wait' | 'waitAny' | 'waitAll' | 'detach' | 'terminate'
>;

export interface RunTerminalRouteDependencies {
  terminals: RunTerminalApi;
  activeRuns: Pick<ClawdbotAgentService, 'getAgentStatus'>;
}

interface ActiveTerminalScope {
  workspaceId: string;
  taskId: string;
  attemptId: string;
}

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ValidationError('Validation failed.', error.issues);
    }
    throw error;
  }
}

async function requireActiveScope(
  dependencies: RunTerminalRouteDependencies,
  taskId: string,
  attemptId: string
): Promise<ActiveTerminalScope> {
  const status = await dependencies.activeRuns.getAgentStatus(taskId);
  if (!status || status.attemptId !== attemptId) {
    throw new NotFoundError('Active run terminal scope not found.');
  }
  return {
    workspaceId: status.taskEnvelope.workspace.workspaceId,
    taskId,
    attemptId,
  };
}

function assertScopedHandle(
  dependencies: RunTerminalRouteDependencies,
  scope: ActiveTerminalScope,
  handleId: string
): void {
  dependencies.terminals.assertScope(handleId, scope.workspaceId, scope.taskId, scope.attemptId);
}

export class RunTerminalController {
  constructor(private readonly dependencies: RunTerminalRouteDependencies) {}

  async list(taskId: string, attemptId: string) {
    const scope = await requireActiveScope(this.dependencies, taskId, attemptId);
    return this.dependencies.terminals.list(scope.workspaceId, scope.taskId, scope.attemptId);
  }

  async get(taskId: string, attemptId: string, handleId: string) {
    const scope = await requireActiveScope(this.dependencies, taskId, attemptId);
    return this.dependencies.terminals.assertScope(
      handleId,
      scope.workspaceId,
      scope.taskId,
      scope.attemptId
    );
  }

  async output(
    taskId: string,
    attemptId: string,
    handleId: string,
    afterCursor: number,
    limit: number
  ) {
    const scope = await requireActiveScope(this.dependencies, taskId, attemptId);
    assertScopedHandle(this.dependencies, scope, handleId);
    return this.dependencies.terminals.output(handleId, afterCursor, limit);
  }

  async wait(taskId: string, attemptId: string, handleId: string, timeoutMs: number) {
    const scope = await requireActiveScope(this.dependencies, taskId, attemptId);
    assertScopedHandle(this.dependencies, scope, handleId);
    return this.dependencies.terminals.wait(handleId, timeoutMs);
  }

  async waitAny(taskId: string, attemptId: string, handleIds: string[], timeoutMs: number) {
    const scope = await requireActiveScope(this.dependencies, taskId, attemptId);
    for (const handleId of handleIds) {
      assertScopedHandle(this.dependencies, scope, handleId);
    }
    return this.dependencies.terminals.waitAny(handleIds, timeoutMs);
  }

  async waitAll(taskId: string, attemptId: string, handleIds: string[], timeoutMs: number) {
    const scope = await requireActiveScope(this.dependencies, taskId, attemptId);
    for (const handleId of handleIds) {
      assertScopedHandle(this.dependencies, scope, handleId);
    }
    return this.dependencies.terminals.waitAll(handleIds, timeoutMs);
  }

  async detach(taskId: string, attemptId: string, handleId: string) {
    const scope = await requireActiveScope(this.dependencies, taskId, attemptId);
    assertScopedHandle(this.dependencies, scope, handleId);
    return this.dependencies.terminals.detach(handleId);
  }

  async terminate(taskId: string, attemptId: string, handleId: string) {
    const scope = await requireActiveScope(this.dependencies, taskId, attemptId);
    assertScopedHandle(this.dependencies, scope, handleId);
    return this.dependencies.terminals.terminate(handleId);
  }
}

export function createRunTerminalRoutes(
  dependencies: RunTerminalRouteDependencies = {
    terminals: getRunTerminalService(),
    activeRuns: clawdbotAgentService,
  }
): RouterType {
  const router: RouterType = Router();
  const controller = new RunTerminalController(dependencies);

  router.get(
    '/runs/:taskId/:attemptId',
    asyncHandler(async (req, res) => {
      const params = parseOrThrow(RunTerminalScopeParamsSchema, req.params);
      res.json(await controller.list(params.taskId, params.attemptId));
    })
  );

  router.post(
    '/runs/:taskId/:attemptId/wait-any',
    asyncHandler(async (req, res) => {
      const params = parseOrThrow(RunTerminalScopeParamsSchema, req.params);
      const body = parseOrThrow(RunTerminalWaitManyRequestSchema, req.body);
      res.json(
        await controller.waitAny(params.taskId, params.attemptId, body.handleIds, body.timeoutMs)
      );
    })
  );

  router.post(
    '/runs/:taskId/:attemptId/wait-all',
    asyncHandler(async (req, res) => {
      const params = parseOrThrow(RunTerminalScopeParamsSchema, req.params);
      const body = parseOrThrow(RunTerminalWaitManyRequestSchema, req.body);
      res.json(
        await controller.waitAll(params.taskId, params.attemptId, body.handleIds, body.timeoutMs)
      );
    })
  );

  router.get(
    '/runs/:taskId/:attemptId/handles/:handleId',
    asyncHandler(async (req, res) => {
      const params = parseOrThrow(RunTerminalHandleParamsSchema, req.params);
      res.json(await controller.get(params.taskId, params.attemptId, params.handleId));
    })
  );

  router.get(
    '/runs/:taskId/:attemptId/handles/:handleId/output',
    asyncHandler(async (req, res) => {
      const params = parseOrThrow(RunTerminalHandleParamsSchema, req.params);
      const query = parseOrThrow(RunTerminalOutputQuerySchema, req.query);
      res.json(
        await controller.output(
          params.taskId,
          params.attemptId,
          params.handleId,
          query.afterCursor,
          query.limit
        )
      );
    })
  );

  router.post(
    '/runs/:taskId/:attemptId/handles/:handleId/wait',
    asyncHandler(async (req, res) => {
      const params = parseOrThrow(RunTerminalHandleParamsSchema, req.params);
      const body = parseOrThrow(RunTerminalWaitRequestSchema, req.body);
      res.json(
        await controller.wait(params.taskId, params.attemptId, params.handleId, body.timeoutMs)
      );
    })
  );

  router.post(
    '/runs/:taskId/:attemptId/handles/:handleId/detach',
    asyncHandler(async (req, res) => {
      const params = parseOrThrow(RunTerminalHandleParamsSchema, req.params);
      res.json(await controller.detach(params.taskId, params.attemptId, params.handleId));
    })
  );

  router.post(
    '/runs/:taskId/:attemptId/handles/:handleId/terminate',
    asyncHandler(async (req, res) => {
      const params = parseOrThrow(RunTerminalHandleParamsSchema, req.params);
      res.json(await controller.terminate(params.taskId, params.attemptId, params.handleId));
    })
  );

  return router;
}

export const runTerminalRoutes = createRunTerminalRoutes();
