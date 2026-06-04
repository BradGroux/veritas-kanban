import { Command } from 'commander';
import chalk from 'chalk';
import { api } from '../utils/api.js';
import { findTask } from '../utils/find.js';
import type {
  TokenMetrics,
  DurationMetrics,
  TaskCostMetrics,
  TaskCostEntry,
} from '../utils/types.js';

/**
 * Format a number as currency (e.g., "$0.42")
 */
function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

/**
 * Format a duration in milliseconds to human-readable format
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }
  if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Format large numbers with commas (e.g., 1,234,567)
 */
function formatNumber(num: number): string {
  return num.toLocaleString('en-US');
}

/**
 * Display usage summary (default behavior)
 */
async function displayUsageSummary(period: string, json: boolean): Promise<void> {
  try {
    // Fetch token metrics
    const tokenMetrics = await api<TokenMetrics>(`/api/metrics/tokens?period=${period}`);

    // Fetch duration metrics
    const durationMetrics = await api<DurationMetrics>(`/api/metrics/duration?period=${period}`);

    if (json) {
      console.log(
        JSON.stringify(
          {
            period,
            tokens: tokenMetrics,
            duration: durationMetrics,
          },
          null,
          2
        )
      );
      return;
    }

    // Display summary in table format
    console.log(chalk.bold(`\n📊 Usage Summary (${period})\n`));
    console.log(chalk.dim('─'.repeat(60)));

    // Token usage
    console.log(chalk.bold('\n💬 Token Usage'));
    console.log(`  Total Tokens:  ${chalk.cyan(formatNumber(tokenMetrics.totalTokens))}`);
    console.log(`  Input Tokens:  ${chalk.white(formatNumber(tokenMetrics.inputTokens))}`);
    console.log(`  Output Tokens: ${chalk.white(formatNumber(tokenMetrics.outputTokens))}`);
    if (tokenMetrics.cacheTokens > 0) {
      console.log(`  Cache Tokens:  ${chalk.green(formatNumber(tokenMetrics.cacheTokens))}`);
    }
    console.log(`  Runs:          ${chalk.white(formatNumber(tokenMetrics.runs))}`);

    // Cost estimation (simple: $0.01/1K input, $0.03/1K output)
    const estimatedCost =
      (tokenMetrics.inputTokens / 1000) * 0.01 + (tokenMetrics.outputTokens / 1000) * 0.03;
    console.log(`  Estimated Cost: ${chalk.yellow(formatCost(estimatedCost))}`);

    // Duration metrics
    console.log(chalk.bold('\n⏱️  Time Spent'));
    console.log(`  Average:   ${chalk.cyan(formatDuration(durationMetrics.avgMs))}`);
    console.log(`  Median:    ${chalk.white(formatDuration(durationMetrics.p50Ms))}`);
    console.log(`  95th %ile: ${chalk.white(formatDuration(durationMetrics.p95Ms))}`);

    console.log(chalk.dim('\n─'.repeat(60)));
    console.log(chalk.dim(`\n💡 Tip: Use --agent <name> or --task <id> for detailed breakdowns\n`));
  } catch (err) {
    console.error(chalk.red(`Error: ${(err as Error).message}`));
    process.exit(1);
  }
}

/**
 * Display per-agent usage breakdown
 */
async function displayAgentUsage(agentName: string, period: string, json: boolean): Promise<void> {
  try {
    const tokenMetrics = await api<TokenMetrics>(`/api/metrics/tokens?period=${period}`);
    const durationMetrics = await api<DurationMetrics>(`/api/metrics/duration?period=${period}`);

    // Find agent in breakdown
    const agentTokens = tokenMetrics.byAgent.find(
      (a: {
        agent: string;
        totalTokens: number;
        inputTokens: number;
        outputTokens: number;
        cacheTokens: number;
      }) => a.agent === agentName
    );
    const agentDuration = durationMetrics.byAgent.find(
      (a: { agent: string; runs: number; avgMs: number; p50Ms: number; p95Ms: number }) =>
        a.agent === agentName
    );

    if (!agentTokens && !agentDuration) {
      console.error(chalk.red(`No data found for agent: ${agentName}`));
      console.log(chalk.dim('\nAvailable agents:'));
      tokenMetrics.byAgent.forEach(
        (a: {
          agent: string;
          totalTokens: number;
          inputTokens: number;
          outputTokens: number;
          cacheTokens: number;
        }) => console.log(chalk.dim(`  - ${a.agent}`))
      );
      process.exit(1);
    }

    if (json) {
      console.log(
        JSON.stringify(
          {
            agent: agentName,
            period,
            tokens: agentTokens || null,
            duration: agentDuration || null,
          },
          null,
          2
        )
      );
      return;
    }

    console.log(chalk.bold(`\n📊 Agent Usage: ${agentName} (${period})\n`));
    console.log(chalk.dim('─'.repeat(60)));

    if (agentTokens) {
      console.log(chalk.bold('\n💬 Token Usage'));
      console.log(`  Total Tokens:  ${chalk.cyan(formatNumber(agentTokens.totalTokens))}`);
      console.log(`  Input Tokens:  ${chalk.white(formatNumber(agentTokens.inputTokens))}`);
      console.log(`  Output Tokens: ${chalk.white(formatNumber(agentTokens.outputTokens))}`);
      if (agentTokens.cacheTokens > 0) {
        console.log(`  Cache Tokens:  ${chalk.green(formatNumber(agentTokens.cacheTokens))}`);
      }
      console.log(`  Runs:          ${chalk.white(formatNumber(agentTokens.runs))}`);

      const estimatedCost =
        (agentTokens.inputTokens / 1000) * 0.01 + (agentTokens.outputTokens / 1000) * 0.03;
      console.log(`  Estimated Cost: ${chalk.yellow(formatCost(estimatedCost))}`);
    }

    if (agentDuration) {
      console.log(chalk.bold('\n⏱️  Time Spent'));
      console.log(`  Runs:      ${chalk.white(formatNumber(agentDuration.runs))}`);
      console.log(`  Average:   ${chalk.cyan(formatDuration(agentDuration.avgMs))}`);
      console.log(`  Median:    ${chalk.white(formatDuration(agentDuration.p50Ms))}`);
      console.log(`  95th %ile: ${chalk.white(formatDuration(agentDuration.p95Ms))}`);
    }

    console.log(chalk.dim('\n─'.repeat(60) + '\n'));
  } catch (err) {
    console.error(chalk.red(`Error: ${(err as Error).message}`));
    process.exit(1);
  }
}

/**
 * Display per-task usage breakdown
 */
async function displayTaskUsage(taskId: string, period: string, json: boolean): Promise<void> {
  try {
    // Find task to get full ID
    const task = await findTask(taskId);
    if (!task) {
      console.error(chalk.red(`Task not found: ${taskId}`));
      process.exit(1);
    }

    // Fetch task cost data
    const taskCostMetrics = await api<TaskCostMetrics>(`/api/metrics/task-cost?period=${period}`);

    // Find this specific task
    const taskCost = taskCostMetrics.tasks.find((t: TaskCostEntry) => t.taskId === task.id);

    if (!taskCost) {
      console.error(chalk.red(`No usage data found for task: ${task.title}`));
      console.log(chalk.dim('\nThis task may not have any activity in the selected period.'));
      process.exit(1);
    }

    if (json) {
      console.log(
        JSON.stringify(
          {
            taskId: task.id,
            taskTitle: task.title,
            period,
            usage: taskCost,
          },
          null,
          2
        )
      );
      return;
    }

    console.log(chalk.bold(`\n📊 Task Usage: ${task.title}\n`));
    console.log(chalk.dim(`   ID: ${task.id}`));
    console.log(chalk.dim('─'.repeat(60)));

    console.log(chalk.bold('\n💬 Token Usage'));
    console.log(`  Total Tokens:  ${chalk.cyan(formatNumber(taskCost.totalTokens))}`);
    console.log(`  Input Tokens:  ${chalk.white(formatNumber(taskCost.inputTokens))}`);
    console.log(`  Output Tokens: ${chalk.white(formatNumber(taskCost.outputTokens))}`);

    console.log(chalk.bold('\n💰 Cost'));
    console.log(`  Total Cost:     ${chalk.yellow(formatCost(taskCost.estimatedCost))}`);
    console.log(`  Runs:           ${chalk.white(formatNumber(taskCost.runs))}`);
    console.log(`  Avg Cost/Run:   ${chalk.white(formatCost(taskCost.avgCostPerRun))}`);

    console.log(chalk.dim('\n─'.repeat(60) + '\n'));
  } catch (err) {
    console.error(chalk.red(`Error: ${(err as Error).message}`));
    process.exit(1);
  }
}

export function registerUsageCommands(program: Command): void {
  program
    .command('usage')
    .description('Display usage statistics (tokens, costs, time)')
    .option(
      '--period <period>',
      'Time period: today, 24h, 3d, 7d, 30d, 3m, 6m, 12m, wtd, mtd, ytd',
      '7d'
    )
    .option('--agent <name>', 'Show usage breakdown for a specific agent')
    .option('--task <id>', 'Show usage breakdown for a specific task')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const period = options.period;

      // Validate period
      const validPeriods = [
        'today',
        '24h',
        '3d',
        '7d',
        '30d',
        '3m',
        '6m',
        '12m',
        'wtd',
        'mtd',
        'ytd',
      ];
      if (!validPeriods.includes(period)) {
        console.error(
          chalk.red(`Invalid period: ${period}. Must be one of: ${validPeriods.join(', ')}`)
        );
        process.exit(1);
      }

      if (options.task) {
        await displayTaskUsage(options.task, period, options.json);
      } else if (options.agent) {
        await displayAgentUsage(options.agent, period, options.json);
      } else {
        await displayUsageSummary(period, options.json);
      }
    });
}
