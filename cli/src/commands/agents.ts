import { Command } from 'commander';
import { randomUUID } from 'node:crypto';
import chalk from 'chalk';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { api } from '../utils/api.js';
import { findTask } from '../utils/find.js';
import type {
  AgentProfileExportResult,
  AgentProfilePackageFormat,
  AgentProfilePackageSummary,
  AgentProfileValidationResult,
  ConversationLifecycleRecord,
  ConversationLifecycleResult,
  PhaseCapabilityEvidence,
  PhaseTransitionRecord,
  PhaseTransitionResult,
  RunApprovalRequest,
  RunFileProvenanceResponse,
  RunRecoveryRecord,
  RunLaunchManifestPreview,
  RunAccessSummaryResponse,
  RunAccessChangePreview,
  RunAccessChangeResult,
  RunPhaseAuthoritySnapshot,
  WorkspaceExecutionTrustDecision,
  WorkspaceExecutionTrustDecisionMode,
  WorkspaceExecutionTrustScanResult,
} from '@veritas-kanban/shared';

type ConversationTurnAction = 'resume' | 'follow-up' | 'fork';
type ConversationControlAction = 'interrupt' | 'compact' | 'archive' | 'close';

interface ConversationTurnOptions {
  sourceAttempt: string;
  message: string;
  forkTurn?: string;
  profile?: string;
  phase?: string;
  requireCapability?: string[];
  commitPolicy?: string;
  json?: boolean;
}

interface ConversationControlOptions {
  attempt: string;
  json?: boolean;
}

interface PhaseTransitionOptions {
  attempt: string;
  operation: string;
  targetEvidence: string;
  fromEvidence?: string;
  manifest?: string;
  reason: string;
  approvalId?: string;
  approvalTtlMs?: string;
  overrideUntil?: string;
  overrideReason?: string;
  json?: boolean;
}

interface RunAccessChangeOptions {
  attempt: string;
  targetPhase: string;
  reason: string;
  request?: string;
  approvalId?: string;
  approvalTtlMs?: string;
  apply?: boolean;
  json?: boolean;
}

function inferProfileFormat(filePath: string): AgentProfilePackageFormat {
  const extension = path.extname(filePath).toLowerCase();
  return extension === '.json' ? 'json' : 'yaml';
}

async function resolveTaskId(id: string): Promise<string> {
  const task = await findTask(id);
  if (!task) throw new Error(`Task not found: ${id}`);
  return task.id;
}

function readPhaseEvidence(filePath: string): PhaseCapabilityEvidence {
  return JSON.parse(readFileSync(path.resolve(filePath), 'utf8')) as PhaseCapabilityEvidence;
}

function printConversationResult(
  action: string,
  result: {
    attemptId: string;
    delivered?: boolean;
    note?: string;
    conversation?: ConversationLifecycleRecord;
  },
  json?: boolean
): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(chalk.green(`✓ Conversation ${action}`));
  console.log(chalk.dim(`Attempt ID: ${result.attemptId}`));
  if (result.conversation?.conversationId) {
    console.log(chalk.dim(`Conversation ID: ${result.conversation.conversationId}`));
  }
  if (result.note) console.log(chalk.dim(result.note));
}

function phaseIdentityLabel(record: PhaseTransitionRecord): string {
  return phaseEvidenceIdentityLabel(record.effectiveEvidence);
}

function phaseEvidenceIdentityLabel(evidence: PhaseCapabilityEvidence): string {
  const identity = evidence.identity;
  return identity.mode === 'legacy'
    ? 'legacy'
    : `${identity.phase} (${identity.profileId}@${identity.profileVersion})`;
}

function registerConversationTurnCommand(
  program: Command,
  action: ConversationTurnAction,
  description: string
): void {
  const command = program
    .command(`agent:${action} <id>`)
    .description(description)
    .requiredOption('--source-attempt <attemptId>', 'Terminal attempt with durable conversation')
    .requiredOption('-m, --message <text>', 'Prompt for the new turn')
    .option('-p, --profile <profileId>', 'Agent profile package to launch')
    .option('--phase <phase>', 'Execution phase (explore, plan, implement, verify, publish)')
    .option(
      '--require-capability <capabilities...>',
      'Require provider runtime capabilities before launch'
    )
    .option(
      '--commit-policy <policy>',
      'Commit policy for this run (forbidden, allowed, or required)'
    )
    .option('--json', 'Output as JSON');

  if (action === 'fork') {
    command.option('--fork-turn <turnId>', 'Provider turn boundary to fork from');
  }

  command.action(async (id: string, options: ConversationTurnOptions) => {
    try {
      const taskId = await resolveTaskId(id);
      const result = await api<{
        attemptId: string;
        conversation?: ConversationLifecycleRecord;
      }>(`/api/agents/${taskId}/conversation/${action}`, {
        method: 'POST',
        body: JSON.stringify({
          sourceAttemptId: options.sourceAttempt,
          message: options.message,
          ...(action === 'fork' && options.forkTurn ? { forkTurnId: options.forkTurn } : {}),
          profileId: options.profile,
          phase: options.phase,
          requiredRuntimeCapabilities: options.requireCapability,
          commitPolicy: options.commitPolicy,
          idempotencyKey: `vk-cli:${taskId}:conversation:${action}:${randomUUID()}`,
        }),
      });
      printConversationResult(action, result, options.json);
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });
}

function registerConversationControlCommand(
  program: Command,
  action: ConversationControlAction,
  description: string
): void {
  program
    .command(`agent:${action} <id>`)
    .description(description)
    .requiredOption('--attempt <attemptId>', 'Exact active attempt ID')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: ConversationControlOptions) => {
      try {
        const taskId = await resolveTaskId(id);
        const result = await api<ConversationLifecycleResult>(
          `/api/agents/${taskId}/conversation/${action}`,
          {
            method: 'POST',
            body: JSON.stringify({ attemptId: options.attempt }),
          }
        );
        printConversationResult(action, result, options.json);
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });
}

export function registerAgentCommands(program: Command): void {
  // Start agent on task
  program
    .command('start <id>')
    .description('Start an agent on a task')
    .option(
      '-a, --agent <agent>',
      'Agent to use (claude-code, amp, copilot, gemini)',
      'claude-code'
    )
    .option('-p, --profile <profileId>', 'Agent profile package to launch')
    .option('--phase <phase>', 'Execution phase (explore, plan, implement, verify, publish)')
    .option(
      '--require-capability <capabilities...>',
      'Require provider runtime capabilities before launch'
    )
    .option(
      '--commit-policy <policy>',
      'Commit policy for this run (forbidden, allowed, or required)'
    )
    .option('--parent-attempt <attemptId>', 'Compare launch inputs with a parent attempt')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        const task = await findTask(id);

        if (!task) {
          console.error(chalk.red(`Task not found: ${id}`));
          process.exit(1);
        }

        if (task.type !== 'code') {
          console.error(chalk.red('Can only start agents on code tasks'));
          process.exit(1);
        }

        if (!task.git?.worktreePath) {
          console.error(chalk.red('Task needs a worktree first. Create one via the UI.'));
          process.exit(1);
        }

        const result = await api<{ attemptId: string }>(`/api/agents/${task.id}/start`, {
          method: 'POST',
          body: JSON.stringify({
            agent: options.profile ? undefined : options.agent,
            profileId: options.profile,
            phase: options.phase,
            requiredRuntimeCapabilities: options.requireCapability,
            commitPolicy: options.commitPolicy,
            parentAttemptId: options.parentAttempt,
            idempotencyKey: `vk-cli:${task.id}:${randomUUID()}`,
          }),
        });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(chalk.green(`✓ Agent started: ${options.profile || options.agent}`));
          console.log(chalk.dim(`Attempt ID: ${result.attemptId}`));
          console.log(chalk.dim(`Working in: ${task.git.worktreePath}`));
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  program
    .command('launch-preview <id>')
    .description('Preview the immutable effective launch manifest without starting an agent')
    .option('-a, --agent <agent>', 'Agent to use', 'codex')
    .option('-p, --profile <profileId>', 'Agent profile package to preview')
    .option('--phase <phase>', 'Execution phase (explore, plan, implement, verify, publish)')
    .option(
      '--require-capability <capabilities...>',
      'Require provider runtime capabilities before launch'
    )
    .option(
      '--commit-policy <policy>',
      'Commit policy for this run (forbidden, allowed, or required)'
    )
    .option('--parent-attempt <attemptId>', 'Compare launch inputs with a parent attempt')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        const task = await findTask(id);
        if (!task) throw new Error(`Task not found: ${id}`);
        const preview = await api<RunLaunchManifestPreview>(
          `/api/agents/${task.id}/launch-preview`,
          {
            method: 'POST',
            body: JSON.stringify({
              agent: options.profile ? undefined : options.agent,
              profileId: options.profile,
              phase: options.phase,
              requiredRuntimeCapabilities: options.requireCapability,
              commitPolicy: options.commitPolicy,
              parentAttemptId: options.parentAttempt,
            }),
          }
        );
        if (options.json) {
          console.log(JSON.stringify(preview, null, 2));
          return;
        }
        console.log(chalk.bold('Run launch manifest'));
        console.log(`  Digest: ${preview.manifest.digest}`);
        console.log(`  Provider: ${preview.manifest.providerRuntime.provider}`);
        console.log(`  Model: ${preview.manifest.runtime.model ?? 'provider default'}`);
        console.log(
          `  Phase: ${
            preview.manifest.phase?.evidence.identity.mode === 'profile'
              ? preview.manifest.phase.evidence.identity.phase
              : 'legacy'
          }`
        );
        if (preview.manifest.phase) {
          console.log(`  Phase evidence: ${preview.manifest.phase.evidence.digest}`);
        }
        console.log(`  Workspace trust: ${preview.manifest.workspaceTrust.status}`);
        console.log(chalk.dim(`  ${preview.manifest.workspaceTrust.source}`));
        console.log(
          `  Enforceable: ${preview.manifest.enforcement.enforceable ? chalk.green('yes') : chalk.red('no')}`
        );
        for (const blocker of preview.manifest.enforcement.blockers) {
          console.log(chalk.red(`  Blocker ${blocker.code}: ${blocker.detail}`));
        }
        if (preview.drift) {
          console.log(
            `  Parent drift: ${preview.drift.material ? chalk.yellow('material') : chalk.green('none')}`
          );
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  const workspaceTrust = program
    .command('workspace-trust')
    .description('Inspect and manage repository execution trust');

  workspaceTrust
    .command('scan <id>')
    .description('Scan repository-controlled instructions and executable configuration')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        const taskId = await resolveTaskId(id);
        const result = await api<WorkspaceExecutionTrustScanResult>(
          `/api/agents/${taskId}/workspace-trust`
        );
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.log(chalk.bold('Workspace execution trust'));
        console.log(`  Identity: ${result.inventory.identity.digest}`);
        console.log(`  Inventory: ${result.inventory.digest}`);
        console.log(`  Project maximum: ${result.inventory.projectPolicy.maximumTrust}`);
        console.log(`  Current decision: ${result.currentDecision?.mode ?? chalk.yellow('none')}`);
        if (result.inventory.entries.length === 0) {
          console.log(chalk.dim('  No recognized repository-controlled components found.'));
          return;
        }
        for (const entry of result.inventory.entries) {
          console.log(
            `  ${entry.posture === 'executable' ? chalk.red('!') : chalk.yellow('•')} ${entry.relativePath}`
          );
          console.log(
            chalk.dim(
              `    ${entry.kind}; ${entry.posture}; ${entry.requestedCapabilities.join(', ')}`
            )
          );
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  workspaceTrust
    .command('decide <id>')
    .description('Record trust, restricted, or denied for an exact scanned inventory')
    .requiredOption('--mode <mode>', 'Decision mode: trusted, restricted, or denied')
    .requiredOption('--inventory <digest>', 'Exact inventory digest from workspace-trust scan')
    .requiredOption('--reason <text>', 'Reason for the decision')
    .option('--expires-at <timestamp>', 'Optional ISO-8601 expiry')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        const mode = options.mode as WorkspaceExecutionTrustDecisionMode;
        if (!['trusted', 'restricted', 'denied'].includes(mode)) {
          throw new Error('Mode must be trusted, restricted, or denied.');
        }
        const taskId = await resolveTaskId(id);
        const decision = await api<WorkspaceExecutionTrustDecision>(
          `/api/agents/${taskId}/workspace-trust/decisions`,
          {
            method: 'POST',
            body: JSON.stringify({
              mode,
              inventoryDigest: options.inventory,
              reason: options.reason,
              expiresAt: options.expiresAt,
            }),
          }
        );
        if (options.json) {
          console.log(JSON.stringify(decision, null, 2));
          return;
        }
        console.log(chalk.green(`✓ Workspace decision recorded: ${decision.mode}`));
        console.log(chalk.dim(`Decision ID: ${decision.id}`));
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  workspaceTrust
    .command('revoke <id>')
    .description('Revoke the current workspace execution trust decision')
    .requiredOption('--inventory <digest>', 'Exact current inventory digest')
    .requiredOption('--reason <text>', 'Reason for revocation')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        const taskId = await resolveTaskId(id);
        const decision = await api<WorkspaceExecutionTrustDecision>(
          `/api/agents/${taskId}/workspace-trust/revoke`,
          {
            method: 'POST',
            body: JSON.stringify({
              inventoryDigest: options.inventory,
              reason: options.reason,
            }),
          }
        );
        if (options.json) {
          console.log(JSON.stringify(decision, null, 2));
          return;
        }
        console.log(chalk.green('✓ Workspace execution trust decision revoked'));
        console.log(chalk.dim(`Decision ID: ${decision.id}`));
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  const profiles = program
    .command('profiles')
    .description('Manage reusable agent profile packages');

  profiles
    .command('list')
    .description('List imported agent profile packages')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const rows = await api<AgentProfilePackageSummary[]>('/api/config/agent-profiles');
        if (options.json) {
          console.log(JSON.stringify(rows, null, 2));
          return;
        }
        if (rows.length === 0) {
          console.log(chalk.dim('No agent profile packages installed'));
          return;
        }
        for (const profile of rows) {
          console.log(
            `${profile.enabled ? chalk.green('●') : chalk.gray('○')} ${chalk.bold(profile.id)} ${chalk.dim(profile.version)}`
          );
          console.log(`  ${profile.displayName} — ${profile.role}`);
          console.log(
            `  agent=${profile.runtime.agent}${profile.runtime.model ? ` model=${profile.runtime.model}` : ''}`
          );
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  profiles
    .command('validate <file>')
    .description('Validate an agent profile package YAML or JSON file')
    .option('--json', 'Output as JSON')
    .action(async (file, options) => {
      try {
        const content = readFileSync(file, 'utf-8');
        const result = await api<AgentProfileValidationResult>(
          '/api/config/agent-profiles/validate',
          {
            method: 'POST',
            body: JSON.stringify({ content, format: inferProfileFormat(file), source: file }),
          }
        );
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        if (result.valid) {
          console.log(chalk.green(`✓ Valid profile package: ${result.profile?.id}`));
        } else {
          console.log(chalk.red('Invalid profile package'));
          for (const issue of result.issues) {
            console.log(chalk.dim(`  ${issue.path}: ${issue.message}`));
          }
          process.exitCode = 1;
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  profiles
    .command('import <file>')
    .description('Import or replace an agent profile package')
    .option('--json', 'Output as JSON')
    .action(async (file, options) => {
      try {
        const content = readFileSync(file, 'utf-8');
        const result = await api<{
          profile: { id: string; displayName: string; version: string };
          created: boolean;
        }>('/api/config/agent-profiles/import', {
          method: 'POST',
          body: JSON.stringify({ content, format: inferProfileFormat(file), source: file }),
        });
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.log(
          chalk.green(
            `✓ ${result.created ? 'Imported' : 'Updated'} ${result.profile.displayName} (${result.profile.id}@${result.profile.version})`
          )
        );
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  profiles
    .command('export <profileId>')
    .description('Export an agent profile package')
    .option('-f, --format <format>', 'yaml or json', 'yaml')
    .option('-o, --output <file>', 'Write export to a file')
    .action(async (profileId, options) => {
      try {
        const format = options.format === 'json' ? 'json' : 'yaml';
        const result = await api<AgentProfileExportResult>(
          `/api/config/agent-profiles/${encodeURIComponent(profileId)}/export?format=${format}`
        );
        if (options.output) {
          writeFileSync(options.output, result.content, 'utf-8');
          console.log(chalk.green(`✓ Exported ${profileId} to ${options.output}`));
        } else {
          process.stdout.write(result.content);
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // Stop agent
  program
    .command('stop <id>')
    .description('Stop a running agent')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        const task = await findTask(id);

        if (!task) {
          console.error(chalk.red(`Task not found: ${id}`));
          process.exit(1);
        }

        const status = await api<{ running: boolean; attemptId?: string }>(
          `/api/agents/${task.id}/status`
        );
        if (!status.running || !status.attemptId) {
          throw new Error('No active agent attempt is available to stop');
        }
        await api(`/api/agents/${task.id}/stop`, {
          method: 'POST',
          body: JSON.stringify({ attemptId: status.attemptId }),
        });

        if (options.json) {
          console.log(JSON.stringify({ stopped: true }));
        } else {
          console.log(chalk.yellow('✓ Agent stopped'));
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  program
    .command('agent:recovery <id>')
    .description('Show the latest durable retry or fallback decision for a task')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        const taskId = await resolveTaskId(id);
        const result = await api<{ recovery: RunRecoveryRecord | null }>(
          `/api/agents/${taskId}/recovery`
        );
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else if (!result.recovery) {
          console.log(chalk.dim('No recovery decision is recorded for this task'));
        } else {
          console.log(chalk.yellow(`Recovery: ${result.recovery.state}`));
          console.log(`  Action: ${result.recovery.action}`);
          console.log(`  Attempt: ${result.recovery.parentRunId}`);
          console.log(`  Sequence: ${result.recovery.sequence}`);
          console.log(`  Reason: ${result.recovery.reason}`);
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  program
    .command('agent:phase <id>')
    .description('Show the active durable phase and transition history for an exact run')
    .requiredOption('--attempt <attemptId>', 'Exact attempt ID')
    .option('--limit <count>', 'Maximum transition records', '100')
    .option('--json', 'Output as JSON')
    .action(
      async (
        id: string,
        options: { attempt: string; limit: string; json?: boolean }
      ): Promise<void> => {
        try {
          const taskId = await resolveTaskId(id);
          const result = await api<{
            phase: RunPhaseAuthoritySnapshot | null;
            current: PhaseTransitionRecord | null;
            history: PhaseTransitionRecord[];
          }>(
            `/api/agents/${taskId}/phase?attemptId=${encodeURIComponent(options.attempt)}&limit=${encodeURIComponent(options.limit)}`
          );
          if (options.json) {
            console.log(JSON.stringify(result, null, 2));
          } else if (!result.phase) {
            console.log(chalk.dim('This legacy run has no phase authority evidence'));
          } else {
            console.log(
              chalk.cyan(`Phase: ${phaseEvidenceIdentityLabel(result.phase.effectiveEvidence)}`)
            );
            console.log(chalk.dim(`Sequence: ${result.phase.transitionSequence}`));
            console.log(chalk.dim(`Evidence: ${result.phase.effectiveEvidence.digest}`));
            console.log(chalk.dim(`Manifest: ${result.phase.manifestDigest}`));
            if (result.current?.emergencyOverride) {
              console.log(
                chalk.yellow(
                  `Emergency override expires: ${result.current.emergencyOverride.expiresAt}`
                )
              );
            }
          }
        } catch (err) {
          console.error(chalk.red(`Error: ${(err as Error).message}`));
          process.exit(1);
        }
      }
    );

  program
    .command('agent:file-provenance <id>')
    .description('Resolve the provenance of exact run-produced file bytes')
    .requiredOption('--attempt <attemptId>', 'Exact attempt ID')
    .requiredOption('--root <root>', 'Safe root label: worktree or run-artifact')
    .requiredOption('--path <path>', 'Root-relative file path')
    .requiredOption('--sha256 <digest>', 'Exact sha256: content digest')
    .option('--limit <count>', 'Maximum predecessor records', '25')
    .option('--json', 'Output the versioned machine-readable contract')
    .action(
      async (
        id: string,
        options: {
          attempt: string;
          root: string;
          path: string;
          sha256: string;
          limit: string;
          json?: boolean;
        }
      ): Promise<void> => {
        try {
          const taskId = await resolveTaskId(id);
          const params = new URLSearchParams({
            attemptId: options.attempt,
            root: options.root,
            path: options.path,
            sha256: options.sha256,
            limit: options.limit,
          });
          const result = await api<RunFileProvenanceResponse>(
            `/api/agents/${taskId}/file-provenance/resolve?${params.toString()}`
          );
          if (options.json) {
            console.log(JSON.stringify(result, null, 2));
            return;
          }
          console.log(chalk.cyan(`File provenance: ${result.status}`));
          console.log(`  Path: ${result.query.root}/${result.query.relativePath}`);
          console.log(`  Digest: ${result.query.sha256}`);
          if (result.current) {
            console.log(`  Source: ${result.current.source}`);
            console.log(`  Operation: ${result.current.operation}`);
            console.log(`  Producer: ${result.current.producer.eventId}`);
            console.log(`  Chain: ${result.chain.length} record(s)`);
          }
          for (const gap of result.gaps) {
            console.log(chalk.yellow(`  ${gap.code}: ${gap.message}`));
          }
        } catch (err) {
          console.error(chalk.red(`Error: ${(err as Error).message}`));
          process.exit(1);
        }
      }
    );
  program
    .command('agent:access <id>')
    .description('Show the exact redacted access projection for one run')
    .requiredOption('--attempt <attemptId>', 'Exact attempt ID')
    .option('--json', 'Output the versioned machine-readable contract')
    .action(async (id: string, options: { attempt: string; json?: boolean }): Promise<void> => {
      try {
        const taskId = await resolveTaskId(id);
        const result = await api<RunAccessSummaryResponse>(
          `/api/agents/${taskId}/access?attemptId=${encodeURIComponent(options.attempt)}`
        );
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const summary = result.current;
        console.log(chalk.cyan(`Run access: ${summary.status}`));
        console.log(`  Attempt: ${summary.identity.attemptId}`);
        console.log(`  Host: ${summary.identity.selectedHost ?? 'unavailable'}`);
        console.log(`  Sandbox: ${summary.filesystem.sandboxMode}`);
        console.log(`  Network: ${summary.network.policy}`);
        console.log(
          `  Tools: ${summary.tools.filter((tool) => tool.decision === 'allow').length} allowed, ${summary.approvals.toolCount} approval, ${summary.tools.filter((tool) => tool.decision === 'deny').length} denied`
        );
        console.log(`  Integrations: ${summary.integrations.length}`);
        console.log(`  Phase sequence: ${summary.identity.transitionSequence}`);
        console.log(chalk.dim(`  Evidence: ${summary.digest}`));
        if (summary.blockers.length > 0) {
          for (const blocker of summary.blockers) {
            console.log(chalk.yellow(`  ${blocker.code}: ${blocker.message}`));
          }
        }
        if (result.history.length > 0) {
          console.log(chalk.dim(`  Prior immutable versions: ${result.history.length}`));
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  program
    .command('agent:change-access <id>')
    .description('Preview or apply a governed Run Access phase change')
    .requiredOption('--attempt <attemptId>', 'Exact active attempt ID')
    .requiredOption(
      '--target-phase <phase>',
      'Target phase (explore, plan, implement, verify, publish)'
    )
    .requiredOption('--reason <text>', 'Operator reason bound to the reviewed diff')
    .option('--request <id>', 'Stable request ID; required when retrying an approval')
    .option('--approval-id <id>', 'Approved exact-action request ID')
    .option('--approval-ttl-ms <milliseconds>', 'Approval request lifetime')
    .option('--apply', 'Apply the exact preview; otherwise preview only')
    .option('--json', 'Output the versioned machine-readable contract')
    .action(async (id: string, options: RunAccessChangeOptions): Promise<void> => {
      try {
        const taskId = await resolveTaskId(id);
        const state = await api<{ phase: RunPhaseAuthoritySnapshot | null }>(
          `/api/agents/${taskId}/phase?attemptId=${encodeURIComponent(options.attempt)}`
        );
        if (!state.phase) throw new Error('This run has no governed phase authority');
        const access = await api<RunAccessSummaryResponse>(
          `/api/agents/${taskId}/access?attemptId=${encodeURIComponent(options.attempt)}`
        );
        const approvalTtlMs = options.approvalTtlMs ? Number(options.approvalTtlMs) : undefined;
        if (options.approvalTtlMs && !Number.isSafeInteger(approvalTtlMs)) {
          throw new Error('--approval-ttl-ms must be an integer');
        }
        const body = {
          attemptId: options.attempt,
          requestId: options.request ?? `access-${randomUUID()}`,
          operation: 'transition-phase' as const,
          targetPhase: options.targetPhase,
          reason: options.reason,
          expectedAccessSummaryDigest: access.current.digest,
          expectedSequence: state.phase.transitionSequence,
          expectedPhaseEvidenceDigest: state.phase.effectiveEvidence.digest,
          expectedManifestDigest: state.phase.manifestDigest,
          approvalId: options.approvalId,
          approvalTtlMs,
        };
        const preview = await api<RunAccessChangePreview>(
          `/api/agents/${taskId}/access/changes/preview`,
          { method: 'POST', body: JSON.stringify(body) }
        );
        const result = options.apply
          ? await api<RunAccessChangeResult>(`/api/agents/${taskId}/access/changes`, {
              method: 'POST',
              body: JSON.stringify({ ...body, requestRevision: preview.requestRevision }),
            })
          : undefined;
        if (options.json) {
          console.log(JSON.stringify(result ?? preview, null, 2));
          return;
        }
        console.log(
          preview.enforcement.state === 'ready'
            ? chalk.green(`Run Access change ready: ${preview.targetPhase}`)
            : chalk.yellow(`Run Access change blocked: ${preview.targetPhase}`)
        );
        console.log(chalk.dim(`Request: ${preview.requestId}`));
        console.log(chalk.dim(`Revision: ${preview.requestRevision}`));
        for (const entry of preview.authorityDelta.entries) {
          console.log(
            `  ${entry.dimension}: +${entry.addedScopes.join(', ') || 'none'} -${entry.removedScopes.join(', ') || 'none'}`
          );
        }
        for (const blocker of preview.enforcement.blockers) {
          console.log(chalk.yellow(`  ${blocker.code}: ${blocker.message}`));
        }
        console.log(
          chalk.dim(
            `Budget: ${preview.budgetImpact.classification} (${preview.budgetImpact.after.reservationState})`
          )
        );
        if (result?.transition.status === 'approval-required' && result.transition.approval) {
          console.log(chalk.yellow('Exact-action approval required'));
          console.log(`  Approval: ${result.transition.approval.id}`);
          console.log(
            chalk.dim('Approve it, then rerun with the same --request and --approval-id values.')
          );
        } else if (result?.transition.record) {
          console.log(chalk.green(`Applied access version #${result.transition.record.sequence}`));
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  program
    .command('agent:transition-phase <id>')
    .description('Apply or request approval for one compare-and-set phase transition')
    .requiredOption('--attempt <attemptId>', 'Exact active attempt ID')
    .requiredOption('--operation <id>', 'Stable idempotency key for this transition')
    .requiredOption('--target-evidence <file>', 'Compiled target phase evidence JSON')
    .requiredOption('--reason <text>', 'Operator reason')
    .option('--from-evidence <file>', 'Initial phase evidence JSON for the first transition')
    .option('--manifest <digest>', 'Launch manifest digest for the first transition')
    .option('--approval-id <id>', 'Exact approval returned by the prior request')
    .option('--approval-ttl-ms <milliseconds>', 'Approval request lifetime')
    .option('--override-until <timestamp>', 'Emergency override expiry, at most 24 hours')
    .option('--override-reason <text>', 'Emergency override justification')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: PhaseTransitionOptions): Promise<void> => {
      try {
        const taskId = await resolveTaskId(id);
        const state = await api<{
          phase: RunPhaseAuthoritySnapshot | null;
          current: PhaseTransitionRecord | null;
          history: PhaseTransitionRecord[];
        }>(`/api/agents/${taskId}/phase?attemptId=${encodeURIComponent(options.attempt)}`);
        const fromEvidence = options.fromEvidence
          ? readPhaseEvidence(options.fromEvidence)
          : undefined;
        const priorEvidence =
          state.phase?.effectiveEvidence ?? state.current?.effectiveEvidence ?? fromEvidence;
        if (!priorEvidence) {
          throw new Error('The first transition requires --from-evidence');
        }
        const manifestDigest =
          state.phase?.manifestDigest ?? state.current?.manifestDigest ?? options.manifest;
        if (!manifestDigest) {
          throw new Error('The first transition requires --manifest');
        }
        if (
          (options.overrideUntil && !options.overrideReason) ||
          (!options.overrideUntil && options.overrideReason)
        ) {
          throw new Error('--override-until and --override-reason must be used together');
        }
        const approvalTtlMs =
          options.approvalTtlMs && /^\d+$/.test(options.approvalTtlMs)
            ? Number(options.approvalTtlMs)
            : undefined;
        if (options.approvalTtlMs && !Number.isSafeInteger(approvalTtlMs)) {
          throw new Error('--approval-ttl-ms must be an integer');
        }
        const result = await api<PhaseTransitionResult>(`/api/agents/${taskId}/phase/transitions`, {
          method: 'POST',
          body: JSON.stringify({
            attemptId: options.attempt,
            operationId: options.operation,
            expectedSequence: state.current?.sequence ?? 0,
            expectedPhaseEvidenceDigest: priorEvidence.digest,
            expectedManifestDigest: manifestDigest,
            reason: options.reason,
            ...(state.current ? {} : { fromEvidence: priorEvidence }),
            targetEvidence: readPhaseEvidence(options.targetEvidence),
            approvalId: options.approvalId,
            approvalTtlMs,
            ...(options.overrideUntil && options.overrideReason
              ? {
                  emergencyOverride: {
                    expiresAt: options.overrideUntil,
                    justification: options.overrideReason,
                  },
                }
              : {}),
          }),
        });
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else if (result.status === 'approval-required' && result.approval) {
          console.log(chalk.yellow('Phase expansion requires approval'));
          console.log(`  Approval: ${result.approval.id}`);
          console.log(`  Revision: ${result.approval.revision}`);
          console.log(`  Action hash: ${result.approval.actionHash}`);
          console.log(
            chalk.dim('Approve it, then retry this command with the same --operation value.')
          );
        } else if (result.record) {
          console.log(chalk.green(`✓ Phase transitioned to ${phaseIdentityLabel(result.record)}`));
          console.log(chalk.dim(`Sequence: ${result.record.sequence}`));
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  program
    .command('agent:decide-phase-approval <approvalId>')
    .description('Approve or reject an exact pending phase transition')
    .requiredOption('--decision <decision>', 'approve or reject')
    .option('--note <text>', 'Decision note')
    .option('--json', 'Output as JSON')
    .action(
      async (
        approvalId: string,
        options: { decision: string; note?: string; json?: boolean }
      ): Promise<void> => {
        try {
          if (!['approve', 'reject'].includes(options.decision)) {
            throw new Error('--decision must be approve or reject');
          }
          const approval = await api<RunApprovalRequest>(
            `/api/run-approvals/${encodeURIComponent(approvalId)}`
          );
          const decided = await api<RunApprovalRequest>(
            `/api/run-approvals/${encodeURIComponent(approval.id)}/decision`,
            {
              method: 'POST',
              body: JSON.stringify({
                decision: options.decision === 'approve' ? 'approved' : 'rejected',
                expectedRevision: approval.revision,
                expectedActionHash: approval.actionHash,
                note: options.note,
              }),
            }
          );
          if (options.json) {
            console.log(JSON.stringify(decided, null, 2));
          } else {
            console.log(chalk.green(`✓ Phase transition approval ${decided.status}`));
          }
        } catch (err) {
          console.error(chalk.red(`Error: ${(err as Error).message}`));
          process.exit(1);
        }
      }
    );

  program
    .command('agent:cancel-recovery <id>')
    .description('Cancel the exact pending retry or fallback for a task')
    .requiredOption('--attempt <attemptId>', 'Parent attempt that owns the pending recovery')
    .option('--json', 'Output as JSON')
    .action(async (id, options: { attempt: string; json?: boolean }) => {
      try {
        const taskId = await resolveTaskId(id);
        const result = await api<{ cancelled: boolean; recovery: RunRecoveryRecord }>(
          `/api/agents/${taskId}/recovery/cancel`,
          {
            method: 'POST',
            body: JSON.stringify({ attemptId: options.attempt }),
          }
        );
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(chalk.yellow('✓ Automatic recovery cancelled'));
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  registerConversationTurnCommand(
    program,
    'resume',
    'Resume a terminal provider conversation without replaying prior prompts'
  );
  registerConversationTurnCommand(
    program,
    'follow-up',
    'Start a provider-native follow-up turn from a terminal attempt'
  );
  registerConversationTurnCommand(
    program,
    'fork',
    'Fork provider-native history from a terminal attempt'
  );

  program
    .command('agent:steer <id>')
    .description('Steer the exact active provider turn')
    .requiredOption('--attempt <attemptId>', 'Exact active attempt ID')
    .requiredOption('-m, --message <text>', 'Steering message')
    .option('--json', 'Output as JSON')
    .action(
      async (
        id: string,
        options: ConversationControlOptions & { message: string }
      ): Promise<void> => {
        try {
          const taskId = await resolveTaskId(id);
          const result = await api<ConversationLifecycleResult>(
            `/api/agents/${taskId}/conversation/steer`,
            {
              method: 'POST',
              body: JSON.stringify({
                attemptId: options.attempt,
                message: options.message,
              }),
            }
          );
          printConversationResult('steered', result, options.json);
        } catch (err) {
          console.error(chalk.red(`Error: ${(err as Error).message}`));
          process.exit(1);
        }
      }
    );

  registerConversationControlCommand(
    program,
    'interrupt',
    'Interrupt the exact active provider turn'
  );
  registerConversationControlCommand(
    program,
    'compact',
    'Compact the active provider conversation'
  );
  registerConversationControlCommand(
    program,
    'archive',
    'Archive the active provider conversation'
  );
  registerConversationControlCommand(program, 'close', 'Close the active provider conversation');

  // Get pending agent requests (for Veritas to process)
  program
    .command('agents:pending')
    .description('List pending agent requests waiting for Clawdbot to process')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const pending = await api<
          {
            taskId: string;
            attemptId: string;
            prompt: string;
            requestedAt: string;
            callbackUrl: string;
          }[]
        >('/api/agents/pending');

        if (options.json) {
          console.log(JSON.stringify(pending, null, 2));
        } else if (pending.length === 0) {
          console.log(chalk.dim('No pending agent requests'));
        } else {
          console.log(chalk.bold(`\n🤖 ${pending.length} Pending Agent Request(s)\n`));

          pending.forEach(
            (req: {
              taskId: string;
              attemptId: string;
              prompt: string;
              requestedAt: string;
              callbackUrl: string;
            }) => {
              console.log(chalk.cyan(`Task: ${req.taskId}`));
              console.log(chalk.dim(`  Attempt: ${req.attemptId}`));
              console.log(chalk.dim(`  Requested: ${new Date(req.requestedAt).toLocaleString()}`));
              console.log(chalk.dim(`  Callback: ${req.callbackUrl}`));
              console.log();

              // Print first few lines of prompt
              const promptLines = req.prompt.split('\n').slice(0, 10);
              console.log(chalk.dim('─'.repeat(50)));
              promptLines.forEach((line: string) => console.log(chalk.dim(`  ${line}`)));
              if (req.prompt.split('\n').length > 10) {
                console.log(chalk.dim('  ...'));
              }
              console.log(chalk.dim('─'.repeat(50)));
              console.log();
            }
          );
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // Complete an agent request (called by Clawdbot after sub-agent finishes)
  program
    .command('agents:complete <taskId>')
    .description('Mark an agent request as complete')
    .option('-s, --success', 'Mark as successful (default)')
    .option('-f, --failed', 'Mark as failed')
    .option('-m, --summary <text>', 'Summary of what was done')
    .option('-e, --error <text>', 'Error message (if failed)')
    .requiredOption('--attempt-id <id>', 'Attempt ID that produced this completion')
    .requiredOption(
      '--manifest-digest <digest>',
      'Provider runtime manifest digest bound to the attempt'
    )
    .action(async (taskId, options) => {
      try {
        const success = !options.failed;
        const body = {
          attemptId: options.attemptId,
          providerRuntimeManifestDigest: options.manifestDigest,
          success,
          summary: options.summary,
          error: options.error,
        };

        await api(`/api/agents/${taskId}/complete`, {
          method: 'POST',
          body: JSON.stringify(body),
        });

        if (success) {
          console.log(chalk.green(`✓ Task ${taskId} marked as complete`));
        } else {
          console.log(chalk.yellow(`⚠ Task ${taskId} marked as failed`));
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // Get agent status for a task
  program
    .command('agents:status <taskId>')
    .description('Get agent status for a task')
    .option('--json', 'Output as JSON')
    .action(async (taskId, options) => {
      try {
        const status = await api<{
          running: boolean;
          taskId?: string;
          attemptId?: string;
          agent?: string;
          status?: string;
          startedAt?: string;
        }>(`/api/agents/${taskId}/status`);

        if (options.json) {
          console.log(JSON.stringify(status, null, 2));
        } else if (!status.running) {
          console.log(chalk.dim('No agent running for this task'));
        } else {
          console.log(chalk.yellow(`🤖 Agent Running`));
          console.log(`  Task: ${status.taskId}`);
          console.log(`  Attempt: ${status.attemptId}`);
          console.log(`  Agent: ${status.agent}`);
          console.log(
            `  Started: ${status.startedAt ? new Date(status.startedAt).toLocaleString() : 'unknown'}`
          );
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });
}
