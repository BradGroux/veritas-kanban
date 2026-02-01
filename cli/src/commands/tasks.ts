import { Command } from 'commander';
import chalk from 'chalk';
import { api } from '../utils/api.js';
import { findTask } from '../utils/find.js';
import { formatTask, formatTaskJson, formatTasksJson } from '../utils/format.js';
import type { Task } from '../utils/types.js';

export function registerTaskCommands(program: Command): void {
  // List tasks
  program
    .command('list')
    .alias('ls')
    .description('List tasks')
    .option(
      '-s, --status <status>',
      'Filter by status (todo, planning, in-progress, blocked, done)'
    )
    .option('-t, --type <type>', 'Filter by type (code, research, content, automation)')
    .option('-p, --project <project>', 'Filter by project')
    .option('-v, --verbose', 'Show more details')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const tasks = await api<Task[]>('/api/tasks');

        let filtered = tasks;
        if (options.status) {
          filtered = filtered.filter((t) => t.status === options.status);
        }
        if (options.type) {
          filtered = filtered.filter((t) => t.type === options.type);
        }
        if (options.project) {
          filtered = filtered.filter((t) => t.project === options.project);
        }

        if (options.json) {
          console.log(formatTasksJson(filtered));
        } else if (filtered.length === 0) {
          console.log(chalk.dim('No tasks found'));
        } else {
          filtered.forEach((task) => console.log(formatTask(task, options.verbose)));
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // Show task details
  program
    .command('show <id>')
    .description('Show task details')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        const task = await findTask(id);

        if (!task) {
          console.error(chalk.red(`Task not found: ${id}`));
          process.exit(1);
        }

        if (options.json) {
          console.log(formatTaskJson(task));
        } else {
          console.log(formatTask(task, true));
          console.log(chalk.dim('─'.repeat(60)));
          console.log(chalk.dim(`ID: ${task.id}`));
          console.log(chalk.dim(`Created: ${new Date(task.created).toLocaleString()}`));
          console.log(chalk.dim(`Updated: ${new Date(task.updated).toLocaleString()}`));
          // Tags feature not yet implemented in shared types
          // if (task.tags?.length) {
          //   console.log(chalk.dim(`Tags: ${task.tags.join(', ')}`));
          // }
          if (task.description) {
            console.log('\n' + task.description);
          }
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // Create task
  program
    .command('create <title>')
    .description('Create a new task')
    .option('-t, --type <type>', 'Task type (code, research, content, automation)', 'code')
    .option('-p, --project <project>', 'Project name')
    .option('-d, --description <desc>', 'Task description')
    .option('--priority <priority>', 'Priority (low, medium, high)', 'medium')
    .option('--json', 'Output as JSON')
    .action(async (title, options) => {
      try {
        const task = await api<Task>('/api/tasks', {
          method: 'POST',
          body: JSON.stringify({
            title,
            type: options.type,
            project: options.project,
            description: options.description || '',
            priority: options.priority,
          }),
        });

        if (options.json) {
          console.log(formatTaskJson(task));
        } else {
          console.log(chalk.green('✓ Task created'));
          console.log(formatTask(task, true));
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // Update task
  program
    .command('update <id>')
    .description('Update a task')
    .option('-s, --status <status>', 'New status')
    .option('-t, --type <type>', 'New type')
    .option('-p, --project <project>', 'New project')
    .option('--priority <priority>', 'New priority')
    .option('--title <title>', 'New title')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        const existing = await findTask(id);

        if (!existing) {
          console.error(chalk.red(`Task not found: ${id}`));
          process.exit(1);
        }

        const updates: Record<string, unknown> = {};
        if (options.status) updates.status = options.status;
        if (options.type) updates.type = options.type;
        if (options.project) updates.project = options.project;
        if (options.priority) updates.priority = options.priority;
        if (options.title) updates.title = options.title;

        if (Object.keys(updates).length === 0) {
          console.error(chalk.yellow('No updates specified'));
          process.exit(1);
        }

        const task = await api<Task>(`/api/tasks/${existing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(updates),
        });

        if (options.json) {
          console.log(formatTaskJson(task));
        } else {
          console.log(chalk.green('✓ Task updated'));
          console.log(formatTask(task, true));
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // Archive task
  program
    .command('archive <id>')
    .description('Archive a completed task')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        const task = await findTask(id);

        if (!task) {
          console.error(chalk.red(`Task not found: ${id}`));
          process.exit(1);
        }

        await api(`/api/tasks/${task.id}/archive`, { method: 'POST' });

        if (options.json) {
          console.log(JSON.stringify({ archived: true }));
        } else {
          console.log(chalk.green('✓ Task archived'));
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // Delete task
  program
    .command('delete <id>')
    .description('Delete a task')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        const task = await findTask(id);

        if (!task) {
          console.error(chalk.red(`Task not found: ${id}`));
          process.exit(1);
        }

        await api(`/api/tasks/${task.id}`, { method: 'DELETE' });

        if (options.json) {
          console.log(JSON.stringify({ deleted: true }));
        } else {
          console.log(chalk.green('✓ Task deleted'));
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });
}
