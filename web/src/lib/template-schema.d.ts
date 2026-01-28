/**
 * Zod validation schema for task templates
 * Enforces strict validation, size limits, and security checks
 */
import { z } from 'zod';
/**
 * Task template schema with strict validation
 */
export declare const TaskTemplateSchema: z.ZodEffects<z.ZodObject<{
    id: z.ZodOptional<z.ZodString>;
    name: z.ZodEffects<z.ZodString, string, string>;
    description: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, string | undefined>;
    category: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, string | undefined>;
    version: z.ZodOptional<z.ZodNumber>;
    taskDefaults: z.ZodObject<{
        type: z.ZodOptional<z.ZodString>;
        priority: z.ZodOptional<z.ZodString>;
        project: z.ZodOptional<z.ZodString>;
        descriptionTemplate: z.ZodOptional<z.ZodString>;
        agent: z.ZodOptional<z.ZodString>;
    }, "strict", z.ZodTypeAny, {
        type?: string | undefined;
        project?: string | undefined;
        priority?: string | undefined;
        agent?: string | undefined;
        descriptionTemplate?: string | undefined;
    }, {
        type?: string | undefined;
        project?: string | undefined;
        priority?: string | undefined;
        agent?: string | undefined;
        descriptionTemplate?: string | undefined;
    }>;
    subtaskTemplates: z.ZodOptional<z.ZodArray<z.ZodObject<{
        title: z.ZodEffects<z.ZodString, string, string>;
        order: z.ZodOptional<z.ZodNumber>;
    }, "strict", z.ZodTypeAny, {
        title: string;
        order?: number | undefined;
    }, {
        title: string;
        order?: number | undefined;
    }>, "many">>;
    blueprint: z.ZodOptional<z.ZodArray<z.ZodObject<{
        refId: z.ZodEffects<z.ZodString, string, string>;
        title: z.ZodEffects<z.ZodString, string, string>;
        taskDefaults: z.ZodOptional<z.ZodObject<{
            type: z.ZodOptional<z.ZodString>;
            priority: z.ZodOptional<z.ZodString>;
            project: z.ZodOptional<z.ZodString>;
            descriptionTemplate: z.ZodOptional<z.ZodString>;
            agent: z.ZodOptional<z.ZodString>;
        }, "strict", z.ZodTypeAny, {
            type?: string | undefined;
            project?: string | undefined;
            priority?: string | undefined;
            agent?: string | undefined;
            descriptionTemplate?: string | undefined;
        }, {
            type?: string | undefined;
            project?: string | undefined;
            priority?: string | undefined;
            agent?: string | undefined;
            descriptionTemplate?: string | undefined;
        }>>;
        subtaskTemplates: z.ZodOptional<z.ZodArray<z.ZodObject<{
            title: z.ZodEffects<z.ZodString, string, string>;
            order: z.ZodOptional<z.ZodNumber>;
        }, "strict", z.ZodTypeAny, {
            title: string;
            order?: number | undefined;
        }, {
            title: string;
            order?: number | undefined;
        }>, "many">>;
        blockedByRefs: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strict", z.ZodTypeAny, {
        title: string;
        refId: string;
        taskDefaults?: {
            type?: string | undefined;
            project?: string | undefined;
            priority?: string | undefined;
            agent?: string | undefined;
            descriptionTemplate?: string | undefined;
        } | undefined;
        subtaskTemplates?: {
            title: string;
            order?: number | undefined;
        }[] | undefined;
        blockedByRefs?: string[] | undefined;
    }, {
        title: string;
        refId: string;
        taskDefaults?: {
            type?: string | undefined;
            project?: string | undefined;
            priority?: string | undefined;
            agent?: string | undefined;
            descriptionTemplate?: string | undefined;
        } | undefined;
        subtaskTemplates?: {
            title: string;
            order?: number | undefined;
        }[] | undefined;
        blockedByRefs?: string[] | undefined;
    }>, "many">>;
    created: z.ZodOptional<z.ZodString>;
    updated: z.ZodOptional<z.ZodString>;
}, "strict", z.ZodTypeAny, {
    name: string;
    taskDefaults: {
        type?: string | undefined;
        project?: string | undefined;
        priority?: string | undefined;
        agent?: string | undefined;
        descriptionTemplate?: string | undefined;
    };
    id?: string | undefined;
    description?: string | undefined;
    created?: string | undefined;
    updated?: string | undefined;
    subtaskTemplates?: {
        title: string;
        order?: number | undefined;
    }[] | undefined;
    category?: string | undefined;
    blueprint?: {
        title: string;
        refId: string;
        taskDefaults?: {
            type?: string | undefined;
            project?: string | undefined;
            priority?: string | undefined;
            agent?: string | undefined;
            descriptionTemplate?: string | undefined;
        } | undefined;
        subtaskTemplates?: {
            title: string;
            order?: number | undefined;
        }[] | undefined;
        blockedByRefs?: string[] | undefined;
    }[] | undefined;
    version?: number | undefined;
}, {
    name: string;
    taskDefaults: {
        type?: string | undefined;
        project?: string | undefined;
        priority?: string | undefined;
        agent?: string | undefined;
        descriptionTemplate?: string | undefined;
    };
    id?: string | undefined;
    description?: string | undefined;
    created?: string | undefined;
    updated?: string | undefined;
    subtaskTemplates?: {
        title: string;
        order?: number | undefined;
    }[] | undefined;
    category?: string | undefined;
    blueprint?: {
        title: string;
        refId: string;
        taskDefaults?: {
            type?: string | undefined;
            project?: string | undefined;
            priority?: string | undefined;
            agent?: string | undefined;
            descriptionTemplate?: string | undefined;
        } | undefined;
        subtaskTemplates?: {
            title: string;
            order?: number | undefined;
        }[] | undefined;
        blockedByRefs?: string[] | undefined;
    }[] | undefined;
    version?: number | undefined;
}>, {
    name: string;
    taskDefaults: {
        type?: string | undefined;
        project?: string | undefined;
        priority?: string | undefined;
        agent?: string | undefined;
        descriptionTemplate?: string | undefined;
    };
    id?: string | undefined;
    description?: string | undefined;
    created?: string | undefined;
    updated?: string | undefined;
    subtaskTemplates?: {
        title: string;
        order?: number | undefined;
    }[] | undefined;
    category?: string | undefined;
    blueprint?: {
        title: string;
        refId: string;
        taskDefaults?: {
            type?: string | undefined;
            project?: string | undefined;
            priority?: string | undefined;
            agent?: string | undefined;
            descriptionTemplate?: string | undefined;
        } | undefined;
        subtaskTemplates?: {
            title: string;
            order?: number | undefined;
        }[] | undefined;
        blockedByRefs?: string[] | undefined;
    }[] | undefined;
    version?: number | undefined;
}, {
    name: string;
    taskDefaults: {
        type?: string | undefined;
        project?: string | undefined;
        priority?: string | undefined;
        agent?: string | undefined;
        descriptionTemplate?: string | undefined;
    };
    id?: string | undefined;
    description?: string | undefined;
    created?: string | undefined;
    updated?: string | undefined;
    subtaskTemplates?: {
        title: string;
        order?: number | undefined;
    }[] | undefined;
    category?: string | undefined;
    blueprint?: {
        title: string;
        refId: string;
        taskDefaults?: {
            type?: string | undefined;
            project?: string | undefined;
            priority?: string | undefined;
            agent?: string | undefined;
            descriptionTemplate?: string | undefined;
        } | undefined;
        subtaskTemplates?: {
            title: string;
            order?: number | undefined;
        }[] | undefined;
        blockedByRefs?: string[] | undefined;
    }[] | undefined;
    version?: number | undefined;
}>;
/**
 * Schema for importing templates (single or array)
 */
export declare const TemplateImportSchema: z.ZodUnion<[z.ZodEffects<z.ZodObject<{
    id: z.ZodOptional<z.ZodString>;
    name: z.ZodEffects<z.ZodString, string, string>;
    description: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, string | undefined>;
    category: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, string | undefined>;
    version: z.ZodOptional<z.ZodNumber>;
    taskDefaults: z.ZodObject<{
        type: z.ZodOptional<z.ZodString>;
        priority: z.ZodOptional<z.ZodString>;
        project: z.ZodOptional<z.ZodString>;
        descriptionTemplate: z.ZodOptional<z.ZodString>;
        agent: z.ZodOptional<z.ZodString>;
    }, "strict", z.ZodTypeAny, {
        type?: string | undefined;
        project?: string | undefined;
        priority?: string | undefined;
        agent?: string | undefined;
        descriptionTemplate?: string | undefined;
    }, {
        type?: string | undefined;
        project?: string | undefined;
        priority?: string | undefined;
        agent?: string | undefined;
        descriptionTemplate?: string | undefined;
    }>;
    subtaskTemplates: z.ZodOptional<z.ZodArray<z.ZodObject<{
        title: z.ZodEffects<z.ZodString, string, string>;
        order: z.ZodOptional<z.ZodNumber>;
    }, "strict", z.ZodTypeAny, {
        title: string;
        order?: number | undefined;
    }, {
        title: string;
        order?: number | undefined;
    }>, "many">>;
    blueprint: z.ZodOptional<z.ZodArray<z.ZodObject<{
        refId: z.ZodEffects<z.ZodString, string, string>;
        title: z.ZodEffects<z.ZodString, string, string>;
        taskDefaults: z.ZodOptional<z.ZodObject<{
            type: z.ZodOptional<z.ZodString>;
            priority: z.ZodOptional<z.ZodString>;
            project: z.ZodOptional<z.ZodString>;
            descriptionTemplate: z.ZodOptional<z.ZodString>;
            agent: z.ZodOptional<z.ZodString>;
        }, "strict", z.ZodTypeAny, {
            type?: string | undefined;
            project?: string | undefined;
            priority?: string | undefined;
            agent?: string | undefined;
            descriptionTemplate?: string | undefined;
        }, {
            type?: string | undefined;
            project?: string | undefined;
            priority?: string | undefined;
            agent?: string | undefined;
            descriptionTemplate?: string | undefined;
        }>>;
        subtaskTemplates: z.ZodOptional<z.ZodArray<z.ZodObject<{
            title: z.ZodEffects<z.ZodString, string, string>;
            order: z.ZodOptional<z.ZodNumber>;
        }, "strict", z.ZodTypeAny, {
            title: string;
            order?: number | undefined;
        }, {
            title: string;
            order?: number | undefined;
        }>, "many">>;
        blockedByRefs: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strict", z.ZodTypeAny, {
        title: string;
        refId: string;
        taskDefaults?: {
            type?: string | undefined;
            project?: string | undefined;
            priority?: string | undefined;
            agent?: string | undefined;
            descriptionTemplate?: string | undefined;
        } | undefined;
        subtaskTemplates?: {
            title: string;
            order?: number | undefined;
        }[] | undefined;
        blockedByRefs?: string[] | undefined;
    }, {
        title: string;
        refId: string;
        taskDefaults?: {
            type?: string | undefined;
            project?: string | undefined;
            priority?: string | undefined;
            agent?: string | undefined;
            descriptionTemplate?: string | undefined;
        } | undefined;
        subtaskTemplates?: {
            title: string;
            order?: number | undefined;
        }[] | undefined;
        blockedByRefs?: string[] | undefined;
    }>, "many">>;
    created: z.ZodOptional<z.ZodString>;
    updated: z.ZodOptional<z.ZodString>;
}, "strict", z.ZodTypeAny, {
    name: string;
    taskDefaults: {
        type?: string | undefined;
        project?: string | undefined;
        priority?: string | undefined;
        agent?: string | undefined;
        descriptionTemplate?: string | undefined;
    };
    id?: string | undefined;
    description?: string | undefined;
    created?: string | undefined;
    updated?: string | undefined;
    subtaskTemplates?: {
        title: string;
        order?: number | undefined;
    }[] | undefined;
    category?: string | undefined;
    blueprint?: {
        title: string;
        refId: string;
        taskDefaults?: {
            type?: string | undefined;
            project?: string | undefined;
            priority?: string | undefined;
            agent?: string | undefined;
            descriptionTemplate?: string | undefined;
        } | undefined;
        subtaskTemplates?: {
            title: string;
            order?: number | undefined;
        }[] | undefined;
        blockedByRefs?: string[] | undefined;
    }[] | undefined;
    version?: number | undefined;
}, {
    name: string;
    taskDefaults: {
        type?: string | undefined;
        project?: string | undefined;
        priority?: string | undefined;
        agent?: string | undefined;
        descriptionTemplate?: string | undefined;
    };
    id?: string | undefined;
    description?: string | undefined;
    created?: string | undefined;
    updated?: string | undefined;
    subtaskTemplates?: {
        title: string;
        order?: number | undefined;
    }[] | undefined;
    category?: string | undefined;
    blueprint?: {
        title: string;
        refId: string;
        taskDefaults?: {
            type?: string | undefined;
            project?: string | undefined;
            priority?: string | undefined;
            agent?: string | undefined;
            descriptionTemplate?: string | undefined;
        } | undefined;
        subtaskTemplates?: {
            title: string;
            order?: number | undefined;
        }[] | undefined;
        blockedByRefs?: string[] | undefined;
    }[] | undefined;
    version?: number | undefined;
}>, {
    name: string;
    taskDefaults: {
        type?: string | undefined;
        project?: string | undefined;
        priority?: string | undefined;
        agent?: string | undefined;
        descriptionTemplate?: string | undefined;
    };
    id?: string | undefined;
    description?: string | undefined;
    created?: string | undefined;
    updated?: string | undefined;
    subtaskTemplates?: {
        title: string;
        order?: number | undefined;
    }[] | undefined;
    category?: string | undefined;
    blueprint?: {
        title: string;
        refId: string;
        taskDefaults?: {
            type?: string | undefined;
            project?: string | undefined;
            priority?: string | undefined;
            agent?: string | undefined;
            descriptionTemplate?: string | undefined;
        } | undefined;
        subtaskTemplates?: {
            title: string;
            order?: number | undefined;
        }[] | undefined;
        blockedByRefs?: string[] | undefined;
    }[] | undefined;
    version?: number | undefined;
}, {
    name: string;
    taskDefaults: {
        type?: string | undefined;
        project?: string | undefined;
        priority?: string | undefined;
        agent?: string | undefined;
        descriptionTemplate?: string | undefined;
    };
    id?: string | undefined;
    description?: string | undefined;
    created?: string | undefined;
    updated?: string | undefined;
    subtaskTemplates?: {
        title: string;
        order?: number | undefined;
    }[] | undefined;
    category?: string | undefined;
    blueprint?: {
        title: string;
        refId: string;
        taskDefaults?: {
            type?: string | undefined;
            project?: string | undefined;
            priority?: string | undefined;
            agent?: string | undefined;
            descriptionTemplate?: string | undefined;
        } | undefined;
        subtaskTemplates?: {
            title: string;
            order?: number | undefined;
        }[] | undefined;
        blockedByRefs?: string[] | undefined;
    }[] | undefined;
    version?: number | undefined;
}>, z.ZodArray<z.ZodEffects<z.ZodObject<{
    id: z.ZodOptional<z.ZodString>;
    name: z.ZodEffects<z.ZodString, string, string>;
    description: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, string | undefined>;
    category: z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, string | undefined>;
    version: z.ZodOptional<z.ZodNumber>;
    taskDefaults: z.ZodObject<{
        type: z.ZodOptional<z.ZodString>;
        priority: z.ZodOptional<z.ZodString>;
        project: z.ZodOptional<z.ZodString>;
        descriptionTemplate: z.ZodOptional<z.ZodString>;
        agent: z.ZodOptional<z.ZodString>;
    }, "strict", z.ZodTypeAny, {
        type?: string | undefined;
        project?: string | undefined;
        priority?: string | undefined;
        agent?: string | undefined;
        descriptionTemplate?: string | undefined;
    }, {
        type?: string | undefined;
        project?: string | undefined;
        priority?: string | undefined;
        agent?: string | undefined;
        descriptionTemplate?: string | undefined;
    }>;
    subtaskTemplates: z.ZodOptional<z.ZodArray<z.ZodObject<{
        title: z.ZodEffects<z.ZodString, string, string>;
        order: z.ZodOptional<z.ZodNumber>;
    }, "strict", z.ZodTypeAny, {
        title: string;
        order?: number | undefined;
    }, {
        title: string;
        order?: number | undefined;
    }>, "many">>;
    blueprint: z.ZodOptional<z.ZodArray<z.ZodObject<{
        refId: z.ZodEffects<z.ZodString, string, string>;
        title: z.ZodEffects<z.ZodString, string, string>;
        taskDefaults: z.ZodOptional<z.ZodObject<{
            type: z.ZodOptional<z.ZodString>;
            priority: z.ZodOptional<z.ZodString>;
            project: z.ZodOptional<z.ZodString>;
            descriptionTemplate: z.ZodOptional<z.ZodString>;
            agent: z.ZodOptional<z.ZodString>;
        }, "strict", z.ZodTypeAny, {
            type?: string | undefined;
            project?: string | undefined;
            priority?: string | undefined;
            agent?: string | undefined;
            descriptionTemplate?: string | undefined;
        }, {
            type?: string | undefined;
            project?: string | undefined;
            priority?: string | undefined;
            agent?: string | undefined;
            descriptionTemplate?: string | undefined;
        }>>;
        subtaskTemplates: z.ZodOptional<z.ZodArray<z.ZodObject<{
            title: z.ZodEffects<z.ZodString, string, string>;
            order: z.ZodOptional<z.ZodNumber>;
        }, "strict", z.ZodTypeAny, {
            title: string;
            order?: number | undefined;
        }, {
            title: string;
            order?: number | undefined;
        }>, "many">>;
        blockedByRefs: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strict", z.ZodTypeAny, {
        title: string;
        refId: string;
        taskDefaults?: {
            type?: string | undefined;
            project?: string | undefined;
            priority?: string | undefined;
            agent?: string | undefined;
            descriptionTemplate?: string | undefined;
        } | undefined;
        subtaskTemplates?: {
            title: string;
            order?: number | undefined;
        }[] | undefined;
        blockedByRefs?: string[] | undefined;
    }, {
        title: string;
        refId: string;
        taskDefaults?: {
            type?: string | undefined;
            project?: string | undefined;
            priority?: string | undefined;
            agent?: string | undefined;
            descriptionTemplate?: string | undefined;
        } | undefined;
        subtaskTemplates?: {
            title: string;
            order?: number | undefined;
        }[] | undefined;
        blockedByRefs?: string[] | undefined;
    }>, "many">>;
    created: z.ZodOptional<z.ZodString>;
    updated: z.ZodOptional<z.ZodString>;
}, "strict", z.ZodTypeAny, {
    name: string;
    taskDefaults: {
        type?: string | undefined;
        project?: string | undefined;
        priority?: string | undefined;
        agent?: string | undefined;
        descriptionTemplate?: string | undefined;
    };
    id?: string | undefined;
    description?: string | undefined;
    created?: string | undefined;
    updated?: string | undefined;
    subtaskTemplates?: {
        title: string;
        order?: number | undefined;
    }[] | undefined;
    category?: string | undefined;
    blueprint?: {
        title: string;
        refId: string;
        taskDefaults?: {
            type?: string | undefined;
            project?: string | undefined;
            priority?: string | undefined;
            agent?: string | undefined;
            descriptionTemplate?: string | undefined;
        } | undefined;
        subtaskTemplates?: {
            title: string;
            order?: number | undefined;
        }[] | undefined;
        blockedByRefs?: string[] | undefined;
    }[] | undefined;
    version?: number | undefined;
}, {
    name: string;
    taskDefaults: {
        type?: string | undefined;
        project?: string | undefined;
        priority?: string | undefined;
        agent?: string | undefined;
        descriptionTemplate?: string | undefined;
    };
    id?: string | undefined;
    description?: string | undefined;
    created?: string | undefined;
    updated?: string | undefined;
    subtaskTemplates?: {
        title: string;
        order?: number | undefined;
    }[] | undefined;
    category?: string | undefined;
    blueprint?: {
        title: string;
        refId: string;
        taskDefaults?: {
            type?: string | undefined;
            project?: string | undefined;
            priority?: string | undefined;
            agent?: string | undefined;
            descriptionTemplate?: string | undefined;
        } | undefined;
        subtaskTemplates?: {
            title: string;
            order?: number | undefined;
        }[] | undefined;
        blockedByRefs?: string[] | undefined;
    }[] | undefined;
    version?: number | undefined;
}>, {
    name: string;
    taskDefaults: {
        type?: string | undefined;
        project?: string | undefined;
        priority?: string | undefined;
        agent?: string | undefined;
        descriptionTemplate?: string | undefined;
    };
    id?: string | undefined;
    description?: string | undefined;
    created?: string | undefined;
    updated?: string | undefined;
    subtaskTemplates?: {
        title: string;
        order?: number | undefined;
    }[] | undefined;
    category?: string | undefined;
    blueprint?: {
        title: string;
        refId: string;
        taskDefaults?: {
            type?: string | undefined;
            project?: string | undefined;
            priority?: string | undefined;
            agent?: string | undefined;
            descriptionTemplate?: string | undefined;
        } | undefined;
        subtaskTemplates?: {
            title: string;
            order?: number | undefined;
        }[] | undefined;
        blockedByRefs?: string[] | undefined;
    }[] | undefined;
    version?: number | undefined;
}, {
    name: string;
    taskDefaults: {
        type?: string | undefined;
        project?: string | undefined;
        priority?: string | undefined;
        agent?: string | undefined;
        descriptionTemplate?: string | undefined;
    };
    id?: string | undefined;
    description?: string | undefined;
    created?: string | undefined;
    updated?: string | undefined;
    subtaskTemplates?: {
        title: string;
        order?: number | undefined;
    }[] | undefined;
    category?: string | undefined;
    blueprint?: {
        title: string;
        refId: string;
        taskDefaults?: {
            type?: string | undefined;
            project?: string | undefined;
            priority?: string | undefined;
            agent?: string | undefined;
            descriptionTemplate?: string | undefined;
        } | undefined;
        subtaskTemplates?: {
            title: string;
            order?: number | undefined;
        }[] | undefined;
        blockedByRefs?: string[] | undefined;
    }[] | undefined;
    version?: number | undefined;
}>, "many">]>;
/**
 * Type exports
 */
export type ValidatedTemplate = z.infer<typeof TaskTemplateSchema>;
export type TemplateImport = z.infer<typeof TemplateImportSchema>;
