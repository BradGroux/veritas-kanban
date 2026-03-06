import { useFeatureSettings, useDebouncedFeatureUpdate } from '@/hooks/useFeatureSettings';
import { useConfig } from '@/hooks/useConfig';
import { DEFAULT_FEATURE_SETTINGS } from '@veritas-kanban/shared';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ToggleRow, SettingRow, SectionHeader, SaveIndicator } from '../shared';
import { Shield, ShieldCheck, Bot } from 'lucide-react';
import { cn } from '@/lib/utils';

export function EnforcementTab() {
  const { settings } = useFeatureSettings();
  const { debouncedUpdate, isPending } = useDebouncedFeatureUpdate();
  const { data: config } = useConfig();

  const updateEnforcement = (key: string, value: boolean | string) => {
    debouncedUpdate({ enforcement: { [key]: value } });
  };

  const resetEnforcement = () => {
    debouncedUpdate({
      enforcement: DEFAULT_FEATURE_SETTINGS.enforcement,
    });
  };

  const enforcement = settings.enforcement ?? DEFAULT_FEATURE_SETTINGS.enforcement;
  const agents = config?.agents ?? [];
  const enabledAgents = agents.filter((a) => a.enabled);
  const orchestratorAgent = enforcement.orchestratorAgent || '';
  const delegationActive = enforcement.orchestratorDelegation && !!orchestratorAgent;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionHeader title="Enforcement Gates" onReset={resetEnforcement} />
        <SaveIndicator isPending={isPending} />
      </div>
      <p className="text-sm text-muted-foreground -mt-2">
        Structural process enforcement — all gates are opt-in
      </p>

      <div className="space-y-4 mt-6">
        <div className="space-y-3">
          <div>
            <ToggleRow
              label="Review Gate"
              description="Require 4x10 review scores before task completion"
              checked={enforcement.reviewGate ?? false}
              onCheckedChange={(v) => updateEnforcement('reviewGate', v)}
            />
            {enforcement.reviewGate && (
              <div className="text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2 mt-2 ml-1">
                ℹ️ Applies to code task types only (code, bug, feature, automation, system).
                Non-code tasks can be completed without review scores.
              </div>
            )}
          </div>
          <div className="border-t pt-3">
            <ToggleRow
              label="Closing Comments"
              description="Require deliverable summary before task completion"
              checked={enforcement.closingComments ?? false}
              onCheckedChange={(v) => updateEnforcement('closingComments', v)}
            />
          </div>
        </div>
      </div>

      <div className="border-t my-6" />

      {/* Automation Gates */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-foreground">Automation</h3>
        <div className="divide-y">
          <ToggleRow
            label="Squad Chat"
            description="Auto-post task lifecycle events to squad chat"
            checked={enforcement.squadChat ?? false}
            onCheckedChange={(v) => updateEnforcement('squadChat', v)}
          />
          <ToggleRow
            label="Auto Telemetry"
            description="Auto-emit run events on status changes"
            checked={enforcement.autoTelemetry ?? false}
            onCheckedChange={(v) => updateEnforcement('autoTelemetry', v)}
          />
          <ToggleRow
            label="Auto Time Tracking"
            description="Auto-start/stop timers on status changes"
            checked={enforcement.autoTimeTracking ?? false}
            onCheckedChange={(v) => updateEnforcement('autoTimeTracking', v)}
          />
        </div>
      </div>

      <div className="border-t my-6" />

      {/* Orchestrator Delegation Section */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-foreground">Orchestrator Delegation</h3>
          {delegationActive ? (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/10 text-green-600 dark:text-green-400">
              <ShieldCheck className="h-3 w-3" />
              <span className="text-xs font-medium">Active</span>
            </div>
          ) : (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
              <Shield className="h-3 w-3" />
              <span className="text-xs font-medium">Inactive</span>
            </div>
          )}
        </div>

        <div className="text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
          <p>
            <strong>What is orchestrator delegation?</strong> When enabled, the designated
            orchestrator agent is expected to coordinate work by delegating tasks to sub-agents
            rather than doing implementation work directly. VK will warn when the orchestrator
            starts doing hands-on work instead of delegating.
          </p>
        </div>

        <div className="divide-y">
          <ToggleRow
            label="Enable Delegation Enforcement"
            description="Warn when orchestrator does work instead of delegating"
            checked={enforcement.orchestratorDelegation ?? false}
            onCheckedChange={(v) => updateEnforcement('orchestratorDelegation', v)}
          />

          <div
            className={cn(!enforcement.orchestratorDelegation && 'opacity-50 pointer-events-none')}
          >
            <SettingRow
              label="Orchestrator Agent"
              description="The agent designated as the orchestrator / coordinator"
            >
              <div className="flex items-center gap-2">
                {orchestratorAgent && <Bot className="h-4 w-4 text-primary" />}
                <Select
                  value={orchestratorAgent || '__none__'}
                  onValueChange={(v) =>
                    updateEnforcement('orchestratorAgent', v === '__none__' ? '' : v)
                  }
                >
                  <SelectTrigger className="w-[180px] h-8">
                    <SelectValue placeholder="Select agent..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">
                      <span className="text-muted-foreground">None selected</span>
                    </SelectItem>
                    {enabledAgents.map((a) => (
                      <SelectItem key={a.type} value={a.type}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </SettingRow>
          </div>
        </div>

        {enforcement.orchestratorDelegation && !orchestratorAgent && (
          <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-md px-3 py-2">
            ⚠️ Delegation enforcement is enabled but no orchestrator agent is selected. Select an
            agent above for enforcement to take effect.
          </div>
        )}
      </div>
    </div>
  );
}
