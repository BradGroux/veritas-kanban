#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { registerTaskCommands } from './commands/tasks.js';
import { registerBacklogCommands } from './commands/backlog.js';
import { registerAgentCommands } from './commands/agents.js';
import { registerAutomationCommands } from './commands/automation.js';
import { registerNotificationCommands } from './commands/notifications.js';
import { registerSummaryCommands } from './commands/summary.js';
import { registerGitHubCommands } from './commands/github.js';
import { registerTimeCommands } from './commands/time.js';
import { registerCommentCommands } from './commands/comments.js';
import { registerAgentStatusCommands } from './commands/agent-status.js';
import { registerProjectCommands } from './commands/projects.js';
import { registerWorkflowCommands } from './commands/workflow.js';
import { registerSetupCommands } from './commands/setup.js';
import { registerUsageCommands } from './commands/usage.js';
import { registerSprintCommands } from './commands/sprints.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerSnapshotCommand } from './commands/snapshot.js';
import { registerPromptCommands } from './commands/prompts.js';
import { registerWorkspaceCommands } from './commands/workspaces.js';
import { registerSchedulerCommands } from './commands/scheduler.js';
import { registerQueueMonitorCommands } from './commands/queue-monitors.js';

const program = new Command();
const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf-8')
) as { version?: string };

program
  .name('vk')
  .description('Veritas Kanban CLI - Task management for AI agents')
  .version(packageJson.version ?? '0.0.0');

// Register all command groups
registerTaskCommands(program);
registerBacklogCommands(program);
registerAgentCommands(program);
registerAutomationCommands(program);
registerNotificationCommands(program);
registerSummaryCommands(program);
registerGitHubCommands(program);
registerTimeCommands(program);
registerCommentCommands(program);
registerAgentStatusCommands(program);
registerProjectCommands(program);
registerWorkflowCommands(program);
registerSetupCommands(program);
registerUsageCommands(program);
registerSprintCommands(program);
registerDoctorCommand(program);
registerSnapshotCommand(program);
registerPromptCommands(program);
registerWorkspaceCommands(program);
registerSchedulerCommands(program);
registerQueueMonitorCommands(program);

program.parse();
