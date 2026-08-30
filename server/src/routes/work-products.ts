import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import type { WorkProduct } from '@veritas-kanban/shared';
import { asyncHandler } from '../middleware/async-handler.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { BadRequestError, NotFoundError, ValidationError } from '../middleware/error-handler.js';
import { getWorkProductArtifactService } from '../services/work-product-artifact-service.js';
import { getWorkProductService } from '../services/work-product-service.js';
import {
  CreateWorkProductBodySchema,
  UpdateWorkProductBodySchema,
  WorkProductExportQuerySchema,
  RegisterWorkProductArtifactBodySchema,
  WorkProductArtifactPurgeQuerySchema,
  WorkProductArtifactPreviewAuditBodySchema,
  WorkProductArtifactPreviewQuerySchema,
  WorkProductArtifactVersionQuerySchema,
  WorkProductListQuerySchema,
} from '../schemas/work-product-schemas.js';
import { getWorkProductArtifactPreviewService } from '../services/work-product-artifact-preview-service.js';
import { auditLog } from '../services/audit-service.js';
import { actorFromRequest } from '../utils/concurrency.js';

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

function authenticatedWorkspace(req: AuthenticatedRequest): string {
  return req.auth?.workspaceId ?? 'local';
}

function assertWorkspaceAccess(
  req: AuthenticatedRequest,
  product: WorkProduct | null
): WorkProduct {
  if (!product || product.workspaceId !== authenticatedWorkspace(req)) {
    throw new NotFoundError('Work product not found');
  }
  return product;
}

router.get(
  '/',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const parsed = WorkProductListQuerySchema.safeParse(req.query);
    if (!parsed.success) throw validationError(parsed.error);

    const service = getWorkProductService();
    const query = parsed.data;
    const products = (
      await service.list({
        workspaceId: authenticatedWorkspace(req),
        taskId: query.taskId,
        sourceRunId: query.sourceRunId,
        agent: query.agent,
        kind: query.kind,
        status: query.status,
        query: query.q,
        includeArchived: query.includeArchived === 'true',
        limit: query.limit,
      })
    ).filter((product) => product.workspaceId === authenticatedWorkspace(req));

    res.json(
      query.view === 'preview' ? products.map((product) => service.toPreview(product)) : products
    );
  })
);

router.post(
  '/',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const parsed = CreateWorkProductBodySchema.safeParse({
      ...req.body,
      workspaceId: authenticatedWorkspace(req),
    });
    if (!parsed.success) throw validationError(parsed.error);

    const product = await getWorkProductService().create(parsed.data);
    res.status(201).json(product);
  })
);

router.get(
  '/maintenance-preview',
  asyncHandler(async (_req, res) => {
    res.json(await getWorkProductService().maintenancePreview());
  })
);

router.post(
  '/artifacts/register',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const parsed = RegisterWorkProductArtifactBodySchema.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error);
    const registration = await getWorkProductArtifactService().register({
      workspaceId: req.auth?.workspaceId ?? 'local',
      ...parsed.data,
    });
    res.status(201).json(registration);
  })
);

router.get(
  '/artifacts',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const parsed = WorkProductListQuerySchema.safeParse(req.query);
    if (!parsed.success) throw validationError(parsed.error);
    const products = await getWorkProductArtifactService().list({
      workspaceId: req.auth?.workspaceId ?? 'local',
      taskId: parsed.data.taskId,
      sourceRunId: parsed.data.sourceRunId,
      includeArchived: parsed.data.includeArchived === 'true',
      limit: parsed.data.limit,
    });
    res.json(
      parsed.data.view === 'preview'
        ? products.map((product) => getWorkProductService().toPreview(product))
        : products
    );
  })
);

router.get(
  '/:id/artifact',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const product = await getWorkProductArtifactService().inspect({
      workspaceId: req.auth?.workspaceId ?? 'local',
      productId: req.params.id as string,
    });
    if (!product) throw new NotFoundError('File work product not found');
    res.json(product);
  })
);

router.get(
  '/:id/artifact/versions',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    res.json(
      await getWorkProductArtifactService().listVersions({
        workspaceId: req.auth?.workspaceId ?? 'local',
        productId: req.params.id as string,
      })
    );
  })
);

router.get(
  '/:id/artifact/preview',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const parsed = WorkProductArtifactPreviewQuerySchema.safeParse(req.query);
    if (!parsed.success) throw validationError(parsed.error);
    res.set('Cache-Control', 'private, no-store');
    const preview = await getWorkProductArtifactPreviewService().preview({
      workspaceId: req.auth?.workspaceId || 'local',
      productId: req.params.id as string,
      version: parsed.data.version,
    });
    if (preview.artifact?.mediaType.toLowerCase().split(';', 1)[0] === 'text/html') {
      await auditLog({
        action: 'artifact.preview.html.prepared',
        actor: actorFromRequest(req),
        resource: preview.artifact.productId,
        details: {
          artifactId: preview.artifact.id,
          version: preview.artifact.version,
          status: preview.status,
          renderer: preview.renderer,
          interactive: false,
        },
      });
    }
    res.json(preview);
  })
);

router.post(
  '/:id/artifact/preview/audit',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const parsed = WorkProductArtifactPreviewAuditBodySchema.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error);
    const productId = req.params.id as string;
    const versions = await getWorkProductArtifactService().listVersions({
      workspaceId: authenticatedWorkspace(req),
      productId,
    });
    const artifact = parsed.data.version
      ? versions.find((candidate) => candidate.version === parsed.data.version)
      : [...versions].sort((left, right) => right.version - left.version)[0];
    if (!artifact) throw new NotFoundError('Work product artifact version not found');
    if (artifact.mediaType.toLowerCase().split(';', 1)[0] !== 'text/html') {
      throw new BadRequestError('HTML preview audit events require an HTML artifact.');
    }
    await auditLog({
      action: `artifact.preview.html.${parsed.data.action}`,
      actor: actorFromRequest(req),
      resource: productId,
      details: {
        artifactId: artifact.id,
        version: artifact.version,
        state: artifact.state,
        interactive: false,
      },
    });
    res.status(204).end();
  })
);

router.get(
  '/:id/artifact/download',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const parsed = WorkProductArtifactVersionQuerySchema.safeParse(req.query);
    if (!parsed.success) throw validationError(parsed.error);
    const download = await getWorkProductArtifactService().download({
      workspaceId: req.auth?.workspaceId ?? 'local',
      productId: req.params.id as string,
      version: parsed.data.version,
    });
    if (!download) throw new NotFoundError('Work product artifact is unavailable');
    res.attachment(download.metadata.safeName);
    res.type(download.metadata.mediaType);
    res.set(
      'Content-Digest',
      `sha-256=:${Buffer.from(download.metadata.sha256, 'hex').toString('base64')}:`
    );
    res.set('X-Artifact-SHA256', download.metadata.sha256);
    res.set('ETag', `"sha256-${download.metadata.sha256}"`);
    res.set('Cache-Control', 'private, immutable');
    res.set('Content-Length', String(download.content.byteLength));
    res.send(Buffer.from(download.content));
  })
);

router.delete(
  '/:id/artifact',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const parsed = WorkProductArtifactPurgeQuerySchema.safeParse(req.query);
    if (!parsed.success) throw validationError(parsed.error);
    res.json(
      await getWorkProductArtifactService().purge({
        workspaceId: authenticatedWorkspace(req),
        productId: req.params.id as string,
        confirmation: parsed.data.confirm,
      })
    );
  })
);

router.get(
  '/:id',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const product = assertWorkspaceAccess(
      req,
      await getWorkProductService().get(req.params.id as string)
    );

    if (req.query.view === 'preview') {
      res.json(getWorkProductService().toPreview(product));
      return;
    }

    res.json(product);
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const parsed = UpdateWorkProductBodySchema.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error);

    const current = assertWorkspaceAccess(
      req,
      await getWorkProductService().get(req.params.id as string)
    );
    if (current.kind === 'file') {
      throw new BadRequestError(
        'File Work Products can only be updated through governed artifact registration.'
      );
    }
    const product = await getWorkProductService().update(req.params.id as string, parsed.data);
    if (!product) throw new NotFoundError('Work product not found');

    res.json(product);
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    assertWorkspaceAccess(req, await getWorkProductService().get(req.params.id as string));
    const product = await getWorkProductService().archive(req.params.id as string);
    if (!product) throw new NotFoundError('Work product not found');

    res.json(product);
  })
);

router.get(
  '/:id/versions',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const product = assertWorkspaceAccess(
      req,
      await getWorkProductService().get(req.params.id as string)
    );

    res.json(await getWorkProductService().listVersions(product.id));
  })
);

router.post(
  '/:id/versions/:version/restore',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const version = Number.parseInt(req.params.version as string, 10);
    if (!Number.isInteger(version) || version < 1) {
      throw new ValidationError('Invalid version');
    }

    assertWorkspaceAccess(req, await getWorkProductService().get(req.params.id as string));
    const product = await getWorkProductService().restoreVersion(req.params.id as string, version);
    if (!product) throw new NotFoundError('Work product version not found');

    res.json(product);
  })
);

router.get(
  '/:id/export',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const parsed = WorkProductExportQuerySchema.safeParse(req.query);
    if (!parsed.success) throw validationError(parsed.error);

    const product = assertWorkspaceAccess(
      req,
      await getWorkProductService().get(req.params.id as string)
    );

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
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const service = getWorkProductService();
    const products = (
      await service.list({
        workspaceId: authenticatedWorkspace(req),
        taskId: req.params.id as string,
        includeArchived: req.query.includeArchived === 'true',
        limit: req.query.limit ? Number.parseInt(req.query.limit as string, 10) : undefined,
      })
    ).filter((product) => product.workspaceId === authenticatedWorkspace(req));
    res.json(
      req.query.view === 'preview'
        ? products.map((product) => service.toPreview(product))
        : products
    );
  })
);

taskRouter.post(
  '/:id/work-products',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const parsed = CreateWorkProductBodySchema.safeParse({
      ...req.body,
      taskId: req.params.id,
      workspaceId: authenticatedWorkspace(req),
    });
    if (!parsed.success) throw validationError(parsed.error);

    const product = await getWorkProductService().create(parsed.data);
    res.status(201).json(product);
  })
);

export { router as workProductRoutes, taskRouter as taskWorkProductRoutes };
