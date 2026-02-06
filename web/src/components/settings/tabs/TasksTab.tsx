import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useFeatureSettings, useDebouncedFeatureUpdate } from '@/hooks/useFeatureSettings';
import { DEFAULT_FEATURE_SETTINGS } from '@veritas-kanban/shared';
import { SettingRow, ToggleRow, NumberRow, SectionHeader, SaveIndicator } from '../shared';

export function TasksTab() {
  const { settings } = useFeatureSettings();
  const { debouncedUpdate, isPending } = useDebouncedFeatureUpdate();

  const update = (key: string, value: any) => {
    debouncedUpdate({ tasks: { [key]: value } });
  };

  const resetTasks = () => {
    debouncedUpdate({ tasks: DEFAULT_FEATURE_SETTINGS.tasks });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionHeader title="Task Behavior" onReset={resetTasks} />
        <SaveIndicator isPending={isPending} />
      </div>
      <div className="divide-y">
        <ToggleRow
          label="Time Tracking"
          description="Enable time tracking on tasks"
          checked={settings.tasks.enableTimeTracking}
          onCheckedChange={(v) => update('enableTimeTracking', v)}
        />
        <ToggleRow
          label="Auto-Complete on Subtasks"
          description="Automatically complete parent when all subtasks are done"
          checked={settings.tasks.enableSubtaskAutoComplete}
          onCheckedChange={(v) => update('enableSubtaskAutoComplete', v)}
        />
        <ToggleRow
          label="Dependencies"
          description="Enable task dependency tracking"
          checked={settings.tasks.enableDependencies}
          onCheckedChange={(v) => update('enableDependencies', v)}
        />
        <ToggleRow
          label="Attachments"
          description="Allow file attachments on tasks"
          checked={settings.tasks.enableAttachments}
          onCheckedChange={(v) => update('enableAttachments', v)}
        />
        {settings.tasks.enableAttachments && (
          <>
            <NumberRow
              label="Max File Size"
              description="Maximum size per attachment"
              value={Math.round(settings.tasks.attachmentMaxFileSize / (1024 * 1024))}
              onChange={(v) => update('attachmentMaxFileSize', v * 1024 * 1024)}
              min={1}
              max={9999}
              unit="MB"
              hideSpinners
              maxLength={4}
            />
            <NumberRow
              label="Max Files Per Task"
              description="Maximum number of attachments per task"
              value={settings.tasks.attachmentMaxPerTask}
              onChange={(v) => update('attachmentMaxPerTask', v)}
              min={1}
              max={9999}
              hideSpinners
              maxLength={4}
            />
            <NumberRow
              label="Max Total Size"
              description="Maximum total attachment size per task"
              value={Math.round(settings.tasks.attachmentMaxTotalSize / (1024 * 1024))}
              onChange={(v) => update('attachmentMaxTotalSize', v * 1024 * 1024)}
              min={1}
              max={9999}
              unit="MB"
              hideSpinners
              maxLength={4}
            />
          </>
        )}
        <ToggleRow
          label="Comments"
          description="Enable comments on tasks"
          checked={settings.tasks.enableComments}
          onCheckedChange={(v) => update('enableComments', v)}
        />
        <NumberRow
          label="Auto-save Delay"
          description="Delay before saving changes (ms)"
          value={settings.tasks.autoSaveDelayMs}
          onChange={(v) => update('autoSaveDelayMs', v)}
          min={200}
          max={5000}
          step={100}
          unit="ms"
          hideSpinners
          maxLength={4}
        />
        <SettingRow label="Default Priority" description="Default priority for new tasks">
          <Select
            value={settings.tasks.defaultPriority}
            onValueChange={(v) => update('defaultPriority', v)}
          >
            <SelectTrigger className="w-28 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
      </div>
    </div>
  );
}
