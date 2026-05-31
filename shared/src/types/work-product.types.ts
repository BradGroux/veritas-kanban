export type WorkProductKind =
  | 'text'
  | 'markdown'
  | 'summary'
  | 'checklist'
  | 'report'
  | 'table'
  | 'dashboard';

export type WorkProductStatus = 'active' | 'archived';
export type WorkProductChangeType = 'create' | 'refine' | 'regenerate' | 'restore' | 'manual';
export type WorkProductRedactionLevel = 'none' | 'standard' | 'strict';

export type WorkProductPrimitive = string | number | boolean | null;

export interface WorkProductRedaction {
  level?: WorkProductRedactionLevel;
  containsSensitiveContent?: boolean;
  sensitiveFields?: string[];
  notes?: string[];
  exportDefault?: 'redacted' | 'full';
}

export interface WorkProductSourceLink {
  label: string;
  href: string;
  type?: 'task' | 'run' | 'file' | 'url' | 'pr' | 'other';
}

export interface WorkProductRenderBase {
  schemaVersion: 1;
  kind: WorkProductKind;
}

export interface TextWorkProductRender extends WorkProductRenderBase {
  kind: 'text';
  text: string;
}

export interface MarkdownWorkProductRender extends WorkProductRenderBase {
  kind: 'markdown';
  markdown: string;
}

export interface SummaryWorkProductRender extends WorkProductRenderBase {
  kind: 'summary';
  summary: string;
  keyPoints?: string[];
  sections?: Array<{
    heading: string;
    body: string;
  }>;
}

export interface ChecklistWorkProductRender extends WorkProductRenderBase {
  kind: 'checklist';
  items: Array<{
    id: string;
    label: string;
    checked: boolean;
    notes?: string;
  }>;
}

export interface ReportWorkProductRender extends WorkProductRenderBase {
  kind: 'report';
  summary: string;
  sections: Array<{
    heading: string;
    body: string;
  }>;
}

export interface TableWorkProductRender extends WorkProductRenderBase {
  kind: 'table';
  columns: Array<{
    key: string;
    label: string;
    type?: 'text' | 'number' | 'boolean' | 'date';
  }>;
  rows: Array<Record<string, WorkProductPrimitive>>;
}

export interface DashboardWorkProductRender extends WorkProductRenderBase {
  kind: 'dashboard';
  widgets: Array<{
    id: string;
    title: string;
    value?: WorkProductPrimitive;
    description?: string;
    tone?: 'neutral' | 'good' | 'warning' | 'critical';
  }>;
}

export type WorkProductRender =
  | TextWorkProductRender
  | MarkdownWorkProductRender
  | SummaryWorkProductRender
  | ChecklistWorkProductRender
  | ReportWorkProductRender
  | TableWorkProductRender
  | DashboardWorkProductRender;

export interface WorkProduct {
  id: string;
  workspaceId: string;
  kind: WorkProductKind;
  title: string;
  status: WorkProductStatus;
  render: WorkProductRender;
  version: number;
  taskId?: string;
  sourceRunId?: string;
  agent?: string;
  model?: string;
  redaction?: WorkProductRedaction;
  sourceLinks?: WorkProductSourceLink[];
  metadata?: Record<string, WorkProductPrimitive>;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface WorkProductVersion {
  id: string;
  productId: string;
  workspaceId: string;
  version: number;
  changeType: WorkProductChangeType;
  changeSummary?: string;
  render: WorkProductRender;
  title: string;
  kind: WorkProductKind;
  agent?: string;
  model?: string;
  redaction?: WorkProductRedaction;
  createdAt: string;
}

export interface WorkProductPreview {
  id: string;
  workspaceId: string;
  kind: WorkProductKind;
  title: string;
  status: WorkProductStatus;
  version: number;
  taskId?: string;
  sourceRunId?: string;
  agent?: string;
  model?: string;
  sourceLinks?: WorkProductSourceLink[];
  redacted: boolean;
  snippet: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkProductInput {
  kind: WorkProductKind;
  title: string;
  render: WorkProductRender;
  taskId?: string;
  sourceRunId?: string;
  agent?: string;
  model?: string;
  workspaceId?: string;
  redaction?: WorkProductRedaction;
  sourceLinks?: WorkProductSourceLink[];
  metadata?: Record<string, WorkProductPrimitive>;
  changeSummary?: string;
}

export interface UpdateWorkProductInput {
  title?: string;
  render?: WorkProductRender;
  status?: WorkProductStatus;
  taskId?: string;
  sourceRunId?: string;
  agent?: string;
  model?: string;
  redaction?: WorkProductRedaction;
  sourceLinks?: WorkProductSourceLink[];
  metadata?: Record<string, WorkProductPrimitive>;
  changeType?: Exclude<WorkProductChangeType, 'create'>;
  changeSummary?: string;
}

export interface WorkProductListOptions {
  taskId?: string;
  sourceRunId?: string;
  agent?: string;
  kind?: WorkProductKind;
  status?: WorkProductStatus;
  query?: string;
  includeArchived?: boolean;
  limit?: number;
}
