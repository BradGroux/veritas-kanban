import { describe, it, expect, vi } from 'vitest';
import type { NextFunction, Response } from 'express';
import type { AuthenticatedRequest } from '../../middleware/auth.js';
import {
  activityAccess,
  agentPermissionAccess,
  agentRegistryAccess,
  agentRoutingAccess,
  diffAccess,
  policyAccess,
  previewAccess,
  scoringAccess,
  searchAccess,
  settingsAccess,
  taskAccess,
  taskCommentAccess,
  workflowAccess,
} from '../../routes/v1/permissions.js';

type AccessGuard = (req: AuthenticatedRequest, res: Response, next: NextFunction) => void;

function mockRequest(
  method: string,
  path: string,
  role: 'admin' | 'agent' | 'read-only' = 'agent'
): AuthenticatedRequest {
  return {
    method,
    path,
    auth: { role, isLocalhost: false },
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
  it('blocks read-only callers from task, settings, workflow, comment, and approval mutations', () => {
    const blockedMutations: Array<{
      guard: AccessGuard;
      method: string;
      path: string;
      required: string;
    }> = [
      { guard: taskAccess, method: 'POST', path: '/', required: 'task:write' },
      { guard: settingsAccess, method: 'PATCH', path: '/features', required: 'settings:write' },
      { guard: workflowAccess, method: 'POST', path: '/', required: 'workflow:write' },
      {
        guard: taskCommentAccess,
        method: 'POST',
        path: '/task_20260531_readonly/comments',
        required: 'comment:write',
      },
      {
        guard: agentPermissionAccess,
        method: 'POST',
        path: '/approvals',
        required: 'task:write',
      },
    ];

    for (const mutation of blockedMutations) {
      const { res, next } = runGuard(
        mutation.guard,
        mockRequest(mutation.method, mutation.path, 'read-only')
      );

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({
            required: [mutation.required],
            currentRole: 'read-only',
          }),
        })
      );
    }
  });

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
    expect(
      runGuard(workflowAccess, mockRequest('POST', '/workflow-1/dry-run')).next
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

  it('requires workflow execution before Codex review can launch from diff routes', () => {
    expect(runGuard(diffAccess, mockRequest('GET', '/task_1')).next).toHaveBeenCalled();
    expect(
      runGuard(diffAccess, mockRequest('POST', '/task_1/codex-review')).next
    ).toHaveBeenCalled();

    const readOnlyReview = runGuard(
      diffAccess,
      mockRequest('POST', '/task_1/codex-review', 'read-only')
    );
    expect(readOnlyReview.next).not.toHaveBeenCalled();
    expect(readOnlyReview.res.status).toHaveBeenCalledWith(403);
    expect(readOnlyReview.res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({ required: ['workflow:execute'] }),
      })
    );

    const genericMutation = runGuard(diffAccess, mockRequest('POST', '/task_1/other', 'read-only'));
    expect(genericMutation.next).not.toHaveBeenCalled();
    expect(genericMutation.res.status).toHaveBeenCalledWith(403);
    expect(genericMutation.res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({ required: ['task:write'] }),
      })
    );
  });

  it('keeps agent self-service reads and checks narrow while guarding privileged writes', () => {
    expect(runGuard(agentPermissionAccess, mockRequest('POST', '/check')).next).toHaveBeenCalled();
    expect(
      runGuard(agentPermissionAccess, mockRequest('POST', '/approvals')).next
    ).toHaveBeenCalled();
    expect(runGuard(agentRoutingAccess, mockRequest('POST', '/route')).next).toHaveBeenCalled();

    const readOnlyApproval = runGuard(
      agentPermissionAccess,
      mockRequest('POST', '/approvals', 'read-only')
    );
    expect(readOnlyApproval.next).not.toHaveBeenCalled();
    expect(readOnlyApproval.res.status).toHaveBeenCalledWith(403);
    expect(readOnlyApproval.res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({ required: ['task:write'] }),
      })
    );

    const readOnlyRegistration = runGuard(
      agentRegistryAccess,
      mockRequest('POST', '/', 'read-only')
    );
    expect(readOnlyRegistration.next).not.toHaveBeenCalled();
    expect(readOnlyRegistration.res.status).toHaveBeenCalledWith(403);
    expect(readOnlyRegistration.res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({ required: ['telemetry:write'] }),
      })
    );

    const agentApprovalReview = runGuard(
      agentPermissionAccess,
      mockRequest('POST', '/approvals/a1')
    );
    expect(agentApprovalReview.next).not.toHaveBeenCalled();
    expect(agentApprovalReview.res.status).toHaveBeenCalledWith(403);
    expect(agentApprovalReview.res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({ required: ['admin:manage'] }),
      })
    );

    const routingConfigUpdate = runGuard(agentRoutingAccess, mockRequest('PUT', '/routing'));
    expect(routingConfigUpdate.next).not.toHaveBeenCalled();
    expect(routingConfigUpdate.res.status).toHaveBeenCalledWith(403);
    expect(routingConfigUpdate.res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({ required: ['admin:manage'] }),
      })
    );
  });

  it('requires admin permission before preview routes can start local processes', () => {
    expect(runGuard(previewAccess, mockRequest('GET', '/task_1')).next).toHaveBeenCalled();

    const startAsAgent = runGuard(previewAccess, mockRequest('POST', '/task_1/start'));
    expect(startAsAgent.next).not.toHaveBeenCalled();
    expect(startAsAgent.res.status).toHaveBeenCalledWith(403);
    expect(startAsAgent.res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({ required: ['admin:manage'] }),
      })
    );

    expect(
      runGuard(previewAccess, mockRequest('POST', '/task_1/start', 'admin')).next
    ).toHaveBeenCalled();
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
