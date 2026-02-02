import { Command } from 'commander';
import chalk from 'chalk';
import { api } from '../utils/api.js';
import { formatTask, formatTaskJson, formatTasksJson } from '../utils/format.js';
import type { Task } from '../utils/types.js';

export function registerBacklogCommands(program: Command): void {
  const backlog = program.command('backlog').description('Manage backlog tasks');

  // List backlog tasks
  backlog
    .command('list')
    .alias('ls')
    .description('List backlog tasks')
    .option('-p, --project <project>', 'Filter by project')
    .option('-t, --type <type>', 'Filter by type')
    .option('-s, --search <query>', 'Search by keyword')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const params = new URLSearchParams();
        if (options.project) params.append('project', options.project);
        if (options.type) params.append('type', options.type);
        if (options.search) params.append('search', options.search);

        const url = `/api/backlog${params.toString() ? `?${params.toString()}` : ''}`;
        const tasks = await api<Task[]>(url);

        if (options.json) {
          console.log(formatTasksJson(tasks));
        } else if (tasks.length === 0) {
          console.log(chalk.dim('No tasks in backlog'));
        } else {
          console.log(chalk.bold(`\nBacklog (${tasks.length} tasks):\n`));
          tasks.forEach((task) => console.log(formatTask(task)));
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // Add task to backlog
  backlog
    .command('add <title>')
    .description('Create a new task directly in backlog')
    .option('-t, --type <type>', 'Task type', 'task')
    .option('-p, --project <project>', 'Project name')
    .option('-d, --description <desc>', 'Task description')
    .option('--priority <priority>', 'Priority (low, medium, high)', 'medium')
    .option('--json', 'Output as JSON')
    .action(async (title, options) => {
      try {
        const task = await api<Task>('/api/backlog', {
          method: 'POST',
          body: JSON.stringify({
            title,
            type: options.type,
            project: options.project,
            description: options.description,
            priority: options.priority,
          }),
        });

        if (options.json) {
          console.log(formatTaskJson(task));
        } else {
          console.log(chalk.green('✓ Task added to backlog'));
          console.log(formatTask(task, true));
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // Promote task to active board
  backlog
    .command('promote <id>')
    .description('Move a backlog task to the active board')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        const task = await api<Task>(`/api/backlog/${id}/promote`, {
          method: 'POST',
        });

        if (options.json) {
          console.log(formatTaskJson(task));
        } else {
          console.log(chalk.green('✓ Task promoted to active board'));
          console.log(formatTask(task, true));
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // Demote active task to backlog
  backlog
    .command('demote <id>')
    .description('Move an active task to the backlog')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        const task = await api<Task>(`/api/tasks/${id}/demote`, {
          method: 'POST',
        });

        if (options.json) {
          console.log(formatTaskJson(task));
        } else {
          console.log(chalk.green('✓ Task moved to backlog'));
          console.log(formatTask(task, true));
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // Delete backlog task
  backlog
    .command('delete <id>')
    .alias('rm')
    .description('Delete a task from backlog')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (id, options) => {
      try {
        if (!options.yes) {
          const readline = await import('node:readline/promises');
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });
          const answer = await rl.question('Are you sure you want to delete this task? (y/N) ');
          rl.close();
          if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
            console.log('Cancelled');
            return;
          }
        }

        await api(`/api/backlog/${id}`, { method: 'DELETE' });
        console.log(chalk.green('✓ Task deleted from backlog'));
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // Show backlog count
  backlog
    .command('count')
    .description('Show number of tasks in backlog')
    .action(async () => {
      try {
        const data = await api<{ count: number }>('/api/backlog/count');
        console.log(chalk.bold(`Backlog: ${data.count} tasks`));
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });
}
