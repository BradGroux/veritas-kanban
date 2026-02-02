#!/usr/bin/env node
import { Command } from 'commander';
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

const program = new Command();

program
  .name('vk')
  .description('Veritas Kanban CLI - Task management for AI agents')
  .version('0.1.0');

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

program.parse();
