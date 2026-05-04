import { Command } from 'commander';
import chalk from 'chalk';
import { api, API_BASE } from '../utils/api.js';

interface HealthResponse {
  ok: boolean;
  version: string;
  uptimeMs: number;
}

interface TaskResponse {
  id: string;
  title: string;
  status: string;
}

export function registerSetupCommands(program: Command): void {
  program
    .command('setup')
    .description('Guided setup wizard for Veritas Kanban')
    .option('--skip-task', 'Skip creating the sample task')
    .option('--json', 'Output results as JSON')
    .action(async (options) => {
      const results: {
        step: string;
        status: 'pass' | 'fail' | 'skip';
        message: string;
        details?: unknown;
      }[] = [];

      if (!options.json) {
        console.log(chalk.bold('\n🚀 Veritas Kanban Setup Wizard\n'));
        console.log(chalk.dim('Checking your environment...\n'));
      }

      // Step 1: Check Node version
      const nodeVersion = process.version;
      const nodeMajor = parseInt(nodeVersion.slice(1).split('.')[0], 10);
      if (nodeMajor >= 22) {
        results.push({
          step: 'node',
          status: 'pass',
          message: `Node.js ${nodeVersion}`,
        });
        if (!options.json) console.log(chalk.green(`✓ Node.js ${nodeVersion}`));
      } else {
        results.push({
          step: 'node',
          status: 'fail',
          message: `Node.js ${nodeVersion} (requires >=22)`,
        });
        if (!options.json)
          console.log(chalk.red(`✗ Node.js ${nodeVersion} — requires v22 or higher`));
      }

      // Step 2: Check if server is running
      let serverRunning = false;
      let serverVersion = '';
      try {
        const health = await api<HealthResponse>('/api/health');
        serverRunning = health.ok;
        serverVersion = health.version;
        results.push({
          step: 'server',
          status: 'pass',
          message: `Server running (v${serverVersion})`,
          details: health,
        });
        if (!options.json)
          console.log(chalk.green(`✓ Server running at ${API_BASE} (v${serverVersion})`));
      } catch {
        results.push({
          step: 'server',
          status: 'fail',
          message: `Server not reachable at ${API_BASE}`,
        });
        if (!options.json) {
          console.log(chalk.red(`✗ Server not reachable at ${API_BASE}`));
          console.log(chalk.dim('  Run: pnpm dev'));
        }
      }

      // Step 3: Check API authentication
      if (serverRunning) {
        try {
          const tasks = await api<TaskResponse[]>('/api/tasks');
          results.push({
            step: 'auth',
            status: 'pass',
            message: `API accessible (${tasks.length} tasks)`,
          });
          if (!options.json)
            console.log(chalk.green(`✓ API accessible (${tasks.length} tasks on board)`));
        } catch (err) {
          const message = (err as Error).message;
          if (message.includes('401') || message.includes('auth')) {
            results.push({
              step: 'auth',
              status: 'fail',
              message: 'Authentication required',
            });
            if (!options.json) {
              console.log(chalk.red('✗ Authentication required'));
              console.log(chalk.dim('  Set VERITAS_ADMIN_KEY or enable localhost bypass'));
            }
          } else {
            results.push({
              step: 'auth',
              status: 'fail',
              message: `API error: ${message}`,
            });
            if (!options.json) console.log(chalk.red(`✗ API error: ${message}`));
          }
        }
      }

      // Step 4: Create sample task (if server running and not skipped)
      if (serverRunning && !options.skipTask) {
        try {
          const task = await api<TaskResponse>('/api/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: '🎉 Welcome to Veritas Kanban!',
              description: `# Welcome to Veritas Kanban!

This is a sample task created by \`vk setup\`.

## Next Steps

1. **Explore the UI** — Open http://localhost:3000 in your browser
2. **Connect an agent** — Add this to your agent's system prompt:
   \`\`\`
   You have access to a Veritas Kanban board at http://localhost:3001/api.
   Use the API to create, update, and manage tasks.
   \`\`\`
3. **Try the CLI** — Run \`vk list\` to see all tasks
4. **Archive this task** — When done exploring, run \`vk done ${Date.now()}\`

## Resources

- [Getting Started Guide](docs/GETTING-STARTED.md)
- [API Documentation](http://localhost:3001/api-docs)
- [GitHub Repository](https://github.com/BradGroux/veritas-kanban)

---
*Created by vk setup on ${new Date().toISOString().slice(0, 10)}*`,
              type: 'docs',
              priority: 'low',
            }),
          });
          results.push({
            step: 'sample-task',
            status: 'pass',
            message: `Created sample task: ${task.id}`,
            details: task,
          });
          if (!options.json) {
            console.log(chalk.green(`✓ Created sample task: ${task.id}`));
          }
        } catch (err) {
          results.push({
            step: 'sample-task',
            status: 'fail',
            message: `Failed to create task: ${(err as Error).message}`,
          });
          if (!options.json) {
            console.log(chalk.yellow(`⚠ Could not create sample task: ${(err as Error).message}`));
          }
        }
      } else if (options.skipTask) {
        results.push({
          step: 'sample-task',
          status: 'skip',
          message: 'Skipped (--skip-task)',
        });
        if (!options.json) console.log(chalk.dim('○ Sample task skipped'));
      }

      // Output JSON if requested
      if (options.json) {
        const allPassed = results.every((r) => r.status !== 'fail');
        console.log(JSON.stringify({ success: allPassed, results }, null, 2));
        process.exit(allPassed ? 0 : 1);
      }

      // Print summary
      const failures = results.filter((r) => r.status === 'fail');
      console.log();

      if (failures.length === 0) {
        console.log(chalk.green.bold('✅ Setup complete!\n'));
        console.log(chalk.bold('Next steps:'));
        console.log(`  1. Open ${chalk.cyan('http://localhost:3000')} in your browser`);
        console.log(`  2. Run ${chalk.cyan('vk list')} to see your tasks`);
        console.log(`  3. Run ${chalk.cyan('vk help')} to see all commands`);
        console.log();
        console.log(chalk.dim('For agent integration, see: docs/GETTING-STARTED.md'));
      } else {
        console.log(chalk.red.bold('❌ Setup incomplete\n'));
        console.log(chalk.bold('Issues to resolve:'));
        failures.forEach((f) => {
          console.log(`  • ${f.message}`);
        });
        console.log();
        process.exit(1);
      }

      console.log();
    });
}
