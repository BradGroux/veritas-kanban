export type WorkProductKind =
  'text' | 'markdown' | 'summary' | 'checklist' | 'report' | 'table' | 'dashboard' | 'file';

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

export const WORK_PRODUCT_ARTIFACT_SCHEMA_VERSION = 'work-product-artifact/v1' as const;
export const WORK_PRODUCT_ARTIFACT_PREVIEW_SCHEMA_VERSION =
  'work-product-artifact-preview/v1' as const;
export const WORK_PRODUCT_HTML_PREVIEW_CSP =
  "default-src 'none'; base-uri 'none'; child-src 'none'; connect-src 'none'; font-src 'none'; form-action 'none'; frame-src 'none'; img-src 'none'; manifest-src 'none'; media-src 'none'; navigate-to 'none'; object-src 'none'; script-src 'none'; style-src 'unsafe-inline'; worker-src 'none'" as const;
export const WORK_PRODUCT_HTML_PREVIEW_SANDBOX = '' as const;

export type WorkProductArtifactState = 'available' | 'quarantined' | 'deleted';
export type WorkProductArtifactRedactionState = 'none' | 'redacted' | 'quarantined';
export type WorkProductArtifactQuarantineReason =
  'content-policy' | 'secret-validation' | 'integrity-mismatch';

export interface WorkProductArtifactMetadata {
  schemaVersion: typeof WORK_PRODUCT_ARTIFACT_SCHEMA_VERSION;
  id: string;
  productId: string;
  version: number;
  workspaceId: string;
  taskId: string;
  runId: string;
  attemptId: string;
  producingEventId: string;
  requestIdDigest: string;
  launchManifestDigest: string;
  mediaType: string;
  byteSize: number;
  sha256: string;
  safeName: string;
  state: WorkProductArtifactState;
  quarantineReason?: WorkProductArtifactQuarantineReason;
  redaction: {
    state: WorkProductArtifactRedactionState;
    reason?: string;
  };
  createdAt: string;
  expiresAt?: string;
}

export type WorkProductArtifactPreviewStatus =
  | 'ready'
  | 'unsupported'
  | 'quarantined'
  | 'expired'
  | 'missing'
  | 'malformed'
  | 'oversized'
  | 'policy-blocked';

export type WorkProductArtifactPreviewRenderer =
  'text' | 'markdown' | 'html' | 'image' | 'pdf' | 'table' | 'none';

export type WorkProductArtifactPreviewAuditAction = 'open' | 'close' | 'refresh' | 'navigate';

export interface WorkProductArtifactPreviewCell {
  text: string;
  formula: boolean;
  truncated: boolean;
}

export interface WorkProductArtifactPreviewSheet {
  name: string;
  rows: WorkProductArtifactPreviewCell[][];
  totalRows: number;
  totalColumns: number;
  truncated: boolean;
}

export type WorkProductArtifactPreviewContent =
  | { kind: 'text'; text: string }
  | {
      kind: 'html';
      document: string;
      interactive: false;
      contentSecurityPolicy: typeof WORK_PRODUCT_HTML_PREVIEW_CSP;
      sandbox: typeof WORK_PRODUCT_HTML_PREVIEW_SANDBOX;
    }
  | {
      kind: 'image';
      base64: string;
      width: number;
      height: number;
      animated: boolean;
    }
  | { kind: 'pdf'; base64: string; pages: number }
  | { kind: 'table'; sheets: WorkProductArtifactPreviewSheet[] };

export interface WorkProductArtifactPreview {
  schemaVersion: typeof WORK_PRODUCT_ARTIFACT_PREVIEW_SCHEMA_VERSION;
  status: WorkProductArtifactPreviewStatus;
  renderer: WorkProductArtifactPreviewRenderer;
  message: string;
  artifact: WorkProductArtifactMetadata | null;
  sourceRunId: string | null;
  redactionState: WorkProductArtifactRedactionState | null;
  causalEvent: {
    taskId: string;
    runId: string;
    attemptId: string;
    eventId: string;
  } | null;
  limits: {
    maxBytes: number;
    maxRows?: number;
    maxColumns?: number;
    maxCellCharacters?: number;
    maxPages?: number;
    maxPixels?: number;
  };
  truncation: {
    truncated: boolean;
    reasons: string[];
  };
  actions: {
    downloadAllowed: boolean;
    openAssociatedAppAllowed: boolean;
  };
  content: WorkProductArtifactPreviewContent | null;
}

export interface FileWorkProductRender extends WorkProductRenderBase {
  kind: 'file';
  artifact: WorkProductArtifactMetadata;
}

export type WorkProductRender =
  | TextWorkProductRender
  | MarkdownWorkProductRender
  | SummaryWorkProductRender
  | ChecklistWorkProductRender
  | ReportWorkProductRender
  | TableWorkProductRender
  | DashboardWorkProductRender
  | FileWorkProductRender;

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
  artifact?: WorkProductArtifactMetadata;
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
  workspaceId?: string;
  taskId?: string;
  sourceRunId?: string;
  agent?: string;
  kind?: WorkProductKind;
  status?: WorkProductStatus;
  query?: string;
  includeArchived?: boolean;
  limit?: number;
}

export interface WorkProductMaintenancePreviewItem {
  id: string;
  workspaceId: string;
  title: string;
  kind: WorkProductKind;
  status: WorkProductStatus;
  taskId?: string;
  sourceRunId?: string;
  version: number;
  versionCount: number;
  sourceLinkCount: number;
  redacted: boolean;
  cleanupEligible: boolean;
  retainedReason: string;
  estimatedBytes: number;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface WorkProductMaintenancePreview {
  generatedAt: string;
  workspaceId: string;
  totals: {
    products: number;
    active: number;
    archived: number;
    versions: number;
    cleanupCandidates: number;
    estimatedBytes: number;
  };
  byKind: Array<{
    kind: WorkProductKind;
    products: number;
    versions: number;
    estimatedBytes: number;
  }>;
  cleanupCandidates: WorkProductMaintenancePreviewItem[];
  retained: WorkProductMaintenancePreviewItem[];
  notes: string[];
}
