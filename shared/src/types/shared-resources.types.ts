// Shared Resource Types

export type SharedResourceType = 'prompt' | 'guideline' | 'skill' | 'config' | 'template';

export interface SharedResource {
  id: string;
  name: string;
  type: SharedResourceType;
  content: string; // markdown content
  tags: string[];
  mountedIn: string[]; // project IDs where this is mounted
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  version: number;
}

export interface CreateSharedResourceInput {
  name: string;
  type: SharedResourceType;
  content: string;
  tags?: string[];
  mountedIn?: string[];
  createdBy?: string;
}

export interface UpdateSharedResourceInput {
  name?: string;
  type?: SharedResourceType;
  content?: string;
  tags?: string[];
}

export interface SharedResourceMountInput {
  projectIds: string[];
}
