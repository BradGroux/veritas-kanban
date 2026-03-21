/**
 * Prompt Template Registry Types
 * Supports prompt template CRUD, versioning, variable interpolation, usage tracking, and preview rendering
 */

/** Prompt template categories */
export type PromptCategory = 'system' | 'agent' | 'tool' | 'evaluation';

/** A prompt template with variables and metadata */
export interface PromptTemplate {
  id: string;
  name: string;
  description?: string;
  category: PromptCategory;
  content: string; // Template content with {{variable}} placeholders
  variables: string[]; // Extracted variable names (e.g., ['agent_name', 'task_context'])
  created: string; // ISO timestamp
  updated: string; // ISO timestamp
  createdBy?: string; // User/agent who created it
  currentVersionId: string; // Reference to current PromptVersion
}

/** A versioned snapshot of a prompt with changelog */
export interface PromptVersion {
  id: string; // Format: `prompt_<templateId>_v<number>`
  templateId: string;
  versionNumber: number;
  content: string;
  changelog: string; // Description of what changed in this version
  createdAt: string; // ISO timestamp
  createdBy?: string; // User/agent who made this version
}

/** Usage tracking for analytics */
export interface PromptUsage {
  id: string; // Unique usage record ID
  templateId: string;
  usedAt: string; // ISO timestamp when template was used
  usedBy?: string; // Agent or user that used it
  renderedPrompt?: string; // Optional: the final rendered prompt (for audit)
  model?: string; // Optional: model that received the prompt
  inputTokens?: number;
  outputTokens?: number;
}

/** Statistics for a prompt template */
export interface PromptStats {
  templateId: string;
  templateName: string;
  totalUsages: number;
  totalVersions: number;
  lastUsedAt?: string; // ISO timestamp
  mostFrequentUser?: string; // Agent/user that used it most
  averageTokensPerUsage?: number;
}

/** Input for creating a new prompt template */
export interface CreatePromptTemplateInput {
  name: string;
  description?: string;
  category: PromptCategory;
  content: string;
}

/** Input for updating a prompt template */
export interface UpdatePromptTemplateInput {
  name?: string;
  description?: string;
  category?: PromptCategory;
  content?: string;
  changelog?: string; // Required if content changes (for version history)
}

/** Preview render request */
export interface RenderPreviewRequest {
  templateId: string;
  sampleVariables: Record<string, string>; // e.g., { agent_name: "Claude", task_context: "Bug triage" }
}

/** Preview render response */
export interface RenderPreviewResponse {
  renderedPrompt: string;
  unmatchedVariables: string[]; // Variables in template but not provided
}
