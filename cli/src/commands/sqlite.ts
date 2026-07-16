import { Command } from 'commander';
import chalk from 'chalk';
import type {
  SqliteJournalOperationStatus,
  SqliteJournalPolicySummary,
  SqliteJournalPreview,
  SqliteJournalTarget,
} from '@veritas-kanban/shared';
import { api } from '../utils/api.js';

interface StatusResponse {
  operation?: SqliteJournalOperationStatus;
  policy?: SqliteJournalPolicySummary;
}

function printError(error: unknown): void {
  console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
  process.exitCode = 1;
}

function printOperation(operation: SqliteJournalOperationStatus): void {
  const state = operation.recoveryRequired
    ? chalk.red(operation.state)
    : operation.state === 'completed'
      ? chalk.green(operation.state)
      : chalk.yellow(operation.state);
  console.log(`${chalk.bold(operation.id)} ${state}`);
  console.log(`  ${operation.originalMode} -> ${operation.targetMode}`);
  console.log(`  backup: ${operation.backupAvailable ? 'verified' : 'not created'}`);
  console.log(`  restart required: ${operation.restartRequired ? 'yes' : 'no'}`);
  if (operation.errorCode) console.log(chalk.red(`  error: ${operation.errorCode}`));
}

export function registerSqliteCommands(program: Command): void {
  const sqlite = program
    .command('sqlite')
    .description('SQLite storage diagnostics and maintenance');
  const journal = sqlite
    .command('journal')
    .description('Preview and schedule journal-mode changes');

  journal
    .command('preview')
    .requiredOption('--target <mode>', 'Target journal mode: wal or delete')
    .option('--single-host', 'Acknowledge single-host compatibility mode')
    .option(
      '--override-reason <reason>',
      'Required justification for compatibility or override mode'
    )
    .option('--expires-at <timestamp>', 'ISO timestamp when the override expires')
    .option('--json', 'Output stable JSON')
    .action(async (options) => {
      try {
        if (!['wal', 'delete'].includes(options.target)) {
          throw new Error('--target must be wal or delete');
        }
        const preview = await api<SqliteJournalPreview>('/api/maintenance/sqlite/journal/preview', {
          method: 'POST',
          body: JSON.stringify({
            targetMode: options.target as SqliteJournalTarget,
            singleHost: options.singleHost || undefined,
            overrideReason: options.overrideReason,
            expiresAt: options.expiresAt,
          }),
        });
        if (options.json) {
          console.log(JSON.stringify(preview, null, 2));
          return;
        }
        console.log(chalk.bold(`SQLite journal preview ${preview.id}`));
        console.log(`  mode: ${preview.currentMode} -> ${preview.targetMode}`);
        console.log(`  filesystem: ${preview.filesystemType} (${preview.filesystemPosture})`);
        console.log(
          `  ownership: ${preview.ownershipState}; active connections: ${preview.activeConnectionCount}`
        );
        console.log(`  backup: ${preview.backupLocation}`);
        for (const sidecar of preview.sidecars) {
          console.log(
            `  ${sidecar.kind}: ${sidecar.present ? `${sidecar.bytes} bytes (${sidecar.fileType})` : 'absent'}`
          );
        }
        console.log(chalk.yellow('Risks:'));
        for (const risk of preview.risks) console.log(`  - ${risk}`);
        console.log(chalk.bold('\nSchedule after review:'));
        console.log(
          `  vk sqlite journal apply --preview-id ${preview.id} --preview-token ${preview.token} --confirm ${preview.id} --acknowledge-risks`
        );
      } catch (error) {
        printError(error);
      }
    });

  journal
    .command('apply')
    .requiredOption('--preview-id <id>', 'Preview operation ID')
    .requiredOption('--preview-token <token>', 'One-time preview token')
    .requiredOption('--confirm <id>', 'Repeat the preview ID to confirm')
    .option('--acknowledge-risks', 'Acknowledge the previewed risks')
    .option('--json', 'Output stable JSON')
    .action(async (options) => {
      try {
        if (!options.acknowledgeRisks || options.confirm !== options.previewId) {
          throw new Error('Apply requires --acknowledge-risks and --confirm matching --preview-id');
        }
        const operation = await api<SqliteJournalOperationStatus>(
          '/api/maintenance/sqlite/journal/apply',
          {
            method: 'POST',
            body: JSON.stringify({
              previewId: options.previewId,
              previewToken: options.previewToken,
              confirm: options.confirm,
              acknowledgeRisks: true,
            }),
          }
        );
        if (options.json) console.log(JSON.stringify(operation, null, 2));
        else {
          printOperation(operation);
          console.log(chalk.yellow('Restart the server to execute the scheduled conversion.'));
        }
      } catch (error) {
        printError(error);
      }
    });

  journal
    .command('status [operationId]')
    .option('--json', 'Output stable JSON')
    .action(async (operationId, options) => {
      try {
        if (operationId) {
          const operation = await api<SqliteJournalOperationStatus>(
            `/api/maintenance/sqlite/journal/operations/${encodeURIComponent(operationId)}`
          );
          if (options.json) console.log(JSON.stringify(operation, null, 2));
          else printOperation(operation);
          return;
        }
        const status = await api<StatusResponse>('/api/maintenance/sqlite/journal/status');
        if (options.json) {
          console.log(JSON.stringify(status, null, 2));
          return;
        }
        if (status.operation) printOperation(status.operation);
        else console.log(chalk.dim('No SQLite journal operation is scheduled.'));
        if (status.policy) {
          console.log(
            `Policy: ${status.policy.source} ${status.policy.status}; expires ${status.policy.expiresAt}`
          );
        }
      } catch (error) {
        printError(error);
      }
    });

  journal
    .command('override')
    .description('Manage SQLite journal overrides')
    .command('revoke')
    .requiredOption('--reason <reason>', 'Revocation reason')
    .option('--json', 'Output stable JSON')
    .action(async (options) => {
      try {
        if (String(options.reason).trim().length < 8) {
          throw new Error('--reason must be at least 8 characters');
        }
        const policy = await api<SqliteJournalPolicySummary>(
          '/api/maintenance/sqlite/journal/override/revoke',
          { method: 'POST', body: JSON.stringify({ reason: options.reason }) }
        );
        if (options.json) console.log(JSON.stringify(policy, null, 2));
        else console.log(chalk.yellow(`Revoked ${policy.id}; restart is required.`));
      } catch (error) {
        printError(error);
      }
    });
}
