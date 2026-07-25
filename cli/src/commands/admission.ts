import { Command } from 'commander';
import chalk from 'chalk';
import type {
  AdmissionReservation,
  AdmissionReservationState,
  ExecutionTreeBudgetSummary,
} from '@veritas-kanban/shared';
import { api } from '../utils/api.js';

interface AdmissionListResponse {
  generatedAt: string;
  reservations: AdmissionReservation[];
}

export function registerAdmissionCommands(program: Command): void {
  const admission = program
    .command('admission')
    .description('Inspect durable execution admission reservations');

  admission
    .command('list')
    .description('List active or recently terminal admission reservations')
    .option('--workspace <id>', 'Filter by workspace')
    .option('--task <id>', 'Filter by task')
    .option('--root-task <id>', 'Filter by root task')
    .option('--provider <provider>', 'Filter by provider')
    .option('--host <id>', 'Filter by launch host')
    .option('--workflow-run <id>', 'Filter by workflow run')
    .option('--workflow-step <id>', 'Filter by workflow step')
    .option('--root-reservation <id>', 'Filter by workflow root reservation')
    .option('--root-objective <id>', 'Filter by execution-tree root objective')
    .option('--node <id>', 'Filter by execution-tree node')
    .option('--parent-node <id>', 'Filter by execution-tree parent node')
    .option('--state <states...>', 'Filter by state (active, released, expired)')
    .option('--limit <count>', 'Maximum records', '100')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const query = new URLSearchParams();
        if (options.workspace) query.set('workspaceId', options.workspace);
        if (options.task) query.set('taskId', options.task);
        if (options.rootTask) query.set('rootTaskId', options.rootTask);
        if (options.provider) query.set('provider', options.provider);
        if (options.host) query.set('hostId', options.host);
        if (options.workflowRun) query.set('workflowRunId', options.workflowRun);
        if (options.workflowStep) query.set('workflowStepId', options.workflowStep);
        if (options.rootReservation) query.set('rootReservationId', options.rootReservation);
        if (options.rootObjective) query.set('rootObjectiveId', options.rootObjective);
        if (options.node) query.set('nodeId', options.node);
        if (options.parentNode) query.set('parentNodeId', options.parentNode);
        for (const state of (options.state ?? []) as AdmissionReservationState[]) {
          query.append('state', state);
        }
        query.set('limit', options.limit);
        const result = await api<AdmissionListResponse>(`/api/admission?${query.toString()}`);
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        if (result.reservations.length === 0) {
          console.log(chalk.dim('No admission reservations matched.'));
          return;
        }
        for (const reservation of result.reservations) printReservation(reservation);
      } catch (error) {
        printError(error);
      }
    });

  admission
    .command('tree <root-objective-id>')
    .description('Inspect aggregate usage and reservations for one execution tree')
    .option('--limit <count>', 'Maximum contributors', '100')
    .option('--json', 'Output as JSON')
    .action(async (rootObjectiveId, options) => {
      try {
        const query = new URLSearchParams({ limit: options.limit });
        const result = await api<ExecutionTreeBudgetSummary>(
          `/api/admission/tree/${encodeURIComponent(rootObjectiveId)}?${query.toString()}`
        );
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        printExecutionTreeSummary(result);
      } catch (error) {
        printError(error);
      }
    });

  admission
    .command('get <id>')
    .description('Inspect one admission reservation')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        const result = await api<AdmissionReservation>(`/api/admission/${encodeURIComponent(id)}`);
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        printReservation(result, true);
      } catch (error) {
        printError(error);
      }
    });
}

function printReservation(reservation: AdmissionReservation, verbose = false): void {
  const state =
    reservation.state === 'active'
      ? chalk.green(reservation.state)
      : reservation.state === 'released'
        ? chalk.blue(reservation.state)
        : chalk.yellow(reservation.state);
  console.log(
    `${state} ${chalk.bold(reservation.id)} task=${reservation.request.taskId} provider=${reservation.request.provider}`
  );
  console.log(
    chalk.dim(
      `  workspace=${reservation.request.workspaceId} root=${reservation.request.rootTaskId} host=${reservation.request.hostId}`
    )
  );
  if (reservation.request.workflowRunId) {
    console.log(
      chalk.dim(
        `  workflow=${reservation.request.workflowRunId} step=${reservation.request.workflowStepId ?? 'root'} root-reservation=${reservation.request.rootReservationId ?? reservation.id}`
      )
    );
  }
  if (reservation.request.executionTree) {
    console.log(
      chalk.dim(
        `  objective=${reservation.request.executionTree.rootObjectiveId} node=${reservation.request.executionTree.nodeId} parent=${reservation.request.executionTree.parentNodeId ?? 'root'} edge=${reservation.request.executionTree.edge}`
      )
    );
  }
  console.log(
    chalk.dim(
      `  capacity runs=${reservation.request.requested.runSlots} processes=${reservation.request.requested.processSlots} memory=${reservation.request.requested.estimatedMemoryMb}MB`
    )
  );
  if (verbose || reservation.state === 'active') {
    console.log(
      chalk.dim(
        `  attempt=${reservation.attemptId ?? 'unbound'} lease=${reservation.lease.expiresAt} revision=${reservation.revision}`
      )
    );
  }
  if (reservation.release) {
    console.log(
      chalk.dim(`  released=${reservation.release.reason} at ${reservation.release.releasedAt}`)
    );
  }
}

function printExecutionTreeSummary(summary: ExecutionTreeBudgetSummary): void {
  console.log(chalk.bold(`Execution tree ${summary.rootObjectiveId}`));
  console.log(
    `  committed tokens=${summary.committed.totalTokens} cost=$${summary.committed.costUsd.toFixed(4)} tools=${summary.committed.toolCalls} runtime=${summary.committed.runtimeSeconds}s retries=${summary.committed.retries} fan-out=${summary.committed.fanOut}`
  );
  console.log(
    chalk.dim(
      `  reserved tokens=${summary.reserved.totalTokens} cost=$${summary.reserved.costUsd.toFixed(4)} tools=${summary.reserved.toolCalls} runtime=${summary.reserved.runtimeSeconds}s retries=${summary.reserved.retries} fan-out=${summary.reserved.fanOut}`
    )
  );
  for (const status of summary.policies) {
    console.log(
      `${status.blocksNextLaunch ? chalk.red('blocked') : chalk.green('available')} ${status.policy.name} (${status.policy.scope}:${status.policy.scopeId})`
    );
  }
  console.log(
    chalk.dim(
      `  contributors=${summary.contributorCount}${summary.truncated ? ` (showing ${summary.contributors.length})` : ''}`
    )
  );
}

function printError(error: unknown): void {
  console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
  process.exitCode = 1;
}
