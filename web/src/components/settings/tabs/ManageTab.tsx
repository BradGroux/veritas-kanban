import { useRef, useState } from 'react';
import { ActionIcon, Button, Select, Text, TextInput } from '@mantine/core';
import { useConfig } from '@/hooks/useConfig';
import { useTemplates, useCreateTemplate } from '@/hooks/useTemplates';
import {
  AVAILABLE_COLORS,
  getAvailableIcons,
  getTypeIcon,
  normalizeTaskTypeColorToken,
  useTaskTypesManager,
} from '@/hooks/useTaskTypes';
import { AVAILABLE_PROJECT_COLORS, useProjectsManager } from '@/hooks/useProjects';
import { useSprintsManager } from '@/hooks/useSprints';
import { useToast } from '@/hooks/useToast';
import { Download, HelpCircle, Info, Plus, Upload } from 'lucide-react';
import type {
  CreateTemplateInput,
  ProjectConfig,
  SprintConfig,
  TaskTypeConfig,
} from '@veritas-kanban/shared';
import { checkDuplicateName, exportAllTemplates, parseTemplateFile } from '@/lib/template-io';
import { ManagedListManager } from '../ManagedListManager';
import { AddTemplateForm, TemplateItem } from './TemplateComponents';
import { SettingsPage, SettingsSection } from '../shared';

export function ManageTab() {
  const { data: _config } = useConfig();
  const { data: templates, isLoading: templatesLoading } = useTemplates();
  const taskTypesManager = useTaskTypesManager();
  const projectsManager = useProjectsManager();
  const sprintsManager = useSprintsManager();
  const { toast } = useToast();
  const [showAddTemplateForm, setShowAddTemplateForm] = useState(false);
  const [showTemplateHelp, setShowTemplateHelp] = useState(false);
  const createTemplate = useCreateTemplate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExportTemplates = () => {
    if (!templates || templates.length === 0) {
      toast({
        title: 'Export failed',
        description: 'No templates to export.',
      });
      return;
    }
    exportAllTemplates(templates);
    toast({
      title: 'Export complete',
      description: `${templates.length} template${templates.length === 1 ? '' : 's'} exported successfully.`,
    });
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = await parseTemplateFile(file);
      const templatesToImport = Array.isArray(parsed) ? parsed : [parsed];
      let imported = 0;
      let skipped = 0;
      for (const template of templatesToImport) {
        if (checkDuplicateName(template.name, templates || [])) {
          skipped++;
          continue;
        }
        await createTemplate.mutateAsync({
          name: template.name,
          description: template.description,
          category: template.category,
          taskDefaults: template.taskDefaults as CreateTemplateInput['taskDefaults'],
          subtaskTemplates: template.subtaskTemplates as CreateTemplateInput['subtaskTemplates'],
          blueprint: template.blueprint as CreateTemplateInput['blueprint'],
        });
        imported++;
      }
      toast({
        title: 'Import complete',
        description: `${imported} template${imported === 1 ? '' : 's'} imported${skipped > 0 ? `, ${skipped} duplicate${skipped === 1 ? '' : 's'} skipped` : ''}.`,
      });
    } catch (err) {
      console.error('[Templates] Import failed:', err);
      toast({
        title: 'Import failed',
        description: err instanceof Error ? err.message : 'Invalid file',
      });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const iconOptions = getAvailableIcons().map((iconName) => ({
    value: iconName,
    label: iconName,
  }));

  const taskTypeColorOptions = AVAILABLE_COLORS.map((color) => ({
    value: color.value,
    label: color.label,
  }));

  const projectColorOptions = AVAILABLE_PROJECT_COLORS.map((color) => ({
    value: color.value,
    label: color.label,
  }));

  return (
    <SettingsPage
      title="Manage"
      description="Maintain task types, projects, sprints, and reusable task templates."
    >
      <SettingsSection
        title="Task Types"
        description="Configure the labels, icons, colors, and ordering available to tasks."
      >
        <div className="border rounded-md p-3">
          <ManagedListManager<TaskTypeConfig>
            title=""
            items={taskTypesManager.items}
            isLoading={taskTypesManager.isLoading}
            onCreate={taskTypesManager.create}
            onUpdate={taskTypesManager.update}
            onDelete={taskTypesManager.remove}
            onReorder={taskTypesManager.reorder}
            canDeleteCheck={taskTypesManager.canDelete}
            renderExtraFields={(item, onChange) => (
              <div className="grid gap-3 mt-2 sm:grid-cols-2">
                <div className="flex items-center gap-2">
                  <Text size="xs" c="dimmed" className="whitespace-nowrap">
                    Icon
                  </Text>
                  <Select
                    value={item.icon}
                    onChange={(icon) => {
                      if (icon) onChange({ icon });
                    }}
                    data={iconOptions}
                    size="xs"
                    radius="md"
                    w={120}
                    aria-label={`${item.label} icon`}
                    renderOption={({ option }) => {
                      const IconComponent = getTypeIcon(option.value);
                      return (
                        <div className="flex items-center gap-2">
                          {IconComponent && <IconComponent className="h-4 w-4" />}
                          {option.label}
                        </div>
                      );
                    }}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Text size="xs" c="dimmed" className="whitespace-nowrap">
                    Color
                  </Text>
                  <Select
                    value={normalizeTaskTypeColorToken(item.colorToken ?? item.color)}
                    onChange={(colorToken) => {
                      if (colorToken) onChange({ colorToken });
                    }}
                    data={taskTypeColorOptions}
                    size="xs"
                    radius="md"
                    w={120}
                    aria-label={`${item.label} color`}
                    renderOption={({ option }) => (
                      <div className="flex items-center gap-2">
                        <div
                          className="vk-task-type-swatch"
                          data-color-token={option.value}
                          aria-hidden="true"
                        />
                        {option.label}
                      </div>
                    )}
                  />
                </div>
              </div>
            )}
            newItemDefaults={{ icon: 'Code', colorToken: 'neutral' }}
          />
        </div>
      </SettingsSection>

      <SettingsSection
        title="Projects"
        description="Configure project metadata, colors, and ordering."
      >
        <div className="border rounded-md p-3">
          <ManagedListManager<ProjectConfig>
            title=""
            items={projectsManager.items}
            isLoading={projectsManager.isLoading}
            onCreate={projectsManager.create}
            onUpdate={projectsManager.update}
            onDelete={projectsManager.remove}
            onReorder={projectsManager.reorder}
            canDeleteCheck={projectsManager.canDelete}
            renderExtraFields={(item, onChange) => (
              <div className="grid gap-3 mt-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="flex items-center gap-2 flex-1">
                  <Text size="xs" c="dimmed" className="whitespace-nowrap">
                    Desc
                  </Text>
                  <TextInput
                    value={item.description || ''}
                    onChange={(e) => onChange({ description: e.target.value })}
                    placeholder="Optional..."
                    size="xs"
                    radius="md"
                    className="flex-1"
                    aria-label={`${item.label} description`}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Text size="xs" c="dimmed" className="whitespace-nowrap">
                    Color
                  </Text>
                  <Select
                    value={item.color || 'bg-muted'}
                    onChange={(color) => {
                      if (color) onChange({ color });
                    }}
                    data={projectColorOptions}
                    size="xs"
                    radius="md"
                    w={120}
                    aria-label={`${item.label} color`}
                    renderOption={({ option }) => (
                      <div className="flex items-center gap-2">
                        <div className={`w-4 h-4 rounded ${option.value}`} />
                        {option.label}
                      </div>
                    )}
                  />
                </div>
              </div>
            )}
            newItemDefaults={{ description: '', color: 'bg-blue-500/20' }}
          />
        </div>
      </SettingsSection>

      <SettingsSection
        title="Sprints"
        description="Configure sprint labels, descriptions, and ordering."
      >
        <div className="border rounded-md p-3">
          <ManagedListManager<SprintConfig>
            title=""
            items={sprintsManager.items}
            isLoading={sprintsManager.isLoading}
            onCreate={sprintsManager.create}
            onUpdate={sprintsManager.update}
            onDelete={sprintsManager.remove}
            onReorder={sprintsManager.reorder}
            canDeleteCheck={sprintsManager.canDelete}
            renderExtraFields={(item, onChange) => (
              <div className="flex items-center gap-2 mt-2">
                <Text size="xs" c="dimmed" className="whitespace-nowrap">
                  Desc
                </Text>
                <TextInput
                  value={item.description || ''}
                  onChange={(e) => onChange({ description: e.target.value })}
                  placeholder="Optional..."
                  size="xs"
                  radius="md"
                  className="flex-1"
                  aria-label={`${item.label} description`}
                />
              </div>
            )}
            newItemDefaults={{ description: '' }}
          />
        </div>
      </SettingsSection>

      <SettingsSection
        title="Task Templates"
        description="Create, import, and export reusable task and blueprint definitions."
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <ActionIcon
                type="button"
                variant="subtle"
                color="gray"
                size="sm"
                radius="md"
                aria-label="Toggle template guide"
                onClick={() => setShowTemplateHelp(!showTemplateHelp)}
              >
                <HelpCircle className="h-4 w-4" />
              </ActionIcon>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="xs"
                radius="md"
                leftSection={<Upload className="h-4 w-4" />}
                onClick={handleImportClick}
              >
                Import
              </Button>
              {templates && templates.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  radius="md"
                  leftSection={<Download className="h-4 w-4" />}
                  onClick={handleExportTemplates}
                >
                  Export
                </Button>
              )}
              {!showAddTemplateForm && (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  radius="md"
                  leftSection={<Plus className="h-4 w-4" />}
                  aria-label="Add template"
                  onClick={() => setShowAddTemplateForm(true)}
                >
                  Add
                </Button>
              )}
            </div>
          </div>

          {showTemplateHelp && (
            <div className="p-3 rounded-md bg-muted/50 border border-muted-foreground/20 text-sm space-y-3">
              <div className="flex items-start gap-2">
                <Info className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                <div className="space-y-2">
                  <p className="font-medium text-sm">Template Guide</p>
                  <div className="text-xs text-muted-foreground space-y-1.5">
                    <div>
                      <strong className="text-foreground">Simple:</strong> Pre-fill fields + subtask
                      lists
                    </div>
                    <div>
                      <strong className="text-foreground">Categories:</strong> Bug, Feature, Sprint
                    </div>
                    <div>
                      <strong className="text-foreground">Variables:</strong> {'{{date}}'},{' '}
                      {'{{project}}'}, {'{{custom}}'}
                    </div>
                    <div>
                      <strong className="text-foreground">Blueprints:</strong> Multi-task with
                      dependencies
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleFileSelect}
            className="hidden"
          />

          {showAddTemplateForm && <AddTemplateForm onClose={() => setShowAddTemplateForm(false)} />}

          {templatesLoading ? (
            <div className="text-sm text-muted-foreground">Loading...</div>
          ) : !templates || templates.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center border rounded-md border-dashed">
              No templates created.
            </div>
          ) : (
            <div className="space-y-2">
              {templates.map((template) => (
                <TemplateItem key={template.id} template={template} />
              ))}
            </div>
          )}
        </div>
      </SettingsSection>
    </SettingsPage>
  );
}
