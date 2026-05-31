import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/async-handler.js';
import { NotFoundError, ValidationError } from '../middleware/error-handler.js';
import { getWorkProductService } from '../services/work-product-service.js';
import {
  CreateWorkProductBodySchema,
  UpdateWorkProductBodySchema,
  WorkProductExportQuerySchema,
  WorkProductListQuerySchema,
} from '../schemas/work-product-schemas.js';

const router: RouterType = Router();
const taskRouter: RouterType = Router();

function validationError(error: z.ZodError): ValidationError {
  return new ValidationError(
    'Validation failed',
    error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }))
  );
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = WorkProductListQuerySchema.safeParse(req.query);
    if (!parsed.success) throw validationError(parsed.error);

    const service = getWorkProductService();
    const query = parsed.data;
    const products = await service.list({
      taskId: query.taskId,
      sourceRunId: query.sourceRunId,
      agent: query.agent,
      kind: query.kind,
      status: query.status,
      query: query.q,
      includeArchived: query.includeArchived === 'true',
      limit: query.limit,
    });

    res.json(
      query.view === 'preview' ? products.map((product) => service.toPreview(product)) : products
    );
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = CreateWorkProductBodySchema.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error);

    const product = await getWorkProductService().create(parsed.data);
    res.status(201).json(product);
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const product = await getWorkProductService().get(req.params.id as string);
    if (!product) throw new NotFoundError('Work product not found');

    if (req.query.view === 'preview') {
      res.json(getWorkProductService().toPreview(product));
      return;
    }

    res.json(product);
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const parsed = UpdateWorkProductBodySchema.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error);

    const product = await getWorkProductService().update(req.params.id as string, parsed.data);
    if (!product) throw new NotFoundError('Work product not found');

    res.json(product);
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const product = await getWorkProductService().archive(req.params.id as string);
    if (!product) throw new NotFoundError('Work product not found');

    res.json(product);
  })
);

router.get(
  '/:id/versions',
  asyncHandler(async (req, res) => {
    const product = await getWorkProductService().get(req.params.id as string);
    if (!product) throw new NotFoundError('Work product not found');

    res.json(await getWorkProductService().listVersions(product.id));
  })
);

router.post(
  '/:id/versions/:version/restore',
  asyncHandler(async (req, res) => {
    const version = Number.parseInt(req.params.version as string, 10);
    if (!Number.isInteger(version) || version < 1) {
      throw new ValidationError('Invalid version');
    }

    const product = await getWorkProductService().restoreVersion(req.params.id as string, version);
    if (!product) throw new NotFoundError('Work product version not found');

    res.json(product);
  })
);

router.get(
  '/:id/export',
  asyncHandler(async (req, res) => {
    const parsed = WorkProductExportQuerySchema.safeParse(req.query);
    if (!parsed.success) throw validationError(parsed.error);

    const product = await getWorkProductService().get(req.params.id as string);
    if (!product) throw new NotFoundError('Work product not found');

    const format = parsed.data.format ?? 'markdown';
    const redacted =
      parsed.data.redacted === undefined ? undefined : parsed.data.redacted === 'true';
    const exported = getWorkProductService().exportProduct(product, { format, redacted });

    if (format === 'json') {
      res.type('application/json').send(exported);
      return;
    }

    res.type('text/markdown').send(exported);
  })
);

taskRouter.get(
  '/:id/work-products',
  asyncHandler(async (req, res) => {
    const service = getWorkProductService();
    const products = await service.list({
      taskId: req.params.id as string,
      includeArchived: req.query.includeArchived === 'true',
      limit: req.query.limit ? Number.parseInt(req.query.limit as string, 10) : undefined,
    });
    res.json(
      req.query.view === 'preview'
        ? products.map((product) => service.toPreview(product))
        : products
    );
  })
);

taskRouter.post(
  '/:id/work-products',
  asyncHandler(async (req, res) => {
    const parsed = CreateWorkProductBodySchema.safeParse({
      ...req.body,
      taskId: req.params.id,
    });
    if (!parsed.success) throw validationError(parsed.error);

    const product = await getWorkProductService().create(parsed.data);
    res.status(201).json(product);
  })
);

export { router as workProductRoutes, taskRouter as taskWorkProductRoutes };
