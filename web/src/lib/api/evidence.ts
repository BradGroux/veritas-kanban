import type { EvidenceTimelineFilters, EvidenceTimelineResponse } from '@veritas-kanban/shared';
import { API_BASE, apiFetch } from './helpers';

function evidenceTimelineQuery(filters: EvidenceTimelineFilters = {}): string {
  const params = new URLSearchParams();
  if (filters.taskId) params.set('taskId', filters.taskId);
  if (filters.project) params.set('project', filters.project);
  if (filters.repo) params.set('repo', filters.repo);
  if (filters.cwd) params.set('cwd', filters.cwd);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.type) params.set('type', filters.type);
  if (filters.source) params.set('source', filters.source);
  if (filters.actor) params.set('actor', filters.actor);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.limit) params.set('limit', String(filters.limit));
  const query = params.toString();
  return `${API_BASE}/evidence/timeline${query ? `?${query}` : ''}`;
}

export const evidenceApi = {
  timeline: (filters: EvidenceTimelineFilters = {}): Promise<EvidenceTimelineResponse> =>
    apiFetch<EvidenceTimelineResponse>(evidenceTimelineQuery(filters)),
};

export type {
  EvidenceTimelineCitation,
  EvidenceTimelineEvent,
  EvidenceTimelineEventSource,
  EvidenceTimelineEventType,
  EvidenceTimelineFilters,
  EvidenceTimelineRecap,
  EvidenceTimelineResponse,
  EvidenceTimelineSourceLink,
} from '@veritas-kanban/shared';
