import { createLogger } from '../lib/logger.js';
import { getSearchService, type SearchResult } from './search-service.js';

const log = createLogger('veritas-context-service');

export interface VeritasContextRequest {
  message: string;
  taskId?: string;
  limit?: number;
}

export interface VeritasContextResponse {
  query: string;
  contextBlock: string;
  results: SearchResult[];
  degraded: boolean;
  reason?: string;
}

const DEFAULT_LIMIT = 4;
const MAX_SNIPPET_LENGTH = 280;

export class VeritasContextService {
  async buildContext(request: VeritasContextRequest): Promise<VeritasContextResponse> {
    const query = [request.taskId, request.message].filter(Boolean).join(' ').trim();
    const limit = Math.min(Math.max(request.limit ?? DEFAULT_LIMIT, 1), 8);

    if (!query) {
      return {
        query,
        contextBlock: '',
        results: [],
        degraded: false,
      };
    }

    try {
      const response = await getSearchService().search({
        query,
        backend: 'auto',
        collections: ['tasks-active', 'tasks-archive', 'docs'],
        limit,
      });

      const results = response.results.slice(0, limit);
      return {
        query,
        results,
        degraded: response.degraded,
        reason: response.reason,
        contextBlock: this.formatContextBlock(results, response.degraded, response.reason),
      };
    } catch (err) {
      log.warn({ err }, 'Failed to build VERITAS retrieval context');
      return {
        query,
        contextBlock: '',
        results: [],
        degraded: true,
        reason: err instanceof Error ? err.message : 'Context retrieval failed',
      };
    }
  }

  private formatContextBlock(results: SearchResult[], degraded: boolean, reason?: string): string {
    if (results.length === 0) return '';

    const lines = [
      '<veritas_context>',
      'Relevant project context retrieved from tasks and docs. Use as supporting context only; cite paths when relying on it.',
    ];

    if (degraded) {
      lines.push(`Retrieval fallback: ${reason || 'keyword search used'}.`);
    }

    results.forEach((result, index) => {
      const snippet = result.snippet.replace(/\s+/g, ' ').trim().slice(0, MAX_SNIPPET_LENGTH);
      lines.push(
        `${index + 1}. [${result.collection}] ${result.title} (${result.path}, score ${Number(
          result.score
        ).toFixed(2)})`
      );
      if (snippet) {
        lines.push(`   ${snippet}`);
      }
    });

    lines.push('</veritas_context>');
    return lines.join('\n');
  }
}

let instance: VeritasContextService | null = null;

export function getVeritasContextService(): VeritasContextService {
  if (!instance) {
    instance = new VeritasContextService();
  }
  return instance;
}
