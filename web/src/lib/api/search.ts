import { API_BASE, apiFetch } from './helpers';

export type SearchBackend = 'auto' | 'qmd' | 'keyword';
export type SearchCollection =
  | 'tasks-active'
  | 'tasks-archive'
  | 'tasks-backlog'
  | 'docs'
  | 'prompts'
  | 'work-products'
  | 'workflows'
  | 'workflow-runs'
  | 'policies'
  | 'decisions'
  | 'settings'
  | 'logs-diagnostics'
  | 'agent-runs'
  | 'notifications'
  | 'maintenance'
  | 'scheduled-runs';

export type SearchTarget =
  | {
      type: 'task';
      taskId: string;
      tab?: string;
      timelineAttemptId?: string;
      timelineEventId?: string;
      href?: string;
    }
  | {
      type: 'view';
      view: string;
      href?: string;
    }
  | {
      type: 'settings';
      section?: string;
      href?: string;
    }
  | {
      type: 'diagnostics';
      href?: string;
    }
  | {
      type: 'url';
      href: string;
    }
  | {
      type: 'none';
      disabledReason?: string;
    };

export interface SearchResultAction {
  id: string;
  label: string;
  target?: SearchTarget;
  disabledReason?: string;
}

export interface SearchRequest {
  query: string;
  limit?: number;
  collections?: SearchCollection[];
  backend?: SearchBackend;
  minScore?: number;
}

export interface SearchResult {
  id: string;
  title: string;
  path: string;
  collection: SearchCollection | string;
  snippet: string;
  score: number;
  metadata?: Record<string, unknown> & {
    target?: SearchTarget;
    actions?: SearchResultAction[];
  };
}

export interface SearchResponse {
  query: string;
  backend: 'qmd' | 'keyword';
  degraded: boolean;
  reason?: string;
  elapsedMs: number;
  results: SearchResult[];
}

export const searchApi = {
  query: async (input: SearchRequest): Promise<SearchResponse> => {
    return apiFetch<SearchResponse>(`${API_BASE}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  },
};
