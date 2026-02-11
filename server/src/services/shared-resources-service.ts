import { createLogger } from '../lib/logger.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getRuntimeDir } from '../utils/paths.js';
import type {
  SharedResource,
  SharedResourceType,
  CreateSharedResourceInput,
  UpdateSharedResourceInput,
} from '@veritas-kanban/shared';

const log = createLogger('shared-resources');
const DATA_DIR = getRuntimeDir();

class SharedResourcesService {
  private resources: SharedResource[] = [];
  private loaded = false;

  private get storagePath(): string {
    return path.join(DATA_DIR, 'shared-resources.json');
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;

    try {
      const data = await fs.readFile(this.storagePath, 'utf-8');
      this.resources = JSON.parse(data) as SharedResource[];
    } catch {
      this.resources = [];
      await this.save();
    }

    this.loaded = true;
  }

  private async save(): Promise<void> {
    await fs.writeFile(this.storagePath, JSON.stringify(this.resources, null, 2));
  }

  private generateId(): string {
    return `shared_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  }

  async listResources(filters?: {
    type?: SharedResourceType;
    project?: string;
    tag?: string;
    name?: string;
  }): Promise<SharedResource[]> {
    await this.ensureLoaded();

    let results = [...this.resources];
    if (filters?.type) {
      results = results.filter((r) => r.type === filters.type);
    }
    if (filters?.project) {
      results = results.filter((r) => r.mountedIn.includes(filters.project as string));
    }
    if (filters?.tag) {
      results = results.filter((r) => r.tags.includes(filters.tag as string));
    }
    if (filters?.name) {
      const search = filters.name.toLowerCase();
      results = results.filter((r) => r.name.toLowerCase().includes(search));
    }

    return results.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getResource(id: string): Promise<SharedResource | null> {
    await this.ensureLoaded();
    return this.resources.find((r) => r.id === id) ?? null;
  }

  async createResource(input: CreateSharedResourceInput): Promise<SharedResource> {
    await this.ensureLoaded();

    const now = new Date().toISOString();
    const resource: SharedResource = {
      id: this.generateId(),
      name: input.name,
      type: input.type,
      content: input.content,
      tags: input.tags ?? [],
      mountedIn: input.mountedIn ?? [],
      createdAt: now,
      updatedAt: now,
      createdBy: input.createdBy,
      version: 1,
    };

    this.resources.push(resource);
    await this.save();
    return resource;
  }

  async updateResource(
    id: string,
    update: UpdateSharedResourceInput
  ): Promise<SharedResource | null> {
    await this.ensureLoaded();
    const resource = this.resources.find((r) => r.id === id);
    if (!resource) return null;

    Object.assign(resource, {
      name: update.name ?? resource.name,
      type: update.type ?? resource.type,
      content: update.content ?? resource.content,
      tags: update.tags ?? resource.tags,
      updatedAt: new Date().toISOString(),
      version: resource.version + 1,
    });

    await this.save();
    return resource;
  }

  async deleteResource(id: string): Promise<boolean> {
    await this.ensureLoaded();
    const before = this.resources.length;
    this.resources = this.resources.filter((r) => r.id !== id);
    if (this.resources.length === before) return false;
    await this.save();
    return true;
  }

  async mountResource(id: string, projectIds: string[]): Promise<SharedResource | null> {
    await this.ensureLoaded();
    const resource = this.resources.find((r) => r.id === id);
    if (!resource) return null;

    const before = new Set(resource.mountedIn);
    projectIds.forEach((projectId) => before.add(projectId));
    resource.mountedIn = Array.from(before);
    resource.updatedAt = new Date().toISOString();
    resource.version += 1;

    await this.save();
    return resource;
  }

  async unmountResource(id: string, projectIds: string[]): Promise<SharedResource | null> {
    await this.ensureLoaded();
    const resource = this.resources.find((r) => r.id === id);
    if (!resource) return null;

    const remove = new Set(projectIds);
    resource.mountedIn = resource.mountedIn.filter((projectId) => !remove.has(projectId));
    resource.updatedAt = new Date().toISOString();
    resource.version += 1;

    await this.save();
    return resource;
  }
}

let instance: SharedResourcesService | null = null;

export function getSharedResourcesService(): SharedResourcesService {
  if (!instance) {
    instance = new SharedResourcesService();
    log.info('Shared resources service initialized');
  }
  return instance;
}
