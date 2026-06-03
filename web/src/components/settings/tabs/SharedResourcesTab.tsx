import { useFeatureSettings, useDebouncedFeatureUpdate } from '@/hooks/useFeatureSettings';
import { Checkbox, NumberInput } from '@mantine/core';
import { DEFAULT_FEATURE_SETTINGS, type FeatureSettings } from '@veritas-kanban/shared';
import { ToggleRow, SectionHeader, SaveIndicator, SettingRow } from '../shared';
import { SkillCapabilityProfilesPanel } from './SkillCapabilityProfilesPanel';
import { SkillRiskDashboardPanel } from './SkillRiskDashboardPanel';

const TYPE_OPTIONS: Array<{
  key: 'prompt' | 'guideline' | 'skill' | 'config' | 'template';
  label: string;
}> = [
  { key: 'prompt', label: 'Prompt' },
  { key: 'guideline', label: 'Guideline' },
  { key: 'skill', label: 'Skill' },
  { key: 'config', label: 'Config' },
  { key: 'template', label: 'Template' },
];

export function SharedResourcesTab() {
  const { settings } = useFeatureSettings();
  const { debouncedUpdate, isPending } = useDebouncedFeatureUpdate();

  const sharedResources = settings?.sharedResources ?? DEFAULT_FEATURE_SETTINGS.sharedResources;

  const updateSharedResources = (patch: Partial<FeatureSettings['sharedResources']>) => {
    debouncedUpdate({ sharedResources: { ...sharedResources, ...patch } });
  };

  const resetSharedResources = () => {
    debouncedUpdate({ sharedResources: DEFAULT_FEATURE_SETTINGS.sharedResources });
  };

  const allowedTypes = sharedResources.allowedTypes ?? [];

  const toggleAllowedType = (type: (typeof TYPE_OPTIONS)[number]['key']) => {
    const next = new Set(allowedTypes);
    if (next.has(type)) {
      next.delete(type);
    } else {
      next.add(type);
    }
    updateSharedResources({ allowedTypes: Array.from(next) });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <SectionHeader title="Shared Resources" onReset={resetSharedResources} />
        <SaveIndicator isPending={isPending} />
      </div>
      <p className="text-sm text-muted-foreground -mt-2">
        Define reusable prompts, guidelines, skills, and templates across projects.
      </p>

      <div className="divide-y">
        <ToggleRow
          label="Enable Shared Resources"
          description="Allow shared resources to be mounted across projects"
          checked={sharedResources.enabled}
          onCheckedChange={(v) => updateSharedResources({ enabled: v })}
        />
        {sharedResources.enabled && (
          <SettingRow
            label="Max Resources"
            description="Global limit for shared resources (1-1000)"
          >
            <NumberInput
              min={1}
              max={1000}
              value={sharedResources.maxResources}
              onChange={(value) => {
                const nextValue = typeof value === 'number' ? value : Number(value);
                if (Number.isFinite(nextValue)) {
                  updateSharedResources({ maxResources: nextValue });
                }
              }}
              size="xs"
              radius="md"
              w={160}
              aria-label="Max Resources"
            />
          </SettingRow>
        )}
      </div>

      {sharedResources.enabled && (
        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Allowed Types
          </h4>
          <div className="space-y-2">
            {TYPE_OPTIONS.map((option) => (
              <Checkbox
                key={option.key}
                checked={allowedTypes.includes(option.key)}
                onChange={() => toggleAllowedType(option.key)}
                label={option.label}
                radius="sm"
              />
            ))}
          </div>
        </div>
      )}

      {sharedResources.enabled && allowedTypes.includes('skill') && <SkillRiskDashboardPanel />}

      {sharedResources.enabled && allowedTypes.includes('skill') && (
        <SkillCapabilityProfilesPanel />
      )}
    </div>
  );
}
