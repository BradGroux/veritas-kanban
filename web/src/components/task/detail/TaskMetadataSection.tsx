import { useState } from 'react';
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
import { useTaskTypes, getTypeIcon } from '@/hooks/useTaskTypes';
import { useProjects } from '@/hooks/useProjects';
import { useSprints } from '@/hooks/useSprints';
import { useConfig } from '@/hooks/useConfig';
import type { Task, TaskStatus, TaskPriority, AgentType } from '@veritas-kanban/shared';

interface TaskMetadataSectionProps {
  task: Task;
  onUpdate: <K extends keyof Task>(field: K, value: Task[K]) => void;
  readOnly?: boolean;
}

const statusLabels: Record<TaskStatus, string> = {
  todo: 'To Do',
  planning: 'Planning',
  'in-progress': 'In Progress',
  blocked: 'Blocked',
  done: 'Done',
};

const priorityLabels: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

export function TaskMetadataSection({
  task,
  onUpdate,
  readOnly = false,
}: TaskMetadataSectionProps) {
  const { data: taskTypes = [] } = useTaskTypes();
  const { data: projects = [] } = useProjects();
  const { data: sprints = [] } = useSprints();
  const { data: config } = useConfig();
  const enabledAgents = config?.agents.filter((a) => a.enabled) || [];
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');

  // Get current type info
  const currentType = taskTypes.find((t) => t.id === task.type);
  const typeLabel = currentType ? currentType.label : task.type;

  return (
    <div className="space-y-4">
      {/* Status, Type, Priority */}
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label className="text-muted-foreground">Status</Label>
          {readOnly ? (
            <div className="text-sm font-medium px-3 py-2 bg-muted/30 rounded-md">
              {statusLabels[task.status]}
            </div>
          ) : (
            <Select value={task.status} onValueChange={(v) => onUpdate('status', v as TaskStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(statusLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="space-y-2">
          <Label className="text-muted-foreground">Type</Label>
          {readOnly ? (
            <div className="text-sm font-medium px-3 py-2 bg-muted/30 rounded-md">{typeLabel}</div>
          ) : (
            <Select value={task.type} onValueChange={(v) => onUpdate('type', v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {taskTypes.map((type) => {
                  const IconComponent = getTypeIcon(type.icon);
                  return (
                    <SelectItem key={type.id} value={type.id}>
                      <div className="flex items-center gap-2">
                        {IconComponent && <IconComponent className="h-4 w-4" />}
                        {type.label}
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="space-y-2">
          <Label className="text-muted-foreground">Priority</Label>
          {readOnly ? (
            <div className="text-sm font-medium px-3 py-2 bg-muted/30 rounded-md capitalize">
              {task.priority}
            </div>
          ) : (
            <Select
              value={task.priority}
              onValueChange={(v) => onUpdate('priority', v as TaskPriority)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(priorityLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* Project */}
      <div className="space-y-2">
        <Label className="text-muted-foreground">Project</Label>
        {readOnly ? (
          <div className="text-sm font-medium px-3 py-2 bg-muted/30 rounded-md">
            {projects.find((p) => p.id === task.project)?.label || task.project || 'No project'}
          </div>
        ) : !showNewProject ? (
          <Select
            value={task.project || '__none__'}
            onValueChange={(value) => {
              if (value === '__new__') {
                setShowNewProject(true);
                setNewProjectName('');
              } else if (value === '__none__') {
                onUpdate('project', undefined);
              } else {
                onUpdate('project', value);
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
                  onUpdate('project', newProjectName.trim());
                  setShowNewProject(false);
                }
                if (e.key === 'Escape') {
                  setShowNewProject(false);
                  setNewProjectName('');
                }
              }}
            />
            <Button
              type="button"
              size="sm"
              onClick={() => {
                if (newProjectName.trim()) {
                  onUpdate('project', newProjectName.trim());
                  setShowNewProject(false);
                }
              }}
            >
              Add
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setShowNewProject(false);
                setNewProjectName('');
              }}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>

      {/* Sprint & Agent */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="text-muted-foreground">Sprint</Label>
          {readOnly ? (
            <div className="text-sm font-medium px-3 py-2 bg-muted/30 rounded-md">
              {sprints.find((s) => s.id === task.sprint)?.label || task.sprint || 'No sprint'}
            </div>
          ) : (
            <Select
              value={task.sprint || '__none__'}
              onValueChange={(value) =>
                onUpdate('sprint', value === '__none__' ? undefined : value)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="No sprint" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No Sprint</SelectItem>
                {sprints.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="space-y-2">
          <Label className="text-muted-foreground">Agent</Label>
          {readOnly ? (
            <div className="text-sm font-medium px-3 py-2 bg-muted/30 rounded-md">
              {task.agent === 'auto' || !task.agent
                ? 'Auto (routing)'
                : enabledAgents.find((a) => a.type === task.agent)?.name || task.agent}
            </div>
          ) : (
            <Select
              value={task.agent || 'auto'}
              onValueChange={(value) =>
                onUpdate('agent', value === 'auto' ? undefined : (value as AgentType))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (routing)</SelectItem>
                {enabledAgents.map((a) => (
                  <SelectItem key={a.type} value={a.type}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>
    </div>
  );
}
