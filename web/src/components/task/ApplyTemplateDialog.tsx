import { useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { useTemplates } from '@/hooks/useTemplates';
import { useUpdateTask } from '@/hooks/useTasks';
import type { Task, Subtask } from '@veritas-kanban/shared';
import {
  FileCode,
  AlertCircle,
  Plus,
  Minus,
  HelpCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { nanoid } from 'nanoid';
import { api } from '@/lib/api';
import {
  interpolateVariables,
  extractCustomVariables,
  type VariableContext,
} from '@/lib/template-variables';
import { getCategoryIcon } from '@/lib/template-categories';

interface ApplyTemplateDialogProps {
  task: Task;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplied?: () => void;
}

interface MergedField {
  field: string;
  label: string;
  before: string | undefined;
  after: string;
  willChange: boolean;
}

interface MergePreview {
  fields: MergedField[];
  subtasksAdded: number;
  existingSubtasks: number;
}

export function ApplyTemplateDialog({
  task,
  open,
  onOpenChange,
  onApplied,
}: ApplyTemplateDialogProps) {
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [customVars, setCustomVars] = useState<Record<string, string>>({});
  const [requiredCustomVars, setRequiredCustomVars] = useState<string[]>([]);
  const [forceOverwrite, setForceOverwrite] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const { data: templates } = useTemplates();
  const updateTask = useUpdateTask();

  // Filter templates by selected category
  const filteredTemplates = useMemo(() => {
    if (!templates) return [];
    if (categoryFilter === 'all') return templates;
    return templates.filter((t) => (t.category || 'custom') === categoryFilter);
  }, [templates, categoryFilter]);

  // Get the selected template
  const template = useMemo(() => {
    if (!selectedTemplate || !templates) return null;
    return templates.find((t) => t.id === selectedTemplate) || null;
  }, [selectedTemplate, templates]);

  // Calculate merge preview
  const mergePreview = useMemo((): MergePreview | null => {
    if (!template) return null;

    // Build variable context
    const context: VariableContext = {
      project: task.project,
      author: 'Brad', // TODO: Get from user config
      customVars,
    };

    const fields: MergedField[] = [];

    // Title
    if (template.taskDefaults.descriptionTemplate) {
      const interpolatedTitle = task.title;
      const willChange = forceOverwrite || !task.title;
      fields.push({
        field: 'title',
        label: 'Title',
        before: task.title,
        after: interpolatedTitle,
        willChange,
      });
    }

    // Description
    if (template.taskDefaults.descriptionTemplate) {
      const interpolatedDescription = interpolateVariables(
        template.taskDefaults.descriptionTemplate,
        context
      );
      const willChange = forceOverwrite || !task.description;
      fields.push({
        field: 'description',
        label: 'Description',
        before: task.description,
        after: interpolatedDescription,
        willChange,
      });
    }

    // Type
    if (template.taskDefaults.type) {
      const willChange = forceOverwrite || !task.type;
      fields.push({
        field: 'type',
        label: 'Type',
        before: task.type,
        after: template.taskDefaults.type,
        willChange,
      });
    }

    // Priority
    if (template.taskDefaults.priority) {
      const willChange = forceOverwrite || !task.priority;
      fields.push({
        field: 'priority',
        label: 'Priority',
        before: task.priority,
        after: template.taskDefaults.priority,
        willChange,
      });
    }

    // Project
    if (template.taskDefaults.project) {
      const willChange = forceOverwrite || !task.project;
      fields.push({
        field: 'project',
        label: 'Project',
        before: task.project,
        after: template.taskDefaults.project,
        willChange,
      });
    }

    // Subtasks
    const subtasksAdded = template.subtaskTemplates?.length || 0;
    const existingSubtasks = task.subtasks?.length || 0;

    return {
      fields: fields.filter((f) => f.willChange),
      subtasksAdded,
      existingSubtasks,
    };
  }, [template, task, customVars, forceOverwrite]);

  // Handle template selection
  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplate(templateId);

    const selected = templates?.find((t) => t.id === templateId);
    if (!selected) return;

    // Extract custom variables from description template and subtasks
    const allTemplateText = [
      selected.taskDefaults.descriptionTemplate || '',
      ...(selected.subtaskTemplates?.map((st) => st.title) || []),
    ].join(' ');

    const customVarNames = extractCustomVariables(allTemplateText);
    setRequiredCustomVars(customVarNames);

    // Initialize custom vars
    const initialCustomVars: Record<string, string> = {};
    customVarNames.forEach((name) => {
      initialCustomVars[name] = '';
    });
    setCustomVars(initialCustomVars);
  };

  // Apply the template
  const handleApply = async () => {
    if (!template) return;

    // Build variable context
    const context: VariableContext = {
      project: task.project,
      author: 'Brad', // TODO: Get from user config
      customVars,
    };

    // Build update input based on merge strategy
    const updates: Record<string, unknown> = {};

    // Description
    if (template.taskDefaults.descriptionTemplate) {
      const interpolated = interpolateVariables(template.taskDefaults.descriptionTemplate, context);
      if (forceOverwrite || !task.description) {
        updates.description = interpolated;
      }
    }

    // Type
    if (template.taskDefaults.type && (forceOverwrite || !task.type)) {
      updates.type = template.taskDefaults.type;
    }

    // Priority
    if (template.taskDefaults.priority && (forceOverwrite || !task.priority)) {
      updates.priority = template.taskDefaults.priority;
    }

    // Project
    if (template.taskDefaults.project && (forceOverwrite || !task.project)) {
      updates.project = template.taskDefaults.project;
    }

    // Subtasks - APPEND to existing
    if (template.subtaskTemplates && template.subtaskTemplates.length > 0) {
      const now = new Date().toISOString();
      const newSubtasks: Subtask[] = template.subtaskTemplates
        .sort((a, b) => a.order - b.order)
        .map((st) => ({
          id: nanoid(),
          title: interpolateVariables(st.title, context),
          completed: false,
          created: now,
        }));

      // Append to existing subtasks
      const existingSubtasks = task.subtasks || [];
      updates.subtasks = [...existingSubtasks, ...newSubtasks];
    }

    // Apply the updates
    await updateTask.mutateAsync({
      id: task.id,
      input: updates,
    });

    // Track which fields were changed for activity logging
    const changedFields = Object.keys(updates);

    // Log activity
    try {
      await api.tasks.applyTemplate(task.id, template.id, template.name, changedFields);
    } catch (error) {
      // Intentionally non-fatal: don't fail the whole operation if activity logging fails
      console.error('Failed to log template application:', error);
    }

    // Close dialog and notify parent
    onOpenChange(false);
    onApplied?.();

    // Reset state
    setSelectedTemplate(null);
    setCustomVars({});
    setRequiredCustomVars([]);
    setForceOverwrite(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <FileCode className="h-5 w-5" />
              Apply Template to Task
            </DialogTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowHelp(!showHelp)}
              className="h-8 gap-1 text-muted-foreground"
            >
              <HelpCircle className="h-4 w-4" />
              {showHelp ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </Button>
          </div>
          {showHelp && (
            <div className="mt-2 p-3 rounded-md bg-muted/50 border border-muted-foreground/20 text-sm space-y-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                <div className="space-y-2">
                  <p className="font-medium text-sm">Apply Template Guide</p>

                  <div className="text-xs text-muted-foreground space-y-1.5">
                    <div>
                      <strong className="text-foreground">Safe by Default:</strong>
                      <p className="mt-0.5">
                        Templates only fill in empty fields — your existing task data is never
                        overwritten unless you choose to.
                      </p>
                    </div>

                    <div>
                      <strong className="text-foreground">Force Overwrite:</strong>
                      <p className="mt-0.5">
                        Toggle this on to replace existing values with template values. The changes
                        preview shows exactly what will be modified before you apply.
                      </p>
                    </div>

                    <div>
                      <strong className="text-foreground">Subtasks:</strong>
                      <p className="mt-0.5">
                        Template subtasks are <em>added</em> to your existing subtasks, never
                        replaced. You'll see a count of how many will be appended.
                      </p>
                    </div>

                    <div>
                      <strong className="text-foreground">Variables:</strong>
                      <p className="mt-0.5">
                        Templates with{' '}
                        <code className="px-1 py-0.5 rounded bg-muted">{'{{date}}'}</code> or{' '}
                        <code className="px-1 py-0.5 rounded bg-muted">{'{{custom:name}}'}</code>{' '}
                        will prompt you for values before applying.
                      </p>
                    </div>

                    <div>
                      <strong className="text-foreground">Changes Preview:</strong>
                      <p className="mt-0.5">
                        A before/after diff appears below showing exactly what will change. Green
                        lines are additions, red lines are removals.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Template selector */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Label className="text-sm">Select Template</Label>
            </div>
            <Tabs value={categoryFilter} onValueChange={setCategoryFilter}>
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="all" className="text-xs">
                  All
                </TabsTrigger>
                <TabsTrigger value="bug" className="text-xs">
                  🐛
                </TabsTrigger>
                <TabsTrigger value="feature" className="text-xs">
                  ✨
                </TabsTrigger>
                <TabsTrigger value="sprint" className="text-xs">
                  🔄
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <Select
              value={selectedTemplate || 'none'}
              onValueChange={(value) => {
                if (value === 'none') {
                  setSelectedTemplate(null);
                } else {
                  handleTemplateSelect(value);
                }
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a template..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No template selected</SelectItem>
                {filteredTemplates
                  .filter((t) => !t.blueprint) // Exclude blueprint templates
                  .map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.category && `${getCategoryIcon(template.category)} `}
                      {template.name}
                      {template.description && (
                        <span className="text-muted-foreground ml-2">— {template.description}</span>
                      )}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          {/* Custom variable inputs */}
          {requiredCustomVars.length > 0 && (
            <div className="grid gap-3 border rounded-md p-3 bg-muted/30">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-blue-500" />
                <Label className="text-sm font-medium">Template Variables</Label>
              </div>
              {requiredCustomVars.map((varName) => (
                <div key={varName} className="grid gap-1.5">
                  <Label htmlFor={`var-${varName}`} className="text-xs">
                    {varName}
                  </Label>
                  <Input
                    id={`var-${varName}`}
                    value={customVars[varName] || ''}
                    onChange={(e) =>
                      setCustomVars((prev) => ({ ...prev, [varName]: e.target.value }))
                    }
                    placeholder={`Enter ${varName}...`}
                    className="h-8"
                  />
                </div>
              ))}
            </div>
          )}

          {/* Force overwrite toggle */}
          {template && (
            <div className="flex items-center justify-between border rounded-md p-3 bg-muted/30">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">Force Overwrite</Label>
                <p className="text-xs text-muted-foreground">
                  Replace existing values with template values
                </p>
              </div>
              <Switch checked={forceOverwrite} onCheckedChange={setForceOverwrite} />
            </div>
          )}

          {/* Merge preview */}
          {mergePreview && mergePreview.fields.length > 0 && (
            <div className="border rounded-md p-3 bg-muted/30 space-y-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-blue-500" />
                <Label className="text-sm font-medium">Changes Preview</Label>
              </div>

              {mergePreview.fields.map((field) => (
                <div key={field.field} className="text-sm border-l-2 border-primary/50 pl-3 py-1">
                  <div className="font-medium text-xs text-muted-foreground uppercase">
                    {field.label}
                  </div>
                  <div className="flex items-start gap-2 mt-1">
                    <Minus className="h-3 w-3 text-red-500 mt-0.5 flex-shrink-0" />
                    <span className="text-red-500/80 line-through flex-1">
                      {field.before || '(empty)'}
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Plus className="h-3 w-3 text-green-500 mt-0.5 flex-shrink-0" />
                    <span className="text-green-500/80 flex-1">{field.after}</span>
                  </div>
                </div>
              ))}

              {mergePreview.subtasksAdded > 0 && (
                <div className="text-sm border-l-2 border-primary/50 pl-3 py-1">
                  <div className="font-medium text-xs text-muted-foreground uppercase">
                    Subtasks
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <Plus className="h-3 w-3 text-blue-500" />
                    <span className="text-sm">
                      Will add {mergePreview.subtasksAdded} subtasks to existing{' '}
                      {mergePreview.existingSubtasks}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {!template && (
            <div className="text-center text-sm text-muted-foreground py-8">
              Select a template to see what will change
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleApply} disabled={!template || updateTask.isPending}>
            {updateTask.isPending ? 'Applying...' : 'Apply Template'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
