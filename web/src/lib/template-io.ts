/**
 * Template import/export utilities with enhanced validation and security
 */

import type { TaskTemplate } from '@veritas-kanban/shared';
import { TemplateImportSchema, type ValidatedTemplate } from './template-schema';
import { ZodError } from 'zod';

// Dangerous keys that could lead to prototype pollution
const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'];

/**
 * Recursively sanitize object keys to prevent prototype pollution
 */
function sanitizeKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(sanitizeKeys);
  }

  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    // Reject dangerous keys
    if (DANGEROUS_KEYS.some((dangerous) => key.includes(dangerous))) {
      throw new Error(`Forbidden key detected: ${key}`);
    }

    // Recursively sanitize nested objects
    sanitized[key] = sanitizeKeys(value);
  }

  return sanitized;
}

/**
 * Format Zod validation errors into human-readable messages
 */
function formatZodError(error: ZodError): string {
  const firstError = error.issues[0];
  if (firstError) {
    const path = firstError.path.join('.');
    return path ? `${path}: ${firstError.message}` : firstError.message;
  }
  return 'Validation failed';
}

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
 * Parse and validate imported template JSON
 * Throws errors for invalid templates (caller should handle with toast)
 */
export async function parseTemplateFile(
  file: File
): Promise<ValidatedTemplate | ValidatedTemplate[]> {
  // Check file size (max 1MB)
  if (file.size > 1024 * 1024) {
    throw new Error('File size exceeds 1MB limit');
  }

  let text: string;
  try {
    text = await file.text();
  } catch (err) {
    throw new Error('Failed to read file');
  }

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error('Invalid JSON format');
  }

  // Sanitize keys to prevent prototype pollution
  try {
    parsed = sanitizeKeys(parsed);
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Security check failed');
  }

  // Validate with Zod schema
  try {
    const validated = TemplateImportSchema.parse(parsed);
    return validated;
  } catch (err) {
    if (err instanceof ZodError) {
      throw new Error(`Validation failed: ${formatZodError(err)}`);
    }
    throw new Error('Template validation failed');
  }
}

/**
 * Check if template name already exists
 */
export function checkDuplicateName(
  templateName: string,
  existingTemplates: TaskTemplate[]
): boolean {
  return existingTemplates.some((t) => t.name.toLowerCase() === templateName.toLowerCase());
}
