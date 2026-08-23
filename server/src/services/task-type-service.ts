import type { TaskTypeConfig } from '@veritas-kanban/shared';
import { ManagedListService } from './managed-list-service.js';
import { TaskService } from './task-service.js';
import { getRuntimeDir } from '../utils/paths.js';

const DEFAULT_TASK_TYPES: TaskTypeConfig[] = [
  {
    id: 'code',
    label: 'Code',
    icon: 'Code',
    color: 'border-l-violet-500',
    order: 0,
    isDefault: true,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  },
  {
    id: 'research',
    label: 'Research',
    icon: 'Search',
    color: 'border-l-cyan-500',
    order: 1,
    isDefault: true,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  },
  {
    id: 'content',
    label: 'Content',
    icon: 'FileText',
    color: 'border-l-orange-500',
    order: 2,
    isDefault: true,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  },
  {
    id: 'automation',
    label: 'Automation',
    icon: 'Zap',
    color: 'border-l-emerald-500',
    order: 3,
    isDefault: true,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  },
];

export class TaskTypeService extends ManagedListService<TaskTypeConfig> {
  private taskService: TaskService;

  constructor(taskService: TaskService) {
    const configDir = getRuntimeDir();

    super({
      filename: 'task-types.json',
      configDir,
      defaults: DEFAULT_TASK_TYPES,
      referenceCounter: async (typeId: string) => {
        // Count how many tasks use this type
        const tasks = await taskService.listTasks();
        return tasks.filter((task: any) => task.type === typeId).length;
      },
    });

    this.taskService = taskService;
  }
}
