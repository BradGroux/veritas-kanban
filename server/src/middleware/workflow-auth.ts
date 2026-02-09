/**
 * Workflow Authentication & Authorization Middleware
 * Handles ACL checks for workflow operations
 */

import type { WorkflowACL, WorkflowPermission } from '../types/workflow.js';
import { getWorkflowService } from '../services/workflow-service.js';
import { ForbiddenError } from './error-handler.js';

/**
 * Check if a user has permission to perform an action on a workflow
 */
export async function checkWorkflowPermission(
  workflowId: string,
  userId: string,
  permission: WorkflowPermission
): Promise<boolean> {
  // Load ACL from .veritas-kanban/workflows/.acl.json
  const workflowService = getWorkflowService();
  const acl = await workflowService.loadACL(workflowId);

  // No ACL entry means system workflow (public view/execute)
  if (!acl) {
    return permission === 'view' || permission === 'execute' || permission === 'create';
  }

  // Owner has all permissions
  if (acl.owner === userId) return true;

  // System workflows (shipped by VK) are view/execute only for all users
  if (acl.owner === 'system') {
    return permission === 'view' || permission === 'execute';
  }

  // Check specific permissions
  switch (permission) {
    case 'view':
      return acl.isPublic || acl.viewers.includes(userId) || acl.editors.includes(userId);
    case 'execute':
      return acl.isPublic || acl.executors.includes(userId) || acl.editors.includes(userId);
    case 'edit':
      return acl.editors.includes(userId);
    case 'delete':
      return acl.owner === userId; // Only owner can delete
    case 'create':
      return true; // Any authenticated user can create workflows
    default:
      return false;
  }
}

/**
 * Assert that a user has permission to perform an action on a workflow
 * Throws ForbiddenError if permission is denied
 */
export async function assertWorkflowPermission(
  workflowId: string,
  userId: string,
  permission: WorkflowPermission
): Promise<void> {
  const hasPermission = await checkWorkflowPermission(workflowId, userId, permission);
  if (!hasPermission) {
    throw new ForbiddenError(`You do not have permission to ${permission} workflow ${workflowId}`);
  }
}
