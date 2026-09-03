import { Select } from '@mantine/core';
import { useFeatureSettings, useDebouncedFeatureUpdate } from '@/hooks/useFeatureSettings';
import {
  DEFAULT_FEATURE_SETTINGS,
  type MarkdownSettings,
  type TaskBehaviorSettings,
} from '@veritas-kanban/shared';
import {
  SettingRow,
  ToggleRow,
  NumberRow,
  SaveIndicator,
  SettingsPage,
  SettingsSection,
} from '../shared';

export function TasksTab() {
  const { settings } = useFeatureSettings();
  const { debouncedUpdate, isPending } = useDebouncedFeatureUpdate();

  const update = <K extends keyof TaskBehaviorSettings>(key: K, value: TaskBehaviorSettings[K]) => {
    debouncedUpdate({ tasks: { [key]: value } });
  };

  const updateMarkdown = <K extends keyof MarkdownSettings>(key: K, value: MarkdownSettings[K]) => {
    debouncedUpdate({ markdown: { [key]: value } });
  };

  const resetTasks = () => {
    debouncedUpdate({ tasks: DEFAULT_FEATURE_SETTINGS.tasks });
  };

  const resetMarkdown = () => {
    debouncedUpdate({ markdown: DEFAULT_FEATURE_SETTINGS.markdown });
  };

  return (
    <SettingsPage
      title="Tasks"
      description="Set defaults and optional capabilities for task authoring and completion."
      actions={<SaveIndicator isPending={isPending} />}
    >
      <SettingsSection
        id="task-behavior"
        title="Task behavior"
        description="Common task defaults and dependent attachment controls."
        onReset={resetTasks}
        divided
      >
        <ToggleRow
          label="Time Tracking"
          description="Enable time tracking on tasks"
          checked={
            settings.tasks?.enableTimeTracking ?? DEFAULT_FEATURE_SETTINGS.tasks.enableTimeTracking
          }
          onCheckedChange={(v) => update('enableTimeTracking', v)}
        />
        <ToggleRow
          label="Auto-Complete on Subtasks"
          description="Automatically complete parent when all subtasks are done"
          checked={
            settings.tasks?.enableSubtaskAutoComplete ??
            DEFAULT_FEATURE_SETTINGS.tasks.enableSubtaskAutoComplete
          }
          onCheckedChange={(v) => update('enableSubtaskAutoComplete', v)}
        />
        <ToggleRow
          label="Dependencies"
          description="Enable task dependency tracking"
          checked={
            settings.tasks?.enableDependencies ?? DEFAULT_FEATURE_SETTINGS.tasks.enableDependencies
          }
          onCheckedChange={(v) => update('enableDependencies', v)}
        />
        <ToggleRow
          label="Attachments"
          description="Allow file attachments on tasks"
          checked={
            settings.tasks?.enableAttachments ?? DEFAULT_FEATURE_SETTINGS.tasks.enableAttachments
          }
          onCheckedChange={(v) => update('enableAttachments', v)}
        />
        {(settings.tasks?.enableAttachments ??
          DEFAULT_FEATURE_SETTINGS.tasks.enableAttachments) && (
          <>
            <NumberRow
              label="Max File Size"
              description="Maximum size per attachment"
              value={Math.round(
                (settings.tasks?.attachmentMaxFileSize ??
                  DEFAULT_FEATURE_SETTINGS.tasks.attachmentMaxFileSize) /
                  (1024 * 1024)
              )}
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
              value={
                settings.tasks?.attachmentMaxPerTask ??
                DEFAULT_FEATURE_SETTINGS.tasks.attachmentMaxPerTask
              }
              onChange={(v) => update('attachmentMaxPerTask', v)}
              min={1}
              max={9999}
              hideSpinners
              maxLength={4}
            />
            <NumberRow
              label="Max Total Size"
              description="Maximum total attachment size per task"
              value={Math.round(
                (settings.tasks?.attachmentMaxTotalSize ??
                  DEFAULT_FEATURE_SETTINGS.tasks.attachmentMaxTotalSize) /
                  (1024 * 1024)
              )}
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
          checked={settings.tasks?.enableComments ?? DEFAULT_FEATURE_SETTINGS.tasks.enableComments}
          onCheckedChange={(v) => update('enableComments', v)}
        />
        <ToggleRow
          label="Require Deliverable for Done"
          description="Prevent tasks from being marked done without at least one deliverable"
          checked={
            settings.tasks?.requireDeliverableForDone ??
            DEFAULT_FEATURE_SETTINGS.tasks.requireDeliverableForDone
          }
          onCheckedChange={(v) => update('requireDeliverableForDone', v)}
        />
        <NumberRow
          label="Auto-save Delay"
          description="Delay before saving changes (ms)"
          value={settings.tasks?.autoSaveDelayMs ?? DEFAULT_FEATURE_SETTINGS.tasks.autoSaveDelayMs}
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
            value={
              settings.tasks?.defaultPriority ?? DEFAULT_FEATURE_SETTINGS.tasks.defaultPriority
            }
            onChange={(value) =>
              value && update('defaultPriority', value as TaskBehaviorSettings['defaultPriority'])
            }
            data={[
              { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' },
              { value: 'critical', label: 'Critical' },
            ]}
            aria-label="Default Priority"
            allowDeselect={false}
            size="xs"
            w={128}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        id="task-markdown"
        title="Markdown"
        description="Formatting behavior for task descriptions and comments."
        onReset={resetMarkdown}
        divided
      >
        <ToggleRow
          label="Enable Markdown"
          description="Use Markdown formatting in task descriptions and comments"
          checked={
            settings.markdown?.enableMarkdown ?? DEFAULT_FEATURE_SETTINGS.markdown.enableMarkdown
          }
          onCheckedChange={(v) => updateMarkdown('enableMarkdown', v)}
        />
        <ToggleRow
          label="Code Highlighting"
          description="Highlight fenced code blocks in Markdown previews"
          checked={
            settings.markdown?.enableCodeHighlighting ??
            DEFAULT_FEATURE_SETTINGS.markdown.enableCodeHighlighting
          }
          onCheckedChange={(v) => updateMarkdown('enableCodeHighlighting', v)}
        />
      </SettingsSection>
    </SettingsPage>
  );
}
