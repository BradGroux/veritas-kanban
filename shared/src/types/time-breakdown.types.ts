import type { EvidenceTimelineEventSource, EvidenceTimelineSourceLink } from './evidence.types.js';

export type TimeBreakdownPreset = 'daily' | 'weekly' | 'monthly' | 'custom';
export type TimeBreakdownBlockKind = 'explicit' | 'inferred' | 'ambiguous';
export type TimeBreakdownConfidence = 'high' | 'medium' | 'low';

export interface TimeBreakdownFilters {
  preset?: TimeBreakdownPreset;
  from?: string;
  to?: string;
  taskId?: string;
  project?: string;
  repo?: string;
  cwd?: string;
  actor?: string;
  includeInferred?: boolean;
  limit?: number;
}

export interface TimeBreakdownSource {
  eventId: string;
  label: string;
  timestamp: string;
  source: EvidenceTimelineEventSource;
  sourceLink?: EvidenceTimelineSourceLink;
}

export interface TimeBreakdownBlock {
  id: string;
  kind: TimeBreakdownBlockKind;
  date: string;
  timestamp: string;
  durationSeconds: number;
  label: string;
  taskId?: string;
  taskTitle?: string;
  project?: string;
  repo?: string;
  cwd?: string;
  actor?: string;
  agent?: string;
  confidence: TimeBreakdownConfidence;
  confidenceReason: string;
  sources: TimeBreakdownSource[];
}

export interface TimeBreakdownGroup {
  key: string;
  label: string;
  date: string;
  taskId?: string;
  taskTitle?: string;
  project?: string;
  repo?: string;
  cwd?: string;
  explicitSeconds: number;
  inferredSeconds: number;
  ambiguousCount: number;
  totalSeconds: number;
  blockIds: string[];
}

export interface TimeBreakdownTotals {
  explicitSeconds: number;
  inferredSeconds: number;
  totalSeconds: number;
  ambiguousCount: number;
  blocks: number;
}

export interface TimeBreakdownResponse {
  generatedAt: string;
  period: {
    preset: TimeBreakdownPreset;
    from: string;
    to: string;
  };
  filters: TimeBreakdownFilters;
  totals: TimeBreakdownTotals;
  groups: TimeBreakdownGroup[];
  blocks: TimeBreakdownBlock[];
  clientSummary: string;
  markdown: string;
  csv: string;
}
