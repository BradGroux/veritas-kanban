import { useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTaskTypes, getTypeIcon } from '@/hooks/useTaskTypes';
import { useProjects } from '@/hooks/useProjects';
import { useSprints } from '@/hooks/useSprints';
import { useTemplateForm } from '@/hooks/useTemplateForm';
import { useCreateTaskForm } from '@/hooks/useCreateTaskForm';
import { BlueprintPreview } from './create/BlueprintPreview';
import { TemplateVariableInputs } from './create/TemplateVariableInputs';
import type { TaskPriority } from '@veritas-kanban/shared';
import { FileText, X, Check, HelpCircle, Info } from 'lucide-react';
import { getCategoryIcon } from '@/lib/template-categories';

interface CreateTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateTaskDialog({ open, onOpenChange }: CreateTaskDialogProps) {
  // Consolidated form state via useReducer
  const {
    state: formState,
    setTitle,
    setDescription,
    setType,
    setPriority,
    setProject,
    setSprint,
    setCategoryFilter,
    setNewProjectName,
    toggleHelp,
    showNewProject: onShowNewProject,
    hideNewProject,
    applyTemplate: applyFormDefaults,
    reset: resetForm,
    canSubmit,
  } = useCreateTaskForm();

  const {
    title,
    description,
    type,
    priority,
    project,
    sprint,
    categoryFilter,
    showHelp,
    showNewProject,
    newProjectName,
  } = formState;

  const { data: taskTypes = [] } = useTaskTypes();
  const { data: projects = [] } = useProjects();
  const { data: sprints = [] } = useSprints();
  
  const {
    selectedTemplate,
    templates,
    subtasks,
    customVars,
    requiredCustomVars,
    applyTemplate,
    clearTemplate,
    removeSubtask,
    setCustomVars,
    createTasks,
    isCreating,
  } = useTemplateForm();

  // Filter templates by selected category
  const filteredTemplates = useMemo(() => {
    if (!templates) return [];
    if (categoryFilter === 'all') return templates;
    return templates.filter(t => (t.category || 'custom') === categoryFilter);
  }, [templates, categoryFilter]);

  const handleTemplateSelect = (templateId: string) => {
    if (templateId === 'none') {
      clearTemplate();
      return;
    }
    
    const template = templates?.find(t => t.id === templateId);
    if (!template) return;
    
    const defaults = applyTemplate(template);
    // Apply template defaults to form state atomically
    applyFormDefaults({
      type: defaults.type || type,
      priority: defaults.priority || priority,
      project: defaults.project || project,
      description: defaults.description || description,
    });
  };

  const currentTemplate = selectedTemplate ? templates?.find(t => t.id === selectedTemplate) : null;
  const isBlueprint = Boolean(currentTemplate?.blueprint && currentTemplate.blueprint.length > 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Use computed canSubmit instead of inline check
    if (!canSubmit(isBlueprint)) {
      return;
    }
    
    await createTasks(title, description, project, sprint, type, priority);

    // Reset form state atomically
    resetForm();
    clearTemplate();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create New Task</DialogTitle>
          </DialogHeader>
          
          {/* Template selector */}
          {templates && templates.length > 0 && (
            <div className="border-b pb-2">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <Label className="text-sm">Template</Label>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={toggleHelp}
                  aria-label={showHelp ? 'Hide template help' : 'Show template help'}
                >
                  <HelpCircle className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
              
              {/* Help Section */}
              {showHelp && (
                <div className="mb-3 p-3 rounded-md bg-muted/50 border border-muted-foreground/20 text-sm space-y-2">
                  <div className="flex items-start gap-2">
                    <Info className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                    <div className="space-y-1.5">
                      <p className="font-medium text-sm">Using Templates</p>
                      <ul className="space-y-1 text-xs text-muted-foreground">
                        <li>• <strong>Simple templates</strong> pre-fill task fields and can include subtasks</li>
                        <li>• <strong>Variables</strong> like <code className="px-1 py-0.5 rounded bg-muted">{'{{date}}'}</code> or <code className="px-1 py-0.5 rounded bg-muted">{'{{author}}'}</code> are replaced when creating the task</li>
                        <li>• <strong>Custom variables</strong> (e.g., <code className="px-1 py-0.5 rounded bg-muted">{'{{bugId}}'}</code>) prompt you for values</li>
                        <li>• <strong>Blueprint templates</strong> create multiple linked tasks with dependencies</li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}
              
              <Tabs value={categoryFilter} onValueChange={setCategoryFilter}>
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="all" className="text-xs">All</TabsTrigger>
                  <TabsTrigger value="bug" className="text-xs">🐛</TabsTrigger>
                  <TabsTrigger value="feature" className="text-xs">✨</TabsTrigger>
                  <TabsTrigger value="sprint" className="text-xs">🔄</TabsTrigger>
                </TabsList>
              </Tabs>
              
              <Select
                value={selectedTemplate || 'none'}
                onValueChange={handleTemplateSelect}
              >
                <SelectTrigger className="mt-2">
                  <SelectValue placeholder="Select template..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No template</SelectItem>
                  {filteredTemplates.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.category && `${getCategoryIcon(template.category)} `}
                      {template.name}
                      {template.description && (
                        <span className="text-muted-foreground ml-2">
                          — {template.description}
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          
          {/* Blueprint preview or regular form */}
          <div className="grid gap-4 py-4">
            {isBlueprint ? (
              <>
                <BlueprintPreview template={currentTemplate!} />
                <TemplateVariableInputs
                  variables={requiredCustomVars}
                  values={customVars}
                  onChange={(name, value) => setCustomVars(prev => ({ ...prev, [name]: value }))}
                />
              </>
            ) : (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="title">Title</Label>
                  <Input
                    id="title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Enter task title..."
                    autoFocus
                  />
                </div>
              
                <div className="grid gap-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe the task..."
                    rows={3}
                  />
                </div>
              
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="type">Type</Label>
                    <Select value={type} onValueChange={setType}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {taskTypes.map((taskType) => {
                          const IconComponent = getTypeIcon(taskType.icon);
                          return (
                            <SelectItem key={taskType.id} value={taskType.id}>
                              <div className="flex items-center gap-2">
                                {IconComponent && <IconComponent className="h-4 w-4" />}
                                {taskType.label}
                              </div>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="grid gap-2">
                    <Label htmlFor="priority">Priority</Label>
                    <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              
                <div className="grid gap-2">
                  <Label htmlFor="project">Project (optional)</Label>
                  {!showNewProject ? (
                    <Select 
                      value={project} 
                      onValueChange={(value) => {
                        if (value === '__new__') {
                          onShowNewProject();
                        } else {
                          setProject(value);
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select project..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">No project</SelectItem>
                        {projects.map((proj) => (
                          <SelectItem key={proj.id} value={proj.id}>
                            {proj.label}
                          </SelectItem>
                        ))}
                        <SelectItem value="__new__" className="text-primary">
                          + New Project
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="flex gap-2">
                      <Input
                        value={newProjectName}
                        onChange={(e) => setNewProjectName(e.target.value)}
                        placeholder="Enter project name..."
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && newProjectName.trim()) {
                            e.preventDefault();
                            setProject(newProjectName.trim());
                          }
                          if (e.key === 'Escape') {
                            hideNewProject();
                          }
                        }}
                      />
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          if (newProjectName.trim()) {
                            setProject(newProjectName.trim());
                          }
                        }}
                      >
                        Add
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={hideNewProject}
                      >
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>

                <div className="grid gap-2">
                  <Label>Sprint (optional)</Label>
                  <Select value={sprint || '__none__'} onValueChange={(v) => setSprint(v === '__none__' ? '' : v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="No sprint" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No Sprint</SelectItem>
                      {sprints.map(s => (
                        <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <TemplateVariableInputs
                  variables={requiredCustomVars}
                  values={customVars}
                  onChange={(name, value) => setCustomVars(prev => ({ ...prev, [name]: value }))}
                />

                {subtasks.length > 0 && (
                  <div className="grid gap-2">
                    <Label>Subtasks ({subtasks.length})</Label>
                    <div className="space-y-1 max-h-40 overflow-y-auto border rounded-md p-2">
                      {subtasks.map((subtask) => (
                        <div
                          key={subtask.id}
                          className="flex items-center justify-between py-1 px-2 rounded hover:bg-muted/50"
                        >
                          <div className="flex items-center gap-2 flex-1">
                            <Check className="h-3 w-3 text-muted-foreground" />
                            <span className="text-sm">{subtask.title}</span>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={() => removeSubtask(subtask.id)}
                            aria-label={`Remove subtask: ${subtask.title}`}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
          
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={!canSubmit(isBlueprint) || isCreating}
            >
              {isCreating ? 'Creating...' : isBlueprint ? 'Create Tasks' : 'Create Task'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
