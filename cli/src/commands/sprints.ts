import { Command } from 'commander';
import chalk from 'chalk';
import { api } from '../utils/api.js';
import type { Task } from '../utils/types.js';

interface Sprint {
  id: string;
  label: string;
  description?: string;
  order: number;
  isHidden?: boolean;
  created: string;
  updated: string;
}

interface ArchiveSuggestion {
  sprint: string;
  taskCount: number;
  tasks: Task[];
}

interface ArchiveResult {
  archived: number;
  taskIds: string[];
}

export function registerSprintCommands(program: Command): void {
  const sprint = program.command('sprint').description('Sprint management commands');

  // List sprints
  sprint
    .command('list')
    .alias('ls')
    .description('List all sprints')
    .option('--hidden', 'Include hidden sprints')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const params = new URLSearchParams();
        if (options.hidden) params.append('includeHidden', 'true');

        const url = `/api/sprints${params.toString() ? `?${params.toString()}` : ''}`;
        const sprints = await api<Sprint[]>(url);

        if (options.json) {
          console.log(JSON.stringify(sprints, null, 2));
        } else if (sprints.length === 0) {
          console.log(chalk.dim('No sprints found'));
        } else {
          console.log(chalk.bold('\nSprints\n'));
          console.log(chalk.dim('-'.repeat(50)));
          sprints.forEach((s) => {
            let line = `  ${chalk.cyan(s.label)}`;
            if (s.isHidden) {
              line += chalk.dim(' [hidden]');
            }
            console.log(line);
            if (s.description) {
              console.log(chalk.dim(`    ${s.description}`));
            }
          });
          console.log(chalk.dim('-'.repeat(50)));
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // Create sprint
  sprint
    .command('create <label>')
    .description('Create a new sprint')
    .option('-d, --description <desc>', 'Sprint description')
    .option('--json', 'Output as JSON')
    .action(async (label, options) => {
      try {
        const body: Record<string, string> = { label };
        if (options.description) body.description = options.description;

        const result = await api<Sprint>('/api/sprints', {
          method: 'POST',
          body: JSON.stringify(body),
        });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(chalk.green(`✓ Sprint created: ${label}`));
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // Update sprint
  sprint
    .command('update <id>')
    .description('Update a sprint')
    .option('-l, --label <label>', 'New sprint name')
    .option('-d, --description <desc>', 'Sprint description')
    .option('--hide', 'Hide sprint from listings')
    .option('--show', 'Show hidden sprint')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        const body: Record<string, unknown> = {};
        if (options.label) body.label = options.label;
        if (options.description) body.description = options.description;
        if (options.hide) body.isHidden = true;
        if (options.show) body.isHidden = false;

        if (Object.keys(body).length === 0) {
          console.error(chalk.red('Error: No update options provided'));
          process.exit(1);
        }

        const result = await api<Sprint>(`/api/sprints/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(chalk.green(`✓ Sprint updated: ${result.label}`));
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // Delete sprint
  sprint
    .command('delete <id>')
    .alias('rm')
    .description('Delete a sprint')
    .option('-y, --yes', 'Skip confirmation')
    .option('-f, --force', 'Force delete even if tasks reference this sprint')
    .action(async (id, options) => {
      try {
        if (!options.yes) {
          const readline = await import('node:readline/promises');
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });
          const answer = await rl.question('Are you sure you want to delete this sprint? (y/N) ');
          rl.close();
          if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
            console.log('Cancelled');
            return;
          }
        }

        const params = new URLSearchParams();
        if (options.force) params.append('force', 'true');

        const url = `/api/sprints/${id}${params.toString() ? `?${params.toString()}` : ''}`;
        await api(url, { method: 'DELETE' });
        console.log(chalk.green('✓ Sprint deleted'));
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // Show sprints ready to archive
  sprint
    .command('suggestions')
    .description('Show sprints ready to archive (all tasks done)')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const suggestions = await api<ArchiveSuggestion[]>('/api/tasks/archive/suggestions');

        if (options.json) {
          console.log(JSON.stringify(suggestions, null, 2));
        } else if (suggestions.length === 0) {
          console.log(chalk.dim('No sprints ready to archive'));
        } else {
          console.log(chalk.bold('\nSprints Ready to Archive\n'));
          console.log(chalk.dim('-'.repeat(50)));
          suggestions.forEach((s) => {
            console.log(`  ${chalk.cyan(s.sprint)}`);
            console.log(chalk.dim(`    ${s.taskCount} task(s) completed, ready to close`));
          });
          console.log(chalk.dim('-'.repeat(50)));
          console.log(chalk.dim(`\nUse 'vk sprint close <id>' to archive tasks`));
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // Close sprint (archive all done tasks)
  sprint
    .command('close <id>')
    .description('Archive all done tasks in a sprint')
    .option('-y, --yes', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        if (!options.yes) {
          const readline = await import('node:readline/promises');
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });
          const answer = await rl.question(
            `Are you sure you want to archive all done tasks in sprint "${id}"? (y/N) `
          );
          rl.close();
          if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
            console.log('Cancelled');
            return;
          }
        }

        const result = await api<ArchiveResult>(`/api/tasks/archive/sprint/${id}`, {
          method: 'POST',
        });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(chalk.green(`✓ Archived ${result.archived} task(s) from sprint "${id}"`));
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });
}
