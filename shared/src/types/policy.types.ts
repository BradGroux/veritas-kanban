export type PolicyType =
  | 'risk-threshold'
  | 'require-approval'
  | 'block-action-type'
  | 'rate-limit'
  | 'webhook-check';

export type PolicyResponseAction = 'block' | 'warn' | 'require-approval';

export type PolicyScopeKey = 'agent' | 'project' | 'action-type' | 'global';

export interface PolicyScope {
  agents?: string[];
  projects?: string[];
  actionTypes?: string[];
}

export interface RiskThreshold {
  threshold: number;
  comparator?: 'gte' | 'gt' | 'lte' | 'lt';
}

export interface RequireApproval {
  reason?: string;
  approvers?: string[];
}

export interface BlockActionType {
  actionTypes: string[];
}

export interface RateLimit {
  maxAttempts: number;
  windowMs: number;
  scopeKey?: PolicyScopeKey;
}

export interface WebhookCheck {
  url: string;
  method?: 'GET' | 'POST';
  timeoutMs?: number;
  expectedStatus?: number;
  expectedBodyContains?: string;
  sendContext?: boolean;
  triggerOn?: 'success' | 'failure';
}

export interface PolicyConfigMap {
  'risk-threshold': RiskThreshold;
  'require-approval': RequireApproval;
  'block-action-type': BlockActionType;
  'rate-limit': RateLimit;
  'webhook-check': WebhookCheck;
}

export interface BasePolicy<TType extends PolicyType = PolicyType> {
  id: string;
  name: string;
  type: TType;
  enabled: boolean;
  scope: PolicyScope;
  responseAction: PolicyResponseAction;
  config: PolicyConfigMap[TType];
  description?: string;
  preset?: 'strict' | 'balanced' | 'permissive';
  createdAt?: string;
  updatedAt?: string;
}

export type AgentPolicy =
  | BasePolicy<'risk-threshold'>
  | BasePolicy<'require-approval'>
  | BasePolicy<'block-action-type'>
  | BasePolicy<'rate-limit'>
  | BasePolicy<'webhook-check'>;

export interface PolicyEvaluationRequest {
  agent?: string;
  project?: string;
  actionType: string;
  riskScore?: number;
  preview?: boolean;
  metadata?: Record<string, unknown>;
}

export interface PolicyEvaluationMatch {
  policyId: string;
  policyName: string;
  policyType: PolicyType;
  responseAction: PolicyResponseAction;
  message: string;
  details?: Record<string, unknown>;
}

export interface PolicyEvaluationResult {
  decision: 'allow' | 'warn' | 'require-approval' | 'block';
  matches: PolicyEvaluationMatch[];
  warnings: string[];
  blockedBy: string[];
  approvalRequiredBy: string[];
}
