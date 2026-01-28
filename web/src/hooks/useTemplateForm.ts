import { useState } from 'react';
import { useTemplates, type TaskTemplate } from './useTemplates';
import { useCreateTask } from './useTasks';
import {
  interpolateVariables,
  extractCustomVariables,
  type VariableContext,
} from '@/lib/template-variables';
import { nanoid } from 'nanoid';
import type { Subtask, TaskPriority } from '@veritas-kanban/shared';

export function useTemplateForm() {
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [customVars, setCustomVars] = useState<Record<string, string>>({});
  const [requiredCustomVars, setRequiredCustomVars] = useState<string[]>([]);

  const { data: templates } = useTemplates();
  const createTask = useCreateTask();

  const applyTemplate = (template: TaskTemplate) => {
    setSelectedTemplate(template.id);

    // If this is a blueprint template, extract variables from all blueprint tasks
    if (template.blueprint && template.blueprint.length > 0) {
      const allBlueprintText = template.blueprint
        .flatMap((bt) => [
          bt.title,
          bt.taskDefaults.descriptionTemplate || '',
          ...(bt.subtaskTemplates?.map((st) => st.title) || []),
        ])
        .join(' ');

      const customVarNames = extractCustomVariables(allBlueprintText);
      setRequiredCustomVars(customVarNames);

      const initialCustomVars: Record<string, string> = {};
      customVarNames.forEach((name) => {
        initialCustomVars[name] = '';
      });
      setCustomVars(initialCustomVars);

      return {
        type: template.taskDefaults.type,
        priority: template.taskDefaults.priority,
        project: template.taskDefaults.project,
        description: '',
      };
    }

    // Single-task template
    // Extract custom variables from description template and subtasks
    const allTemplateText = [
      template.taskDefaults.descriptionTemplate || '',
      ...(template.subtaskTemplates?.map((st) => st.title) || []),
    ].join(' ');

    const customVarNames = extractCustomVariables(allTemplateText);
    setRequiredCustomVars(customVarNames);

    // Initialize custom vars
    const initialCustomVars: Record<string, string> = {};
    customVarNames.forEach((name) => {
      initialCustomVars[name] = '';
    });
    setCustomVars(initialCustomVars);

    // Convert subtask templates to actual subtasks
    if (template.subtaskTemplates && template.subtaskTemplates.length > 0) {
      const now = new Date().toISOString();
      const templateSubtasks: Subtask[] = template.subtaskTemplates
        .sort((a, b) => a.order - b.order)
        .map((st) => ({
          id: nanoid(),
          title: st.title,
          completed: false,
          created: now,
        }));
      setSubtasks(templateSubtasks);
    } else {
      setSubtasks([]);
    }

    return {
      type: template.taskDefaults.type,
      priority: template.taskDefaults.priority,
      project: template.taskDefaults.project,
      description: template.taskDefaults.descriptionTemplate || '',
    };
  };

  const clearTemplate = () => {
    setSelectedTemplate(null);
    setSubtasks([]);
    setCustomVars({});
    setRequiredCustomVars([]);
  };

  const removeSubtask = (id: string) => {
    setSubtasks((prev) => prev.filter((st) => st.id !== id));
  };

  const createTasks = async (
    title: string,
    description: string,
    project: string,
    sprint: string,
    type: string,
    priority: string
  ) => {
    // Build variable context
    const context: VariableContext = {
      project: project.trim() || undefined,
      author: 'Brad', // TODO: Get from user config
      customVars,
    };

    // Check if this is a blueprint template
    const template = selectedTemplate ? templates?.find((t) => t.id === selectedTemplate) : null;

    if (template?.blueprint && template.blueprint.length > 0) {
      // Blueprint: create multiple tasks
      await handleBlueprintCreation(template, context, project);
    } else {
      // Single task creation
      // Interpolate variables in description
      const interpolatedDescription = interpolateVariables(description, context);

      // Interpolate variables in subtask titles
      const interpolatedSubtasks = subtasks.map((st) => ({
        ...st,
        title: interpolateVariables(st.title, context),
      }));

      await createTask.mutateAsync({
        title: title.trim(),
        description: interpolatedDescription.trim(),
        type,
        priority: priority as TaskPriority,
        project: project.trim() || undefined,
        sprint: sprint.trim() || undefined,
        subtasks: interpolatedSubtasks.length > 0 ? interpolatedSubtasks : undefined,
      });
    }
  };

  const handleBlueprintCreation = async (
    template: TaskTemplate,
    context: VariableContext,
    project: string
  ) => {
    if (!template.blueprint) return;

    // Map to store refId -> actual task ID
    const refIdToTaskId: Record<string, string> = {};

    // Create tasks in order, resolving dependencies
    for (const blueprintTask of template.blueprint) {
      // Interpolate title
      const taskTitle = interpolateVariables(blueprintTask.title, context);

      // Interpolate description
      const taskDescription = interpolateVariables(
        blueprintTask.taskDefaults.descriptionTemplate || '',
        context
      );

      // Create subtasks
      const taskSubtasks = blueprintTask.subtaskTemplates?.map((st) => {
        const now = new Date().toISOString();
        return {
          id: nanoid(),
          title: interpolateVariables(st.title, context),
          completed: false,
          created: now,
        };
      });

      // Resolve dependencies
      const blockedBy = blueprintTask.blockedByRefs
        ?.map((refId) => refIdToTaskId[refId])
        .filter(Boolean);

      // Create the task
      const createdTask = await createTask.mutateAsync({
        title: taskTitle,
        description: taskDescription,
        type: blueprintTask.taskDefaults.type,
        priority: blueprintTask.taskDefaults.priority,
        project: blueprintTask.taskDefaults.project || project.trim() || undefined,
        subtasks: taskSubtasks,
        blockedBy,
      });

      // Store the mapping
      refIdToTaskId[blueprintTask.refId] = createdTask.id;
    }
  };

  return {
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
    isCreating: createTask.isPending,
  };
}
