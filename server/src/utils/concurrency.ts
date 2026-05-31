import type { Request, Response } from 'express';
import { ConflictError } from '../middleware/error-handler.js';
import type { AuthContext, AuthenticatedRequest } from '../middleware/auth.js';

export interface RevisionedResource {
  revision?: number;
  version?: number;
}

export interface RevisionConflictDetails {
  resourceType: string;
  resourceId: string;
  expectedRevision: number;
  currentRevision: number;
  current: unknown;
}

function parseRevisionValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed === '*') {
    return undefined;
  }

  const normalized = trimmed.replace(/^W\//, '').replace(/^"|"$/g, '');
  const direct = Number.parseInt(normalized, 10);
  if (/^\d+$/.test(normalized) && Number.isInteger(direct)) {
    return direct;
  }

  const revisionSegment = normalized.match(/:(\d+)$/);
  if (!revisionSegment?.[1]) {
    return undefined;
  }

  const revision = Number.parseInt(revisionSegment[1], 10);
  return Number.isInteger(revision) ? revision : undefined;
}

export function actorFromRequest(req: AuthenticatedRequest): string {
  const auth: AuthContext | undefined = req.auth;
  if (!auth) {
    return 'system:unknown';
  }

  const actorType = auth.actorType ?? (auth.role === 'agent' ? 'agent' : 'service');
  const actorId =
    actorType === 'user'
      ? auth.userId || auth.keyName || auth.tokenName
      : actorType === 'localhost-bypass'
        ? auth.keyName || auth.userId || 'localhost'
        : auth.tokenName || auth.keyName || auth.userId;

  return `${actorType}:${actorId || 'unknown'}`;
}

export function resourceRevision(resource: RevisionedResource | null | undefined): number {
  const revision = resource?.revision ?? resource?.version;
  return typeof revision === 'number' && Number.isInteger(revision) && revision >= 0 ? revision : 1;
}

export function revisionEtag(resourceType: string, resourceId: string, revision: number): string {
  return `"${resourceType}:${resourceId}:${revision}"`;
}

export function setRevisionHeaders(
  res: Response,
  resourceType: string,
  resourceId: string,
  resource: RevisionedResource | number
): void {
  const revision = typeof resource === 'number' ? resource : resourceRevision(resource);
  res.setHeader('ETag', revisionEtag(resourceType, resourceId, revision));
  res.setHeader('X-Resource-Revision', String(revision));
}

export function expectedRevisionFromRequest(req: Request): number | undefined {
  const ifMatch = req.header('if-match');
  if (ifMatch) {
    for (const candidate of ifMatch.split(',')) {
      const revision = parseRevisionValue(candidate);
      if (revision !== undefined) {
        return revision;
      }
    }
  }

  const headerRevision = parseRevisionValue(req.header('x-resource-revision'));
  if (headerRevision !== undefined) {
    return headerRevision;
  }

  const body = req.body as Record<string, unknown> | undefined;
  return parseRevisionValue(body?.expectedRevision);
}

export function assertFreshRevision(
  req: Request,
  resourceType: string,
  resourceId: string,
  current: RevisionedResource,
  currentPayload: unknown = current
): void {
  const expectedRevision = expectedRevisionFromRequest(req);
  if (expectedRevision === undefined) {
    return;
  }

  const currentRevision = resourceRevision(current);
  if (expectedRevision === currentRevision) {
    return;
  }

  const details: RevisionConflictDetails = {
    resourceType,
    resourceId,
    expectedRevision,
    currentRevision,
    current: currentPayload,
  };

  throw new ConflictError(
    `${resourceType} ${resourceId} has changed since it was loaded. Reload and retry with the latest revision.`,
    details
  );
}
