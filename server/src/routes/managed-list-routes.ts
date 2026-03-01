import { Router } from 'express';
import { z } from 'zod';
import type { ManagedListItem } from '@veritas-kanban/shared';
import type { ManagedListService } from '../services/managed-list-service.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { NotFoundError, ValidationError, BadRequestError } from '../middleware/error-handler.js';

/**
 * Create a generic Express router for a ManagedListService instance
 */
export function createManagedListRouter<T extends ManagedListItem>(
  service: ManagedListService<T>,
  createSchema?: z.ZodType<any>,
  updateSchema?: z.ZodType<any>
): Router {
  const router = Router();

  // GET / - List all items
  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const includeHidden = req.query.includeHidden === 'true';
      const items = await service.list(includeHidden);
      res.json(items);
    })
  );

  // GET /:id - Get a single item
  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const item = await service.get(req.params.id as string);
      if (!item) {
        throw new NotFoundError('Item not found');
      }
      res.json(item);
    })
  );

  // POST / - Create a new item
  router.post(
    '/',
    asyncHandler(async (req, res) => {
      let data;
      try {
        data = createSchema ? createSchema.parse(req.body) : req.body;
      } catch (err: any) {
        if (err.name === 'ZodError') {
          throw new ValidationError('Validation error', err.issues);
        }
        throw err;
      }

      const item = await service.create(data);
      res.status(201).json(item);
    })
  );

  // PATCH /:id - Update an item
  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      let data;
      try {
        data = updateSchema ? updateSchema.parse(req.body) : req.body;
      } catch (err: any) {
        if (err.name === 'ZodError') {
          throw new ValidationError('Validation error', err.issues);
        }
        throw err;
      }

      const item = await service.update(req.params.id as string, data);
      if (!item) {
        throw new NotFoundError('Item not found');
      }
      res.json(item);
    })
  );

  // DELETE /:id - Delete an item
  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const force = req.query.force === 'true';
      const result = await service.delete(req.params.id as string, force);

      if (!result.deleted) {
        if (result.referenceCount !== undefined && result.referenceCount > 0) {
          throw new BadRequestError('Cannot delete item with references', {
            referenceCount: result.referenceCount,
          });
        }
        throw new BadRequestError('Cannot delete default item or item not found');
      }

      res.status(204).send();
    })
  );

  // GET /:id/can-delete - Check if item can be deleted
  router.get(
    '/:id/can-delete',
    asyncHandler(async (req, res) => {
      const result = await service.canDelete(req.params.id as string);
      res.json(result);
    })
  );

  // POST /reorder - Reorder items
  router.post(
    '/reorder',
    asyncHandler(async (req, res) => {
      let orderedIds: string[];
      try {
        const schema = z.object({
          orderedIds: z.array(z.string()),
        });
        ({ orderedIds } = schema.parse(req.body));
      } catch (err: any) {
        if (err.name === 'ZodError') {
          throw new ValidationError('Validation error', err.issues);
        }
        throw err;
      }
      const items = await service.reorder(orderedIds);
      res.json(items);
    })
  );

  return router;
}
