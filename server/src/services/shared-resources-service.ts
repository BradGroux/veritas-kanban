import { createLogger } from '../lib/logger.js';
import type {
  SharedResource,
  SharedResourceType,
  CreateSharedResourceInput,
  UpdateSharedResourceInput,
} from '@veritas-kanban/shared';
import type { SharedResourceRepository } from '../storage/interfaces.js';
import { FileSharedResourceRepository } from '../storage/shared-resource-repository.js';

const log = createLogger('shared-resources');

export class SharedResourcesService {
  constructor(
    private readonly repository: SharedResourceRepository = new FileSharedResourceRepository()
  ) {}

  private generateId(): string {
    return `shared_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  }

  async listResources(filters?: {
    type?: SharedResourceType;
    project?: string;
    tag?: string;
    name?: string;
  }): Promise<SharedResource[]> {
    let results = [...(await this.repository.read())];
    if (filters?.type) results = results.filter((resource) => resource.type === filters.type);
    if (filters?.project)
      results = results.filter((resource) =>
        resource.mountedIn.includes(filters.project as string)
      );
    if (filters?.tag)
      results = results.filter((resource) => resource.tags.includes(filters.tag as string));
    if (filters?.name) {
      const search = filters.name.toLowerCase();
      results = results.filter((resource) => resource.name.toLowerCase().includes(search));
    }
    return results.sort((left, right) => left.name.localeCompare(right.name));
  }

  async getResource(id: string): Promise<SharedResource | null> {
    return (await this.repository.read()).find((resource) => resource.id === id) ?? null;
  }

  createResource(input: CreateSharedResourceInput): Promise<SharedResource> {
    return this.repository.mutate<SharedResource>((resources) => {
      const now = new Date().toISOString();
      const resource: SharedResource = {
        id: this.generateId(),
        name: input.name,
        type: input.type,
        content: input.content,
        tags: [...(input.tags ?? [])],
        mountedIn: [...(input.mountedIn ?? [])],
        createdAt: now,
        updatedAt: now,
        createdBy: input.createdBy,
        version: 1,
      };
      return { resources: [...resources, resource], result: resource, changed: true };
    });
  }

  updateResource(id: string, update: UpdateSharedResourceInput): Promise<SharedResource | null> {
    return this.changeResource(id, (resource) => ({
      ...resource,
      name: update.name ?? resource.name,
      type: update.type ?? resource.type,
      content: update.content ?? resource.content,
      tags: update.tags ?? resource.tags,
    }));
  }

  deleteResource(id: string): Promise<boolean> {
    return this.repository.mutate<boolean>((resources) => {
      const next = resources.filter((resource) => resource.id !== id);
      const changed = next.length !== resources.length;
      return { resources: next, result: changed, changed };
    });
  }

  mountResource(id: string, projectIds: string[]): Promise<SharedResource | null> {
    return this.changeResource(id, (resource) => ({
      ...resource,
      mountedIn: Array.from(new Set([...resource.mountedIn, ...projectIds])),
    }));
  }

  unmountResource(id: string, projectIds: string[]): Promise<SharedResource | null> {
    const remove = new Set(projectIds);
    return this.changeResource(id, (resource) => ({
      ...resource,
      mountedIn: resource.mountedIn.filter((projectId) => !remove.has(projectId)),
    }));
  }

  private changeResource(
    id: string,
    change: (resource: SharedResource) => SharedResource
  ): Promise<SharedResource | null> {
    return this.repository.mutate<SharedResource | null>((resources) => {
      const index = resources.findIndex((resource) => resource.id === id);
      if (index === -1) return { resources, result: null, changed: false };
      const current = resources[index];
      const resource = {
        ...change(current),
        updatedAt: new Date().toISOString(),
        version: current.version + 1,
      };
      const next = [...resources];
      next[index] = resource;
      return { resources: next, result: resource, changed: true };
    });
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
