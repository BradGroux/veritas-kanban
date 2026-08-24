import path from 'node:path';
import type { AgentRunTrace } from '@veritas-kanban/shared';
import { ensureWithinBase, validatePathSegment } from '../utils/sanitize.js';
import { mkdir, readdir } from './fs-helpers.js';
import { JsonFileRepository } from './json-file-repository.js';

export class TraceFileRepository {
  constructor(private readonly tracesDir: string) {}

  ensureReady(): Promise<void> {
    return mkdir(this.tracesDir, { recursive: true }).then(() => undefined);
  }

  read(traceId: string): Promise<AgentRunTrace> {
    return this.repositoryFor(traceId).read();
  }

  async list(): Promise<AgentRunTrace[]> {
    let files: string[];
    try {
      files = await readdir(this.tracesDir);
    } catch {
      return [];
    }

    const traces: AgentRunTrace[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        traces.push(await this.repositoryFor(file.slice(0, -'.json'.length)).read());
      } catch {
        // Ignore invalid or concurrently removed trace files.
      }
    }
    return traces;
  }

  write(trace: AgentRunTrace): Promise<void> {
    return this.repositoryFor(trace.traceId).write(trace);
  }

  private repositoryFor(traceId: string): JsonFileRepository<AgentRunTrace> {
    validatePathSegment(traceId);
    const filePath = ensureWithinBase(this.tracesDir, path.join(this.tracesDir, `${traceId}.json`));
    return new JsonFileRepository(filePath);
  }
}
