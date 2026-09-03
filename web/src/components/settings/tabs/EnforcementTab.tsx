import { useFeatureSettings, useDebouncedFeatureUpdate } from '@/hooks/useFeatureSettings';
import { useConfig } from '@/hooks/useConfig';
import { api } from '@/lib/api';
import {
  DEFAULT_FEATURE_SETTINGS,
  type CeremonyEnforcementMode,
  type CeremonyRequirement,
} from '@veritas-kanban/shared';
import { Select } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import {
  ToggleRow,
  SettingRow,
  SaveIndicator,
  SettingsPage,
  SettingsSection,
  SettingsGroup,
  SettingsNotice,
} from '../shared';
import { UiPill } from '@/components/ui/UiVocabulary';
import { Bot } from 'lucide-react';
import { cn } from '@/lib/utils';

const ceremonyModeOptions: Array<{ value: CeremonyEnforcementMode; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'warn', label: 'Warn' },
  { value: 'block', label: 'Block' },
];

function formatCeremonyKind(kind: CeremonyRequirement['kind']): string {
  return kind === 'design_review' ? 'Design review' : 'Failure retrospective';
}

function formatCeremonyTarget(requirement: CeremonyRequirement): string {
  const { target } = requirement;
  return (
    target.taskId ||
    target.runId ||
    target.workflowId ||
    target.prUrl ||
    target.ciUrl ||
    'workspace'
  );
}

export function EnforcementTab() {
  const { settings } = useFeatureSettings();
  const { debouncedUpdate, isPending } = useDebouncedFeatureUpdate();
  const { data: config } = useConfig();
  const { data: pendingCeremonies = [] } = useQuery({
    queryKey: ['ceremonies', 'pending', 'settings'],
    queryFn: () => api.ceremonies.list({ status: 'pending', limit: 5 }),
    staleTime: 30_000,
  });

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
    <SettingsPage
      title="Enforcement"
      description="Configure opt-in process gates, automation, and orchestrator delegation."
    >
      <SettingsSection
        title="Completion Gates"
        description="Require review and ceremony evidence before eligible work can complete."
        actions={<SaveIndicator isPending={isPending} />}
        onReset={resetEnforcement}
      >
        <div className="space-y-4">
          <div className="space-y-3">
            <div>
              <ToggleRow
                label="Review Gate"
                description="Require 4x10 review scores before task completion"
                checked={enforcement.reviewGate ?? false}
                onCheckedChange={(v) => updateEnforcement('reviewGate', v)}
              />
              {enforcement.reviewGate && (
                <SettingsNotice>
                  Applies to code task types only (code, bug, feature, automation, system). Non-code
                  tasks can be completed without review scores.
                </SettingsNotice>
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
            <div className="border-t pt-3 space-y-3">
              <SettingRow
                label="Design Review Ceremony"
                description="Require review artifacts before completing high-risk or multi-agent tasks"
              >
                <Select
                  value={enforcement.ceremonyDesignReview ?? 'off'}
                  onChange={(value) =>
                    updateEnforcement(
                      'ceremonyDesignReview',
                      (value ?? 'off') as CeremonyEnforcementMode
                    )
                  }
                  data={ceremonyModeOptions}
                  aria-label="Design Review Ceremony Enforcement"
                  allowDeselect={false}
                  size="xs"
                  className="w-full sm:w-36"
                />
              </SettingRow>
              <SettingRow
                label="Failure Retrospective Ceremony"
                description="Require retrospective artifacts after blocked work or failed attempts"
              >
                <Select
                  value={enforcement.ceremonyFailureRetrospective ?? 'off'}
                  onChange={(value) =>
                    updateEnforcement(
                      'ceremonyFailureRetrospective',
                      (value ?? 'off') as CeremonyEnforcementMode
                    )
                  }
                  data={ceremonyModeOptions}
                  aria-label="Failure Retrospective Ceremony Enforcement"
                  allowDeselect={false}
                  size="xs"
                  className="w-full sm:w-36"
                />
              </SettingRow>
              <SettingsGroup>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-foreground">Pending ceremonies</span>
                  <UiPill kind="count">{pendingCeremonies.length}</UiPill>
                </div>
                {pendingCeremonies.length > 0 ? (
                  <div className="mt-2 space-y-2">
                    {pendingCeremonies.map((requirement) => (
                      <div key={requirement.id} className="text-xs">
                        <div className="font-medium text-foreground">{requirement.title}</div>
                        <div className="text-muted-foreground">
                          {formatCeremonyKind(requirement.kind)} -{' '}
                          {formatCeremonyTarget(requirement)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-1 text-xs text-muted-foreground">No pending ceremonies</div>
                )}
              </SettingsGroup>
            </div>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Automation"
        description="Emit collaboration, telemetry, and time-tracking events automatically."
        divided
      >
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
      </SettingsSection>

      <SettingsSection
        title="Orchestrator Delegation"
        description="Warn when the designated orchestrator performs implementation instead of coordinating delegates."
        tone="advanced"
        status={
          delegationActive ? (
            <UiPill kind="status" tone="success">
              Active
            </UiPill>
          ) : (
            <UiPill>Inactive</UiPill>
          )
        }
      >
        <div className="space-y-4">
          <SettingsNotice>
            <p>
              <strong>What is orchestrator delegation?</strong> When enabled, the designated
              orchestrator agent is expected to coordinate work by delegating tasks to sub-agents
              rather than doing implementation work directly. VK will warn when the orchestrator
              starts doing hands-on work instead of delegating.
            </p>
          </SettingsNotice>

          <div className="divide-y">
            <ToggleRow
              label="Enable Delegation Enforcement"
              description="Warn when orchestrator does work instead of delegating"
              checked={enforcement.orchestratorDelegation ?? false}
              onCheckedChange={(v) => updateEnforcement('orchestratorDelegation', v)}
            />

            <div
              className={cn(
                !enforcement.orchestratorDelegation && 'opacity-50 pointer-events-none'
              )}
            >
              <SettingRow
                label="Orchestrator Agent"
                description="The agent designated as the orchestrator / coordinator"
              >
                <div className="flex items-center gap-2">
                  {orchestratorAgent && <Bot className="h-4 w-4 text-primary" />}
                  <Select
                    disabled={!enforcement.orchestratorDelegation}
                    value={orchestratorAgent || '__none__'}
                    onChange={(value) =>
                      updateEnforcement(
                        'orchestratorAgent',
                        value === '__none__' ? '' : (value ?? '')
                      )
                    }
                    data={[
                      { value: '__none__', label: 'None selected' },
                      ...enabledAgents.map((agent) => ({
                        value: agent.type,
                        label: agent.name,
                      })),
                    ]}
                    aria-label="Orchestrator Agent"
                    placeholder="Select agent..."
                    allowDeselect={false}
                    size="xs"
                    className="w-full sm:w-44"
                  />
                </div>
              </SettingRow>
            </div>
          </div>

          {enforcement.orchestratorDelegation && !orchestratorAgent && (
            <SettingsNotice tone="warning">
              Delegation enforcement is enabled but no orchestrator agent is selected. Select an
              agent above for enforcement to take effect.
            </SettingsNotice>
          )}
        </div>
      </SettingsSection>
    </SettingsPage>
  );
}
