import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Command } from 'commander';
import chalk from 'chalk';
import type {
  RunToolCatalog,
  ToolInvocationResult,
  ToolServerDefinition,
  ToolServerDefinitionInput,
  ToolServerDiscovery,
} from '@veritas-kanban/shared';
import { api } from '../utils/api.js';

export function registerToolServerCommands(program: Command): void {
  const servers = program
    .command('tool-servers')
    .alias('tools')
    .description('Manage run-scoped MCP and tool servers');

  servers
    .command('list')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      await execute(async () => {
        const definitions = await api<ToolServerDefinition[]>('/api/tool-servers');
        if (options.json) return printJson(definitions);
        for (const definition of definitions) {
          console.log(
            `${chalk.bold(definition.id)} ${definition.enabled ? chalk.green('enabled') : chalk.yellow('disabled')} ${definition.version} ${definition.transport.kind}`
          );
        }
      });
    });

  servers
    .command('get <id>')
    .option('--json', 'Output as JSON')
    .action(async (id, _options) => {
      await execute(async () => {
        const definition = await api<ToolServerDefinition>(
          `/api/tool-servers/${encodeURIComponent(id)}`
        );
        printJson(definition);
      });
    });

  servers
    .command('create <file>')
    .description('Create a definition from a JSON file')
    .option('--json', 'Output as JSON')
    .action(async (file, options) => {
      await execute(async () => {
        const input = JSON.parse(readFileSync(file, 'utf8')) as ToolServerDefinitionInput;
        const definition = await api<ToolServerDefinition>('/api/tool-servers', {
          method: 'POST',
          body: JSON.stringify(input),
        });
        if (options.json) return printJson(definition);
        console.log(chalk.green(`Created ${definition.id}@${definition.version}`));
      });
    });

  servers
    .command('update <id> <file>')
    .description('Replace a definition from a JSON file')
    .option('--json', 'Output as JSON')
    .action(async (id, file, options) => {
      await execute(async () => {
        const input = JSON.parse(readFileSync(file, 'utf8')) as ToolServerDefinitionInput;
        const definition = await api<ToolServerDefinition>(
          `/api/tool-servers/${encodeURIComponent(id)}`,
          {
            method: 'PUT',
            body: JSON.stringify(input),
          }
        );
        if (options.json) return printJson(definition);
        console.log(chalk.green(`Updated ${definition.id}@${definition.version}`));
      });
    });

  servers
    .command('delete <id>')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      await execute(async () => {
        const result = await api<{ deleted: string }>(
          `/api/tool-servers/${encodeURIComponent(id)}`,
          { method: 'DELETE' }
        );
        if (options.json) return printJson(result);
        console.log(chalk.green(`Deleted ${result.deleted}`));
      });
    });

  servers
    .command('enable <id>')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      await execute(async () => {
        const updated = await setDefinitionEnabled(id, true);
        if (options.json) return printJson(updated);
        console.log(chalk.green(`Enabled ${updated.id}`));
      });
    });

  servers
    .command('disable <id>')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      await execute(async () => {
        const updated = await setDefinitionEnabled(id, false);
        if (options.json) return printJson(updated);
        console.log(chalk.green(`Disabled ${updated.id}`));
      });
    });

  servers
    .command('version <id> <version>')
    .option('--json', 'Output as JSON')
    .action(async (id, version, options) => {
      await execute(async () => {
        const current = await getDefinition(id);
        const updated = await replaceDefinition(id, { ...current, version });
        if (options.json) return printJson(updated);
        console.log(chalk.green(`Versioned ${updated.id}@${updated.version}`));
      });
    });

  servers
    .command('discover <id>')
    .option('--force', 'Ignore a matching discovery cache entry')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      await execute(async () => {
        const discovery = await api<ToolServerDiscovery>(
          `/api/tool-servers/${encodeURIComponent(id)}/discover`,
          {
            method: 'POST',
            body: JSON.stringify({ force: options.force === true }),
          }
        );
        if (options.json) return printJson(discovery);
        console.log(
          `${discovery.status === 'ready' ? chalk.green('ready') : chalk.red('failed')} ${discovery.serverId}@${discovery.serverVersion} tools=${discovery.tools.length}`
        );
        if (discovery.error) console.log(chalk.red(discovery.error));
      });
    });

  servers
    .command('catalog <taskId> <attemptId>')
    .option('--json', 'Output as JSON')
    .action(async (taskId, attemptId) => {
      await execute(async () => {
        printJson(
          await api<RunToolCatalog>(
            `/api/tool-servers/runs/${encodeURIComponent(taskId)}/${encodeURIComponent(attemptId)}/catalog`
          )
        );
      });
    });

  servers
    .command('call <taskId> <attemptId> <serverId> <tool>')
    .requiredOption('--arguments <json>', 'JSON object of tool arguments')
    .option('--operation-id <id>', 'Stable caller operation ID', randomUUID())
    .option('--approval-id <id>', 'Approved run approval ID')
    .option('--json', 'Output as JSON')
    .action(async (taskId, attemptId, serverId, tool, options) => {
      await execute(async () => {
        const result = await api<ToolInvocationResult>('/api/tool-servers/call', {
          method: 'POST',
          body: JSON.stringify({
            taskId,
            attemptId,
            serverId,
            tool,
            arguments: JSON.parse(options.arguments),
            operationId: options.operationId,
            approvalId: options.approvalId,
          }),
        });
        if (options.json) return printJson(result);
        console.log(
          `${result.isError ? chalk.red('error') : chalk.green('complete')} ${result.serverId}/${result.tool} event=${result.eventId}`
        );
        printJson(result.content);
      });
    });
}

async function execute(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
    process.exitCode = 1;
  }
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

async function getDefinition(id: string): Promise<ToolServerDefinition> {
  return api<ToolServerDefinition>(`/api/tool-servers/${encodeURIComponent(id)}`);
}

async function replaceDefinition(
  id: string,
  definition: ToolServerDefinition
): Promise<ToolServerDefinition> {
  const {
    schemaVersion: _schemaVersion,
    digest: _digest,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...input
  } = definition;
  return api<ToolServerDefinition>(`/api/tool-servers/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(input satisfies ToolServerDefinitionInput),
  });
}

async function setDefinitionEnabled(id: string, enabled: boolean): Promise<ToolServerDefinition> {
  const current = await getDefinition(id);
  return replaceDefinition(id, { ...current, enabled });
}
