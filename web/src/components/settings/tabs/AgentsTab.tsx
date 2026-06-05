import { useState, useCallback, useEffect, useMemo } from 'react';
import { ActionIcon, Badge, Button, Modal, Select, Switch, Text, TextInput } from '@mantine/core';
import { useCodexHealth, useConfig, useProviderHealth, useUpdateAgents } from '@/hooks/useConfig';
import { useFeatureSettings, useDebouncedFeatureUpdate } from '@/hooks/useFeatureSettings';
import { useRoutingConfig, useUpdateRoutingConfig } from '@/hooks/useRouting';
import { useAgentHostPreview, useAgentHosts } from '@/hooks/useAgent';
import {
  Bot,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  Route,
  ChevronDown,
  ChevronUp,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Server,
} from 'lucide-react';
import type {
  AgentConfig,
  AgentHostCompatibilityResponse,
  AgentHostHealthResponse,
  AgentHostPosture,
  AgentHostPreviewRequest,
  AgentHostRecord,
  AgentType,
  RoutingRule,
  AgentRoutingConfig,
} from '@veritas-kanban/shared';
import type {
  CodexHealthStatus,
  ContextProviderHealth,
  ContextProviderPostureStatus,
  ContextProviderHealthResponse,
} from '@/lib/api';
import { DEFAULT_FEATURE_SETTINGS, DEFAULT_ROUTING_CONFIG } from '@veritas-kanban/shared';
import { cn } from '@/lib/utils';
import { ToggleRow, NumberRow, SectionHeader, SaveIndicator } from '../shared';

type AgentFeatureSettings = typeof DEFAULT_FEATURE_SETTINGS.agents;

export function AgentsTab() {
  const { data: config, isLoading } = useConfig();
  const {
    data: codexHealth,
    isFetching: isCodexHealthFetching,
    refetch: refetchCodexHealth,
  } = useCodexHealth();
  const {
    data: providerHealth,
    isFetching: isProviderHealthFetching,
    refetch: refetchProviderHealth,
  } = useProviderHealth();
  const { settings } = useFeatureSettings();
  const { debouncedUpdate, isPending } = useDebouncedFeatureUpdate();
  const updateAgents = useUpdateAgents();
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingAgent, setEditingAgent] = useState<string | null>(null);

  const update = <K extends keyof AgentFeatureSettings>(key: K, value: AgentFeatureSettings[K]) => {
    debouncedUpdate({ agents: { [key]: value } as Partial<AgentFeatureSettings> });
  };

  const handleToggleAgent = (agentType: AgentType) => {
    if (!config) return;
    const updatedAgents = config.agents.map((a) =>
      a.type === agentType ? { ...a, enabled: !a.enabled } : a
    );
    updateAgents.mutate(updatedAgents);
  };

  const handleAddAgent = (agent: AgentConfig) => {
    if (!config) return;
    updateAgents.mutate([...config.agents, agent]);
    setShowAddForm(false);
  };

  const handleEditAgent = (originalType: string, updated: AgentConfig) => {
    if (!config) return;
    const updatedAgents = config.agents.map((a) => (a.type === originalType ? updated : a));
    updateAgents.mutate(updatedAgents);
    setEditingAgent(null);
  };

  const handleRemoveAgent = (agentType: string) => {
    if (!config) return;
    const updatedAgents = config.agents.filter((a) => a.type !== agentType);
    updateAgents.mutate(updatedAgents);
  };

  const resetAgents = () => {
    debouncedUpdate({ agents: DEFAULT_FEATURE_SETTINGS.agents });
  };

  const isDefault = (type: string) => config?.defaultAgent === type;

  return (
    <div className="space-y-6">
      {/* Agent List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Installed Agents</h3>
          {!showAddForm && (
            <Button
              variant="outline"
              size="xs"
              leftSection={<Plus className="h-4 w-4" />}
              onClick={() => setShowAddForm(true)}
            >
              Add Agent
            </Button>
          )}
        </div>

        {showAddForm && (
          <AgentForm
            existingTypes={config?.agents.map((a) => a.type) || []}
            onSubmit={handleAddAgent}
            onCancel={() => setShowAddForm(false)}
          />
        )}

        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading...</div>
        ) : config?.agents.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4 text-center border rounded-md border-dashed">
            No agents configured. Add one to get started.
          </div>
        ) : (
          <div className="space-y-2">
            {config?.agents.map((agent) =>
              editingAgent === agent.type ? (
                <AgentForm
                  key={agent.type}
                  agent={agent}
                  existingTypes={config.agents
                    .filter((a) => a.type !== agent.type)
                    .map((a) => a.type)}
                  onSubmit={(updated) => handleEditAgent(agent.type, updated)}
                  onCancel={() => setEditingAgent(null)}
                />
              ) : (
                <AgentItem
                  key={agent.type}
                  agent={agent}
                  isDefault={isDefault(agent.type)}
                  onToggle={() => handleToggleAgent(agent.type)}
                  onEdit={() => setEditingAgent(agent.type)}
                  onRemove={() => handleRemoveAgent(agent.type)}
                />
              )
            )}
          </div>
        )}
      </div>

      <CodexHealthPanel
        health={codexHealth}
        isFetching={isCodexHealthFetching}
        onRefresh={() => refetchCodexHealth()}
      />

      <ProviderHealthPanel
        health={providerHealth}
        isFetching={isProviderHealthFetching}
        onRefresh={() => refetchProviderHealth()}
      />

      <AgentHostHealthPanel agents={config?.agents || []} />

      {/* Agent Behavior */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <SectionHeader title="Agent Behavior" onReset={resetAgents} />
          <SaveIndicator isPending={isPending} />
        </div>
        <div className="divide-y">
          <NumberRow
            label="Timeout"
            description="Kill agent process after N minutes (5-480)"
            value={
              settings.agents?.timeoutMinutes ?? DEFAULT_FEATURE_SETTINGS.agents.timeoutMinutes
            }
            onChange={(v) => update('timeoutMinutes', v)}
            min={5}
            max={480}
            unit="min"
            hideSpinners
            maxLength={3}
          />
          <ToggleRow
            label="Auto-Commit on Complete"
            description="Automatically commit changes when agent finishes successfully"
            checked={
              settings.agents?.autoCommitOnComplete ??
              DEFAULT_FEATURE_SETTINGS.agents.autoCommitOnComplete
            }
            onCheckedChange={(v) => update('autoCommitOnComplete', v)}
          />
          <ToggleRow
            label="Auto-Cleanup Worktrees"
            description="Remove worktree when task is archived"
            checked={
              settings.agents?.autoCleanupWorktrees ??
              DEFAULT_FEATURE_SETTINGS.agents.autoCleanupWorktrees
            }
            onCheckedChange={(v) => update('autoCleanupWorktrees', v)}
          />
          <ToggleRow
            label="Preview Panel"
            description="Show preview panel in task detail view"
            checked={
              settings.agents?.enablePreview ?? DEFAULT_FEATURE_SETTINGS.agents.enablePreview
            }
            onCheckedChange={(v) => update('enablePreview', v)}
          />
        </div>
      </div>

      {/* Agent Routing Rules */}
      <RoutingRulesSection agents={config?.agents || []} />
    </div>
  );
}

function providerStateColor(state: ContextProviderHealth['state']): string {
  switch (state) {
    case 'connected':
      return 'green';
    case 'degraded':
    case 'stale':
      return 'yellow';
    case 'disconnected':
      return 'red';
    case 'unknown':
      return 'gray';
  }
}

function providerPostureStatusColor(status: ContextProviderPostureStatus): string {
  switch (status) {
    case 'safe':
    case 'normal':
      return 'green';
    case 'degraded':
    case 'stale':
    case 'unknown':
      return 'yellow';
    case 'risky':
    case 'disconnected':
      return 'red';
    default:
      return 'gray';
  }
}

function formatProviderState(value: string): string {
  return value
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function ProviderHealthPanel({
  health,
  isFetching,
  onRefresh,
}: {
  health?: ContextProviderHealthResponse;
  isFetching: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="rounded-md border bg-card p-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Context Provider Health</h3>
          <p className="text-xs text-muted-foreground">
            {health?.checkedAt
              ? `Checked ${new Date(health.checkedAt).toLocaleTimeString()}`
              : 'Checking provider posture'}
          </p>
        </div>
        <ActionIcon
          variant="subtle"
          size="sm"
          onClick={onRefresh}
          disabled={isFetching}
          aria-label="Refresh provider health"
        >
          {isFetching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </ActionIcon>
      </div>

      {health && (
        <div className="flex flex-wrap gap-2">
          <Badge variant="light" color="gray">
            {health.summary.total} providers
          </Badge>
          <Badge variant="light" color={health.summary.writeCapable > 0 ? 'yellow' : 'gray'}>
            {health.summary.writeCapable} write-capable
          </Badge>
          <Badge variant="light" color={health.summary.risky > 0 ? 'red' : 'green'}>
            {health.summary.risky} risky
          </Badge>
        </div>
      )}

      <div className="space-y-2">
        {(health?.providers ?? []).map((provider) => (
          <ProviderHealthItem key={provider.id} provider={provider} />
        ))}
        {!health?.providers?.length && (
          <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            No provider health data is available yet.
          </div>
        )}
      </div>
    </div>
  );
}

function ProviderHealthItem({ provider }: { provider: ContextProviderHealth }) {
  return (
    <div className="rounded-md border bg-background/60 p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{provider.name}</span>
            <Badge size="xs" color={providerStateColor(provider.state)} variant="light">
              {formatProviderState(provider.state)}
            </Badge>
            <Badge
              size="xs"
              color={provider.risk === 'risky' ? 'red' : 'gray'}
              variant={provider.risk === 'risky' ? 'light' : 'outline'}
            >
              {formatProviderState(provider.risk)}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{provider.detail}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge size="xs" variant="outline">
          {formatProviderState(provider.boundary)}
        </Badge>
        <Badge size="xs" variant={provider.readCapability ? 'light' : 'outline'} color="gray">
          Read {provider.readCapability ? 'on' : 'off'}
        </Badge>
        <Badge
          size="xs"
          variant={provider.writeCapability ? 'light' : 'outline'}
          color={provider.writeCapability ? 'yellow' : 'gray'}
        >
          Write {provider.writeCapability ? 'on' : 'off'}
        </Badge>
      </div>

      <p className="text-xs text-muted-foreground">{provider.privacyScope}</p>

      {provider.tools.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {provider.tools.slice(0, 5).map((tool) => (
            <Badge key={tool} size="xs" variant="outline" color="gray">
              {tool}
            </Badge>
          ))}
        </div>
      )}

      {provider.postureFlags.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {provider.postureFlags.slice(0, 4).map((flag) => (
            <li key={flag}>{flag}</li>
          ))}
        </ul>
      )}

      {provider.postureChecks?.length ? (
        <div className="space-y-2">
          {provider.postureChecks.slice(0, 5).map((check) => (
            <div key={check.id} className="rounded-md border bg-card/60 p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium">{check.label}</span>
                <Badge size="xs" color={providerPostureStatusColor(check.status)} variant="light">
                  {formatProviderState(check.status)}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{check.detail}</p>
              {check.items?.length ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {check.items.slice(0, 6).map((item) => (
                    <Badge key={item} size="xs" variant="outline" color="gray">
                      {item}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {provider.recommendations.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {provider.recommendations.slice(0, 2).map((recommendation) => (
            <li key={recommendation}>{recommendation}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function hostPostureColor(posture: AgentHostPosture): string {
  switch (posture) {
    case 'connected':
      return 'green';
    case 'degraded':
    case 'stale':
      return 'yellow';
    case 'risky':
    case 'disconnected':
      return 'red';
    case 'unknown':
      return 'gray';
  }
}

function AgentHostHealthPanel({ agents }: { agents: AgentConfig[] }) {
  const { data: health, isFetching, refetch } = useAgentHosts();
  const enabledAgents = agents.filter((agent) => agent.enabled);
  const firstEnabledAgent = enabledAgents[0]?.type || '';
  const [selectedAgent, setSelectedAgent] = useState<string>(firstEnabledAgent);
  const [selectedHostId, setSelectedHostId] = useState<string>('auto');

  useEffect(() => {
    if (!selectedAgent && firstEnabledAgent) {
      setSelectedAgent(firstEnabledAgent);
    }
  }, [firstEnabledAgent, selectedAgent]);

  const selectedAgentConfig = agents.find((agent) => agent.type === selectedAgent);
  const previewRequest = useMemo<AgentHostPreviewRequest>(
    () => ({
      agent: selectedAgent || undefined,
      provider: selectedAgentConfig?.provider,
      model: selectedAgentConfig?.model,
      manualHostId: selectedHostId === 'auto' ? undefined : selectedHostId,
    }),
    [selectedAgent, selectedAgentConfig?.provider, selectedAgentConfig?.model, selectedHostId]
  );
  const { data: preview, isFetching: isPreviewFetching } = useAgentHostPreview(
    previewRequest,
    !!selectedAgent || (health?.hosts.length ?? 0) > 0
  );

  return (
    <div className="rounded-md border bg-card p-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Agent Host Health</h3>
          <p className="text-xs text-muted-foreground">
            {health?.generatedAt
              ? `Checked ${new Date(health.generatedAt).toLocaleTimeString()}`
              : 'Checking supervisor posture'}
          </p>
        </div>
        <ActionIcon
          variant="subtle"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          aria-label="Refresh host health"
        >
          {isFetching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </ActionIcon>
      </div>

      <AgentHostSummary health={health} />

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          {(health?.hosts ?? []).map((host) => (
            <AgentHostItem key={host.id} host={host} />
          ))}
          {!health?.hosts?.length && (
            <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              No agent supervisors have registered host metadata yet.
            </div>
          )}
        </div>

        <AgentHostPreviewPanel
          agents={enabledAgents}
          hosts={health?.hosts ?? []}
          preview={preview}
          selectedAgent={selectedAgent}
          selectedHostId={selectedHostId}
          isFetching={isPreviewFetching}
          onAgentChange={setSelectedAgent}
          onHostChange={setSelectedHostId}
        />
      </div>
    </div>
  );
}

function AgentHostSummary({ health }: { health?: AgentHostHealthResponse }) {
  if (!health) {
    return (
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline" color="gray">
          Loading hosts
        </Badge>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Badge variant="light" color="gray">
        {health.summary.total} hosts
      </Badge>
      <Badge variant="light" color="green">
        {health.summary.connected} connected
      </Badge>
      <Badge variant="light" color={health.summary.degraded > 0 ? 'yellow' : 'gray'}>
        {health.summary.degraded} degraded
      </Badge>
      <Badge variant="light" color={health.summary.stale > 0 ? 'yellow' : 'gray'}>
        {health.summary.stale} stale
      </Badge>
      <Badge variant="light" color={health.summary.overloaded > 0 ? 'red' : 'gray'}>
        {health.summary.overloaded} overloaded
      </Badge>
    </div>
  );
}

function AgentHostItem({ host }: { host: AgentHostRecord }) {
  return (
    <div className="rounded-md border bg-background/60 p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Server className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{host.name}</span>
            <Badge size="xs" color={hostPostureColor(host.posture)} variant="light">
              {formatProviderState(host.posture)}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {host.supervisorType}
            {host.os ? ` · ${host.os}` : ''}
          </p>
        </div>
        <Badge size="xs" color={host.overloaded ? 'red' : 'gray'} variant="outline">
          Queue {host.queueDepth}/{host.maxQueueDepth}
        </Badge>
      </div>

      <div className="flex flex-wrap gap-1">
        {host.supportedAgents.slice(0, 4).map((agent) => (
          <Badge key={agent} size="xs" variant="outline" color="gray">
            {agent}
          </Badge>
        ))}
        {host.supportedProviders.slice(0, 3).map((provider) => (
          <Badge key={provider} size="xs" variant="light" color="gray">
            {provider}
          </Badge>
        ))}
      </div>

      {host.workspaceLabels.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Workspaces: {host.workspaceLabels.slice(0, 3).join(', ')}
        </p>
      )}

      {host.diagnostics.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {host.diagnostics.slice(0, 3).map((diagnostic) => (
            <li key={diagnostic}>{diagnostic}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AgentHostPreviewPanel({
  agents,
  hosts,
  preview,
  selectedAgent,
  selectedHostId,
  isFetching,
  onAgentChange,
  onHostChange,
}: {
  agents: AgentConfig[];
  hosts: AgentHostRecord[];
  preview?: AgentHostCompatibilityResponse;
  selectedAgent: string;
  selectedHostId: string;
  isFetching: boolean;
  onAgentChange: (value: string) => void;
  onHostChange: (value: string) => void;
}) {
  const selectedHost = preview?.decision.selectedHostName || preview?.decision.selectedHostId;
  const selectedPreview = preview?.decision.selectedHostId
    ? preview.previews.find((item) => item.hostId === preview.decision.selectedHostId)
    : undefined;

  return (
    <div className="rounded-md border bg-background/60 p-3 space-y-3">
      <div>
        <h4 className="text-sm font-medium">Launch Compatibility</h4>
        <p className="text-xs text-muted-foreground">
          {isFetching ? 'Resolving host route' : preview?.decision.reason || 'No route resolved'}
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Select
          label="Preview Agent"
          value={selectedAgent}
          onChange={(value) => onAgentChange(value || '')}
          data={agents.map((agent) => ({ value: agent.type, label: agent.name }))}
          placeholder="Select agent"
          size="xs"
        />
        <Select
          label="Target Host"
          value={selectedHostId}
          onChange={(value) => onHostChange(value || 'auto')}
          data={[
            { value: 'auto', label: 'Auto route' },
            ...hosts.map((host) => ({ value: host.id, label: host.name })),
          ]}
          size="xs"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge variant="light" color={selectedHost ? 'green' : 'gray'}>
          {selectedHost || 'No host selected'}
        </Badge>
        <Badge variant="outline" color="gray">
          {preview?.decision.policy || 'disabled'}
        </Badge>
      </div>

      {selectedPreview && (
        <div className="space-y-1">
          {selectedPreview.checks.slice(0, 5).map((check) => (
            <div key={check.id} className="flex items-start justify-between gap-2 text-xs">
              <span className="text-muted-foreground">{check.label}</span>
              <Badge size="xs" color={check.passed ? 'green' : 'red'} variant="light">
                {check.passed ? 'Pass' : 'Block'}
              </Badge>
            </div>
          ))}
        </div>
      )}

      {!selectedPreview && preview?.decision.fallbackBehavior && (
        <p className="text-xs text-muted-foreground">{preview.decision.fallbackBehavior}</p>
      )}
    </div>
  );
}

function CodexHealthPanel({
  health,
  isFetching,
  onRefresh,
}: {
  health?: CodexHealthStatus;
  isFetching: boolean;
  onRefresh: () => void;
}) {
  const statusBadge = (ready: boolean, label: string) => (
    <Badge
      variant={ready ? 'light' : 'outline'}
      color={ready ? 'green' : 'gray'}
      leftSection={ready ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
    >
      {label}
    </Badge>
  );

  return (
    <div className="rounded-md border bg-card p-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Codex Health</h3>
          <p className="text-xs text-muted-foreground">
            {health?.checkedAt
              ? `Checked ${new Date(health.checkedAt).toLocaleTimeString()}`
              : 'Checking Codex readiness'}
          </p>
        </div>
        <ActionIcon
          variant="subtle"
          size="sm"
          onClick={onRefresh}
          disabled={isFetching}
          aria-label="Refresh Codex health"
        >
          {isFetching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </ActionIcon>
      </div>

      <div className="flex flex-wrap gap-2">
        {statusBadge(!!health?.cli.installed, 'CLI installed')}
        {statusBadge(!!health?.cli.authenticated, 'Authenticated')}
        {statusBadge(!!health?.sdk.available, 'SDK available')}
        {statusBadge(!!health?.ready.cli, 'CLI profile')}
        {statusBadge(!!health?.ready.sdk, 'SDK profile')}
        {statusBadge(!!health?.ready.cloud, 'Cloud profile')}
      </div>

      {health?.cli.version && (
        <div className="text-xs text-muted-foreground">
          {health.cli.version}
          {health.cli.authMode ? ` · ${health.cli.authMode}` : ''}
        </div>
      )}

      {health?.recommendations.length ? (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {health.recommendations.map((recommendation) => (
            <li key={recommendation}>{recommendation}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ============ Agent Item (display mode) ============

interface AgentItemProps {
  agent: AgentConfig;
  isDefault: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onRemove: () => void;
}

function AgentItem({ agent, isDefault, onToggle, onEdit, onRemove }: AgentItemProps) {
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);

  return (
    <>
      <div
        className={cn(
          'flex items-center justify-between py-2 px-3 rounded-md border',
          agent.enabled ? 'bg-card' : 'bg-muted/30'
        )}
      >
        <div className="flex items-center gap-3">
          <Bot className="h-4 w-4 text-muted-foreground" />
          <div>
            <div className="flex items-center gap-2">
              <span
                className={cn('font-medium text-sm', !agent.enabled && 'text-muted-foreground')}
              >
                {agent.name}
              </span>
              {isDefault && (
                <Badge size="xs" variant="light" color="violet">
                  Default
                </Badge>
              )}
            </div>
            <code className="text-xs text-muted-foreground">
              {agent.command} {agent.args.join(' ')}
            </code>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ActionIcon variant="subtle" size="sm" onClick={onEdit} aria-label={`Edit ${agent.name}`}>
            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
          </ActionIcon>
          {isDefault ? (
            <span
              className="text-xs text-muted-foreground px-1"
              title="Cannot remove the default agent"
            >
              —
            </span>
          ) : (
            <ActionIcon
              variant="subtle"
              size="sm"
              onClick={() => setConfirmRemoveOpen(true)}
              aria-label={`Remove ${agent.name}`}
            >
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
            </ActionIcon>
          )}
          <Switch
            checked={agent.enabled}
            onChange={() => onToggle()}
            aria-label={`Enable ${agent.name}`}
            size="sm"
          />
        </div>
      </div>

      {!isDefault && (
        <Modal
          opened={confirmRemoveOpen}
          onClose={() => setConfirmRemoveOpen(false)}
          title="Remove agent?"
          centered
        >
          <Text size="sm" c="dimmed">
            This will remove &ldquo;{agent.name}&rdquo; ({agent.type}) from your agent
            configuration.
          </Text>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="subtle" onClick={() => setConfirmRemoveOpen(false)}>
              Cancel
            </Button>
            <Button
              color="red"
              onClick={() => {
                onRemove();
                setConfirmRemoveOpen(false);
              }}
            >
              Remove
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

// ============ Agent Form (add/edit mode) ============

interface AgentFormProps {
  agent?: AgentConfig;
  existingTypes: string[];
  onSubmit: (agent: AgentConfig) => void;
  onCancel: () => void;
}

// ============ Routing Rules Section ============

interface RoutingRulesSectionProps {
  agents: AgentConfig[];
}

function RoutingRulesSection({ agents }: RoutingRulesSectionProps) {
  const { data: routingConfig, isLoading } = useRoutingConfig();
  const updateRouting = useUpdateRoutingConfig();
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [showAddRule, setShowAddRule] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const config = routingConfig || DEFAULT_ROUTING_CONFIG;
  const enabledAgents = agents.filter((a) => a.enabled);

  const saveConfig = useCallback(
    (updated: AgentRoutingConfig) => {
      updateRouting.mutate(updated);
    },
    [updateRouting]
  );

  const handleToggleEnabled = () => {
    saveConfig({ ...config, enabled: !config.enabled });
  };

  const handleToggleRule = (ruleId: string) => {
    const updated = {
      ...config,
      rules: config.rules.map((r) => (r.id === ruleId ? { ...r, enabled: !r.enabled } : r)),
    };
    saveConfig(updated);
  };

  const handleAddRule = (rule: RoutingRule) => {
    saveConfig({ ...config, rules: [...config.rules, rule] });
    setShowAddRule(false);
  };

  const handleEditRule = (originalId: string, updated: RoutingRule) => {
    saveConfig({
      ...config,
      rules: config.rules.map((r) => (r.id === originalId ? updated : r)),
    });
    setEditingRuleId(null);
  };

  const handleRemoveRule = (ruleId: string) => {
    saveConfig({
      ...config,
      rules: config.rules.filter((r) => r.id !== ruleId),
    });
  };

  const handleMoveRule = (ruleId: string, direction: 'up' | 'down') => {
    const idx = config.rules.findIndex((r) => r.id === ruleId);
    if (idx < 0) return;
    const newIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= config.rules.length) return;
    const newRules = [...config.rules];
    [newRules[idx], newRules[newIdx]] = [newRules[newIdx], newRules[idx]];
    saveConfig({ ...config, rules: newRules });
  };

  const handleDefaultAgentChange = (agent: string) => {
    saveConfig({ ...config, defaultAgent: agent as AgentType });
  };

  const handleDefaultModelChange = (model: string) => {
    saveConfig({ ...config, defaultModel: model || undefined });
  };

  const handleFallbackToggle = () => {
    saveConfig({ ...config, fallbackOnFailure: !config.fallbackOnFailure });
  };

  const handleMaxRetriesChange = (value: number) => {
    saveConfig({ ...config, maxRetries: Math.min(3, Math.max(0, value)) });
  };

  const resetRouting = () => {
    saveConfig(DEFAULT_ROUTING_CONFIG);
  };

  if (isLoading) {
    return (
      <div className="text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading routing config...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button
          type="button"
          className="flex items-center gap-2 text-sm font-medium hover:text-foreground transition-colors"
          onClick={() => setExpanded(!expanded)}
        >
          <Route className="h-4 w-4" />
          Agent Routing
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
        <div className="flex items-center gap-2">
          {updateRouting.isPending && <SaveIndicator isPending />}
          <Switch
            checked={config.enabled}
            onChange={() => handleToggleEnabled()}
            aria-label="Enable agent routing"
            size="sm"
          />
        </div>
      </div>

      {expanded && (
        <div className={cn('space-y-4', !config.enabled && 'opacity-50 pointer-events-none')}>
          {/* Rules list */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Rules (first match wins)
              </h4>
              {!showAddRule && (
                <Button
                  variant="outline"
                  size="xs"
                  leftSection={<Plus className="h-3.5 w-3.5" />}
                  onClick={() => setShowAddRule(true)}
                >
                  Add Rule
                </Button>
              )}
            </div>

            {showAddRule && (
              <RoutingRuleForm
                agents={enabledAgents}
                existingIds={config.rules.map((r) => r.id)}
                onSubmit={handleAddRule}
                onCancel={() => setShowAddRule(false)}
              />
            )}

            {config.rules.length === 0 ? (
              <div className="text-sm text-muted-foreground py-3 text-center border rounded-md border-dashed">
                No routing rules — all tasks use the default agent.
              </div>
            ) : (
              <div className="space-y-1">
                {config.rules.map((rule, idx) =>
                  editingRuleId === rule.id ? (
                    <RoutingRuleForm
                      key={rule.id}
                      rule={rule}
                      agents={enabledAgents}
                      existingIds={config.rules.filter((r) => r.id !== rule.id).map((r) => r.id)}
                      onSubmit={(updated) => handleEditRule(rule.id, updated)}
                      onCancel={() => setEditingRuleId(null)}
                    />
                  ) : (
                    <RoutingRuleItem
                      key={rule.id}
                      rule={rule}
                      agents={agents}
                      isFirst={idx === 0}
                      isLast={idx === config.rules.length - 1}
                      onToggle={() => handleToggleRule(rule.id)}
                      onEdit={() => setEditingRuleId(rule.id)}
                      onRemove={() => handleRemoveRule(rule.id)}
                      onMoveUp={() => handleMoveRule(rule.id, 'up')}
                      onMoveDown={() => handleMoveRule(rule.id, 'down')}
                    />
                  )
                )}
              </div>
            )}
          </div>

          {/* Default & Fallback settings */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Defaults
              </h4>
              <Button variant="subtle" size="compact-xs" onClick={resetRouting}>
                Reset to defaults
              </Button>
            </div>
            <div className="divide-y">
              <div className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm font-medium">Default Agent</p>
                  <p className="text-xs text-muted-foreground">Used when no rules match</p>
                </div>
                <Select
                  aria-label="Default Agent"
                  value={config.defaultAgent}
                  onChange={(value) => value && handleDefaultAgentChange(value)}
                  data={enabledAgents.map((a) => ({ value: a.type, label: a.name }))}
                  className="w-[180px]"
                  size="xs"
                  allowDeselect={false}
                  disabled={enabledAgents.length === 0}
                />
              </div>
              <div className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm font-medium">Default Model</p>
                  <p className="text-xs text-muted-foreground">
                    Model override for the default agent
                  </p>
                </div>
                <TextInput
                  aria-label="Default Model"
                  value={config.defaultModel || ''}
                  onChange={(e) => handleDefaultModelChange(e.target.value)}
                  placeholder="e.g., sonnet"
                  className="w-[180px]"
                  size="xs"
                />
              </div>
              <ToggleRow
                label="Fallback on Failure"
                description="Auto-retry with fallback agent when primary fails"
                checked={config.fallbackOnFailure}
                onCheckedChange={handleFallbackToggle}
              />
              <NumberRow
                label="Max Retries"
                description="Maximum retry attempts before giving up (0-3)"
                value={config.maxRetries}
                onChange={handleMaxRetriesChange}
                min={0}
                max={3}
                hideSpinners
                maxLength={1}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============ Routing Rule Item (display mode) ============

interface RoutingRuleItemProps {
  rule: RoutingRule;
  agents: AgentConfig[];
  isFirst: boolean;
  isLast: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function RoutingRuleItem({
  rule,
  agents,
  isFirst,
  isLast,
  onToggle,
  onEdit,
  onRemove,
  onMoveUp,
  onMoveDown,
}: RoutingRuleItemProps) {
  const agentName = agents.find((a) => a.type === rule.agent)?.name || rule.agent;
  const fallbackName = rule.fallback
    ? agents.find((a) => a.type === rule.fallback)?.name || rule.fallback
    : null;

  const matchLabels: string[] = [];
  if (rule.match.type) {
    const types = Array.isArray(rule.match.type) ? rule.match.type : [rule.match.type];
    matchLabels.push(`type: ${types.join(', ')}`);
  }
  if (rule.match.priority) {
    const priorities = Array.isArray(rule.match.priority)
      ? rule.match.priority
      : [rule.match.priority];
    matchLabels.push(`priority: ${priorities.join(', ')}`);
  }
  if (rule.match.project) {
    const projects = Array.isArray(rule.match.project) ? rule.match.project : [rule.match.project];
    matchLabels.push(`project: ${projects.join(', ')}`);
  }
  if (rule.match.minSubtasks) {
    matchLabels.push(`≥${rule.match.minSubtasks} subtasks`);
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2 py-2 px-3 rounded-md border text-sm',
        rule.enabled ? 'bg-card' : 'bg-muted/30 opacity-60'
      )}
    >
      {/* Reorder buttons */}
      <div className="flex flex-col gap-0.5">
        <button
          type="button"
          disabled={isFirst}
          onClick={onMoveUp}
          className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Move up"
        >
          <ChevronUp className="h-3 w-3" />
        </button>
        <button
          type="button"
          disabled={isLast}
          onClick={onMoveDown}
          className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Move down"
        >
          <ChevronDown className="h-3 w-3" />
        </button>
      </div>

      {/* Rule info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{rule.name}</span>
        </div>
        <div className="flex flex-wrap gap-1 mt-1">
          {matchLabels.map((label, i) => (
            <Badge key={i} size="xs" variant="light" color="gray" className="font-mono">
              {label}
            </Badge>
          ))}
          <span className="text-xs text-muted-foreground">→</span>
          <Badge size="xs" variant="outline" color="gray">
            {agentName}
            {rule.model ? ` (${rule.model})` : ''}
          </Badge>
          {fallbackName && (
            <>
              <span className="text-xs text-muted-foreground">fallback:</span>
              <Badge size="xs" variant="outline" color="gray">
                {fallbackName}
              </Badge>
            </>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        <ActionIcon variant="subtle" size="sm" onClick={onEdit} aria-label={`Edit ${rule.name}`}>
          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
        </ActionIcon>
        <ActionIcon
          variant="subtle"
          size="sm"
          onClick={onRemove}
          aria-label={`Remove ${rule.name}`}
        >
          <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
        </ActionIcon>
        <Switch
          checked={rule.enabled}
          onChange={() => onToggle()}
          aria-label={`Enable ${rule.name}`}
          size="sm"
        />
      </div>
    </div>
  );
}

// ============ Routing Rule Form (add/edit mode) ============

interface RoutingRuleFormProps {
  rule?: RoutingRule;
  agents: AgentConfig[];
  existingIds: string[];
  onSubmit: (rule: RoutingRule) => void;
  onCancel: () => void;
}

function RoutingRuleForm({ rule, agents, existingIds, onSubmit, onCancel }: RoutingRuleFormProps) {
  const isEditing = !!rule;
  const [name, setName] = useState(rule?.name || '');
  const [id, setId] = useState(rule?.id || '');
  const [matchType, setMatchType] = useState(
    rule?.match.type
      ? Array.isArray(rule.match.type)
        ? rule.match.type.join(', ')
        : rule.match.type
      : ''
  );
  const [matchPriority, setMatchPriority] = useState(
    rule?.match.priority
      ? Array.isArray(rule.match.priority)
        ? rule.match.priority.join(', ')
        : rule.match.priority
      : ''
  );
  const [matchProject, setMatchProject] = useState(
    rule?.match.project
      ? Array.isArray(rule.match.project)
        ? rule.match.project.join(', ')
        : rule.match.project
      : ''
  );
  const [minSubtasks, setMinSubtasks] = useState(rule?.match.minSubtasks?.toString() || '');
  const [agent, setAgent] = useState(rule?.agent || agents[0]?.type || '');
  const [model, setModel] = useState(rule?.model || '');
  const [fallback, setFallback] = useState(rule?.fallback || '');

  const autoId = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const effectiveId = id || autoId;
  const isDuplicate = !isEditing && existingIds.includes(effectiveId);
  const isValid = name.trim() && effectiveId && agent && !isDuplicate;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;

    const parseList = (val: string): string | string[] | undefined => {
      if (!val.trim()) return undefined;
      const items = val
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      return items.length === 1 ? items[0] : items.length > 0 ? items : undefined;
    };

    onSubmit({
      id: isEditing ? rule.id : effectiveId,
      name: name.trim(),
      match: {
        type: parseList(matchType),
        priority: parseList(matchPriority) as RoutingRule['match']['priority'],
        project: parseList(matchProject),
        minSubtasks: minSubtasks ? parseInt(minSubtasks, 10) : undefined,
      },
      agent: agent as AgentType,
      model: model.trim() || undefined,
      fallback: (fallback.trim() || undefined) as AgentType | undefined,
      enabled: rule?.enabled ?? true,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 border rounded-lg p-4 bg-muted/30">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Route className="h-4 w-4" />
        {isEditing ? `Edit Rule: ${rule.name}` : 'Add Routing Rule'}
      </div>

      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <TextInput
            label="Rule Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., High-priority bugs"
          />
          <TextInput
            label={
              <>
                ID{' '}
                {!isEditing && effectiveId && (
                  <span className="text-xs text-muted-foreground ml-1">({effectiveId})</span>
                )}
              </>
            }
            value={isEditing ? rule.id : id}
            onChange={(e) => setId(e.target.value)}
            placeholder="auto from name"
            disabled={isEditing}
            error={isDuplicate ? 'A routing rule with this ID already exists' : undefined}
          />
        </div>

        {/* Match criteria */}
        <div className="grid grid-cols-2 gap-3">
          <TextInput
            label="Match Type(s)"
            description="Comma-separated"
            value={matchType}
            onChange={(e) => setMatchType(e.target.value)}
            placeholder="e.g., code, bug"
            classNames={{ input: 'font-mono text-sm' }}
          />
          <TextInput
            label="Match Priority"
            description="low, medium, high"
            value={matchPriority}
            onChange={(e) => setMatchPriority(e.target.value)}
            placeholder="e.g., high"
            classNames={{ input: 'font-mono text-sm' }}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <TextInput
            label="Match Project"
            description="Optional"
            value={matchProject}
            onChange={(e) => setMatchProject(e.target.value)}
            placeholder="e.g., rubicon"
            classNames={{ input: 'font-mono text-sm' }}
          />
          <TextInput
            label="Min Subtasks"
            description="Complexity"
            type="number"
            value={minSubtasks}
            onChange={(e) => setMinSubtasks(e.target.value)}
            placeholder="e.g., 5"
            classNames={{ input: 'font-mono text-sm' }}
            min="0"
          />
        </div>

        {/* Agent selection */}
        <div className="grid grid-cols-3 gap-3">
          <Select
            label="Primary Agent"
            value={agent}
            onChange={(value) => value && setAgent(value as AgentType)}
            data={agents.map((a) => ({ value: a.type, label: a.name }))}
            allowDeselect={false}
            disabled={agents.length === 0}
          />
          <TextInput
            label="Model"
            description="Optional"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="e.g., opus"
            classNames={{ input: 'font-mono text-sm' }}
          />
          <Select
            label="Fallback Agent"
            description="Optional"
            value={fallback || '__none__'}
            onChange={(value) => setFallback(!value || value === '__none__' ? '' : value)}
            data={[
              { value: '__none__', label: 'None' },
              ...agents
                .filter((a) => a.type !== agent)
                .map((a) => ({ value: a.type, label: a.name })),
            ]}
            allowDeselect={false}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="subtle"
          size="xs"
          leftSection={<X className="h-3.5 w-3.5" />}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          size="xs"
          leftSection={<Check className="h-3.5 w-3.5" />}
          disabled={!isValid}
        >
          {isEditing ? 'Save Rule' : 'Add Rule'}
        </Button>
      </div>
    </form>
  );
}

// ============ Agent Form (add/edit mode) ============

function AgentForm({ agent, existingTypes, onSubmit, onCancel }: AgentFormProps) {
  const isEditing = !!agent;
  const [name, setName] = useState(agent?.name || '');
  const [type, setType] = useState(agent?.type || '');
  const [command, setCommand] = useState(agent?.command || '');
  const [argsStr, setArgsStr] = useState(agent?.args.join(' ') || '');

  const typeSlug =
    type ||
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  const isDuplicate = !isEditing && existingTypes.includes(typeSlug);
  const isValid = name.trim() && command.trim() && !isDuplicate;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    onSubmit({
      type: (isEditing ? agent.type : typeSlug) as AgentType,
      name: name.trim(),
      command: command.trim(),
      args: argsStr
        .trim()
        .split(/\s+/)
        .filter((a) => a),
      enabled: agent?.enabled ?? true,
      provider: agent?.provider,
      model: agent?.model,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 border rounded-lg p-4 bg-muted/30">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Bot className="h-4 w-4" />
        {isEditing ? `Edit ${agent.name}` : 'Add Agent'}
      </div>

      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <TextInput
            id="agent-name"
            label="Display Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., My Custom Agent"
          />
          <TextInput
            id="agent-type"
            label={
              <>
                Type Slug
                {!isEditing && typeSlug && (
                  <span className="text-xs text-muted-foreground ml-1">({typeSlug})</span>
                )}
              </>
            }
            value={isEditing ? agent.type : type}
            onChange={(e) => setType(e.target.value)}
            placeholder="auto-generated from name"
            disabled={isEditing}
            error={isDuplicate ? 'An agent with this type already exists' : undefined}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <TextInput
            id="agent-command"
            label="Command"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="e.g., claude"
            classNames={{ input: 'font-mono text-sm' }}
          />
          <TextInput
            id="agent-args"
            label="Arguments"
            description="Space-separated"
            value={argsStr}
            onChange={(e) => setArgsStr(e.target.value)}
            placeholder="e.g., --flag -p"
            classNames={{ input: 'font-mono text-sm' }}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="subtle"
          size="xs"
          leftSection={<X className="h-3.5 w-3.5" />}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          size="xs"
          leftSection={<Check className="h-3.5 w-3.5" />}
          disabled={!isValid}
        >
          {isEditing ? 'Save' : 'Add Agent'}
        </Button>
      </div>
    </form>
  );
}
