import { useMemo, useState } from 'react';
import type {
  AgentPolicy,
  PolicyEvaluationRequest,
  PolicyType,
  PolicyResponseAction,
} from '@veritas-kanban/shared';
import { ArrowLeft, Edit, FlaskConical, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import {
  useCreatePolicy,
  useDeletePolicy,
  useEvaluatePolicies,
  usePolicies,
  useUpdatePolicy,
} from '@/hooks/usePolicies';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';

interface PolicyManagerProps {
  onBack: () => void;
}

type PolicyFormState = {
  id: string;
  name: string;
  type: PolicyType;
  enabled: boolean;
  responseAction: PolicyResponseAction;
  description: string;
  scopeAgents: string;
  scopeProjects: string;
  scopeActionTypes: string;
  riskThreshold: string;
  riskComparator: 'gte' | 'gt' | 'lte' | 'lt';
  approvalReason: string;
  approvalApprovers: string;
  blockedActionTypes: string;
  rateLimitAttempts: string;
  rateLimitWindowMs: string;
  rateLimitScopeKey: 'agent' | 'project' | 'action-type' | 'global';
  webhookUrl: string;
  webhookMethod: 'GET' | 'POST';
  webhookTimeoutMs: string;
  webhookExpectedStatus: string;
  webhookExpectedBodyContains: string;
  webhookSendContext: boolean;
  webhookTriggerOn: 'success' | 'failure';
  preset?: 'strict' | 'balanced' | 'permissive';
  createdAt?: string;
};

type PreviewState = PolicyEvaluationRequest;

const DEFAULT_FORM: PolicyFormState = {
  id: '',
  name: '',
  type: 'risk-threshold',
  enabled: true,
  responseAction: 'warn',
  description: '',
  scopeAgents: '',
  scopeProjects: '',
  scopeActionTypes: '',
  riskThreshold: '70',
  riskComparator: 'gte',
  approvalReason: '',
  approvalApprovers: '',
  blockedActionTypes: '',
  rateLimitAttempts: '10',
  rateLimitWindowMs: '60000',
  rateLimitScopeKey: 'agent',
  webhookUrl: '',
  webhookMethod: 'POST',
  webhookTimeoutMs: '5000',
  webhookExpectedStatus: '200',
  webhookExpectedBodyContains: '',
  webhookSendContext: true,
  webhookTriggerOn: 'failure',
};

const DEFAULT_PREVIEW: PreviewState = {
  agent: 'codex',
  project: 'core',
  actionType: 'git.push',
  riskScore: 75,
  preview: true,
};

function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function scopeLabel(policy: AgentPolicy): string {
  const parts: string[] = [];
  if ((policy.scope.agents ?? []).length > 0)
    parts.push(`Agents: ${(policy.scope.agents ?? []).join(', ')}`);
  if ((policy.scope.projects ?? []).length > 0)
    parts.push(`Projects: ${(policy.scope.projects ?? []).join(', ')}`);
  if ((policy.scope.actionTypes ?? []).length > 0) {
    parts.push(`Actions: ${(policy.scope.actionTypes ?? []).join(', ')}`);
  }
  return parts.length > 0 ? parts.join(' | ') : 'Global';
}

function policyTypeLabel(type: PolicyType): string {
  switch (type) {
    case 'risk-threshold':
      return 'Risk Threshold';
    case 'require-approval':
      return 'Require Approval';
    case 'block-action-type':
      return 'Block Action Type';
    case 'rate-limit':
      return 'Rate Limit';
    case 'webhook-check':
      return 'Webhook Check';
  }
}

function responseVariant(
  action: PolicyResponseAction
): 'default' | 'destructive' | 'secondary' | 'outline' {
  if (action === 'block') return 'destructive';
  if (action === 'require-approval') return 'secondary';
  return 'outline';
}

function policyToForm(policy: AgentPolicy): PolicyFormState {
  const form: PolicyFormState = {
    ...DEFAULT_FORM,
    id: policy.id,
    name: policy.name,
    type: policy.type,
    enabled: policy.enabled,
    responseAction: policy.responseAction,
    description: policy.description || '',
    scopeAgents: (policy.scope.agents ?? []).join(', '),
    scopeProjects: (policy.scope.projects ?? []).join(', '),
    scopeActionTypes: (policy.scope.actionTypes ?? []).join(', '),
    preset: policy.preset,
    createdAt: policy.createdAt,
  };

  if (policy.type === 'risk-threshold') {
    form.riskThreshold = String(policy.config.threshold);
    form.riskComparator = policy.config.comparator ?? 'gte';
  } else if (policy.type === 'require-approval') {
    form.approvalReason = policy.config.reason || '';
    form.approvalApprovers = (policy.config.approvers ?? []).join(', ');
  } else if (policy.type === 'block-action-type') {
    form.blockedActionTypes = policy.config.actionTypes.join(', ');
  } else if (policy.type === 'rate-limit') {
    form.rateLimitAttempts = String(policy.config.maxAttempts);
    form.rateLimitWindowMs = String(policy.config.windowMs);
    form.rateLimitScopeKey = policy.config.scopeKey ?? 'global';
  } else if (policy.type === 'webhook-check') {
    form.webhookUrl = policy.config.url;
    form.webhookMethod = policy.config.method ?? 'POST';
    form.webhookTimeoutMs = String(policy.config.timeoutMs ?? 5000);
    form.webhookExpectedStatus = String(policy.config.expectedStatus ?? 200);
    form.webhookExpectedBodyContains = policy.config.expectedBodyContains || '';
    form.webhookSendContext = policy.config.sendContext ?? true;
    form.webhookTriggerOn = policy.config.triggerOn ?? 'failure';
  }

  return form;
}

function formToPolicy(form: PolicyFormState): AgentPolicy {
  const base = {
    id: form.id.trim(),
    name: form.name.trim(),
    type: form.type,
    enabled: form.enabled,
    scope: {
      agents: splitCsv(form.scopeAgents),
      projects: splitCsv(form.scopeProjects),
      actionTypes: splitCsv(form.scopeActionTypes),
    },
    responseAction: form.responseAction,
    description: form.description.trim() || undefined,
    preset: form.preset,
    createdAt: form.createdAt,
  };

  if (form.type === 'risk-threshold') {
    return {
      ...base,
      type: 'risk-threshold',
      config: {
        threshold: Number(form.riskThreshold),
        comparator: form.riskComparator,
      },
    };
  }

  if (form.type === 'require-approval') {
    return {
      ...base,
      type: 'require-approval',
      config: {
        reason: form.approvalReason.trim() || undefined,
        approvers: splitCsv(form.approvalApprovers),
      },
    };
  }

  if (form.type === 'block-action-type') {
    return {
      ...base,
      type: 'block-action-type',
      config: {
        actionTypes: splitCsv(form.blockedActionTypes),
      },
    };
  }

  if (form.type === 'rate-limit') {
    return {
      ...base,
      type: 'rate-limit',
      config: {
        maxAttempts: Number(form.rateLimitAttempts),
        windowMs: Number(form.rateLimitWindowMs),
        scopeKey: form.rateLimitScopeKey,
      },
    };
  }

  return {
    ...base,
    type: 'webhook-check',
    config: {
      url: form.webhookUrl.trim(),
      method: form.webhookMethod,
      timeoutMs: Number(form.webhookTimeoutMs),
      expectedStatus: Number(form.webhookExpectedStatus),
      expectedBodyContains: form.webhookExpectedBodyContains.trim() || undefined,
      sendContext: form.webhookSendContext,
      triggerOn: form.webhookTriggerOn,
    },
  };
}

export function PolicyManager({ onBack }: PolicyManagerProps) {
  const { toast } = useToast();
  const { data: policies = [], isLoading } = usePolicies();
  const createPolicy = useCreatePolicy();
  const updatePolicy = useUpdatePolicy();
  const deletePolicy = useDeletePolicy();
  const evaluatePolicies = useEvaluatePolicies();

  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [form, setForm] = useState<PolicyFormState>(DEFAULT_FORM);
  const [editingPolicyId, setEditingPolicyId] = useState<string | null>(null);
  const [previewPolicy, setPreviewPolicy] = useState<AgentPolicy | null>(null);
  const [previewInput, setPreviewInput] = useState<PreviewState>(DEFAULT_PREVIEW);

  const filteredPolicies = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return policies;

    return policies.filter((policy) => {
      return (
        policy.name.toLowerCase().includes(term) ||
        policy.id.toLowerCase().includes(term) ||
        policyTypeLabel(policy.type).toLowerCase().includes(term) ||
        scopeLabel(policy).toLowerCase().includes(term)
      );
    });
  }, [policies, search]);

  const openCreateDialog = () => {
    setEditingPolicyId(null);
    setForm(DEFAULT_FORM);
    setDialogOpen(true);
  };

  const openEditDialog = (policy: AgentPolicy) => {
    setEditingPolicyId(policy.id);
    setForm(policyToForm(policy));
    setDialogOpen(true);
  };

  const handleSave = async () => {
    try {
      const policy = formToPolicy(form);
      if (editingPolicyId) {
        await updatePolicy.mutateAsync({ id: editingPolicyId, policy });
        toast({ title: 'Policy updated', description: `${policy.name} was saved.` });
      } else {
        await createPolicy.mutateAsync(policy);
        toast({ title: 'Policy created', description: `${policy.name} was created.` });
      }
      setDialogOpen(false);
    } catch (error) {
      toast({
        title: 'Failed to save policy',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const handleToggle = async (policy: AgentPolicy, enabled: boolean) => {
    try {
      await updatePolicy.mutateAsync({
        id: policy.id,
        policy: {
          ...policy,
          enabled,
        },
      });
      toast({
        title: enabled ? 'Policy enabled' : 'Policy disabled',
        description: `${policy.name} is now ${enabled ? 'active' : 'inactive'}.`,
      });
    } catch (error) {
      toast({
        title: 'Failed to update policy',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async (policy: AgentPolicy) => {
    if (!window.confirm(`Delete policy "${policy.name}"?`)) {
      return;
    }

    try {
      await deletePolicy.mutateAsync(policy.id);
      toast({ title: 'Policy deleted', description: `${policy.name} was removed.` });
    } catch (error) {
      toast({
        title: 'Failed to delete policy',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const openPreview = (policy: AgentPolicy) => {
    setPreviewPolicy(policy);
    setPreviewInput((current) => ({
      ...current,
      actionType:
        policy.type === 'block-action-type'
          ? policy.config.actionTypes[0] || current.actionType
          : current.actionType,
    }));
    setPreviewOpen(true);
  };

  const columns: DataTableColumn<AgentPolicy>[] = [
    {
      key: 'name',
      header: 'Policy',
      cell: (policy) => (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="font-medium">{policy.name}</div>
            {policy.preset && (
              <Badge variant="outline" className="capitalize">
                {policy.preset}
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground">{policy.id}</div>
          {policy.description && (
            <div className="text-xs text-muted-foreground">{policy.description}</div>
          )}
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      cell: (policy) => <Badge variant="secondary">{policyTypeLabel(policy.type)}</Badge>,
    },
    {
      key: 'scope',
      header: 'Scope',
      cell: (policy) => (
        <div className="max-w-xs text-xs text-muted-foreground">{scopeLabel(policy)}</div>
      ),
    },
    {
      key: 'response',
      header: 'Response',
      cell: (policy) => (
        <Badge variant={responseVariant(policy.responseAction)}>{policy.responseAction}</Badge>
      ),
    },
    {
      key: 'enabled',
      header: 'Enabled',
      cell: (policy) => (
        <Switch
          checked={policy.enabled}
          onCheckedChange={(enabled) => {
            void handleToggle(policy, enabled);
          }}
          aria-label={`Toggle ${policy.name}`}
        />
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      className: 'w-[190px]',
      cell: (policy) => (
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => openEditDialog(policy)}>
            <Edit className="mr-1 h-3.5 w-3.5" />
            Edit
          </Button>
          <Button variant="outline" size="sm" onClick={() => openPreview(policy)}>
            <FlaskConical className="mr-1 h-3.5 w-3.5" />
            Test
          </Button>
          <Button variant="ghost" size="icon" onClick={() => void handleDelete(policy)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex h-screen flex-col gap-4 bg-background">
      <div className="border-b bg-card px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back to board">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-bold">
                <ShieldAlert className="h-6 w-6" />
                Agent Policies
              </h1>
              <p className="text-sm text-muted-foreground">
                Guard agent behavior with scoped policies, approval gates, rate limits, and webhook
                checks.
              </p>
            </div>
          </div>
          <Button onClick={openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            New Policy
          </Button>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-hidden px-6 pb-6">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border bg-card p-4">
            <div className="text-sm font-medium">Strict</div>
            <div className="mt-1 text-sm text-muted-foreground">
              Blocks high-risk actions immediately.
            </div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="text-sm font-medium">Balanced</div>
            <div className="mt-1 text-sm text-muted-foreground">
              Requires approval on elevated-risk actions.
            </div>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="text-sm font-medium">Permissive</div>
            <div className="mt-1 text-sm text-muted-foreground">
              Allows most activity and surfaces warnings for bursts.
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Input
            placeholder="Search policies by name, id, type, or scope..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="max-w-md"
          />
          <Badge variant="outline">{filteredPolicies.length} policies</Badge>
        </div>

        {isLoading ? (
          <div className="rounded-lg border bg-card p-8 text-muted-foreground">
            Loading policies...
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={filteredPolicies}
            rowKey={(policy) => policy.id}
            emptyMessage="No policies match the current filter."
          />
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editingPolicyId ? 'Edit Policy' : 'Create Policy'}</DialogTitle>
            <DialogDescription>
              Define when the policy applies, what it checks, and how the agent should respond.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="policy-id">Policy ID</Label>
              <Input
                id="policy-id"
                value={form.id}
                onChange={(event) => setForm((current) => ({ ...current, id: event.target.value }))}
                disabled={Boolean(editingPolicyId)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="policy-name">Name</Label>
              <Input
                id="policy-name"
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({ ...current, name: event.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={form.type}
                onValueChange={(value: PolicyType) =>
                  setForm((current) => ({ ...current, type: value }))
                }
                disabled={Boolean(editingPolicyId)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="risk-threshold">Risk Threshold</SelectItem>
                  <SelectItem value="require-approval">Require Approval</SelectItem>
                  <SelectItem value="block-action-type">Block Action Type</SelectItem>
                  <SelectItem value="rate-limit">Rate Limit</SelectItem>
                  <SelectItem value="webhook-check">Webhook Check</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Response Action</Label>
              <Select
                value={form.responseAction}
                onValueChange={(value: PolicyResponseAction) =>
                  setForm((current) => ({ ...current, responseAction: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="warn">Warn</SelectItem>
                  <SelectItem value="require-approval">Require Approval</SelectItem>
                  <SelectItem value="block">Block</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="policy-description">Description</Label>
              <Textarea
                id="policy-description"
                value={form.description}
                onChange={(event) =>
                  setForm((current) => ({ ...current, description: event.target.value }))
                }
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="scope-agents">Scope: Agents</Label>
              <Input
                id="scope-agents"
                placeholder="codex, reviewer"
                value={form.scopeAgents}
                onChange={(event) =>
                  setForm((current) => ({ ...current, scopeAgents: event.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="scope-projects">Scope: Projects</Label>
              <Input
                id="scope-projects"
                placeholder="core, docs"
                value={form.scopeProjects}
                onChange={(event) =>
                  setForm((current) => ({ ...current, scopeProjects: event.target.value }))
                }
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="scope-actions">Scope: Action Types</Label>
              <Input
                id="scope-actions"
                placeholder="git.push, deploy.release"
                value={form.scopeActionTypes}
                onChange={(event) =>
                  setForm((current) => ({ ...current, scopeActionTypes: event.target.value }))
                }
              />
            </div>
          </div>

          {form.type === 'risk-threshold' && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="risk-threshold">Threshold</Label>
                <Input
                  id="risk-threshold"
                  type="number"
                  value={form.riskThreshold}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, riskThreshold: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Comparator</Label>
                <Select
                  value={form.riskComparator}
                  onValueChange={(value: 'gte' | 'gt' | 'lte' | 'lt') =>
                    setForm((current) => ({ ...current, riskComparator: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gte">Greater than or equal</SelectItem>
                    <SelectItem value="gt">Greater than</SelectItem>
                    <SelectItem value="lte">Less than or equal</SelectItem>
                    <SelectItem value="lt">Less than</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {form.type === 'require-approval' && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="approval-reason">Reason</Label>
                <Textarea
                  id="approval-reason"
                  value={form.approvalReason}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, approvalReason: event.target.value }))
                  }
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="approval-approvers">Approvers</Label>
                <Input
                  id="approval-approvers"
                  placeholder="lead, security"
                  value={form.approvalApprovers}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, approvalApprovers: event.target.value }))
                  }
                />
              </div>
            </div>
          )}

          {form.type === 'block-action-type' && (
            <div className="space-y-2">
              <Label htmlFor="blocked-actions">Blocked Action Types</Label>
              <Input
                id="blocked-actions"
                placeholder="git.force-push, prod.delete"
                value={form.blockedActionTypes}
                onChange={(event) =>
                  setForm((current) => ({ ...current, blockedActionTypes: event.target.value }))
                }
              />
            </div>
          )}

          {form.type === 'rate-limit' && (
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="rate-attempts">Max Attempts</Label>
                <Input
                  id="rate-attempts"
                  type="number"
                  value={form.rateLimitAttempts}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, rateLimitAttempts: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rate-window">Window (ms)</Label>
                <Input
                  id="rate-window"
                  type="number"
                  value={form.rateLimitWindowMs}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, rateLimitWindowMs: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Rate Limit Key</Label>
                <Select
                  value={form.rateLimitScopeKey}
                  onValueChange={(value: 'agent' | 'project' | 'action-type' | 'global') =>
                    setForm((current) => ({ ...current, rateLimitScopeKey: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="agent">Agent</SelectItem>
                    <SelectItem value="project">Project</SelectItem>
                    <SelectItem value="action-type">Action Type</SelectItem>
                    <SelectItem value="global">Global</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {form.type === 'webhook-check' && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="webhook-url">Webhook URL</Label>
                <Input
                  id="webhook-url"
                  value={form.webhookUrl}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, webhookUrl: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Method</Label>
                <Select
                  value={form.webhookMethod}
                  onValueChange={(value: 'GET' | 'POST') =>
                    setForm((current) => ({ ...current, webhookMethod: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GET">GET</SelectItem>
                    <SelectItem value="POST">POST</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Trigger On</Label>
                <Select
                  value={form.webhookTriggerOn}
                  onValueChange={(value: 'success' | 'failure') =>
                    setForm((current) => ({ ...current, webhookTriggerOn: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="failure">Failure</SelectItem>
                    <SelectItem value="success">Success</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="webhook-timeout">Timeout (ms)</Label>
                <Input
                  id="webhook-timeout"
                  type="number"
                  value={form.webhookTimeoutMs}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, webhookTimeoutMs: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="webhook-status">Expected Status</Label>
                <Input
                  id="webhook-status"
                  type="number"
                  value={form.webhookExpectedStatus}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      webhookExpectedStatus: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="webhook-body-contains">Expected Body Contains</Label>
                <Input
                  id="webhook-body-contains"
                  value={form.webhookExpectedBodyContains}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      webhookExpectedBodyContains: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border px-3 py-2 md:col-span-2">
                <div>
                  <div className="text-sm font-medium">Send evaluation context</div>
                  <div className="text-xs text-muted-foreground">
                    Include agent, project, action type, and metadata in the webhook payload.
                  </div>
                </div>
                <Switch
                  checked={form.webhookSendContext}
                  onCheckedChange={(checked) =>
                    setForm((current) => ({ ...current, webhookSendContext: checked }))
                  }
                />
              </div>
            </div>
          )}

          <div className="flex items-center justify-between rounded-lg border px-3 py-2">
            <div>
              <div className="text-sm font-medium">Enabled</div>
              <div className="text-xs text-muted-foreground">
                Disabled policies stay configured but are ignored during evaluation.
              </div>
            </div>
            <Switch
              checked={form.enabled}
              onCheckedChange={(checked) =>
                setForm((current) => ({ ...current, enabled: checked }))
              }
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleSave()}
              disabled={createPolicy.isPending || updatePolicy.isPending}
            >
              {editingPolicyId ? 'Save Changes' : 'Create Policy'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Test Policy Evaluation</DialogTitle>
            <DialogDescription>
              Preview how the guard engine would evaluate an action before an agent executes it.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="preview-agent">Agent</Label>
              <Input
                id="preview-agent"
                value={previewInput.agent || ''}
                onChange={(event) =>
                  setPreviewInput((current) => ({ ...current, agent: event.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="preview-project">Project</Label>
              <Input
                id="preview-project"
                value={previewInput.project || ''}
                onChange={(event) =>
                  setPreviewInput((current) => ({ ...current, project: event.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="preview-action">Action Type</Label>
              <Input
                id="preview-action"
                value={previewInput.actionType}
                onChange={(event) =>
                  setPreviewInput((current) => ({ ...current, actionType: event.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="preview-risk">Risk Score</Label>
              <Input
                id="preview-risk"
                type="number"
                value={previewInput.riskScore ?? ''}
                onChange={(event) =>
                  setPreviewInput((current) => ({
                    ...current,
                    riskScore: event.target.value ? Number(event.target.value) : undefined,
                  }))
                }
              />
            </div>
          </div>

          {previewPolicy && (
            <div className="rounded-lg border bg-muted/20 p-3 text-sm">
              Testing against <span className="font-medium">{previewPolicy.name}</span>. Evaluation
              runs against all enabled policies so you can see collisions and escalations.
            </div>
          )}

          {evaluatePolicies.data && (
            <div className="space-y-3 rounded-lg border bg-card p-4">
              <div className="flex items-center gap-2">
                <Badge
                  variant={evaluatePolicies.data.decision === 'block' ? 'destructive' : 'secondary'}
                >
                  {evaluatePolicies.data.decision}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {evaluatePolicies.data.matches.length} matching policies
                </span>
              </div>
              <div className="space-y-2">
                {evaluatePolicies.data.matches.map((match) => (
                  <div key={match.policyId} className="rounded-md border px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="font-medium">{match.policyName}</div>
                      <Badge variant={responseVariant(match.responseAction)}>
                        {match.responseAction}
                      </Badge>
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">{match.message}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>
              Close
            </Button>
            <Button
              onClick={() => void evaluatePolicies.mutateAsync({ ...previewInput, preview: true })}
              disabled={evaluatePolicies.isPending}
            >
              {evaluatePolicies.isPending ? 'Evaluating...' : 'Run Preview'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
