import { API_BASE, apiFetch } from './helpers';

export type DeliverableSchedule = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'custom';
export type DeliverableRunStatus = 'success' | 'failed' | 'skipped';

export interface ScheduledDeliverable {
  id: string;
  name: string;
  description: string;
  schedule: DeliverableSchedule;
  cronExpr?: string;
  scheduleDescription: string;
  enabled: boolean;
  agent?: string;
  outputPath?: string;
  tags: string[];
  createdAt: string;
  lastRunAt?: string;
  nextRunAt?: string;
  totalRuns: number;
}

export interface ScheduledDeliverableRunSnapshot {
  status: DeliverableRunStatus;
  capturedAt: string;
  sourceRunId?: string;
  workflowId?: string;
  outputFile?: string;
  summary?: string;
  durationMs?: number;
  error?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface ScheduledDeliverableRun {
  id: string;
  deliverableId: string;
  status: DeliverableRunStatus;
  outputFile?: string;
  summary?: string;
  durationMs?: number;
  error?: string;
  sourceRunId?: string;
  workflowId?: string;
  snapshot?: ScheduledDeliverableRunSnapshot;
  runAt: string;
}

export interface ScheduledDeliverableCreateInput {
  name: string;
  description: string;
  schedule: DeliverableSchedule;
  cronExpr?: string;
  scheduleDescription?: string;
  agent?: string;
  outputPath?: string;
  tags?: string[];
  enabled?: boolean;
}

export interface ScheduledDeliverableRunInput {
  status: DeliverableRunStatus;
  outputFile?: string;
  summary?: string;
  durationMs?: number;
  error?: string;
  sourceRunId?: string;
  workflowId?: string;
  snapshotMetadata?: Record<string, string | number | boolean | null>;
}

export const scheduledDeliverablesApi = {
  list: (filters: { enabled?: boolean; agent?: string; tag?: string } = {}) => {
    const params = new URLSearchParams();
    if (typeof filters.enabled === 'boolean') params.set('enabled', String(filters.enabled));
    if (filters.agent) params.set('agent', filters.agent);
    if (filters.tag) params.set('tag', filters.tag);
    const query = params.toString();
    return apiFetch<ScheduledDeliverable[]>(`${API_BASE}/deliverables${query ? `?${query}` : ''}`);
  },

  create: (input: ScheduledDeliverableCreateInput) =>
    apiFetch<ScheduledDeliverable>(`${API_BASE}/deliverables`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),

  recordRun: (deliverableId: string, input: ScheduledDeliverableRunInput) =>
    apiFetch<ScheduledDeliverableRun>(
      `${API_BASE}/deliverables/${encodeURIComponent(deliverableId)}/runs`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }
    ),
};
