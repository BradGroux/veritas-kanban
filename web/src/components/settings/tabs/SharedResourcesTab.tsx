import { useFeatureSettings, useDebouncedFeatureUpdate } from '@/hooks/useFeatureSettings';
import { DEFAULT_FEATURE_SETTINGS } from '@veritas-kanban/shared';
import { ToggleRow, SectionHeader, SaveIndicator, SettingRow } from '../shared';
import { Checkbox } from '@/components/ui/checkbox';

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

  const sharedResources = settings.sharedResources;

  const updateSharedResources = (patch: Record<string, any>) => {
    debouncedUpdate({ sharedResources: patch });
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
            <div className="flex items-center gap-3 min-w-[200px]">
              <input
                type="range"
                min={1}
                max={1000}
                value={sharedResources.maxResources}
                onChange={(e) => updateSharedResources({ maxResources: Number(e.target.value) })}
                className="w-40"
              />
              <span className="text-xs text-muted-foreground w-10 text-right">
                {sharedResources.maxResources}
              </span>
            </div>
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
              <label key={option.key} className="flex items-center gap-3 text-sm">
                <Checkbox
                  checked={allowedTypes.includes(option.key)}
                  onCheckedChange={() => toggleAllowedType(option.key)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
