import { Router, type Router as RouterType } from 'express';
import { asyncHandler } from '../middleware/async-handler.js';
import { BadRequestError, NotFoundError } from '../middleware/error-handler.js';
import { WorkspaceCapabilityService } from '../services/workspace-capability-service.js';
import {
  WorkspaceCapabilityFormatSchema,
  WorkspaceCapabilityImportBodySchema,
  WorkspaceCapabilityIntakeBodySchema,
  WorkspaceCapabilityManifestSchema,
  WorkspaceCapabilityValidateBodySchema,
} from '../schemas/workspace-capability-schemas.js';

const router: RouterType = Router();
const workspaceCapabilityService = new WorkspaceCapabilityService();

router.get(
  '/manifest',
  asyncHandler(async (_req, res) => {
    res.json(await workspaceCapabilityService.getLocalManifest());
  })
);

router.put(
  '/manifest',
  asyncHandler(async (req, res) => {
    const manifest = WorkspaceCapabilityManifestSchema.parse(req.body);
    res.json(await workspaceCapabilityService.saveLocalManifest(manifest));
  })
);

router.post(
  '/manifest/validate',
  asyncHandler(async (req, res) => {
    const input = WorkspaceCapabilityValidateBodySchema.parse(req.body);
    res.json(workspaceCapabilityService.validateInput(input));
  })
);

router.post(
  '/manifest/import',
  asyncHandler(async (req, res) => {
    const input = WorkspaceCapabilityImportBodySchema.parse(req.body);
    res.status(201).json(await workspaceCapabilityService.importLocalManifest(input));
  })
);

router.get(
  '/manifest/export',
  asyncHandler(async (req, res) => {
    const format =
      WorkspaceCapabilityFormatSchema.parse(req.query.format) ??
      (req.query.format === 'json' ? 'json' : 'yaml');
    res.json(await workspaceCapabilityService.exportLocalManifest(format));
  })
);

router.get(
  '/trusted',
  asyncHandler(async (_req, res) => {
    res.json(await workspaceCapabilityService.listTrustedManifests());
  })
);

router.post(
  '/trusted',
  asyncHandler(async (req, res) => {
    const input = WorkspaceCapabilityImportBodySchema.parse(req.body);
    const result = await workspaceCapabilityService.registerTrustedManifest(input);
    res.status(result.created ? 201 : 200).json(result);
  })
);

router.delete(
  '/trusted/:workspaceId',
  asyncHandler(async (req, res) => {
    const removed = await workspaceCapabilityService.removeTrustedManifest(
      req.params.workspaceId as string
    );
    if (!removed) throw new NotFoundError(`Trusted workspace not found: ${req.params.workspaceId}`);
    res.status(204).send();
  })
);

router.get(
  '/discover',
  asyncHandler(async (_req, res) => {
    res.json(await workspaceCapabilityService.discover());
  })
);

router.post(
  '/intake',
  asyncHandler(async (req, res) => {
    const input = WorkspaceCapabilityIntakeBodySchema.parse(req.body);
    try {
      res.status(201).json(await workspaceCapabilityService.intake(input));
    } catch (error) {
      if (error instanceof BadRequestError || error instanceof NotFoundError) throw error;
      throw error;
    }
  })
);

router.get(
  '/delegations',
  asyncHandler(async (_req, res) => {
    res.json(await workspaceCapabilityService.listDelegations());
  })
);

router.post(
  '/delegations/:id/refresh',
  asyncHandler(async (req, res) => {
    res.json(await workspaceCapabilityService.refreshDelegation(req.params.id as string));
  })
);

export { router as workspaceCapabilityRoutes };
