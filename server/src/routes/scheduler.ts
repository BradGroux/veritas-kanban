import { Router, type Router as RouterType } from 'express';
import { getSchedulerService } from '../services/scheduler-service.js';
import { asyncHandler } from '../middleware/async-handler.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { ForbiddenError } from '../middleware/error-handler.js';
import { getAutomationDraftService } from '../services/automation-draft-service.js';
import { getAutomationActivationService } from '../services/automation-activation-service.js';
import {
  AutomationActivationApplyBodySchema,
  AutomationActivationPreviewBodySchema,
  AutomationBindingActionBodySchema,
  AutomationDraftCloneBodySchema,
  AutomationDraftCompileBodySchema,
  AutomationDraftDeleteQuerySchema,
  AutomationDraftRevisionQuerySchema,
} from '../schemas/automation-draft-schemas.js';

const router: RouterType = Router();

function actor(req: AuthenticatedRequest): string {
  return (
    req.auth?.userId ??
    req.auth?.tokenName ??
    req.auth?.keyName ??
    req.auth?.clientId ??
    req.auth?.role ??
    'unknown'
  );
}

function compileInput(req: AuthenticatedRequest) {
  const parsed = AutomationDraftCompileBodySchema.parse(req.body);
  const authorizedWorkspaceId = req.auth?.workspaceId;
  if (
    authorizedWorkspaceId &&
    parsed.hints?.workspaceId &&
    parsed.hints.workspaceId !== authorizedWorkspaceId
  ) {
    throw new ForbiddenError('Automation draft workspace must match the authenticated workspace.');
  }
  return {
    ...parsed,
    requestedBy: actor(req),
    hints: {
      ...parsed.hints,
      workspaceId: authorizedWorkspaceId ?? parsed.hints?.workspaceId ?? 'local',
    },
  };
}

router.post(
  '/drafts/preview',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    res.json(await getAutomationDraftService().preview(compileInput(req)));
  })
);

router.post(
  '/drafts',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const draft = await getAutomationDraftService().save(compileInput(req));
    res.status(201).json(draft);
  })
);

router.get(
  '/drafts',
  asyncHandler(async (_req, res) => {
    res.json({
      generatedAt: new Date().toISOString(),
      drafts: await getAutomationDraftService().list(),
    });
  })
);

router.post(
  '/drafts/:draftId/activation-preview',
  asyncHandler(async (req, res) => {
    const parsed = AutomationActivationPreviewBodySchema.parse(req.body);
    res.json(
      await getAutomationActivationService().preview(
        String(req.params.draftId),
        parsed.requestId,
        parsed.revision
      )
    );
  })
);

router.post(
  '/drafts/:draftId/activate',
  asyncHandler(async (req, res) => {
    const parsed = AutomationActivationApplyBodySchema.parse(req.body);
    const result = await getAutomationActivationService().apply({
      draftId: String(req.params.draftId),
      ...parsed,
    });
    res.status(result.version ? 201 : 202).json(result);
  })
);

router.get(
  '/automations',
  asyncHandler(async (_req, res) => {
    res.json(await getAutomationActivationService().list());
  })
);

for (const action of ['pause', 'resume', 'revoke'] as const) {
  router.post(
    `/automations/:bindingId/${action}`,
    asyncHandler(async (req, res) => {
      const parsed = AutomationBindingActionBodySchema.parse(req.body);
      res.json(
        await getAutomationActivationService().updateBinding(
          String(req.params.bindingId),
          parsed.expectedRevision,
          action === 'resume' ? 'active' : action === 'pause' ? 'paused' : 'revoked',
          parsed.reason
        )
      );
    })
  );
}

router.get(
  '/drafts/:draftId',
  asyncHandler(async (req, res) => {
    const query = AutomationDraftRevisionQuerySchema.parse(req.query);
    res.json(await getAutomationDraftService().get(String(req.params.draftId), query.revision));
  })
);

router.post(
  '/drafts/:draftId/revisions',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    res
      .status(201)
      .json(
        await getAutomationDraftService().revise(String(req.params.draftId), compileInput(req))
      );
  })
);

router.post(
  '/drafts/:draftId/clone',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const parsed = AutomationDraftCloneBodySchema.parse(req.body);
    res.status(201).json(
      await getAutomationDraftService().clone(String(req.params.draftId), {
        requestId: parsed.requestId,
        requestedBy: actor(req),
      })
    );
  })
);

router.delete(
  '/drafts/:draftId',
  asyncHandler(async (req, res) => {
    const draftId = String(req.params.draftId);
    const query = AutomationDraftDeleteQuerySchema.parse(req.query);
    if (query.confirm !== draftId) {
      throw new ForbiddenError('Automation draft deletion requires exact ID confirmation.');
    }
    res.json(await getAutomationDraftService().delete(draftId));
  })
);

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json(await getSchedulerService().list());
  })
);

router.get(
  '/items/:itemId',
  asyncHandler(async (req, res) => {
    res.json(await getSchedulerService().getItem(String(req.params.itemId)));
  })
);

router.post(
  '/items/:itemId/run',
  asyncHandler(async (req, res) => {
    res.json(await getSchedulerService().runItem(String(req.params.itemId), 'manual-run'));
  })
);

router.post(
  '/items/:itemId/pause',
  asyncHandler(async (req, res) => {
    res.json(await getSchedulerService().pause(String(req.params.itemId)));
  })
);

router.post(
  '/items/:itemId/resume',
  asyncHandler(async (req, res) => {
    res.json(await getSchedulerService().resume(String(req.params.itemId)));
  })
);

router.post(
  '/items/:itemId/validate',
  asyncHandler(async (req, res) => {
    res.json(await getSchedulerService().validate(String(req.params.itemId)));
  })
);

router.post(
  '/due/run',
  asyncHandler(async (_req, res) => {
    res.json(await getSchedulerService().runDue());
  })
);

export { router as schedulerRoutes };
