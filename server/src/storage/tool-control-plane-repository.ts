import path from 'node:path';
import { z } from 'zod';
import type {
  RunToolCatalog,
  ToolServerDefinition,
  ToolServerDiscovery,
} from '@veritas-kanban/shared';
import {
  runToolCatalogSchema,
  toolServerDefinitionSchema,
  toolServerDiscoverySchema,
} from '../schemas/tool-control-plane-schemas.js';
import { withFileLock } from '../services/file-lock.js';
import { getRuntimeDir } from '../utils/paths.js';
import { ensureWithinBase } from '../utils/sanitize.js';
import { atomicWriteFile, fileExists, mkdir, readFile } from './fs-helpers.js';
import type { ToolControlPlaneRepository } from './interfaces.js';

const STATE_SCHEMA_VERSION = 'tool-control-plane-state/v1' as const;
const stateSchema = z
  .object({
    schemaVersion: z.literal(STATE_SCHEMA_VERSION),
    definitions: z.array(toolServerDefinitionSchema).max(500),
    discoveries: z.array(toolServerDiscoverySchema).max(5_000),
    catalogs: z.array(runToolCatalogSchema).max(20_000),
  })
  .strict();

interface ToolControlPlaneState {
  schemaVersion: typeof STATE_SCHEMA_VERSION;
  definitions: ToolServerDefinition[];
  discoveries: ToolServerDiscovery[];
  catalogs: RunToolCatalog[];
}

function emptyState(): ToolControlPlaneState {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    definitions: [],
    discoveries: [],
    catalogs: [],
  };
}

export class InMemoryToolControlPlaneRepository implements ToolControlPlaneRepository {
  private state = emptyState();

  async listDefinitions(): Promise<ToolServerDefinition[]> {
    return structuredClone(this.state.definitions);
  }

  async getDefinition(id: string): Promise<ToolServerDefinition | null> {
    return structuredClone(this.state.definitions.find((entry) => entry.id === id) ?? null);
  }

  async saveDefinition(definition: ToolServerDefinition): Promise<ToolServerDefinition> {
    const parsed = toolServerDefinitionSchema.parse(definition);
    this.state.definitions = [
      ...this.state.definitions.filter((entry) => entry.id !== parsed.id),
      parsed,
    ];
    return structuredClone(parsed);
  }

  async deleteDefinition(id: string): Promise<boolean> {
    const before = this.state.definitions.length;
    this.state.definitions = this.state.definitions.filter((entry) => entry.id !== id);
    return this.state.definitions.length !== before;
  }

  async getDiscovery(definitionDigest: string): Promise<ToolServerDiscovery | null> {
    return structuredClone(
      this.state.discoveries.find((entry) => entry.definitionDigest === definitionDigest) ?? null
    );
  }

  async saveDiscovery(discovery: ToolServerDiscovery): Promise<ToolServerDiscovery> {
    const parsed = toolServerDiscoverySchema.parse(discovery);
    this.state.discoveries = [
      ...this.state.discoveries.filter(
        (entry) => entry.definitionDigest !== parsed.definitionDigest
      ),
      parsed,
    ];
    return structuredClone(parsed);
  }

  async getRunCatalog(taskId: string, attemptId: string): Promise<RunToolCatalog | null> {
    return structuredClone(
      this.state.catalogs.find(
        (entry) => entry.taskId === taskId && entry.attemptId === attemptId
      ) ?? null
    );
  }

  async saveRunCatalog(catalog: RunToolCatalog): Promise<RunToolCatalog> {
    const parsed = runToolCatalogSchema.parse(catalog);
    const existing = this.state.catalogs.find(
      (entry) => entry.taskId === parsed.taskId && entry.attemptId === parsed.attemptId
    );
    if (existing && existing.digest !== parsed.digest) {
      throw new Error('Run tool catalog identity was reused with changed evidence.');
    }
    this.state.catalogs = [
      ...this.state.catalogs.filter(
        (entry) => entry.taskId !== parsed.taskId || entry.attemptId !== parsed.attemptId
      ),
      parsed,
    ];
    return structuredClone(parsed);
  }
}

export class FileToolControlPlaneRepository implements ToolControlPlaneRepository {
  private readonly statePath: string;

  constructor(statePath = path.join(getRuntimeDir(), 'tool-control-plane', 'state.json')) {
    this.statePath = statePath;
    ensureWithinBase(path.dirname(statePath), statePath);
  }

  async listDefinitions(): Promise<ToolServerDefinition[]> {
    return structuredClone((await this.read()).definitions);
  }

  async getDefinition(id: string): Promise<ToolServerDefinition | null> {
    return structuredClone(
      (await this.read()).definitions.find((entry) => entry.id === id) ?? null
    );
  }

  async saveDefinition(definition: ToolServerDefinition): Promise<ToolServerDefinition> {
    const parsed = toolServerDefinitionSchema.parse(definition);
    return this.mutate((state) => {
      state.definitions = [...state.definitions.filter((entry) => entry.id !== parsed.id), parsed];
      return parsed;
    });
  }

  async deleteDefinition(id: string): Promise<boolean> {
    return this.mutate((state) => {
      const before = state.definitions.length;
      state.definitions = state.definitions.filter((entry) => entry.id !== id);
      return state.definitions.length !== before;
    });
  }

  async getDiscovery(definitionDigest: string): Promise<ToolServerDiscovery | null> {
    return structuredClone(
      (await this.read()).discoveries.find(
        (entry) => entry.definitionDigest === definitionDigest
      ) ?? null
    );
  }

  async saveDiscovery(discovery: ToolServerDiscovery): Promise<ToolServerDiscovery> {
    const parsed = toolServerDiscoverySchema.parse(discovery);
    return this.mutate((state) => {
      state.discoveries = [
        ...state.discoveries.filter((entry) => entry.definitionDigest !== parsed.definitionDigest),
        parsed,
      ];
      return parsed;
    });
  }

  async getRunCatalog(taskId: string, attemptId: string): Promise<RunToolCatalog | null> {
    return structuredClone(
      (await this.read()).catalogs.find(
        (entry) => entry.taskId === taskId && entry.attemptId === attemptId
      ) ?? null
    );
  }

  async saveRunCatalog(catalog: RunToolCatalog): Promise<RunToolCatalog> {
    const parsed = runToolCatalogSchema.parse(catalog);
    return this.mutate((state) => {
      const existing = state.catalogs.find(
        (entry) => entry.taskId === parsed.taskId && entry.attemptId === parsed.attemptId
      );
      if (existing && existing.digest !== parsed.digest) {
        throw new Error('Run tool catalog identity was reused with changed evidence.');
      }
      state.catalogs = [
        ...state.catalogs.filter(
          (entry) => entry.taskId !== parsed.taskId || entry.attemptId !== parsed.attemptId
        ),
        parsed,
      ];
      return parsed;
    });
  }

  private async read(): Promise<ToolControlPlaneState> {
    if (!(await fileExists(this.statePath))) return emptyState();
    return stateSchema.parse(JSON.parse(await readFile(this.statePath, 'utf8')));
  }

  private async mutate<T>(operation: (state: ToolControlPlaneState) => T): Promise<T> {
    await mkdir(path.dirname(this.statePath), { recursive: true });
    return withFileLock(this.statePath, async () => {
      const state = await this.read();
      const result = operation(state);
      const normalized = stateSchema.parse(state);
      await atomicWriteFile(this.statePath, `${JSON.stringify(normalized, null, 2)}\n`);
      return structuredClone(result);
    });
  }
}
