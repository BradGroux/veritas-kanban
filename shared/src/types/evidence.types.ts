export type EvidenceTimelineEventType =
  | 'task'
  | 'status'
  | 'comment'
  | 'time'
  | 'agent_run'
  | 'telemetry'
  | 'work_product'
  | 'deliverable'
  | 'github'
  | 'attachment'
  | 'observation';

export type EvidenceTimelineEventSource =
  | 'task'
  | 'activity'
  | 'status-history'
  | 'telemetry'
  | 'work-product'
  | 'deliverable';

export interface EvidenceTimelineSourceLink {
  label: string;
  target:
    | 'task'
    | 'agent'
    | 'timeline'
    | 'work-products'
    | 'attachments'
    | 'github'
    | 'telemetry'
    | 'external';
  taskId?: string;
  eventId?: string;
  runId?: string;
  href?: string;
}

export interface EvidenceTimelineEvent {
  id: string;
  timestamp: string;
  type: EvidenceTimelineEventType;
  source: EvidenceTimelineEventSource;
  title: string;
  detail?: string;
  taskId?: string;
  taskTitle?: string;
  project?: string;
  repo?: string;
  cwd?: string;
  actor?: string;
  agent?: string;
  sourceLink?: EvidenceTimelineSourceLink;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface EvidenceTimelineCitation {
  eventId: string;
  label: string;
  timestamp: string;
  source: EvidenceTimelineEventSource;
}

export interface EvidenceTimelineRecap {
  markdown: string;
  citations: EvidenceTimelineCitation[];
}

export interface EvidenceTimelineFilters {
  taskId?: string;
  project?: string;
  repo?: string;
  cwd?: string;
  from?: string;
  to?: string;
  type?: EvidenceTimelineEventType;
  source?: EvidenceTimelineEventSource;
  actor?: string;
  page?: number;
  limit?: number;
}

export interface EvidenceTimelineResponse {
  events: EvidenceTimelineEvent[];
  recap: EvidenceTimelineRecap;
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
  generatedAt: string;
  filters: EvidenceTimelineFilters;
}
