import {
  authorizePermissionByMethod,
  type AuthPermission,
  type MethodPermissionOverride,
} from '../../middleware/auth.js';

type PermissionSpec = AuthPermission | AuthPermission[];

function routeAccess(
  read: PermissionSpec,
  write: PermissionSpec = read,
  overrides: MethodPermissionOverride[] = []
) {
  return authorizePermissionByMethod({ read, write, overrides });
}

export const taskAccess = routeAccess('task:read', 'task:write');
export const taskReadAccess = routeAccess('task:read', 'task:read');
export const taskCommentAccess = routeAccess('task:read', 'comment:write');
export const workProductAccess = routeAccess('work_product:read', 'work_product:write');
export const diffAccess = routeAccess('task:read', 'task:write', [
  { methods: ['POST'], path: /^\/[^/]+\/codex-review\/?$/, permissions: 'workflow:execute' },
]);
export const settingsAccess = routeAccess('settings:read', 'settings:write');
export const adminAccess = routeAccess('admin:manage', 'admin:manage');
export const agentRegistryAccess = routeAccess('agent:read', 'telemetry:write');
export const agentPermissionAccess = routeAccess('agent:read', 'admin:manage', [
  { methods: ['POST'], path: /^\/check\/?$/, permissions: 'agent:read' },
  { methods: ['POST'], path: /^\/approvals\/?$/, permissions: 'task:write' },
]);
export const agentRoutingAccess = routeAccess('agent:read', 'admin:manage', [
  { methods: ['POST'], path: /^\/route\/?$/, permissions: 'agent:read' },
  { methods: ['POST'], path: /^\/hosts\/preview\/?$/, permissions: 'agent:read' },
  { methods: ['POST'], path: /^\/[^/]+\/(start|stop)\/?$/, permissions: 'agent:write' },
  { methods: ['POST'], path: /^\/[^/]+\/message\/?$/, permissions: 'task:write' },
]);
export const agentTaskAccess = routeAccess('agent:read', 'task:write', [
  { methods: ['POST'], path: /^\/[^/]+\/(start|stop)\/?$/, permissions: 'agent:write' },
]);
export const agentStatusAccess = routeAccess('agent:read', 'telemetry:write');
export const reportAccess = routeAccess('report:read', 'report:read');
export const telemetryAccess = routeAccess('telemetry:read', 'telemetry:write');
export const policyAccess = routeAccess('policy:read', 'policy:read', [
  { methods: ['POST'], path: /^\/evaluate\/?$/, permissions: ['policy:read', 'agent:read'] },
]);
export const sandboxPolicyAccess = routeAccess('policy:read', 'policy:write', [
  { methods: ['POST'], path: /^\/validate\/?$/, permissions: ['policy:read', 'agent:read'] },
]);
export const skillCapabilityAccess = routeAccess('policy:read', 'policy:write', [
  {
    methods: ['POST'],
    path: /^\/[^/]+\/remediation-task\/?$/,
    permissions: ['policy:write', 'task:write'],
  },
]);
export const skillSecurityAccess = routeAccess('policy:read', 'admin:manage', [
  { methods: ['POST'], path: /^\/scan\/?$/, permissions: 'admin:manage' },
]);
export const backupAccess = routeAccess('backup:read', 'backup:write', [
  { methods: ['POST'], path: /^\/skill-security\/scan\/?$/, permissions: 'admin:manage' },
]);
export const previewAccess = routeAccess('task:read', 'admin:manage');
export const workspaceAccess = routeAccess('workspace:read', 'admin:manage');
export const workspaceCapabilityAccess = routeAccess('workspace:read', 'settings:write', [
  { methods: ['POST'], path: /^\/manifest\/validate\/?$/, permissions: 'workspace:read' },
  { methods: ['POST'], path: /^\/intake\/?$/, permissions: 'task:write' },
  { methods: ['GET'], path: /^\/delegations(?:\/.*)?$/, permissions: 'task:read' },
  { methods: ['POST'], path: /^\/delegations\/[^/]+\/refresh\/?$/, permissions: 'task:write' },
]);
export const notificationAccess = routeAccess('agent:read', 'comment:write');
export const broadcastAccess = routeAccess('task:read', 'comment:write');
export const activityAccess = routeAccess('telemetry:read', 'admin:manage');
export const costPredictionAccess = routeAccess('report:read', 'task:write');
export const statusHistoryAccess = routeAccess('telemetry:read', 'admin:manage');
export const delegationAccess = routeAccess('agent:read', 'admin:manage');
export const transcriptAccess = routeAccess('workspace:read', 'workflow:execute');
export const feedbackAccess = routeAccess('report:read', 'comment:write');

export const configAccess = routeAccess('settings:read', 'settings:write', [
  { methods: ['POST'], path: /^\/repos\/validate\/?$/, permissions: 'settings:read' },
]);

export const searchAccess = routeAccess('task:read', 'settings:write', [
  { methods: ['POST'], path: /^\/?$/, permissions: ['task:read', 'work_product:read'] },
]);

export const workflowAccess = routeAccess('workflow:read', 'workflow:write', [
  { methods: ['POST'], path: /^\/[^/]+\/runs\/?$/, permissions: 'workflow:execute' },
  { methods: ['POST'], path: /^\/[^/]+\/dry-run\/?$/, permissions: 'workflow:execute' },
  { methods: ['POST'], path: /^\/runs\/[^/]+\/resume\/?$/, permissions: 'workflow:execute' },
  {
    methods: ['POST'],
    path: /^\/runs\/[^/]+\/steps\/[^/]+\/(approve|reject)\/?$/,
    permissions: 'workflow:execute',
  },
]);

export const schedulerAccess = routeAccess('workflow:read', 'workflow:write', [
  { methods: ['POST'], path: /^\/items\/[^/]+\/run\/?$/, permissions: 'workflow:execute' },
  { methods: ['POST'], path: /^\/items\/[^/]+\/validate\/?$/, permissions: 'workflow:read' },
  { methods: ['POST'], path: /^\/due\/run\/?$/, permissions: 'workflow:execute' },
]);

export const watcherPolicyAccess = routeAccess('policy:read', 'policy:write', [
  { methods: ['POST'], path: /^\/evaluate\/?$/, permissions: ['policy:read', 'agent:read'] },
]);

export const reportRoutesAccess = routeAccess('report:read', 'settings:write', [
  { methods: ['POST'], path: /^\/generate\/?$/, permissions: 'report:read' },
]);

export const scoringAccess = routeAccess('report:read', 'settings:write', [
  { methods: ['POST'], path: /^\/evaluate\/?$/, permissions: 'report:read' },
]);

export const promptRegistryAccess = routeAccess('settings:read', 'settings:write', [
  { methods: ['POST'], path: /^\/[^/]+\/render-preview\/?$/, permissions: 'settings:read' },
  { methods: ['POST'], path: /^\/[^/]+\/record-usage\/?$/, permissions: 'telemetry:write' },
]);
