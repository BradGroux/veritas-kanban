import { resolve } from 'path';
import type { SprintConfig } from '@veritas-kanban/shared';
import { ManagedListService } from './managed-list-service.js';
import { TaskService } from './task-service.js';
import { createLogger } from '../lib/logger.js';
const log = createLogger('sprint-service');

export class SprintService extends ManagedListService<SprintConfig> {
  private taskService: TaskService;
  private seeded = false;

  constructor(taskService: TaskService) {
    const configDir = resolve(process.cwd(), '..', '.veritas-kanban');

    super({
      filename: 'sprints.json',
      configDir,
      defaults: [],
      referenceCounter: async (sprintId: string) => {
        // Count how many tasks use this sprint
        const tasks = await taskService.listTasks();
        return tasks.filter((task: any) => task.sprint === sprintId).length;
      },
    });

    this.taskService = taskService;
  }

  /**
   * Initialize service and perform seed migration if needed
   */
  async init(): Promise<void> {
    // Prevent re-entrant init (list() calls init(), seed calls list())
    if (this.seeded) return;
    this.seeded = true;

    // Call parent init first
    await super.init();

    // Seed sprints from existing tasks on first run
    await this.seedSprintsFromTasks();
  }

  /**
   * Seed migration: scan all tasks and create SprintConfig entries for unique sprints
   */
  private async seedSprintsFromTasks(): Promise<void> {
    // Only seed if the file is empty or has no items
    const existingSprints = await this.list(true);
    if (existingSprints.length > 0) {
      return; // Already seeded
    }

    // Collect unique sprint strings from all tasks (active + archived)
    const [activeTasks, archivedTasks] = await Promise.all([
      this.taskService.listTasks(),
      this.taskService.listArchivedTasks(),
    ]);

    const allTasks = [...activeTasks, ...archivedTasks];
    const sprintStrings = new Set<string>();

    allTasks.forEach((task) => {
      if (task.sprint) {
        sprintStrings.add(task.sprint);
      }
    });

    // Create SprintConfig entries for each unique sprint
    // Use the raw sprint string as the ID for backward compatibility
    // (tasks store sprint as a plain string that must match the sprint ID)
    const sprintArray = Array.from(sprintStrings).sort();
    const now = new Date().toISOString();

    for (let i = 0; i < sprintArray.length; i++) {
      const sprintName = sprintArray[i];

      await this.seedItem({
        id: sprintName, // Must match existing task.sprint values
        label: sprintName,
        order: i,
        created: now,
        updated: now,
      } as SprintConfig);
    }

    log.info(`✅ Seeded ${sprintArray.length} sprints from existing tasks`);
  }
}
