import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { api } from '../utils/api.js';
import type {
  WorkspaceCapabilityDiscoveryResult,
  WorkspaceCapabilityFormat,
  WorkspaceCapabilityRegistrationResult,
  WorkspaceCapabilityValidationResult,
  WorkspaceDelegatedWorkIntakeResult,
} from '@veritas-kanban/shared';

function inferFormat(filePath: string): WorkspaceCapabilityFormat {
  return path.extname(filePath).toLowerCase() === '.json' ? 'json' : 'yaml';
}

function contextField(
  value: string,
  previous: Record<string, string> = {}
): Record<string, string> {
  const index = value.indexOf('=');
  if (index === -1) {
    throw new Error('Context fields must use key=value format');
  }
  return {
    ...previous,
    [value.slice(0, index).trim()]: value.slice(index + 1).trim(),
  };
}

export function registerWorkspaceCommands(program: Command): void {
  const workspaces = program
    .command('workspaces')
    .alias('workspace')
    .description('Workspace capability discovery and delegated intake');

  workspaces
    .command('discover')
    .description('List local and trusted workspace capability manifests')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const result = await api<WorkspaceCapabilityDiscoveryResult>(
          '/api/workspace-capabilities/discover'
        );
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (result.local) {
          console.log(chalk.bold(`\nLocal: ${result.local.name}`));
          console.log(chalk.dim(`  ${result.local.workspaceId}`));
          for (const capability of result.local.capabilities) {
            console.log(`  - ${capability.id}: ${capability.name}`);
          }
        }

        console.log(chalk.bold(`\nTrusted Workspaces (${result.trusted.length})`));
        if (result.trusted.length === 0) {
          console.log(chalk.dim('  No trusted workspace manifests registered.'));
        }
        for (const workspace of result.trusted) {
          console.log(`  ${chalk.cyan(workspace.workspaceId)} ${workspace.name}`);
          for (const capability of workspace.capabilities) {
            console.log(
              `    - ${capability.id}: ${capability.acceptedTaskTypes.join(', ') || 'any'}`
            );
          }
        }
        console.log();
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  workspaces
    .command('validate <file>')
    .description('Validate a workspace capability manifest YAML or JSON file')
    .option('--json', 'Output as JSON')
    .action(async (file, options) => {
      try {
        const content = readFileSync(file, 'utf-8');
        const result = await api<WorkspaceCapabilityValidationResult>(
          '/api/workspace-capabilities/manifest/validate',
          {
            method: 'POST',
            body: JSON.stringify({ content, format: inferFormat(file), source: file }),
            headers: { 'Content-Type': 'application/json' },
          }
        );
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        if (result.valid) {
          console.log(chalk.green(`Valid workspace manifest: ${result.manifest?.workspaceId}`));
          return;
        }
        console.log(chalk.red('Invalid workspace manifest'));
        for (const issue of result.issues) {
          console.log(chalk.dim(`  ${issue.path}: ${issue.message}`));
        }
        process.exitCode = 1;
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  workspaces
    .command('trust <file>')
    .description('Register a trusted peer workspace manifest')
    .option('--json', 'Output as JSON')
    .action(async (file, options) => {
      try {
        const content = readFileSync(file, 'utf-8');
        const result = await api<WorkspaceCapabilityRegistrationResult>(
          '/api/workspace-capabilities/trusted',
          {
            method: 'POST',
            body: JSON.stringify({ content, format: inferFormat(file), source: file }),
            headers: { 'Content-Type': 'application/json' },
          }
        );
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.log(
          chalk.green(
            `${result.created ? 'Registered' : 'Updated'} trusted workspace: ${result.manifest.name}`
          )
        );
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  workspaces
    .command('intake')
    .description('Create delegated work intake in this workspace')
    .requiredOption('--source-workspace <id>', 'Source workspace ID')
    .requiredOption('--capability <id>', 'Target capability ID')
    .requiredOption('--title <title>', 'Delegated work title')
    .requiredOption('--context <text>', 'Delegated work context')
    .option('--source-name <name>', 'Source workspace display name')
    .option('--source-task <id>', 'Originating task ID')
    .option('--source-task-url <url>', 'Originating task URL')
    .option('--repository <repo>', 'Source repository')
    .option('--issue-url <url>', 'Source issue URL')
    .option('--type <type>', 'Task type')
    .option('--project <project>', 'Target project')
    .option('--priority <priority>', 'Target priority')
    .option('--label <label...>', 'Delegation labels')
    .option('--context-field <key=value>', 'Required context field', contextField, {})
    .option('--requested-by <actor>', 'Requester actor')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const result = await api<WorkspaceDelegatedWorkIntakeResult>(
          '/api/workspace-capabilities/intake',
          {
            method: 'POST',
            body: JSON.stringify({
              source: {
                workspaceId: options.sourceWorkspace,
                workspaceName: options.sourceName,
                taskId: options.sourceTask,
                taskUrl: options.sourceTaskUrl,
                repository: options.repository,
                issueUrl: options.issueUrl,
              },
              capabilityId: options.capability,
              title: options.title,
              context: options.context,
              contextFields: options.contextField,
              labels: options.label,
              priority: options.priority,
              project: options.project,
              type: options.type,
              requestedBy: options.requestedBy,
            }),
            headers: { 'Content-Type': 'application/json' },
          }
        );
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.log(chalk.green(`Created delegated task: ${result.taskId}`));
        console.log(chalk.dim(`Delegation: ${result.record.id}`));
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });
}
