import { UiModal as Modal, OverlayFooter } from '@/components/ui/UiOverlay';
import {
  UiHeading,
  UiAction,
  UiPill,
  semanticToneForLegacyColor,
  UiIconAction,
} from '@/components/ui/UiVocabulary';
import { SettingsGroup, SettingsNotice } from '@/components/settings/shared/SettingsLayout';
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NumberInput, Select, Switch, Text, Textarea, TextInput } from '@mantine/core';
import {
  useAgentProfiles,
  useCodexHealth,
  useConfig,
  useDeleteAgentProfile,
  useExportAgentProfile,
  useHarnessCompatibilityMatrix,
  useImportAgentProfile,
  useProviderHealth,
  useUpdateAgentProfile,
  useUpdateAgents,
  useValidateAgentProfile,
} from '@/hooks/useConfig';
import { useFeatureSettings, useDebouncedFeatureUpdate } from '@/hooks/useFeatureSettings';
import { useRoutingConfig, useUpdateRoutingConfig } from '@/hooks/useRouting';
import { useAgentHostPreview, useAgentHosts, useStartAgent } from '@/hooks/useAgent';
import {
  useCreateSandboxPolicy,
  useDeleteSandboxPolicy,
  useSandboxPolicies,
  useUpdateSandboxPolicy,
  useValidateSandboxPolicy,
} from '@/hooks/useSandboxPolicies';
import {
  Bot,
  AlertCircle,
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
  ShieldCheck,
  Server,
  Upload,
  Download,
  Rocket,
} from 'lucide-react';
import type {
  AgentConfig,
  AgentHostCompatibilityResponse,
  AgentHostHealthResponse,
  AgentHostPosture,
  AgentHostPreviewRequest,
  AgentHostRecord,
  AgentProvider,
  AgentType,
  RoutingRule,
  AgentRoutingConfig,
  AgentBudgetLimits,
  AgentProfilePackageFormat,
  AgentProfilePackageSummary,
  BuzzDefinitionAction,
  BuzzDefinitionPreview,
  SandboxPolicyDryRunResult,
  SandboxPolicyPreset,
  ProviderRuntimeManifest,
  HarnessSupportStatus,
  HarnessCompatibilityMatrix,
} from '@veritas-kanban/shared';
import type {
  CodexHealthStatus,
  ContextProviderHealth,
  ContextProviderPostureStatus,
  ContextProviderHealthResponse,
} from '@/lib/api';
import { api } from '@/lib/api';
import { DEFAULT_FEATURE_SETTINGS, DEFAULT_ROUTING_CONFIG } from '@veritas-kanban/shared';
import { cn } from '@/lib/utils';
import {
  ToggleRow,
  NumberRow,
  SectionHeader,
  SaveIndicator,
  SettingsLocalNav,
  SettingsPage,
  SettingsSection,
} from '../shared';

type AgentFeatureSettings = typeof DEFAULT_FEATURE_SETTINGS.agents;

const AGENT_PROVIDER_OPTIONS: Array<{ value: AgentProvider | '__none__'; label: string }> = [
  { value: '__none__', label: 'None / legacy' },
  { value: 'codex-cli', label: 'Codex CLI' },
  { value: 'codex-sdk', label: 'Codex SDK' },
  { value: 'codex-app-server', label: 'Codex app-server' },
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'acp-stdio', label: 'ACP stdio agent' },
  { value: 'hermes-cli', label: 'Hermes Agent' },
  { value: 'codex-cloud', label: 'Codex Cloud' },
  { value: 'ollama-local', label: 'Ollama Local' },
  { value: 'ollama-cloud', label: 'Ollama Cloud' },
  { value: 'lm-studio-local', label: 'LM Studio Local' },
  { value: 'openclaw', label: 'OpenClaw' },
  { value: 'custom', label: 'Custom' },
];

const SANDBOX_PROVIDER_OPTIONS = AGENT_PROVIDER_OPTIONS.filter(
  (option): option is { value: AgentProvider; label: string } => option.value !== '__none__'
);

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
  const { data: agentProfiles = [], isLoading: isAgentProfilesLoading } = useAgentProfiles();
  const { data: harnessCompatibility } = useHarnessCompatibilityMatrix();
  const harnessSupport = harnessCompatibility?.supportStatuses ?? [];
  const { data: sandboxPresets = [], isLoading: isSandboxPoliciesLoading } = useSandboxPolicies();
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
    <SettingsPage
      title="Agents"
      description="Configure execution providers, review compatibility and health, and manage the policies that govern agent work."
    >
      <SettingsLocalNav
        label="Agent settings sections"
        items={[
          { id: 'agents-providers', label: 'Providers' },
          { id: 'agents-compatibility', label: 'Compatibility' },
          { id: 'agents-profiles', label: 'Profiles' },
          { id: 'agents-health', label: 'Health' },
          { id: 'agents-policies', label: 'Policies' },
        ]}
      />

      <SettingsSection
        id="agents-providers"
        title="Providers"
        description="Installed agent runtimes and their launch configuration."
        actions={
          !showAddForm ? (
            <UiAction
              variant="secondary"
              leftSection={<Plus className="h-4 w-4" />}
              onClick={() => setShowAddForm(true)}
            >
              Add Agent
            </UiAction>
          ) : undefined
        }
      >
        <div className="space-y-3">
          <Text size="xs" c="dimmed">
            {isLoading
              ? 'Loading installed agents'
              : `${config?.agents.length ?? 0} installed agent${(config?.agents.length ?? 0) === 1 ? '' : 's'}`}
          </Text>

          {showAddForm && (
            <AgentForm
              existingTypes={config?.agents.map((a) => a.type) || []}
              sandboxPresets={sandboxPresets}
              defaultSandboxPresetId={config?.defaultSandboxPresetId}
              onSubmit={handleAddAgent}
              onCancel={() => setShowAddForm(false)}
            />
          )}

          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading...</div>
          ) : config?.agents.length === 0 ? (
            <SettingsGroup empty className="text-sm text-muted-foreground py-4 text-center">
              No agents configured. Add one to get started.
            </SettingsGroup>
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
                    sandboxPresets={sandboxPresets}
                    defaultSandboxPresetId={config.defaultSandboxPresetId}
                    onSubmit={(updated) => handleEditAgent(agent.type, updated)}
                    onCancel={() => setEditingAgent(null)}
                  />
                ) : (
                  <AgentItem
                    key={agent.type}
                    agent={agent}
                    supportStatus={harnessSupport.find((status) => status.agentType === agent.type)}
                    sandboxPresets={sandboxPresets}
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
      </SettingsSection>

      <SettingsSection
        id="agents-compatibility"
        title="Compatibility"
        description="Reviewed harness support, tested versions, and current limitations."
      >
        <HarnessCompatibilityPanel matrix={harnessCompatibility} />
      </SettingsSection>

      <SettingsSection
        id="agents-profiles"
        title="Profiles"
        description="Reusable agent packages and imported Buzz persona or team definitions."
      >
        <div className="space-y-4">
          <AgentProfilePackagesSection
            profiles={agentProfiles}
            agents={config?.agents || []}
            isLoading={isAgentProfilesLoading}
          />

          <BuzzDefinitionImportSection />
        </div>
      </SettingsSection>

      <SettingsSection
        id="agents-health"
        title="Health"
        description="Authentication, provider posture, and host supervisor readiness."
      >
        <div className="space-y-4">
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
        </div>
      </SettingsSection>

      <SettingsSection
        id="agents-policies"
        title="Policies"
        description="Advanced sandbox, completion, worktree, preview, and routing controls."
        tone="advanced"
      >
        <div className="space-y-5">
          <SandboxPoliciesSection
            agents={config?.agents || []}
            presets={sandboxPresets}
            isLoading={isSandboxPoliciesLoading}
          />

          <SettingsGroup className="space-y-4">
            <SectionHeader
              title="Agent Behavior"
              actions={<SaveIndicator isPending={isPending} />}
              onReset={resetAgents}
              contained
            />
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
          </SettingsGroup>

          <RoutingRulesSection agents={config?.agents || []} />
        </div>
      </SettingsSection>
    </SettingsPage>
  );
}

function HarnessCompatibilityPanel({ matrix }: { matrix?: HarnessCompatibilityMatrix }) {
  if (!matrix) return null;

  return (
    <section className="space-y-3" aria-labelledby="harness-compatibility-title">
      <div>
        <UiHeading order={3} id="harness-compatibility-title">
          Harness Compatibility
        </UiHeading>
        <Text size="xs" c="dimmed">
          Reviewed builds and live support evidence from one compatibility record.
        </Text>
      </div>
      <SettingsGroup className="divide-y">
        {matrix.records.map((record) => (
          <div
            key={record.profileId}
            className="grid gap-2 p-3 md:grid-cols-[minmax(10rem,1fr)_minmax(11rem,1fr)_auto]"
          >
            <div>
              <Text size="sm" fw={500}>
                {record.displayName}
              </Text>
              <Text size="xs" c="dimmed">
                {record.testedVersions.join(', ')}
              </Text>
              {record.testedBuilds.length > 0 && (
                <Text size="xs" c="dimmed">
                  Build {record.testedBuilds.map((build) => build.slice(0, 12)).join(', ')}
                </Text>
              )}
            </div>
            <Text size="xs" c="dimmed">
              {record.limitations[0]}
            </Text>
            <div className="flex flex-wrap items-start gap-1">
              <UiPill>{record.supportStatus?.supportTier ?? 'not configured'}</UiPill>
              <UiPill>{record.sourceAvailability.replace('-', ' ')}</UiPill>
            </div>
          </div>
        ))}
      </SettingsGroup>
      <Text size="xs" c="dimmed">
        Matrix {matrix.digest.slice(0, 12)} · probe revision {matrix.probeRevision}
      </Text>
    </section>
  );
}

const BUZZ_DEFINITION_ADAPTER_ID = 'buzz-default';

function BuzzDefinitionImportSection() {
  const queryClient = useQueryClient();
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [action, setAction] = useState<BuzzDefinitionAction>('create');
  const [targetId, setTargetId] = useState('');
  const [preview, setPreview] = useState<BuzzDefinitionPreview | null>(null);
  const definitionsQuery = useQuery({
    queryKey: ['integrations', 'communication', 'buzz-definitions', BUZZ_DEFINITION_ADAPTER_ID],
    queryFn: () => api.integrations.buzzDefinitions(BUZZ_DEFINITION_ADAPTER_ID),
    retry: false,
    staleTime: 30_000,
  });
  const linksQuery = useQuery({
    queryKey: [
      'integrations',
      'communication',
      'buzz-definition-links',
      BUZZ_DEFINITION_ADAPTER_ID,
    ],
    queryFn: () => api.integrations.buzzDefinitionLinks(BUZZ_DEFINITION_ADAPTER_ID),
    retry: false,
    staleTime: 30_000,
  });
  const selected = definitionsQuery.data?.definitions.find(
    (definition) => definition.eventId === selectedEventId
  );
  const previewMutation = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error('Select a Buzz definition first');
      return api.integrations.previewBuzzDefinition(BUZZ_DEFINITION_ADAPTER_ID, {
        coordinate: {
          authorPubkey: selected.authorPubkey,
          kind: selected.kind,
          dTag: selected.dTag,
        },
        action,
        targetId: targetId.trim() || undefined,
      });
    },
    onSuccess: setPreview,
  });
  const importMutation = useMutation({
    mutationFn: () => {
      if (!preview) throw new Error('Preview the Buzz definition first');
      return api.integrations.importBuzzDefinition(BUZZ_DEFINITION_ADAPTER_ID, {
        coordinate: {
          authorPubkey: preview.definition.authorPubkey,
          kind: preview.definition.kind,
          dTag: preview.definition.dTag,
        },
        action: preview.action,
        targetId: preview.targetId,
        expectedEventId: preview.definition.eventId,
        expectedLocalRevision: preview.expectedLocalRevision,
      });
    },
    onSuccess: async () => {
      setPreview(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['config'] }),
        queryClient.invalidateQueries({ queryKey: ['config', 'agent-profiles'] }),
        queryClient.invalidateQueries({
          queryKey: [
            'integrations',
            'communication',
            'buzz-definitions',
            BUZZ_DEFINITION_ADAPTER_ID,
          ],
        }),
        queryClient.invalidateQueries({
          queryKey: [
            'integrations',
            'communication',
            'buzz-definition-links',
            BUZZ_DEFINITION_ADAPTER_ID,
          ],
        }),
      ]);
    },
  });
  const resetPreview = () => {
    setPreview(null);
    previewMutation.reset();
    importMutation.reset();
  };
  const error = previewMutation.error ?? importMutation.error;
  const blocked = Boolean(
    preview &&
    preview.action !== 'skip' &&
    (preview.collisions.length || preview.unresolvedPersonaIds.length)
  );

  return (
    <SettingsGroup className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <UiHeading order={3}>Buzz Persona and Team Definitions</UiHeading>
          <p className="text-xs text-muted-foreground">
            One-way import from the configured signed Buzz connection. Imports never start, enable,
            or reroute an agent.
          </p>
        </div>
        <UiAction
          variant="secondary"
          leftSection={<RefreshCw className="h-3.5 w-3.5" />}
          loading={definitionsQuery.isFetching}
          onClick={() => {
            resetPreview();
            void definitionsQuery.refetch();
            void linksQuery.refetch();
          }}
        >
          Refresh Sources
        </UiAction>
      </div>

      {definitionsQuery.error ? (
        <SettingsNotice tone="warning" icon={<AlertCircle className="h-4 w-4" />}>
          Configure and verify Buzz under Notifications before importing definitions.{' '}
          {definitionsQuery.error.message}
        </SettingsNotice>
      ) : (
        <>
          <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_160px_minmax(180px,260px)_auto]">
            <Select
              label="Definition"
              placeholder={
                definitionsQuery.isLoading
                  ? 'Loading Buzz definitions...'
                  : 'Select persona or team'
              }
              value={selectedEventId}
              onChange={(value) => {
                setSelectedEventId(value);
                resetPreview();
              }}
              data={(definitionsQuery.data?.definitions ?? []).map((definition) => ({
                value: definition.eventId,
                label: `${definition.type}: ${definition.displayName} (${definition.dTag})${
                  definition.compatibility === 'rejected' ? ' [rejected]' : ''
                }`,
              }))}
              searchable
              disabled={definitionsQuery.isLoading}
            />
            <Select
              label="Action"
              value={action}
              onChange={(value) => {
                const next = (value as BuzzDefinitionAction) ?? 'create';
                setAction(next);
                if (next === 'create' || next === 'skip') setTargetId('');
                resetPreview();
              }}
              data={[
                { value: 'create', label: 'Create' },
                { value: 'link', label: 'Link existing' },
                { value: 'refresh', label: 'Refresh linked' },
                { value: 'skip', label: 'Skip' },
              ]}
              allowDeselect={false}
            />
            <TextInput
              label="Target ID"
              value={targetId}
              onChange={(event) => {
                setTargetId(event.currentTarget.value);
                resetPreview();
              }}
              placeholder="Deterministic when omitted"
              disabled={action === 'create' || action === 'skip'}
            />
            <UiAction
              variant="secondary"
              className="self-end"
              onClick={() => previewMutation.mutate()}
              loading={previewMutation.isPending}
              disabled={!selected}
            >
              Preview
            </UiAction>
          </div>

          {definitionsQuery.data && (
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span>{definitionsQuery.data.definitions.length} validated heads</span>
              <span>•</span>
              <span>{definitionsQuery.data.rejectedCount} rejected records</span>
              <span>•</span>
              <span>{definitionsQuery.data.community}</span>
            </div>
          )}

          {preview && (
            <SettingsGroup className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <UiPill>{preview.definition.type}</UiPill>
                <Text size="sm" fw={600}>
                  {preview.definition.displayName}
                </Text>
                <UiPill>{preview.action}</UiPill>
                <UiPill
                  kind="status"
                  tone={semanticToneForLegacyColor(
                    preview.definition.compatibility === 'compatible' ? 'green' : 'red'
                  )}
                >
                  {preview.definition.compatibility}
                </UiPill>
                <span className="text-xs text-muted-foreground">
                  {preview.definition.authorPubkey.slice(0, 12)}… / {preview.definition.dTag}
                </span>
              </div>
              <div className="grid gap-1 text-xs text-muted-foreground md:grid-cols-2">
                <div>Community: {preview.definition.community}</div>
                <div>
                  Created: {new Date(preview.definition.createdAt * 1_000).toLocaleString()}
                </div>
                <div>Event: {preview.definition.eventId.slice(0, 16)}…</div>
                <div>Content SHA-256: {preview.definition.contentHash.slice(0, 16)}…</div>
              </div>

              {blocked && (
                <SettingsNotice tone="error" icon={<ShieldAlert className="h-4 w-4" />}>
                  Resolve every collision and unresolved same-author persona before importing.
                  {preview.collisions.map((collision) => (
                    <div key={`${collision.field}:${collision.value}`}>
                      {collision.field}: {collision.detail}
                    </div>
                  ))}
                  {preview.unresolvedPersonaIds.length > 0 && (
                    <div>Unresolved personas: {preview.unresolvedPersonaIds.join(', ')}</div>
                  )}
                </SettingsNotice>
              )}

              {preview.diff.length > 0 && (
                <SettingsGroup aria-label="Buzz definition proposed changes">
                  <div className="mb-1 text-xs font-medium">Proposed changes</div>
                  <div className="space-y-1">
                    {preview.diff.map((entry) => (
                      <div key={entry.field} className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{entry.field}</span>{' '}
                        {entry.change}: {entry.beforeSummary ?? 'not set'} →{' '}
                        {entry.afterSummary ?? 'not set'}
                      </div>
                    ))}
                  </div>
                </SettingsGroup>
              )}

              <div className="grid gap-2 md:grid-cols-2">
                {preview.fieldReport.map((field) => (
                  <SettingsGroup
                    key={field.field}
                    className="flex items-start justify-between gap-2"
                  >
                    <div>
                      <div className="text-xs font-medium">{field.field}</div>
                      <div className="text-xs text-muted-foreground">{field.detail}</div>
                    </div>
                    <UiPill
                      kind="status"
                      tone={semanticToneForLegacyColor(
                        field.disposition === 'mapped'
                          ? 'green'
                          : field.disposition === 'rejected' || field.disposition === 'conflict'
                            ? 'red'
                            : 'gray'
                      )}
                    >
                      {field.disposition}
                    </UiPill>
                  </SettingsGroup>
                ))}
              </div>

              <div className="flex justify-end">
                <UiAction
                  variant="primary"
                  onClick={() => importMutation.mutate()}
                  loading={importMutation.isPending}
                  disabled={blocked}
                >
                  {preview.action === 'skip' ? 'Confirm Skip' : `Confirm ${preview.action}`}
                </UiAction>
              </div>
            </SettingsGroup>
          )}

          {linksQuery.data && linksQuery.data.length > 0 && (
            <div className="flex flex-wrap gap-2" aria-label="Linked Buzz source status">
              {linksQuery.data.map((link) => (
                <UiPill
                  kind="status"
                  tone={semanticToneForLegacyColor(
                    link.status === 'current'
                      ? 'green'
                      : link.status === 'changed'
                        ? 'yellow'
                        : 'red'
                  )}
                  key={`${link.targetType}:${link.targetId}`}
                >
                  {link.targetId}: {link.status}
                </UiPill>
              ))}
            </div>
          )}
        </>
      )}

      {error && (
        <SettingsNotice tone="error" icon={<AlertCircle className="h-4 w-4" />}>
          {error.message}
        </SettingsNotice>
      )}
    </SettingsGroup>
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

function harnessSupportTierColor(tier: HarnessSupportStatus['supportTier']): string {
  switch (tier) {
    case 'certified':
      return 'green';
    case 'configured':
    case 'detected':
      return 'blue';
    case 'degraded':
      return 'yellow';
    case 'unsupported':
      return 'red';
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

function formatAgentProvider(provider: AgentProvider): string {
  return (
    AGENT_PROVIDER_OPTIONS.find((option) => option.value === provider)?.label ??
    formatProviderState(provider)
  );
}

function cleanBudgetLimits(limits: AgentBudgetLimits): AgentBudgetLimits {
  const clean: AgentBudgetLimits = {};
  for (const key of ['totalTokens', 'costUsd', 'toolCalls', 'runtimeSeconds'] as const) {
    const value = limits[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      clean[key] = value;
    }
  }
  return clean;
}

function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const SAMPLE_PROFILE_PACKAGE = `id: docs-reviewer
schemaVersion: agent-profile-package/v1
version: 1.0.0
displayName: Documentation Reviewer
role: Reviews documentation changes for accuracy and release readiness
enabled: true
capabilities:
  - docs-review
  - release-notes
defaultTaskTypes:
  - docs
runtime:
  agent: codex
  provider: codex-cli
  model: gpt-5.1
instructions:
  prompt: Check docs against shipped behavior and call out stale roadmap language.
tools:
  allowed:
    - shell
    - git
permissions:
  level: specialist
policy:
  sandboxPresetId: workspace-write-default
`;

function AgentProfilePackagesSection({
  profiles,
  agents,
  isLoading,
}: {
  profiles: AgentProfilePackageSummary[];
  agents: AgentConfig[];
  isLoading: boolean;
}) {
  const [format, setFormat] = useState<AgentProfilePackageFormat>('yaml');
  const [content, setContent] = useState(SAMPLE_PROFILE_PACKAGE);
  const [validationMessage, setValidationMessage] = useState<string>('');
  const [exportContent, setExportContent] = useState<string>('');
  const validateProfile = useValidateAgentProfile();
  const importProfile = useImportAgentProfile();
  const exportProfile = useExportAgentProfile();

  const handleValidate = async () => {
    const result = await validateProfile.mutateAsync({ content, format });
    setValidationMessage(
      result.valid
        ? `Valid: ${result.profile?.displayName ?? result.profile?.id}`
        : result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n')
    );
  };

  const handleImport = async () => {
    const result = await importProfile.mutateAsync({ content, format, source: 'settings' });
    setValidationMessage(
      `${result.created ? 'Imported' : 'Updated'}: ${result.profile.displayName} ${result.profile.version}`
    );
  };

  const handleExport = async (id: string, selectedFormat: AgentProfilePackageFormat) => {
    const result = await exportProfile.mutateAsync({ id, format: selectedFormat });
    setFormat(result.format);
    setExportContent(result.content);
  };

  return (
    <SettingsGroup className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <UiHeading order={3}>Agent Profile Packages</UiHeading>
          <p className="text-xs text-muted-foreground">
            {profiles.length} package{profiles.length === 1 ? '' : 's'} installed
          </p>
        </div>
        <UiPill>YAML / JSON</UiPill>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,420px)]">
        <div className="space-y-2">
          {isLoading ? (
            <SettingsGroup empty className="text-sm text-muted-foreground">
              Loading packages...
            </SettingsGroup>
          ) : profiles.length === 0 ? (
            <SettingsGroup empty className="text-sm text-muted-foreground">
              No profile packages installed.
            </SettingsGroup>
          ) : (
            profiles.map((profile) => (
              <AgentProfileCard
                key={profile.id}
                profile={profile}
                agents={agents}
                onExport={handleExport}
              />
            ))
          )}
        </div>

        <SettingsGroup className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <Text size="sm" fw={500}>
              Import Package
            </Text>
            <Select
              size="xs"
              className="w-28"
              value={format}
              onChange={(value) => setFormat((value as AgentProfilePackageFormat) || 'yaml')}
              data={[
                { value: 'yaml', label: 'YAML' },
                { value: 'json', label: 'JSON' },
              ]}
              allowDeselect={false}
            />
          </div>
          <Textarea
            value={content}
            onChange={(event) => setContent(event.currentTarget.value)}
            minRows={12}
            spellCheck={false}
          />
          <div className="flex flex-wrap gap-2">
            <UiAction
              variant="secondary"
              onClick={handleValidate}
              loading={validateProfile.isPending}
            >
              Validate
            </UiAction>
            <UiAction
              variant="primary"
              leftSection={<Upload className="h-4 w-4" />}
              onClick={handleImport}
              loading={importProfile.isPending}
            >
              Import
            </UiAction>
          </div>
          {validationMessage && (
            <pre className="max-h-36 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-xs">
              {validationMessage}
            </pre>
          )}
          {exportContent && (
            <Textarea
              label="Last Export"
              value={exportContent}
              onChange={(event) => setExportContent(event.currentTarget.value)}
              minRows={8}
              spellCheck={false}
            />
          )}
        </SettingsGroup>
      </div>
    </SettingsGroup>
  );
}

function AgentProfileCard({
  profile,
  agents,
  onExport,
}: {
  profile: AgentProfilePackageSummary;
  agents: AgentConfig[];
  onExport: (id: string, format: AgentProfilePackageFormat) => void;
}) {
  const updateProfile = useUpdateAgentProfile();
  const deleteProfile = useDeleteAgentProfile();
  const startAgent = useStartAgent();
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [role, setRole] = useState(profile.role);
  const [description, setDescription] = useState(profile.description ?? '');
  const [capabilities, setCapabilities] = useState(profile.capabilities.join(', '));
  const [defaultTaskTypes, setDefaultTaskTypes] = useState(profile.defaultTaskTypes.join(', '));
  const [launchTaskId, setLaunchTaskId] = useState('');
  const runtimeAgent = agents.find((agent) => agent.type === profile.runtime.agent);

  useEffect(() => {
    setDisplayName(profile.displayName);
    setRole(profile.role);
    setDescription(profile.description ?? '');
    setCapabilities(profile.capabilities.join(', '));
    setDefaultTaskTypes(profile.defaultTaskTypes.join(', '));
  }, [profile]);

  const saveMetadata = () => {
    updateProfile.mutate({
      id: profile.id,
      patch: {
        displayName,
        role,
        description,
        capabilities: splitCsv(capabilities),
        defaultTaskTypes: splitCsv(defaultTaskTypes),
      },
    });
  };

  const launch = () => {
    if (!launchTaskId.trim()) return;
    startAgent.mutate({ taskId: launchTaskId.trim(), profileId: profile.id });
  };

  return (
    <SettingsGroup className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Bot className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{profile.displayName}</span>
            <UiPill
              kind="status"
              tone={semanticToneForLegacyColor(profile.enabled ? 'green' : 'gray')}
            >
              {profile.enabled ? 'Enabled' : 'Disabled'}
            </UiPill>
            <UiPill>
              {profile.id}@{profile.version}
            </UiPill>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{profile.role}</p>
        </div>
        <Switch
          checked={profile.enabled}
          onChange={(event) =>
            updateProfile.mutate({
              id: profile.id,
              patch: { enabled: event.currentTarget.checked },
            })
          }
          aria-label={`Toggle ${profile.displayName}`}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <UiPill kind="status" tone={runtimeAgent?.enabled ? 'success' : 'neutral'}>
          {profile.runtime.agent}
        </UiPill>
        {profile.runtime.provider && <UiPill>{profile.runtime.provider}</UiPill>}
        {profile.runtime.model && <UiPill>{profile.runtime.model}</UiPill>}
        {profile.policy?.sandboxPresetId && <UiPill>{profile.policy.sandboxPresetId}</UiPill>}
        {profile.policy?.budget?.enabled && <UiPill>Budget</UiPill>}
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <TextInput
          label="Name"
          value={displayName}
          onChange={(e) => setDisplayName(e.currentTarget.value)}
        />
        <TextInput label="Role" value={role} onChange={(e) => setRole(e.currentTarget.value)} />
        <TextInput
          label="Capabilities"
          value={capabilities}
          onChange={(e) => setCapabilities(e.currentTarget.value)}
        />
        <TextInput
          label="Task Types"
          value={defaultTaskTypes}
          onChange={(e) => setDefaultTaskTypes(e.currentTarget.value)}
        />
      </div>
      <Textarea
        label="Description"
        value={description}
        onChange={(e) => setDescription(e.currentTarget.value)}
        minRows={2}
      />

      <div className="flex flex-wrap items-end gap-2">
        <UiAction variant="secondary" onClick={saveMetadata} loading={updateProfile.isPending}>
          Save Metadata
        </UiAction>
        <UiAction
          variant="secondary"
          leftSection={<Download className="h-4 w-4" />}
          onClick={() => onExport(profile.id, 'yaml')}
        >
          Export YAML
        </UiAction>
        <UiAction
          variant="destructive"
          onClick={() => deleteProfile.mutate(profile.id)}
          loading={deleteProfile.isPending}
        >
          Remove
        </UiAction>
        <TextInput
          size="xs"
          label="Launch Task"
          value={launchTaskId}
          onChange={(event) => setLaunchTaskId(event.currentTarget.value)}
          placeholder="task id"
        />
        <UiAction
          variant="primary"
          leftSection={<Rocket className="h-4 w-4" />}
          onClick={launch}
          loading={startAgent.isPending}
          disabled={!profile.enabled || !launchTaskId.trim()}
        >
          Launch
        </UiAction>
      </div>
    </SettingsGroup>
  );
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
    <SettingsGroup className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <UiHeading order={3}>Context Provider Health</UiHeading>
          <p className="text-xs text-muted-foreground">
            {health?.checkedAt
              ? `Checked ${new Date(health.checkedAt).toLocaleTimeString()}`
              : 'Checking provider posture'}
          </p>
        </div>
        <UiIconAction
          variant="quiet"
          onClick={onRefresh}
          disabled={isFetching}
          aria-label="Refresh provider health"
        >
          {isFetching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </UiIconAction>
      </div>

      {health && (
        <div className="flex flex-wrap gap-2">
          <UiPill>{health.summary.total} providers</UiPill>
          <UiPill
            kind="status"
            tone={semanticToneForLegacyColor(health.summary.writeCapable > 0 ? 'yellow' : 'gray')}
          >
            {health.summary.writeCapable} write-capable
          </UiPill>
          <UiPill
            kind="status"
            tone={semanticToneForLegacyColor(health.summary.risky > 0 ? 'red' : 'green')}
          >
            {health.summary.risky} risky
          </UiPill>
        </div>
      )}

      <div className="space-y-2">
        {(health?.providers ?? []).map((provider) => (
          <ProviderHealthItem key={provider.id} provider={provider} />
        ))}
        {!health?.providers?.length && (
          <SettingsGroup empty className="text-sm text-muted-foreground">
            No provider health data is available yet.
          </SettingsGroup>
        )}
      </div>
    </SettingsGroup>
  );
}

function ProviderHealthItem({ provider }: { provider: ContextProviderHealth }) {
  return (
    <SettingsGroup className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{provider.name}</span>
            <UiPill
              kind="status"
              tone={semanticToneForLegacyColor(providerStateColor(provider.state))}
            >
              {formatProviderState(provider.state)}
            </UiPill>
            <UiPill
              kind="status"
              tone={semanticToneForLegacyColor(provider.risk === 'risky' ? 'red' : 'gray')}
            >
              {formatProviderState(provider.risk)}
            </UiPill>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{provider.detail}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <UiPill>{formatProviderState(provider.boundary)}</UiPill>
        <UiPill>Read {provider.readCapability ? 'on' : 'off'}</UiPill>
        <UiPill
          kind="status"
          tone={semanticToneForLegacyColor(provider.writeCapability ? 'yellow' : 'gray')}
        >
          Write {provider.writeCapability ? 'on' : 'off'}
        </UiPill>
      </div>

      <p className="text-xs text-muted-foreground">{provider.privacyScope}</p>

      {provider.tools.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {provider.tools.slice(0, 5).map((tool) => (
            <UiPill key={tool}>{tool}</UiPill>
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
            <SettingsGroup key={check.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium">{check.label}</span>
                <UiPill
                  kind="status"
                  tone={semanticToneForLegacyColor(providerPostureStatusColor(check.status))}
                >
                  {formatProviderState(check.status)}
                </UiPill>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{check.detail}</p>
              {check.items?.length ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {check.items.slice(0, 6).map((item) => (
                    <UiPill key={item}>{item}</UiPill>
                  ))}
                </div>
              ) : null}
            </SettingsGroup>
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
    </SettingsGroup>
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
      sandboxPresetId: selectedAgentConfig?.sandboxPresetId,
      manualHostId: selectedHostId === 'auto' ? undefined : selectedHostId,
    }),
    [
      selectedAgent,
      selectedAgentConfig?.provider,
      selectedAgentConfig?.model,
      selectedAgentConfig?.sandboxPresetId,
      selectedHostId,
    ]
  );
  const { data: preview, isFetching: isPreviewFetching } = useAgentHostPreview(
    previewRequest,
    !!selectedAgent || (health?.hosts.length ?? 0) > 0
  );

  return (
    <SettingsGroup className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <UiHeading order={3}>Agent Host Health</UiHeading>
          <p className="text-xs text-muted-foreground">
            {health?.generatedAt
              ? `Checked ${new Date(health.generatedAt).toLocaleTimeString()}`
              : 'Checking supervisor posture'}
          </p>
        </div>
        <UiIconAction
          variant="quiet"
          onClick={() => refetch()}
          disabled={isFetching}
          aria-label="Refresh host health"
        >
          {isFetching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </UiIconAction>
      </div>

      <AgentHostSummary health={health} />

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          {(health?.hosts ?? []).map((host) => (
            <AgentHostItem key={host.id} host={host} />
          ))}
          {!health?.hosts?.length && (
            <SettingsGroup empty className="text-sm text-muted-foreground">
              No agent supervisors have registered host metadata yet.
            </SettingsGroup>
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
    </SettingsGroup>
  );
}

function AgentHostSummary({ health }: { health?: AgentHostHealthResponse }) {
  if (!health) {
    return (
      <div className="flex flex-wrap gap-2">
        <UiPill>Loading hosts</UiPill>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <UiPill>{health.summary.total} hosts</UiPill>
      <UiPill kind="status" tone="success">
        {health.summary.connected} connected
      </UiPill>
      <UiPill
        kind="status"
        tone={semanticToneForLegacyColor(health.summary.degraded > 0 ? 'yellow' : 'gray')}
      >
        {health.summary.degraded} degraded
      </UiPill>
      <UiPill
        kind="status"
        tone={semanticToneForLegacyColor(health.summary.stale > 0 ? 'yellow' : 'gray')}
      >
        {health.summary.stale} stale
      </UiPill>
      <UiPill
        kind="status"
        tone={semanticToneForLegacyColor(health.summary.overloaded > 0 ? 'red' : 'gray')}
      >
        {health.summary.overloaded} overloaded
      </UiPill>
    </div>
  );
}

function AgentHostItem({ host }: { host: AgentHostRecord }) {
  return (
    <SettingsGroup className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Server className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{host.name}</span>
            <UiPill kind="status" tone={semanticToneForLegacyColor(hostPostureColor(host.posture))}>
              {formatProviderState(host.posture)}
            </UiPill>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {host.supervisorType}
            {host.os ? ` · ${host.os}` : ''}
          </p>
        </div>
        <UiPill kind="status" tone={semanticToneForLegacyColor(host.overloaded ? 'red' : 'gray')}>
          Queue {host.queueDepth}/{host.maxQueueDepth}
        </UiPill>
      </div>

      <div className="flex flex-wrap gap-1">
        <UiPill kind="status" tone="info">
          {host.providerRuntimeManifests.length} validated manifest
          {host.providerRuntimeManifests.length === 1 ? '' : 's'}
        </UiPill>
        {host.supportedAgents.slice(0, 4).map((agent) => (
          <UiPill key={agent}>{agent}</UiPill>
        ))}
        {host.supportedProviders.slice(0, 3).map((provider) => (
          <UiPill key={provider}>{provider}</UiPill>
        ))}
        {host.sandboxCapabilities.slice(0, 3).map((capability) => (
          <UiPill key={capability}>{capability}</UiPill>
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
    </SettingsGroup>
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
    <SettingsGroup className="space-y-3">
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
        <UiPill kind="status" tone={semanticToneForLegacyColor(selectedHost ? 'green' : 'gray')}>
          {selectedHost || 'No host selected'}
        </UiPill>
        <UiPill>{preview?.decision.policy || 'disabled'}</UiPill>
      </div>

      {selectedPreview && (
        <div className="space-y-1">
          {selectedPreview.checks.slice(0, 5).map((check) => (
            <div key={check.id} className="flex items-start justify-between gap-2 text-xs">
              <span className="text-muted-foreground">{check.label}</span>
              <UiPill
                kind="status"
                tone={semanticToneForLegacyColor(check.passed ? 'green' : 'red')}
              >
                {check.passed ? 'Pass' : 'Block'}
              </UiPill>
            </div>
          ))}
        </div>
      )}

      {!selectedPreview && preview?.decision.fallbackBehavior && (
        <p className="text-xs text-muted-foreground">{preview.decision.fallbackBehavior}</p>
      )}
    </SettingsGroup>
  );
}

function SandboxPoliciesSection({
  agents,
  presets,
  isLoading,
}: {
  agents: AgentConfig[];
  presets: SandboxPolicyPreset[];
  isLoading: boolean;
}) {
  const createPreset = useCreateSandboxPolicy();
  const updatePreset = useUpdateSandboxPolicy();
  const deletePreset = useDeleteSandboxPolicy();
  const validatePreset = useValidateSandboxPolicy();
  const { data: hostHealth } = useAgentHosts();
  const [editingPreset, setEditingPreset] = useState<SandboxPolicyPreset | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [previewPresetId, setPreviewPresetId] = useState<string>('');
  const [previewProvider, setPreviewProvider] = useState<AgentProvider>('codex-sdk');
  const [previewState, setPreviewState] = useState<
    | { status: 'idle' }
    | { status: 'pending'; key: string; epoch: number }
    | {
        status: 'success';
        key: string;
        epoch: number;
        data: SandboxPolicyDryRunResult & { traceId?: string };
      }
    | { status: 'error'; key: string; epoch: number; message: string }
  >({ status: 'idle' });
  const previewSelectionRef = useRef({ key: '', epoch: 0 });

  useEffect(() => {
    if (!previewPresetId && presets.length > 0) {
      setPreviewPresetId(presets[0].id);
    }
  }, [presets, previewPresetId]);

  const assignedByPreset = useMemo(() => {
    const grouped = new Map<string, AgentConfig[]>();
    for (const agent of agents) {
      if (!agent.sandboxPresetId) continue;
      const current = grouped.get(agent.sandboxPresetId) ?? [];
      current.push(agent);
      grouped.set(agent.sandboxPresetId, current);
    }
    return grouped;
  }, [agents]);

  const selectedPreset = presets.find((preset) => preset.id === previewPresetId);
  const previewManifest = useMemo<ProviderRuntimeManifest | undefined>(() => {
    const provider = previewProvider.toLowerCase();
    return hostHealth?.hosts
      .filter((host) => host.posture === 'connected')
      .flatMap((host) => host.providerRuntimeManifests)
      .filter(
        (manifest) =>
          manifest.provider.toLowerCase() === provider ||
          manifest.adapter.toLowerCase() === provider
      )
      .sort((left, right) => right.probe.probedAt.localeCompare(left.probe.probedAt))[0];
  }, [hostHealth?.hosts, previewProvider]);
  const previewSelectionKey = `${selectedPreset?.id ?? ''}\u0000${previewProvider.toLowerCase()}\u0000${previewManifest?.digest ?? ''}`;
  if (previewSelectionRef.current.key !== previewSelectionKey) {
    previewSelectionRef.current = {
      key: previewSelectionKey,
      epoch: previewSelectionRef.current.epoch + 1,
    };
  }
  const previewStateIsCurrent =
    previewState.status !== 'idle' &&
    previewState.key === previewSelectionRef.current.key &&
    previewState.epoch === previewSelectionRef.current.epoch;
  const validation =
    previewStateIsCurrent && previewState.status === 'success' ? previewState.data : undefined;
  const validationError =
    previewStateIsCurrent && previewState.status === 'error' ? previewState.message : undefined;
  const validationPending = previewStateIsCurrent && previewState.status === 'pending';

  const handlePreview = async () => {
    if (!selectedPreset || !previewManifest) return;
    const selection = { ...previewSelectionRef.current };
    setPreviewState({ status: 'pending', ...selection });
    try {
      const data = await validatePreset.mutateAsync({
        presetId: selectedPreset.id,
        provider: previewProvider,
        providerRuntimeManifestDigest: previewManifest.digest,
      });
      if (
        previewSelectionRef.current.key === selection.key &&
        previewSelectionRef.current.epoch === selection.epoch
      ) {
        setPreviewState({ status: 'success', ...selection, data });
      }
    } catch (error) {
      if (
        previewSelectionRef.current.key === selection.key &&
        previewSelectionRef.current.epoch === selection.epoch
      ) {
        setPreviewState({
          status: 'error',
          ...selection,
          message:
            error instanceof Error
              ? error.message
              : 'Sandbox validation failed. Refresh host readiness and try again.',
        });
      }
    }
  };

  const handleSavePreset = (preset: SandboxPolicyPreset) => {
    if (editingPreset) {
      updatePreset.mutate(
        { id: editingPreset.id, preset },
        {
          onSuccess: () => setEditingPreset(null),
        }
      );
      return;
    }

    createPreset.mutate(preset, {
      onSuccess: () => setShowCreateForm(false),
    });
  };

  return (
    <SettingsGroup className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <UiHeading order={3}>Sandbox Policies</UiHeading>
          <p className="text-xs text-muted-foreground">
            {isLoading ? 'Loading presets' : `${presets.length} presets configured`}
          </p>
        </div>
        {!showCreateForm && !editingPreset && (
          <UiAction
            variant="secondary"
            leftSection={<Plus className="h-4 w-4" />}
            onClick={() => setShowCreateForm(true)}
          >
            Add Preset
          </UiAction>
        )}
      </div>

      {(showCreateForm || editingPreset) && (
        <SandboxPresetForm
          preset={editingPreset ?? undefined}
          existingIds={presets.map((preset) => preset.id)}
          onSubmit={handleSavePreset}
          onCancel={() => {
            setShowCreateForm(false);
            setEditingPreset(null);
          }}
        />
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-2">
          {presets.map((preset) => {
            const assignedAgents = assignedByPreset.get(preset.id) ?? [];
            return (
              <SettingsGroup key={preset.id} className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{preset.name}</span>
                      <UiPill
                        kind="status"
                        tone={semanticToneForLegacyColor(preset.enabled ? 'green' : 'gray')}
                      >
                        {preset.enabled ? 'Enabled' : 'Disabled'}
                      </UiPill>
                      <UiPill>{preset.enforcement}</UiPill>
                      {preset.builtIn && <UiPill>Built-in</UiPill>}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {sandboxPresetSummary(preset)}
                    </p>
                  </div>
                  {!preset.builtIn && (
                    <div className="flex items-center gap-1">
                      <UiIconAction
                        variant="quiet"
                        aria-label={`Edit ${preset.name}`}
                        onClick={() => setEditingPreset(preset)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </UiIconAction>
                      <UiIconAction
                        variant="quiet"
                        aria-label={
                          preset.enabled ? `Disable ${preset.name}` : `Enable ${preset.name}`
                        }
                        onClick={() =>
                          updatePreset.mutate({
                            id: preset.id,
                            preset: { ...preset, enabled: !preset.enabled },
                          })
                        }
                      >
                        <ShieldAlert className="h-3.5 w-3.5" />
                      </UiIconAction>
                      <UiIconAction
                        variant="destructive"
                        aria-label={`Delete ${preset.name}`}
                        onClick={() => deletePreset.mutate(preset.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </UiIconAction>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-1">
                  <UiPill>{formatSandboxMode(preset)}</UiPill>
                  <UiPill>Network {preset.network.defaultEgress}</UiPill>
                  <UiPill>Env {preset.environment.passthrough.length}</UiPill>
                  {assignedAgents.length > 0 && <UiPill>{assignedAgents.length} assigned</UiPill>}
                </div>
              </SettingsGroup>
            );
          })}

          {!presets.length && (
            <SettingsGroup empty className="text-sm text-muted-foreground">
              No sandbox presets configured.
            </SettingsGroup>
          )}
        </div>

        <SettingsGroup className="space-y-3">
          <div>
            <h4 className="text-sm font-medium">Dry Run</h4>
            <p className="text-xs text-muted-foreground">
              Check provider enforcement before launch.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Select
              label="Preset"
              size="xs"
              value={previewPresetId}
              onChange={(value) => setPreviewPresetId(value || '')}
              data={presets.map((preset) => ({ value: preset.id, label: preset.name }))}
              disabled={presets.length === 0}
            />
            <Select
              label="Provider"
              size="xs"
              value={previewProvider}
              onChange={(value) => setPreviewProvider((value as AgentProvider) || 'codex-sdk')}
              data={SANDBOX_PROVIDER_OPTIONS}
              allowDeselect={false}
            />
          </div>
          {!previewManifest && (
            <p className="text-xs text-yellow-600 dark:text-yellow-400">
              No validated live manifest is registered for this provider. The check will fail
              closed.
            </p>
          )}
          <UiAction
            variant="secondary"
            onClick={handlePreview}
            disabled={!selectedPreset || !previewManifest || validationPending}
            title={
              previewManifest
                ? 'Run dry sandbox check'
                : 'A live registered provider manifest is required'
            }
          >
            {validationPending ? 'Checking...' : 'Run Dry Check'}
          </UiAction>

          {validationError && (
            <SettingsNotice tone="error" icon={<AlertCircle className="h-4 w-4" />}>
              {validationError}
            </SettingsNotice>
          )}

          {validation && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <UiPill
                  kind="status"
                  tone={semanticToneForLegacyColor(sandboxDecisionColor(validation.decision))}
                >
                  {validation.decision}
                </UiPill>
                <UiPill>{validation.effective.sandboxMode}</UiPill>
                <UiPill
                  kind="status"
                  tone={semanticToneForLegacyColor(
                    validation.effective.networkAccessEnabled ? 'yellow' : 'green'
                  )}
                >
                  Network {validation.effective.networkAccessEnabled ? 'on' : 'off'}
                </UiPill>
              </div>
              {validation.unsupportedRules.length > 0 && (
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {validation.unsupportedRules.slice(0, 5).map((rule) => (
                    <li key={rule.id}>{rule.detail}</li>
                  ))}
                </ul>
              )}
              {validation.traceId && (
                <p className="text-xs text-muted-foreground">Trace {validation.traceId}</p>
              )}
            </div>
          )}
        </SettingsGroup>
      </div>
    </SettingsGroup>
  );
}

function SandboxPresetForm({
  preset,
  existingIds,
  onSubmit,
  onCancel,
}: {
  preset?: SandboxPolicyPreset;
  existingIds: string[];
  onSubmit: (preset: SandboxPolicyPreset) => void;
  onCancel: () => void;
}) {
  const isEditing = !!preset;
  const now = new Date().toISOString();
  const [name, setName] = useState(preset?.name ?? '');
  const [id, setId] = useState(preset?.id ?? '');
  const [enabled, setEnabled] = useState(preset?.enabled ?? true);
  const [enforcement, setEnforcement] = useState<SandboxPolicyPreset['enforcement']>(
    preset?.enforcement ?? 'required'
  );
  const [readPaths, setReadPaths] = useState(
    joinList(preset?.filesystem.readPaths ?? ['<workspace>'])
  );
  const [writePaths, setWritePaths] = useState(
    joinList(preset?.filesystem.writePaths ?? ['<workspace>'])
  );
  const [deniedPaths, setDeniedPaths] = useState(joinList(preset?.filesystem.deniedPaths ?? []));
  const [networkDefault, setNetworkDefault] = useState<
    SandboxPolicyPreset['network']['defaultEgress']
  >(preset?.network.defaultEgress ?? 'deny');
  const [allowedHosts, setAllowedHosts] = useState(joinList(preset?.network.allowedHosts ?? []));
  const [environmentKeys, setEnvironmentKeys] = useState(
    joinList(
      preset?.environment.passthrough ?? [
        'PATH',
        'HOME',
        'SHELL',
        'USER',
        'TMPDIR',
        'TEMP',
        'TERM',
        'VK_API_URL',
      ]
    )
  );
  const [credentialMode, setCredentialMode] = useState<SandboxPolicyPreset['credentials']['mode']>(
    preset?.credentials.mode ?? 'none'
  );
  const [brokerRefs, setBrokerRefs] = useState(joinList(preset?.credentials.brokerRefs ?? []));

  const effectiveId = isEditing ? preset.id : id || presetIdFromName(name);
  const duplicate = !isEditing && existingIds.includes(effectiveId);
  const valid = name.trim() && effectiveId && !duplicate;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid) return;

    onSubmit({
      id: effectiveId,
      name: name.trim(),
      enabled,
      builtIn: false,
      enforcement,
      requiredCapabilities: [],
      filesystem: {
        readPaths: splitList(readPaths),
        writePaths: splitList(writePaths),
        deniedPaths: splitList(deniedPaths),
        dotfileMasking: splitList(deniedPaths).length > 0,
        localOnlyHandles: true,
      },
      network: {
        defaultEgress: networkDefault,
        allowedHosts: splitList(allowedHosts),
        allowedMethods: allowedHosts.trim() ? ['GET', 'POST'] : [],
        allowedPathPrefixes: allowedHosts.trim() ? ['/'] : [],
        blockPrivateNetwork: networkDefault === 'deny',
        blockMetadataEndpoints: networkDefault === 'deny',
        blockLoopback: networkDefault === 'deny',
      },
      environment: {
        passthrough: splitList(environmentKeys).map((key) => key.toUpperCase()),
        redactDisplay: true,
      },
      credentials: {
        mode: credentialMode,
        brokerRefs: splitList(brokerRefs),
      },
      createdAt: preset?.createdAt ?? now,
      updatedAt: now,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="settings-form space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ShieldCheck className="h-4 w-4" />
        {isEditing ? `Edit ${preset.name}` : 'Add Sandbox Preset'}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <TextInput
          label="Name"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <TextInput
          label="ID"
          value={isEditing ? preset.id : id}
          onChange={(event) => setId(event.currentTarget.value)}
          disabled={isEditing}
          placeholder={name ? presetIdFromName(name) : 'repo-contained'}
          error={duplicate ? 'Preset ID already exists' : undefined}
        />
        <Select
          label="Enforcement"
          value={enforcement}
          onChange={(value) =>
            setEnforcement((value as SandboxPolicyPreset['enforcement']) ?? 'required')
          }
          data={[
            { value: 'required', label: 'Required' },
            { value: 'advisory', label: 'Advisory' },
          ]}
          allowDeselect={false}
        />
        <Select
          label="Network"
          value={networkDefault}
          onChange={(value) =>
            setNetworkDefault((value as SandboxPolicyPreset['network']['defaultEgress']) ?? 'deny')
          }
          data={[
            { value: 'deny', label: 'Default deny' },
            { value: 'allow', label: 'Default allow' },
          ]}
          allowDeselect={false}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Textarea
          label="Read Paths"
          value={readPaths}
          onChange={(event) => setReadPaths(event.currentTarget.value)}
          minRows={2}
        />
        <Textarea
          label="Write Paths"
          value={writePaths}
          onChange={(event) => setWritePaths(event.currentTarget.value)}
          minRows={2}
        />
        <Textarea
          label="Denied Paths"
          value={deniedPaths}
          onChange={(event) => setDeniedPaths(event.currentTarget.value)}
          minRows={2}
        />
        <Textarea
          label="Allowed Hosts"
          value={allowedHosts}
          onChange={(event) => setAllowedHosts(event.currentTarget.value)}
          minRows={2}
        />
        <Textarea
          label="Environment"
          value={environmentKeys}
          onChange={(event) => setEnvironmentKeys(event.currentTarget.value)}
          minRows={2}
        />
        <Textarea
          label="Broker Refs"
          value={brokerRefs}
          onChange={(event) => setBrokerRefs(event.currentTarget.value)}
          minRows={2}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Select
          label="Credentials"
          value={credentialMode}
          onChange={(value) =>
            setCredentialMode((value as SandboxPolicyPreset['credentials']['mode']) ?? 'none')
          }
          data={[
            { value: 'none', label: 'None' },
            { value: 'brokered', label: 'Brokered' },
            { value: 'env-passthrough', label: 'Environment passthrough' },
          ]}
          allowDeselect={false}
        />
        <Switch
          label="Enabled"
          checked={enabled}
          onChange={(event) => setEnabled(event.currentTarget.checked)}
        />
      </div>

      <div className="flex justify-end gap-2">
        <UiAction
          variant="quiet"
          type="button"
          leftSection={<X className="h-3.5 w-3.5" />}
          onClick={onCancel}
        >
          Cancel
        </UiAction>
        <UiAction
          variant="primary"
          type="submit"
          leftSection={<Check className="h-3.5 w-3.5" />}
          disabled={!valid}
        >
          Save Preset
        </UiAction>
      </div>
    </form>
  );
}

function splitList(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinList(values: string[]): string {
  return values.join('\n');
}

function presetIdFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function sandboxPresetSummary(preset: SandboxPolicyPreset): string {
  const pieces = [
    `${preset.filesystem.readPaths.length} read`,
    `${preset.filesystem.writePaths.length} write`,
    `${preset.network.allowedHosts.length} hosts`,
    `${preset.credentials.mode} credentials`,
  ];
  return pieces.join(' · ');
}

function formatSandboxMode(preset: SandboxPolicyPreset): string {
  if (preset.filesystem.writePaths.length > 0) return 'Workspace write';
  if (preset.filesystem.readPaths.length > 0) return 'Read only';
  return 'Full access';
}

function sandboxDecisionColor(decision: SandboxPolicyDryRunResult['decision']): string {
  if (decision === 'allow') return 'green';
  if (decision === 'warn') return 'yellow';
  return 'red';
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
    <UiPill
      kind="status"
      tone={semanticToneForLegacyColor(ready ? 'green' : 'gray')}
      leftSection={ready ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
    >
      {label}
    </UiPill>
  );

  return (
    <SettingsGroup className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <UiHeading order={3}>Codex Health</UiHeading>
          <p className="text-xs text-muted-foreground">
            {health?.checkedAt
              ? `Checked ${new Date(health.checkedAt).toLocaleTimeString()}`
              : 'Checking Codex readiness'}
          </p>
        </div>
        <UiIconAction
          variant="quiet"
          onClick={onRefresh}
          disabled={isFetching}
          aria-label="Refresh Codex health"
        >
          {isFetching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </UiIconAction>
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
    </SettingsGroup>
  );
}

// ============ Agent Item (display mode) ============

interface AgentItemProps {
  agent: AgentConfig;
  supportStatus?: HarnessSupportStatus;
  sandboxPresets: SandboxPolicyPreset[];
  isDefault: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onRemove: () => void;
}

function AgentItem({
  agent,
  supportStatus,
  sandboxPresets,
  isDefault,
  onToggle,
  onEdit,
  onRemove,
}: AgentItemProps) {
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const sandboxPreset = sandboxPresets.find((preset) => preset.id === agent.sandboxPresetId);

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
              {isDefault && <UiPill>Default</UiPill>}
            </div>
            <code className="text-xs text-muted-foreground">
              {agent.command} {agent.args.join(' ')}
            </code>
            <div className="mt-1 flex flex-wrap gap-1">
              {agent.provider && <UiPill>{formatAgentProvider(agent.provider)}</UiPill>}
              {supportStatus && (
                <UiPill
                  kind="status"
                  tone={semanticToneForLegacyColor(
                    harnessSupportTierColor(supportStatus.supportTier)
                  )}
                  title={supportStatus.reason}
                >
                  {formatProviderState(supportStatus.supportTier)}
                </UiPill>
              )}
              {agent.model && <UiPill>{agent.model}</UiPill>}
              {sandboxPreset && <UiPill>{sandboxPreset.name}</UiPill>}
              {agent.budget?.enabled && <UiPill>Budget</UiPill>}
            </div>
            {supportStatus && (
              <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{supportStatus.reason}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <UiIconAction variant="quiet" onClick={onEdit} aria-label={`Edit ${agent.name}`}>
            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
          </UiIconAction>
          {isDefault ? (
            <span
              className="text-xs text-muted-foreground px-1"
              title="Cannot remove the default agent"
            >
              —
            </span>
          ) : (
            <UiIconAction
              variant="quiet"
              onClick={() => setConfirmRemoveOpen(true)}
              aria-label={`Remove ${agent.name}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </UiIconAction>
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
          variant="confirm"
          compound
          opened={confirmRemoveOpen}
          onClose={() => setConfirmRemoveOpen(false)}
          title="Remove agent?"
          centered
        >
          <div className="vk-overlay-scroll">
            <Text size="sm" c="dimmed">
              This will remove &ldquo;{agent.name}&rdquo; ({agent.type}) from your agent
              configuration.
            </Text>
          </div>
          <OverlayFooter>
            <UiAction variant="quiet" data-autofocus onClick={() => setConfirmRemoveOpen(false)}>
              Cancel
            </UiAction>
            <UiAction
              variant="destructive"
              onClick={() => {
                onRemove();
                setConfirmRemoveOpen(false);
              }}
            >
              Remove
            </UiAction>
          </OverlayFooter>
        </Modal>
      )}
    </>
  );
}

// ============ Agent Form (add/edit mode) ============

interface AgentFormProps {
  agent?: AgentConfig;
  existingTypes: string[];
  sandboxPresets: SandboxPolicyPreset[];
  defaultSandboxPresetId?: string;
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
                <UiAction
                  variant="secondary"
                  leftSection={<Plus className="h-3.5 w-3.5" />}
                  onClick={() => setShowAddRule(true)}
                >
                  Add Rule
                </UiAction>
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
              <SettingsGroup empty className="text-sm text-muted-foreground py-3 text-center">
                No routing rules — all tasks use the default agent.
              </SettingsGroup>
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
              <UiAction variant="quiet" onClick={resetRouting}>
                Reset to defaults
              </UiAction>
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
            <UiPill key={i} className="font-mono">
              {label}
            </UiPill>
          ))}
          <span className="text-xs text-muted-foreground">→</span>
          <UiPill>
            {agentName}
            {rule.model ? ` (${rule.model})` : ''}
          </UiPill>
          {fallbackName && (
            <>
              <span className="text-xs text-muted-foreground">fallback:</span>
              <UiPill>{fallbackName}</UiPill>
            </>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        <UiIconAction variant="quiet" onClick={onEdit} aria-label={`Edit ${rule.name}`}>
          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
        </UiIconAction>
        <UiIconAction variant="destructive" onClick={onRemove} aria-label={`Remove ${rule.name}`}>
          <Trash2 className="h-3.5 w-3.5" />
        </UiIconAction>
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
    <form onSubmit={handleSubmit} className="settings-form space-y-3">
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
        <UiAction
          variant="quiet"
          type="button"
          leftSection={<X className="h-3.5 w-3.5" />}
          onClick={onCancel}
        >
          Cancel
        </UiAction>
        <UiAction
          variant="primary"
          type="submit"
          leftSection={<Check className="h-3.5 w-3.5" />}
          disabled={!isValid}
        >
          {isEditing ? 'Save Rule' : 'Add Rule'}
        </UiAction>
      </div>
    </form>
  );
}

// ============ Agent Form (add/edit mode) ============

function AgentForm({
  agent,
  existingTypes,
  sandboxPresets,
  defaultSandboxPresetId,
  onSubmit,
  onCancel,
}: AgentFormProps) {
  const isEditing = !!agent;
  const [name, setName] = useState(agent?.name || '');
  const [type, setType] = useState(agent?.type || '');
  const [command, setCommand] = useState(agent?.command || '');
  const [argsStr, setArgsStr] = useState(agent?.args.join(' ') || '');
  const [provider, setProvider] = useState<AgentProvider | ''>(agent?.provider || '');
  const [model, setModel] = useState(agent?.model || '');
  const [sandboxPresetId, setSandboxPresetId] = useState(agent?.sandboxPresetId || '');
  const [budgetEnabled, setBudgetEnabled] = useState(agent?.budget?.enabled ?? false);
  const [budgetLimits, setBudgetLimits] = useState<AgentBudgetLimits>(agent?.budget?.limits ?? {});

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
      provider: provider || undefined,
      model: model.trim() || undefined,
      sandboxPresetId: sandboxPresetId || undefined,
      budget: budgetEnabled
        ? {
            enabled: true,
            scope: 'agent',
            name: `${name.trim()} run budget`,
            limits: cleanBudgetLimits(budgetLimits),
            softThresholdPercent: agent?.budget?.softThresholdPercent ?? 80,
            hardAction: agent?.budget?.hardAction ?? 'require-approval',
            downgradeModel: agent?.budget?.downgradeModel,
          }
        : undefined,
    });
  };

  const updateBudgetLimit = (key: keyof AgentBudgetLimits, value: number | string) => {
    const numeric = typeof value === 'number' ? value : Number(value);
    setBudgetLimits((current) => ({
      ...current,
      [key]: Number.isFinite(numeric) ? Math.max(0, numeric) : 0,
    }));
  };

  return (
    <form onSubmit={handleSubmit} className="settings-form space-y-3">
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

        <div className="grid grid-cols-2 gap-3">
          <Select
            id="agent-provider"
            label="Provider"
            value={provider || '__none__'}
            onChange={(value) =>
              setProvider(!value || value === '__none__' ? '' : (value as AgentProvider))
            }
            data={AGENT_PROVIDER_OPTIONS}
            allowDeselect={false}
          />
          <TextInput
            id="agent-model"
            label="Model"
            description="Optional"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="e.g., llama3.2"
            classNames={{ input: 'font-mono text-sm' }}
          />
        </div>

        <Select
          id="agent-sandbox-preset"
          label="Sandbox Preset"
          value={sandboxPresetId || '__default__'}
          onChange={(value) => setSandboxPresetId(value === '__default__' ? '' : value || '')}
          data={[
            {
              value: '__default__',
              label: defaultSandboxPresetId
                ? `Default (${defaultSandboxPresetId})`
                : 'Default / legacy',
            },
            ...sandboxPresets.map((preset) => ({ value: preset.id, label: preset.name })),
          ]}
          allowDeselect={false}
        />

        <SettingsGroup className="space-y-3">
          <Switch
            label="Agent Budget Defaults"
            description="Apply stricter caps when this agent launches runs"
            checked={budgetEnabled}
            onChange={(event) => setBudgetEnabled(event.currentTarget.checked)}
          />
          {budgetEnabled && (
            <div className="grid grid-cols-2 gap-3">
              <NumberInput
                label="Token Limit"
                value={budgetLimits.totalTokens ?? 0}
                onChange={(value) => updateBudgetLimit('totalTokens', value)}
                min={0}
                hideControls
                thousandSeparator=","
              />
              <NumberInput
                label="Cost Limit"
                value={budgetLimits.costUsd ?? 0}
                onChange={(value) => updateBudgetLimit('costUsd', value)}
                min={0}
                hideControls
                prefix="$"
              />
              <NumberInput
                label="Tool Calls"
                value={budgetLimits.toolCalls ?? 0}
                onChange={(value) => updateBudgetLimit('toolCalls', value)}
                min={0}
                hideControls
              />
              <NumberInput
                label="Runtime Seconds"
                value={budgetLimits.runtimeSeconds ?? 0}
                onChange={(value) => updateBudgetLimit('runtimeSeconds', value)}
                min={0}
                hideControls
              />
            </div>
          )}
        </SettingsGroup>
      </div>

      <div className="flex justify-end gap-2">
        <UiAction
          variant="quiet"
          type="button"
          leftSection={<X className="h-3.5 w-3.5" />}
          onClick={onCancel}
        >
          Cancel
        </UiAction>
        <UiAction
          variant="primary"
          type="submit"
          leftSection={<Check className="h-3.5 w-3.5" />}
          disabled={!isValid}
        >
          {isEditing ? 'Save' : 'Add Agent'}
        </UiAction>
      </div>
    </form>
  );
}
