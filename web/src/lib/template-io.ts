/**
 * Template import/export utilities
 */

import type { TaskTemplate } from '@veritas-kanban/shared';

/**
 * Export a single template as JSON file
 */
export function exportTemplate(template: TaskTemplate): void {
  const json = JSON.stringify(template, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `template-${template.name.toLowerCase().replace(/\s+/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Export all templates as JSON file
 */
export function exportAllTemplates(templates: TaskTemplate[]): void {
  const json = JSON.stringify(templates, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `templates-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Parse imported template JSON
 */
export async function parseTemplateFile(file: File): Promise<TaskTemplate | TaskTemplate[]> {
  const text = await file.text();
  const parsed = JSON.parse(text);
  
  // Validate that it's a template or array of templates
  if (Array.isArray(parsed)) {
    // Validate each template
    parsed.forEach(validateTemplate);
    return parsed;
  } else {
    validateTemplate(parsed);
    return parsed;
  }
}

/**
 * Validate template structure
 */
function validateTemplate(template: any): void {
  if (!template.name) {
    throw new Error('Template must have a name');
  }
  if (!template.taskDefaults) {
    throw new Error('Template must have taskDefaults');
  }
  // Basic validation - could be expanded
}

/**
 * Check if template name already exists
 */
export function checkDuplicateName(
  templateName: string,
  existingTemplates: TaskTemplate[]
): boolean {
  return existingTemplates.some(t => t.name.toLowerCase() === templateName.toLowerCase());
}
