import type { TaskTemplate, UpdateTemplateInput } from '@veritas-kanban/shared';

function optionalField<T>(existing: T | undefined, patch: T | null | undefined): T | undefined {
  return patch === null ? undefined : patch === undefined ? existing : patch;
}

/** Shared patch semantics for file and SQLite persistence. Null is never stored. */
export function applyTemplateUpdate(
  existing: TaskTemplate,
  input: UpdateTemplateInput
): TaskTemplate {
  const defaults = input.taskDefaults;
  return {
    ...existing,
    name: input.name ?? existing.name,
    description: optionalField(existing.description, input.description),
    category: optionalField(existing.category, input.category),
    taskDefaults: {
      ...existing.taskDefaults,
      type: optionalField(existing.taskDefaults.type, defaults?.type),
      priority: optionalField(existing.taskDefaults.priority, defaults?.priority),
      project: optionalField(existing.taskDefaults.project, defaults?.project),
      descriptionTemplate: optionalField(
        existing.taskDefaults.descriptionTemplate,
        defaults?.descriptionTemplate
      ),
      agent: optionalField(existing.taskDefaults.agent, defaults?.agent),
    },
    subtaskTemplates: input.subtaskTemplates ?? existing.subtaskTemplates,
    blueprint: input.blueprint ?? existing.blueprint,
    launch: input.launch ?? existing.launch,
    updated: new Date().toISOString(),
  };
}
