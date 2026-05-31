import { findTask as findTaskWithClient } from '@veritas-kanban/shared';
import type { Task } from './types.js';
import { api } from './api.js';

export function findTask(id: string): Promise<Task | null> {
  return findTaskWithClient(id, api);
}
