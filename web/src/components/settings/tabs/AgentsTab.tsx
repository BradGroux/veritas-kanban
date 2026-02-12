import { useState, useCallback } from 'react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useConfig, useUpdateAgents } from '@/hooks/useConfig';
import { useFeatureSettings, useDebouncedFeatureUpdate } from '@/hooks/useFeatureSettings';
import { useRoutingConfig, useUpdateRoutingConfig } from '@/hooks/useRouting';
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
} from 'lucide-react';
import type {
  AgentConfig,
  AgentType,
  RoutingRule,
  AgentRoutingConfig,
} from '@veritas-kanban/shared';
import { DEFAULT_FEATURE_SETTINGS, DEFAULT_ROUTING_CONFIG } from '@veritas-kanban/shared';
import { cn } from '@/lib/utils';
import { ToggleRow, NumberRow, SectionHeader, SaveIndicator } from '../shared';

export function AgentsTab() {
  const { data: config, isLoading } = useConfig();
  const { settings } = useFeatureSettings();
  const { debouncedUpdate, isPending } = useDebouncedFeatureUpdate();
  const updateAgents = useUpdateAgents();
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingAgent, setEditingAgent] = useState<string | null>(null);

  const update = (key: string, value: any) => {
    debouncedUpdate({ agents: { [key]: value } });
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
            <Button variant="outline" size="sm" onClick={() => setShowAddForm(true)}>
              <Plus className="h-4 w-4 mr-1" /> Add Agent
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

// ============ Agent Item (display mode) ============

interface AgentItemProps {
  agent: AgentConfig;
  isDefault: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onRemove: () => void;
}

function AgentItem({ agent, isDefault, onToggle, onEdit, onRemove }: AgentItemProps) {
  return (
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
            <span className={cn('font-medium text-sm', !agent.enabled && 'text-muted-foreground')}>
              {agent.name}
            </span>
            {isDefault && (
              <span className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded">
                Default
              </span>
            )}
          </div>
          <code className="text-xs text-muted-foreground">
            {agent.command} {agent.args.join(' ')}
          </code>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onEdit}
          aria-label={`Edit ${agent.name}`}
        >
          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
        {isDefault ? (
          <span
            className="text-xs text-muted-foreground px-1"
            title="Cannot remove the default agent"
          >
            —
          </span>
        ) : (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label={`Remove ${agent.name}`}
              >
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove agent?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will remove &ldquo;{agent.name}&rdquo; ({agent.type}) from your agent
                  configuration.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={onRemove}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        <Switch
          checked={agent.enabled}
          onCheckedChange={onToggle}
          aria-label={`Enable ${agent.name}`}
        />
      </div>
    </div>
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
            onCheckedChange={handleToggleEnabled}
            aria-label="Enable agent routing"
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
                <Button variant="outline" size="sm" onClick={() => setShowAddRule(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add Rule
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
              <Button variant="ghost" size="sm" className="text-xs h-6" onClick={resetRouting}>
                Reset to defaults
              </Button>
            </div>
            <div className="divide-y">
              <div className="flex items-center justify-between py-2">
                <div>
                  <Label className="text-sm">Default Agent</Label>
                  <p className="text-xs text-muted-foreground">Used when no rules match</p>
                </div>
                <Select value={config.defaultAgent} onValueChange={handleDefaultAgentChange}>
                  <SelectTrigger className="w-[180px] h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {enabledAgents.map((a) => (
                      <SelectItem key={a.type} value={a.type}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between py-2">
                <div>
                  <Label className="text-sm">Default Model</Label>
                  <p className="text-xs text-muted-foreground">
                    Model override for the default agent
                  </p>
                </div>
                <Input
                  value={config.defaultModel || ''}
                  onChange={(e) => handleDefaultModelChange(e.target.value)}
                  placeholder="e.g., sonnet"
                  className="w-[180px] h-8 text-sm"
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
            <Badge key={i} variant="secondary" className="text-xs font-mono">
              {label}
            </Badge>
          ))}
          <span className="text-xs text-muted-foreground">→</span>
          <Badge variant="outline" className="text-xs">
            {agentName}
            {rule.model ? ` (${rule.model})` : ''}
          </Badge>
          {fallbackName && (
            <>
              <span className="text-xs text-muted-foreground">fallback:</span>
              <Badge variant="outline" className="text-xs">
                {fallbackName}
              </Badge>
            </>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
        </Button>
        <Switch checked={rule.enabled} onCheckedChange={onToggle} />
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
        priority: parseList(matchPriority) as any,
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
          <div className="grid gap-1.5">
            <Label>Rule Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., High-priority bugs"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>
              ID{' '}
              {!isEditing && effectiveId && (
                <span className="text-xs text-muted-foreground ml-1">({effectiveId})</span>
              )}
            </Label>
            <Input
              value={isEditing ? rule.id : id}
              onChange={(e) => setId(e.target.value)}
              placeholder="auto from name"
              disabled={isEditing}
              className={cn(isDuplicate && 'border-red-500')}
            />
          </div>
        </div>

        {/* Match criteria */}
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label>
              Match Type(s) <span className="text-xs text-muted-foreground">(comma-separated)</span>
            </Label>
            <Input
              value={matchType}
              onChange={(e) => setMatchType(e.target.value)}
              placeholder="e.g., code, bug"
              className="font-mono text-sm"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>
              Match Priority{' '}
              <span className="text-xs text-muted-foreground">(low, medium, high)</span>
            </Label>
            <Input
              value={matchPriority}
              onChange={(e) => setMatchPriority(e.target.value)}
              placeholder="e.g., high"
              className="font-mono text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label>
              Match Project <span className="text-xs text-muted-foreground">(optional)</span>
            </Label>
            <Input
              value={matchProject}
              onChange={(e) => setMatchProject(e.target.value)}
              placeholder="e.g., rubicon"
              className="font-mono text-sm"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>
              Min Subtasks <span className="text-xs text-muted-foreground">(complexity)</span>
            </Label>
            <Input
              type="number"
              value={minSubtasks}
              onChange={(e) => setMinSubtasks(e.target.value)}
              placeholder="e.g., 5"
              className="font-mono text-sm"
              min="0"
            />
          </div>
        </div>

        {/* Agent selection */}
        <div className="grid grid-cols-3 gap-3">
          <div className="grid gap-1.5">
            <Label>Primary Agent</Label>
            <Select value={agent} onValueChange={setAgent}>
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {agents.map((a) => (
                  <SelectItem key={a.type} value={a.type}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>
              Model <span className="text-xs text-muted-foreground">(optional)</span>
            </Label>
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="e.g., opus"
              className="font-mono text-sm"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>
              Fallback Agent <span className="text-xs text-muted-foreground">(optional)</span>
            </Label>
            <Select
              value={fallback || '__none__'}
              onValueChange={(v) => setFallback(v === '__none__' ? '' : v)}
            >
              <SelectTrigger className="h-8">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {agents
                  .filter((a) => a.type !== agent)
                  .map((a) => (
                    <SelectItem key={a.type} value={a.type}>
                      {a.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          <X className="h-3.5 w-3.5 mr-1" /> Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!isValid}>
          <Check className="h-3.5 w-3.5 mr-1" /> {isEditing ? 'Save Rule' : 'Add Rule'}
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
          <div className="grid gap-1.5">
            <Label htmlFor="agent-name">Display Name</Label>
            <Input
              id="agent-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., My Custom Agent"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="agent-type">
              Type Slug
              {!isEditing && typeSlug && (
                <span className="text-xs text-muted-foreground ml-1">({typeSlug})</span>
              )}
            </Label>
            <Input
              id="agent-type"
              value={isEditing ? agent.type : type}
              onChange={(e) => setType(e.target.value)}
              placeholder="auto-generated from name"
              disabled={isEditing}
              className={cn(isDuplicate && 'border-red-500')}
            />
            {isDuplicate && (
              <p className="text-xs text-red-500">An agent with this type already exists</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="agent-command">Command</Label>
            <Input
              id="agent-command"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="e.g., claude"
              className="font-mono text-sm"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="agent-args">Arguments (space-separated)</Label>
            <Input
              id="agent-args"
              value={argsStr}
              onChange={(e) => setArgsStr(e.target.value)}
              placeholder="e.g., --flag -p"
              className="font-mono text-sm"
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          <X className="h-3.5 w-3.5 mr-1" /> Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!isValid}>
          <Check className="h-3.5 w-3.5 mr-1" /> {isEditing ? 'Save' : 'Add Agent'}
        </Button>
      </div>
    </form>
  );
}
