import { Switch } from '@/components/ui/switch';
import {
  useConfig,
  useUpdateAgents,
} from '@/hooks/useConfig';
import {
  useFeatureSettings,
  useDebouncedFeatureUpdate,
} from '@/hooks/useFeatureSettings';
import { Bot } from 'lucide-react';
import type { AgentConfig, AgentType } from '@veritas-kanban/shared';
import { DEFAULT_FEATURE_SETTINGS } from '@veritas-kanban/shared';
import { cn } from '@/lib/utils';
import { ToggleRow, NumberRow, SectionHeader, SaveIndicator } from '../shared';

export function AgentsTab() {
  const { data: config, isLoading } = useConfig();
  const { settings } = useFeatureSettings();
  const { debouncedUpdate, isPending } = useDebouncedFeatureUpdate();
  const updateAgents = useUpdateAgents();

  const update = (key: string, value: any) => {
    debouncedUpdate({ agents: { [key]: value } });
  };

  const handleToggleAgent = (agentType: AgentType) => {
    if (!config) return;
    const updatedAgents = config.agents.map(a =>
      a.type === agentType ? { ...a, enabled: !a.enabled } : a
    );
    updateAgents.mutate(updatedAgents);
  };

  const resetAgents = () => {
    debouncedUpdate({ agents: DEFAULT_FEATURE_SETTINGS.agents });
  };

  return (
    <div className="space-y-6">
      {/* Agent List */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium">Installed Agents</h3>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading...</div>
        ) : (
          <div className="space-y-2">
            {config?.agents.map((agent) => (
              <AgentToggleItem
                key={agent.type}
                agent={agent}
                onToggle={() => handleToggleAgent(agent.type)}
              />
            ))}
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
            value={settings.agents.timeoutMinutes}
            onChange={(v) => update('timeoutMinutes', v)}
            min={5}
            max={480}
            unit="min"
          />
          <ToggleRow
            label="Auto-Commit on Complete"
            description="Automatically commit changes when agent finishes successfully"
            checked={settings.agents.autoCommitOnComplete}
            onCheckedChange={(v) => update('autoCommitOnComplete', v)}
          />
          <ToggleRow
            label="Auto-Cleanup Worktrees"
            description="Remove worktree when task is archived"
            checked={settings.agents.autoCleanupWorktrees}
            onCheckedChange={(v) => update('autoCleanupWorktrees', v)}
          />
          <ToggleRow
            label="Preview Panel"
            description="Show preview panel in task detail view"
            checked={settings.agents.enablePreview}
            onCheckedChange={(v) => update('enablePreview', v)}
          />
        </div>
      </div>
    </div>
  );
}

function AgentToggleItem({ agent, onToggle }: { agent: AgentConfig; onToggle: () => void }) {
  return (
    <div className={cn(
      'flex items-center justify-between py-2 px-3 rounded-md border',
      agent.enabled ? 'bg-card' : 'bg-muted/30'
    )}>
      <div className="flex items-center gap-3">
        <Bot className="h-4 w-4 text-muted-foreground" />
        <div>
          <div className={cn('font-medium text-sm', !agent.enabled && 'text-muted-foreground')}>
            {agent.name}
          </div>
          <code className="text-xs text-muted-foreground">
            {agent.command} {agent.args.join(' ')}
          </code>
        </div>
      </div>
      <Switch 
        checked={agent.enabled} 
        onCheckedChange={onToggle}
        aria-label={`Enable ${agent.name}`}
      />
    </div>
  );
}
