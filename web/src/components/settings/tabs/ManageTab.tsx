import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useConfig } from '@/hooks/useConfig';
import {
  useTemplates,
  useCreateTemplate,
} from '@/hooks/useTemplates';
import { useTaskTypesManager, getTypeIcon, getAvailableIcons, AVAILABLE_COLORS } from '@/hooks/useTaskTypes';
import { useProjectsManager, AVAILABLE_PROJECT_COLORS } from '@/hooks/useProjects';
import { useSprintsManager } from '@/hooks/useSprints';
import { useToast } from '@/hooks/useToast';
import {
  Plus, Download, Upload, HelpCircle, Info,
} from 'lucide-react';
import type { TaskTypeConfig, SprintConfig, ProjectConfig } from '@veritas-kanban/shared';
import { exportAllTemplates, parseTemplateFile, checkDuplicateName } from '@/lib/template-io';
import { ManagedListManager } from '../ManagedListManager';
import { AddTemplateForm, TemplateItem } from './TemplateComponents';

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
          taskDefaults: template.taskDefaults as any,
          subtaskTemplates: template.subtaskTemplates as any,
          blueprint: template.blueprint as any,
        });
        imported++;
      }
      toast({
        title: 'Import complete',
        description: `${imported} template${imported === 1 ? '' : 's'} imported${skipped > 0 ? `, ${skipped} duplicate${skipped === 1 ? '' : 's'} skipped` : ''}.`,
      });
    } catch (err) {
      toast({
        title: 'Import failed',
        description: err instanceof Error ? err.message : 'Invalid file',
      });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-6">
      {/* Task Types */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Task Types</h3>
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
              <div className="flex gap-2 mt-2">
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground">Icon</Label>
                  <Select value={item.icon} onValueChange={(icon) => onChange({ icon })}>
                    <SelectTrigger className="h-8 mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {getAvailableIcons().map((iconName) => {
                        const IconComponent = getTypeIcon(iconName);
                        return (
                          <SelectItem key={iconName} value={iconName}>
                            <div className="flex items-center gap-2">
                              {IconComponent && <IconComponent className="h-4 w-4" />}
                              {iconName}
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground">Color</Label>
                  <Select value={item.color || 'border-l-gray-500'} onValueChange={(color) => onChange({ color })}>
                    <SelectTrigger className="h-8 mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {AVAILABLE_COLORS.map((color) => (
                        <SelectItem key={color.value} value={color.value}>
                          <div className="flex items-center gap-2">
                            <div className={`w-4 h-4 rounded border-l-4 ${color.value}`}></div>
                            {color.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            newItemDefaults={{ icon: 'Code', color: 'border-l-gray-500' }}
          />
        </div>
      </div>

      {/* Projects */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Projects</h3>
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
              <div className="flex gap-2 mt-2">
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground">Description</Label>
                  <Input
                    value={item.description || ''}
                    onChange={(e) => onChange({ description: e.target.value })}
                    placeholder="Optional description..."
                    className="h-8 mt-1"
                  />
                </div>
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground">Badge Color</Label>
                  <Select value={item.color || 'bg-muted'} onValueChange={(color) => onChange({ color })}>
                    <SelectTrigger className="h-8 mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {AVAILABLE_PROJECT_COLORS.map((color) => (
                        <SelectItem key={color.value} value={color.value}>
                          <div className="flex items-center gap-2">
                            <div className={`w-4 h-4 rounded ${color.value}`}></div>
                            {color.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            newItemDefaults={{ description: '', color: 'bg-blue-500/20' }}
          />
        </div>
      </div>

      {/* Sprints */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Sprints</h3>
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
              <div className="mt-2">
                <Label className="text-xs text-muted-foreground">Description</Label>
                <Input
                  value={item.description || ''}
                  onChange={(e) => onChange({ description: e.target.value })}
                  placeholder="Optional description..."
                  className="h-8 mt-1"
                />
              </div>
            )}
            newItemDefaults={{ description: '' }}
          />
        </div>
      </div>

      {/* Templates */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium">Task Templates</h3>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => setShowTemplateHelp(!showTemplateHelp)}
            >
              <HelpCircle className="h-4 w-4 text-muted-foreground" />
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleImportClick}>
              <Upload className="h-4 w-4 mr-1" /> Import
            </Button>
            {templates && templates.length > 0 && (
              <Button variant="outline" size="sm" onClick={handleExportTemplates}>
                <Download className="h-4 w-4 mr-1" /> Export
              </Button>
            )}
            {!showAddTemplateForm && (
              <Button variant="outline" size="sm" onClick={() => setShowAddTemplateForm(true)}>
                <Plus className="h-4 w-4 mr-1" /> Add
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
                  <div><strong className="text-foreground">Simple:</strong> Pre-fill fields + subtask lists</div>
                  <div><strong className="text-foreground">Categories:</strong> Bug 🐛, Feature ✨, Sprint 🔄</div>
                  <div><strong className="text-foreground">Variables:</strong> {'{{date}}'}, {'{{project}}'}, {'{{custom}}'}</div>
                  <div><strong className="text-foreground">Blueprints:</strong> Multi-task with dependencies</div>
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

        {showAddTemplateForm && (
          <AddTemplateForm onClose={() => setShowAddTemplateForm(false)} />
        )}

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
    </div>
  );
}
