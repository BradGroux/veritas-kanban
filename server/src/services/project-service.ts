import { resolve } from 'path';
import type { ProjectConfig } from '@veritas-kanban/shared';
import { ManagedListService } from './managed-list-service.js';
import { TaskService } from './task-service.js';
import { createLogger } from '../lib/logger.js';
const log = createLogger('project-service');

// Color palette for auto-seeded projects
const PROJECT_COLORS = [
  'bg-blue-500/20',
  'bg-green-500/20',
  'bg-purple-500/20',
  'bg-orange-500/20',
  'bg-pink-500/20',
  'bg-cyan-500/20',
  'bg-amber-500/20',
  'bg-rose-500/20',
  'bg-indigo-500/20',
  'bg-teal-500/20',
];

export class ProjectService extends ManagedListService<ProjectConfig> {
  private taskService: TaskService;
  private seeded = false;

  constructor(taskService: TaskService) {
    const configDir = resolve(process.cwd(), '..', '.veritas-kanban');

    super({
      filename: 'projects.json',
      configDir,
      defaults: [],
      referenceCounter: async (projectId: string) => {
        // Count how many tasks use this project
        const tasks = await taskService.listTasks();
        return tasks.filter((task: any) => task.project === projectId).length;
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

    // Seed projects from existing tasks on first run
    await this.seedProjectsFromTasks();
  }

  /**
   * Seed migration: scan all tasks and create ProjectConfig entries for unique projects
   */
  private async seedProjectsFromTasks(): Promise<void> {
    // Only seed if the file is empty or has no items
    const existingProjects = await this.list(true);
    if (existingProjects.length > 0) {
      return; // Already seeded
    }

    // Collect unique project strings from all tasks (active + archived)
    const [activeTasks, archivedTasks] = await Promise.all([
      this.taskService.listTasks(),
      this.taskService.listArchivedTasks(),
    ]);

    const allTasks = [...activeTasks, ...archivedTasks];
    const projectStrings = new Set<string>();

    allTasks.forEach((task) => {
      if (task.project) {
        projectStrings.add(task.project);
      }
    });

    // Create ProjectConfig entries for each unique project
    // Use the raw project string as the ID for backward compatibility
    // (tasks store project as a plain string that must match the project ID)
    const projectArray = Array.from(projectStrings).sort();
    const now = new Date().toISOString();

    for (let i = 0; i < projectArray.length; i++) {
      const projectName = projectArray[i];
      const color = PROJECT_COLORS[i % PROJECT_COLORS.length];

      await this.seedItem({
        id: projectName, // Must match existing task.project values
        label: projectName,
        color,
        order: i,
        created: now,
        updated: now,
      } as ProjectConfig);
    }

    log.info(`✅ Seeded ${projectArray.length} projects from existing tasks`);
  }
}
