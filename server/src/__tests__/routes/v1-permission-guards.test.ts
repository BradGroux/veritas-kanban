import { describe, it, expect, vi } from 'vitest';
import type { NextFunction, Response } from 'express';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import {
  activityAccess,
  policyAccess,
  scoringAccess,
  searchAccess,
  settingsAccess,
  workflowAccess,
} from '../../routes/v1/permissions.js';

type AccessGuard = (req: AuthenticatedRequest, res: Response, next: NextFunction) => void;

function mockRequest(method: string, path: string): AuthenticatedRequest {
  return {
    method,
    path,
    auth: { role: 'agent', isLocalhost: false },
  } as unknown as AuthenticatedRequest;
}

function mockResponse(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

function runGuard(handler: AccessGuard, req: AuthenticatedRequest) {
  const res = mockResponse();
  const next = vi.fn() as NextFunction;
  handler(req, res, next);
  return { res, next };
}

describe('v1 REST permission guard presets', () => {
  it('blocks agent keys from settings mutations at the route boundary', () => {
    const { res, next } = runGuard(settingsAccess, mockRequest('PATCH', '/features'));

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'FORBIDDEN',
        details: expect.objectContaining({
          required: ['settings:write'],
          currentRole: 'agent',
        }),
      })
    );
  });

  it('requires admin permission for destructive telemetry maintenance routes', () => {
    const { res, next } = runGuard(activityAccess, mockRequest('DELETE', '/'));

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          required: ['admin:manage'],
          currentRole: 'agent',
        }),
      })
    );
  });

  it('keeps read-like search POSTs available while guarding index refresh', () => {
    expect(runGuard(searchAccess, mockRequest('POST', '/')).next).toHaveBeenCalled();

    const { res, next } = runGuard(searchAccess, mockRequest('POST', '/index/refresh'));
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({ required: ['settings:write'] }),
      })
    );
  });

  it('keeps policy evaluation available to agent keys without opening policy mutations', () => {
    expect(runGuard(policyAccess, mockRequest('POST', '/evaluate')).next).toHaveBeenCalled();

    const { res, next } = runGuard(policyAccess, mockRequest('POST', '/'));
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({ required: ['policy:read'] }),
      })
    );
  });

  it('separates workflow execution from workflow authoring permissions', () => {
    expect(
      runGuard(workflowAccess, mockRequest('POST', '/workflow-1/runs')).next
    ).toHaveBeenCalled();

    const { res, next } = runGuard(workflowAccess, mockRequest('POST', '/'));
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({ required: ['workflow:write'] }),
      })
    );
  });

  it('keeps scoring evaluation read-like while guarding scoring profile mutations', () => {
    expect(runGuard(scoringAccess, mockRequest('POST', '/evaluate')).next).toHaveBeenCalled();

    const { res, next } = runGuard(scoringAccess, mockRequest('POST', '/profiles'));
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({ required: ['settings:write'] }),
      })
    );
  });
});
