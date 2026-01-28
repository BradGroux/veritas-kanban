/**
 * Zod validation schema for task templates
 * Enforces strict validation, size limits, and security checks
 */
import { z } from 'zod';
// Dangerous keys that could lead to prototype pollution
const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'];
/**
 * Check if a string contains dangerous keys
 */
function hasDangerousKeys(str) {
    return DANGEROUS_KEYS.some(key => str.includes(key));
}
/**
 * Subtask template schema
 */
const SubtaskTemplateSchema = z.object({
    title: z.string()
        .min(1, 'Subtask title cannot be empty')
        .refine(val => !hasDangerousKeys(val), {
        message: 'Subtask title contains forbidden keys',
    }),
    order: z.number().int().min(0).optional(),
}).strict();
/**
 * Blueprint task schema
 */
const BlueprintTaskSchema = z.object({
    refId: z.string()
        .min(1, 'Blueprint task refId cannot be empty')
        .refine(val => !hasDangerousKeys(val), {
        message: 'Blueprint refId contains forbidden keys',
    }),
    title: z.string()
        .min(1, 'Blueprint task title cannot be empty')
        .refine(val => !hasDangerousKeys(val), {
        message: 'Blueprint task title contains forbidden keys',
    }),
    taskDefaults: z.object({
        type: z.string().optional(),
        priority: z.string().optional(),
        project: z.string().optional(),
        descriptionTemplate: z.string().optional(),
        agent: z.string().optional(),
    }).strict().optional(),
    subtaskTemplates: z.array(SubtaskTemplateSchema).optional(),
    blockedByRefs: z.array(z.string()).optional(),
}).strict();
/**
 * Task template schema with strict validation
 */
export const TaskTemplateSchema = z.object({
    id: z.string().optional(), // Optional for imports
    name: z.string()
        .min(1, 'Template name is required')
        .max(100, 'Template name must be 100 characters or less')
        .refine(val => !hasDangerousKeys(val), {
        message: 'Template name contains forbidden keys',
    }),
    description: z.string()
        .max(500, 'Template description must be 500 characters or less')
        .optional()
        .refine(val => !val || !hasDangerousKeys(val), {
        message: 'Template description contains forbidden keys',
    }),
    category: z.string()
        .optional()
        .refine(val => !val || !hasDangerousKeys(val), {
        message: 'Template category contains forbidden keys',
    }),
    version: z.number().int().min(0).optional(),
    taskDefaults: z.object({
        type: z.string().optional(),
        priority: z.string().optional(),
        project: z.string().optional(),
        descriptionTemplate: z.string().optional(),
        agent: z.string().optional(),
    }).strict(),
    subtaskTemplates: z.array(SubtaskTemplateSchema)
        .max(50, 'Maximum 50 subtask templates allowed')
        .optional(),
    blueprint: z.array(BlueprintTaskSchema)
        .max(20, 'Maximum 20 blueprint tasks allowed')
        .optional(),
    created: z.string().optional(),
    updated: z.string().optional(),
}).strict()
    .refine((data) => {
    // Validate blueprint dependency references
    if (!data.blueprint || data.blueprint.length === 0) {
        return true;
    }
    const refIds = new Set(data.blueprint.map(task => task.refId));
    for (const task of data.blueprint) {
        if (task.blockedByRefs) {
            for (const ref of task.blockedByRefs) {
                if (!refIds.has(ref)) {
                    return false;
                }
            }
        }
    }
    return true;
}, {
    message: 'Blueprint dependency references must point to valid refIds within the same blueprint',
});
/**
 * Schema for importing templates (single or array)
 */
export const TemplateImportSchema = z.union([
    TaskTemplateSchema,
    z.array(TaskTemplateSchema),
]);
//# sourceMappingURL=template-schema.js.map