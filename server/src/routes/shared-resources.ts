/**
 * Shared Resources API Routes
 *
 * GET    /api/shared-resources             — List all (filters: type, project, tag, name)
 * GET    /api/shared-resources/:id         — Get one
 * POST   /api/shared-resources             — Create
 * PATCH  /api/shared-resources/:id         — Update
 * DELETE /api/shared-resources/:id         — Delete
 * POST   /api/shared-resources/:id/mount   — Mount to project(s)
 * POST   /api/shared-resources/:id/unmount — Unmount from project(s)
 */

import { Router, type Router as RouterType } from 'express';
import {
  SharedResourceCreateSchema,
  SharedResourceUpdateSchema,
  SharedResourceMountSchema,
  SharedResourceListQuerySchema,
} from '../schemas/shared-resources-schemas.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { NotFoundError, ValidationError } from '../middleware/error-handler.js';
import { getSharedResourcesService } from '../services/shared-resources-service.js';

const router: RouterType = Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    let query;
    try {
      query = SharedResourceListQuerySchema.parse(req.query);
    } catch (err: any) {
      if (err.name === 'ZodError') {
        throw new ValidationError('Validation error', err.issues);
      }
      throw err;
    }

    const service = getSharedResourcesService();
    const resources = await service.listResources({
      type: query.type,
      project: query.project,
      tag: query.tag,
      name: query.name,
    });
    res.json(resources);
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const service = getSharedResourcesService();
    const resource = await service.getResource(String(req.params.id));
    if (!resource) throw new NotFoundError('Shared resource not found');
    res.json(resource);
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    let data;
    try {
      data = SharedResourceCreateSchema.parse(req.body);
    } catch (err: any) {
      if (err.name === 'ZodError') {
        throw new ValidationError('Validation error', err.issues);
      }
      throw err;
    }

    const service = getSharedResourcesService();
    const resource = await service.createResource(data);
    res.status(201).json(resource);
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    let update;
    try {
      update = SharedResourceUpdateSchema.parse(req.body);
    } catch (err: any) {
      if (err.name === 'ZodError') {
        throw new ValidationError('Validation error', err.issues);
      }
      throw err;
    }

    const service = getSharedResourcesService();
    const resource = await service.updateResource(String(req.params.id), update);
    if (!resource) throw new NotFoundError('Shared resource not found');
    res.json(resource);
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const service = getSharedResourcesService();
    const success = await service.deleteResource(String(req.params.id));
    if (!success) throw new NotFoundError('Shared resource not found');
    res.json({ success: true });
  })
);

router.post(
  '/:id/mount',
  asyncHandler(async (req, res) => {
    let data;
    try {
      data = SharedResourceMountSchema.parse(req.body);
    } catch (err: any) {
      if (err.name === 'ZodError') {
        throw new ValidationError('Validation error', err.issues);
      }
      throw err;
    }

    const service = getSharedResourcesService();
    const resource = await service.mountResource(String(req.params.id), data.projectIds);
    if (!resource) throw new NotFoundError('Shared resource not found');
    res.json(resource);
  })
);

router.post(
  '/:id/unmount',
  asyncHandler(async (req, res) => {
    let data;
    try {
      data = SharedResourceMountSchema.parse(req.body);
    } catch (err: any) {
      if (err.name === 'ZodError') {
        throw new ValidationError('Validation error', err.issues);
      }
      throw err;
    }

    const service = getSharedResourcesService();
    const resource = await service.unmountResource(String(req.params.id), data.projectIds);
    if (!resource) throw new NotFoundError('Shared resource not found');
    res.json(resource);
  })
);

export { router as sharedResourcesRoutes };
