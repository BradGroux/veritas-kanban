import { useMemo, useState } from 'react';
import type {
  AgentPolicy,
  PolicyEvaluationRequest,
  PolicyType,
  PolicyResponseAction,
} from '@veritas-kanban/shared';
import {
  ArrowLeft,
  Edit,
  ExternalLink,
  FlaskConical,
  Plus,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Modal,
  Select,
  Switch,
  Textarea,
  TextInput,
} from '@mantine/core';
import { useToast } from '@/hooks/useToast';
import {
  useCreatePolicy,
  useDeletePolicy,
  useEvaluatePolicies,
  usePolicies,
  useUpdatePolicy,
} from '@/hooks/usePolicies';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';

interface PolicyManagerProps {
  onBack: () => void;
}

const BASE_PATH = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');

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

const policyTypeSelectData = [
  { value: 'risk-threshold', label: 'Risk Threshold' },
  { value: 'require-approval', label: 'Require Approval' },
  { value: 'block-action-type', label: 'Block Action Type' },
  { value: 'rate-limit', label: 'Rate Limit' },
  { value: 'webhook-check', label: 'Webhook Check' },
];

const responseActionSelectData = [
  { value: 'warn', label: 'Warn' },
  { value: 'require-approval', label: 'Require Approval' },
  { value: 'block', label: 'Block' },
];

const comparatorSelectData = [
  { value: 'gte', label: 'Greater than or equal' },
  { value: 'gt', label: 'Greater than' },
  { value: 'lte', label: 'Less than or equal' },
  { value: 'lt', label: 'Less than' },
];

const rateLimitScopeSelectData = [
  { value: 'agent', label: 'Agent' },
  { value: 'project', label: 'Project' },
  { value: 'action-type', label: 'Action Type' },
  { value: 'global', label: 'Global' },
];

const webhookMethodSelectData = [
  { value: 'GET', label: 'GET' },
  { value: 'POST', label: 'POST' },
];

const webhookTriggerSelectData = [
  { value: 'failure', label: 'Failure' },
  { value: 'success', label: 'Success' },
];

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

function responseColor(action: PolicyResponseAction | 'allow') {
  if (action === 'block') return 'red';
  if (action === 'require-approval') return 'yellow';
  return 'gray';
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
              <Badge variant="outline" tt="none" className="capitalize">
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
      cell: (policy) => (
        <Badge variant="light" tt="none">
          {policyTypeLabel(policy.type)}
        </Badge>
      ),
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
        <Badge color={responseColor(policy.responseAction)} variant="light" tt="none">
          {policy.responseAction}
        </Badge>
      ),
    },
    {
      key: 'enabled',
      header: 'Enabled',
      cell: (policy) => (
        <Switch
          checked={policy.enabled}
          onChange={(event) => {
            void handleToggle(policy, event.currentTarget.checked);
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
          <ActionIcon
            variant="subtle"
            onClick={() => void handleDelete(policy)}
            aria-label={`Delete ${policy.name}`}
          >
            <Trash2 className="h-4 w-4" />
          </ActionIcon>
        </div>
      ),
    },
  ];

  return (
    <div className="flex h-screen flex-col gap-4 bg-background">
      <div className="border-b bg-card px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <ActionIcon variant="subtle" onClick={onBack} aria-label="Back">
              <ArrowLeft className="h-4 w-4" />
            </ActionIcon>
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
          <TextInput
            placeholder="Search policies by name, id, type, or scope..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="max-w-md"
          />
          <Badge variant="outline" tt="none">
            {filteredPolicies.length} policies
          </Badge>
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

      <Modal
        opened={dialogOpen}
        onClose={() => setDialogOpen(false)}
        size="xl"
        centered
        title={
          <div>
            <div className="text-lg font-semibold">
              {editingPolicyId ? 'Edit Policy' : 'Create Policy'}
            </div>
            <div className="text-sm text-muted-foreground">
              Define when the policy applies, what it checks, and how the agent should respond.
            </div>
          </div>
        }
      >
        <div className="max-h-[75vh] overflow-y-auto pr-2">
          <div className="grid gap-4 py-2 md:grid-cols-2">
            <div className="space-y-2">
              <TextInput
                id="policy-id"
                label="Policy ID"
                value={form.id}
                onChange={(event) => setForm((current) => ({ ...current, id: event.target.value }))}
                disabled={Boolean(editingPolicyId)}
              />
            </div>
            <div className="space-y-2">
              <TextInput
                id="policy-name"
                label="Name"
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({ ...current, name: event.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Select
                label="Type"
                value={form.type}
                onChange={(value) => {
                  if (!value) return;
                  setForm((current) => ({ ...current, type: value as PolicyType }));
                }}
                data={policyTypeSelectData}
                disabled={Boolean(editingPolicyId)}
                allowDeselect={false}
              />
            </div>
            <div className="space-y-2">
              <Select
                label="Response Action"
                value={form.responseAction}
                onChange={(value) => {
                  if (!value) return;
                  setForm((current) => ({
                    ...current,
                    responseAction: value as PolicyResponseAction,
                  }));
                }}
                data={responseActionSelectData}
                allowDeselect={false}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Textarea
                id="policy-description"
                label="Description"
                value={form.description}
                onChange={(event) =>
                  setForm((current) => ({ ...current, description: event.target.value }))
                }
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <TextInput
                id="scope-agents"
                label="Scope: Agents"
                placeholder="codex, reviewer"
                value={form.scopeAgents}
                onChange={(event) =>
                  setForm((current) => ({ ...current, scopeAgents: event.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <TextInput
                id="scope-projects"
                label="Scope: Projects"
                placeholder="core, docs"
                value={form.scopeProjects}
                onChange={(event) =>
                  setForm((current) => ({ ...current, scopeProjects: event.target.value }))
                }
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <TextInput
                id="scope-actions"
                label="Scope: Action Types"
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
                <TextInput
                  id="risk-threshold"
                  label="Threshold"
                  type="number"
                  value={form.riskThreshold}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, riskThreshold: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Select
                  label="Comparator"
                  value={form.riskComparator}
                  onChange={(value) => {
                    if (!value) return;
                    setForm((current) => ({
                      ...current,
                      riskComparator: value as 'gte' | 'gt' | 'lte' | 'lt',
                    }));
                  }}
                  data={comparatorSelectData}
                  allowDeselect={false}
                />
              </div>
            </div>
          )}

          {form.type === 'require-approval' && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Textarea
                  id="approval-reason"
                  label="Reason"
                  value={form.approvalReason}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, approvalReason: event.target.value }))
                  }
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <TextInput
                  id="approval-approvers"
                  label="Approvers"
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
              <TextInput
                id="blocked-actions"
                label="Blocked Action Types"
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
                <TextInput
                  id="rate-attempts"
                  label="Max Attempts"
                  type="number"
                  value={form.rateLimitAttempts}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, rateLimitAttempts: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <TextInput
                  id="rate-window"
                  label="Window (ms)"
                  type="number"
                  value={form.rateLimitWindowMs}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, rateLimitWindowMs: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Select
                  label="Rate Limit Key"
                  value={form.rateLimitScopeKey}
                  onChange={(value) => {
                    if (!value) return;
                    setForm((current) => ({
                      ...current,
                      rateLimitScopeKey: value as 'agent' | 'project' | 'action-type' | 'global',
                    }));
                  }}
                  data={rateLimitScopeSelectData}
                  allowDeselect={false}
                />
              </div>
            </div>
          )}

          {form.type === 'webhook-check' && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <TextInput
                  id="webhook-url"
                  label="Webhook URL"
                  value={form.webhookUrl}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, webhookUrl: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Select
                  label="Method"
                  value={form.webhookMethod}
                  onChange={(value) => {
                    if (!value) return;
                    setForm((current) => ({ ...current, webhookMethod: value as 'GET' | 'POST' }));
                  }}
                  data={webhookMethodSelectData}
                  allowDeselect={false}
                />
              </div>
              <div className="space-y-2">
                <Select
                  label="Trigger On"
                  value={form.webhookTriggerOn}
                  onChange={(value) => {
                    if (!value) return;
                    setForm((current) => ({
                      ...current,
                      webhookTriggerOn: value as 'success' | 'failure',
                    }));
                  }}
                  data={webhookTriggerSelectData}
                  allowDeselect={false}
                />
              </div>
              <div className="space-y-2">
                <TextInput
                  id="webhook-timeout"
                  label="Timeout (ms)"
                  type="number"
                  value={form.webhookTimeoutMs}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, webhookTimeoutMs: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <TextInput
                  id="webhook-status"
                  label="Expected Status"
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
                <TextInput
                  id="webhook-body-contains"
                  label="Expected Body Contains"
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
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      webhookSendContext: event.currentTarget.checked,
                    }))
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
              onChange={(event) =>
                setForm((current) => ({ ...current, enabled: event.currentTarget.checked }))
              }
            />
          </div>

          <Group justify="flex-end" mt="md">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleSave()}
              disabled={createPolicy.isPending || updatePolicy.isPending}
            >
              {editingPolicyId ? 'Save Changes' : 'Create Policy'}
            </Button>
          </Group>
        </div>
      </Modal>

      <Modal
        opened={previewOpen}
        onClose={() => setPreviewOpen(false)}
        size="lg"
        centered
        title={
          <div>
            <div className="text-lg font-semibold">Test Policy Evaluation</div>
            <div className="text-sm text-muted-foreground">
              Preview how the guard engine would evaluate an action before an agent executes it.
            </div>
          </div>
        }
      >
        <div className="grid gap-4 py-2 md:grid-cols-2">
          <div className="space-y-2">
            <TextInput
              id="preview-agent"
              label="Agent"
              value={previewInput.agent || ''}
              onChange={(event) =>
                setPreviewInput((current) => ({ ...current, agent: event.target.value }))
              }
            />
          </div>
          <div className="space-y-2">
            <TextInput
              id="preview-project"
              label="Project"
              value={previewInput.project || ''}
              onChange={(event) =>
                setPreviewInput((current) => ({ ...current, project: event.target.value }))
              }
            />
          </div>
          <div className="space-y-2">
            <TextInput
              id="preview-action"
              label="Action Type"
              value={previewInput.actionType}
              onChange={(event) =>
                setPreviewInput((current) => ({ ...current, actionType: event.target.value }))
              }
            />
          </div>
          <div className="space-y-2">
            <TextInput
              id="preview-risk"
              label="Risk Score"
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
                color={responseColor(evaluatePolicies.data.decision)}
                variant="light"
                tt="none"
              >
                {evaluatePolicies.data.decision}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {evaluatePolicies.data.matches.length} matching policies
              </span>
              {evaluatePolicies.data.traceId && (
                <Button
                  component="a"
                  href={`${BASE_PATH}/decisions?trace=${encodeURIComponent(evaluatePolicies.data.traceId)}`}
                  size="xs"
                  variant="subtle"
                  target="_self"
                >
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                  Open Trace
                </Button>
              )}
            </div>
            <div className="space-y-2">
              {evaluatePolicies.data.matches.map((match) => (
                <div key={match.policyId} className="rounded-md border px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="font-medium">{match.policyName}</div>
                    <Badge color={responseColor(match.responseAction)} variant="light" tt="none">
                      {match.responseAction}
                    </Badge>
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">{match.message}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <Group justify="flex-end" mt="md">
          <Button variant="outline" onClick={() => setPreviewOpen(false)}>
            Close
          </Button>
          <Button
            onClick={() => void evaluatePolicies.mutateAsync({ ...previewInput, preview: true })}
            disabled={evaluatePolicies.isPending}
          >
            {evaluatePolicies.isPending ? 'Evaluating...' : 'Run Preview'}
          </Button>
        </Group>
      </Modal>
    </div>
  );
}
