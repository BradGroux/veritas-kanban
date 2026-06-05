import type { TimeBreakdownFilters, TimeBreakdownResponse } from '@veritas-kanban/shared';
import { API_BASE, apiFetch } from './helpers';

function timeBreakdownQuery(filters: TimeBreakdownFilters = {}): string {
  const params = new URLSearchParams();
  if (filters.preset) params.set('preset', filters.preset);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.taskId) params.set('taskId', filters.taskId);
  if (filters.project) params.set('project', filters.project);
  if (filters.repo) params.set('repo', filters.repo);
  if (filters.cwd) params.set('cwd', filters.cwd);
  if (filters.actor) params.set('actor', filters.actor);
  if (typeof filters.includeInferred === 'boolean') {
    params.set('includeInferred', String(filters.includeInferred));
  }
  if (filters.limit) params.set('limit', String(filters.limit));
  const query = params.toString();
  return `${API_BASE}/time-breakdowns${query ? `?${query}` : ''}`;
}

export const timeBreakdownsApi = {
  generate: (filters: TimeBreakdownFilters = {}): Promise<TimeBreakdownResponse> =>
    apiFetch<TimeBreakdownResponse>(timeBreakdownQuery(filters)),
};

export type {
  TimeBreakdownBlock,
  TimeBreakdownBlockKind,
  TimeBreakdownConfidence,
  TimeBreakdownFilters,
  TimeBreakdownGroup,
  TimeBreakdownPreset,
  TimeBreakdownResponse,
  TimeBreakdownSource,
  TimeBreakdownTotals,
} from '@veritas-kanban/shared';
