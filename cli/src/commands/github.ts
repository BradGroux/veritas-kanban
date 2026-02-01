import { Command } from 'commander';
import chalk from 'chalk';
import { api } from '../utils/api.js';

interface SyncResult {
  imported: number;
  updated: number;
  errors: string[];
  lastSyncAt: string;
}

interface SyncStatus {
  lastSyncAt: string | null;
  mappedIssues: number;
  enabled: boolean;
  syncMode: string;
  repo: string;
}

interface SyncConfig {
  enabled: boolean;
  repo: string;
  syncMode: string;
  labelFilter: string;
  pollIntervalMs: number;
}

export function registerGitHubCommands(program: Command): void {
  const github = program.command('github').alias('gh').description('GitHub Issues sync commands');

  // vk github sync — trigger manual sync
  github
    .command('sync')
    .description('Trigger a manual GitHub Issues sync')
    .action(async () => {
      try {
        console.log(chalk.dim('Syncing GitHub Issues…'));
        const result = await api<SyncResult>('/api/github/sync', {
          method: 'POST',
        });

        console.log(chalk.bold('\n🔄 GitHub Sync Complete\n'));
        console.log(`  Imported: ${chalk.green(String(result.imported))}`);
        console.log(`  Updated:  ${chalk.yellow(String(result.updated))}`);

        if (result.errors.length > 0) {
          console.log(chalk.red('\n  Errors:'));
          result.errors.forEach((e) => console.log(`    • ${e}`));
        }

        console.log(chalk.dim(`\n  Last sync: ${result.lastSyncAt}`));
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // vk github status — show sync status
  github
    .command('status')
    .description('Show GitHub sync status')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const status = await api<SyncStatus>('/api/github/sync/status');

        if (options.json) {
          console.log(JSON.stringify(status, null, 2));
        } else {
          console.log(chalk.bold('\n📊 GitHub Sync Status\n'));
          console.log(`  Enabled:       ${status.enabled ? chalk.green('Yes') : chalk.red('No')}`);
          console.log(`  Repo:          ${chalk.cyan(status.repo)}`);
          console.log(`  Sync Mode:     ${status.syncMode}`);
          console.log(`  Mapped Issues: ${chalk.yellow(String(status.mappedIssues))}`);
          console.log(
            `  Last Sync:     ${status.lastSyncAt ? chalk.dim(status.lastSyncAt) : chalk.dim('Never')}`
          );
          console.log();
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // vk github config — show or update sync configuration
  github
    .command('config')
    .description('Show or update GitHub sync configuration')
    .option('--json', 'Output as JSON')
    .option('--enable', 'Enable sync')
    .option('--disable', 'Disable sync')
    .option('--repo <repo>', 'Set repository (e.g. owner/repo)')
    .option('--label <label>', 'Set label filter')
    .option('--mode <mode>', 'Set sync mode (inbound|outbound|bidirectional)')
    .option('--interval <ms>', 'Set poll interval in milliseconds')
    .action(async (options) => {
      try {
        // Check if any update flags are provided
        const patch: Record<string, unknown> = {};
        if (options.enable) patch.enabled = true;
        if (options.disable) patch.enabled = false;
        if (options.repo) patch.repo = options.repo;
        if (options.label) patch.labelFilter = options.label;
        if (options.mode) patch.syncMode = options.mode;
        if (options.interval) patch.pollIntervalMs = parseInt(options.interval, 10);

        let config: SyncConfig;
        if (Object.keys(patch).length > 0) {
          config = await api<SyncConfig>('/api/github/sync/config', {
            method: 'PUT',
            body: JSON.stringify(patch),
            headers: { 'Content-Type': 'application/json' },
          });
          console.log(chalk.green('✓ Configuration updated'));
        } else {
          config = await api<SyncConfig>('/api/github/sync/config');
        }

        if (options.json) {
          console.log(JSON.stringify(config, null, 2));
        } else {
          console.log(chalk.bold('\n⚙️  GitHub Sync Configuration\n'));
          console.log(`  Enabled:       ${config.enabled ? chalk.green('Yes') : chalk.red('No')}`);
          console.log(`  Repo:          ${chalk.cyan(config.repo)}`);
          console.log(`  Sync Mode:     ${config.syncMode}`);
          console.log(`  Label Filter:  ${config.labelFilter}`);
          console.log(
            `  Poll Interval: ${config.pollIntervalMs}ms (${config.pollIntervalMs / 1000}s)`
          );
          console.log();
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // vk github mappings — list issue↔task mappings
  github
    .command('mappings')
    .description('List GitHub issue ↔ kanban task mappings')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const mappings = await api<Record<string, string>>('/api/github/sync/mappings');

        if (options.json) {
          console.log(JSON.stringify(mappings, null, 2));
        } else {
          const entries = Object.entries(mappings);
          if (entries.length === 0) {
            console.log(chalk.dim('\nNo issue↔task mappings yet. Run `vk github sync` first.\n'));
          } else {
            console.log(chalk.bold(`\n🔗 Issue ↔ Task Mappings (${entries.length})\n`));
            entries.forEach(([issueNum, taskId]) => {
              console.log(`  #${chalk.cyan(issueNum)} → ${chalk.yellow(taskId)}`);
            });
            console.log();
          }
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });
}
