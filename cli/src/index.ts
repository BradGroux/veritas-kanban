#!/usr/bin/env node
import { Command } from 'commander';
import { registerTaskCommands } from './commands/tasks.js';
import { registerAgentCommands } from './commands/agents.js';
import { registerAutomationCommands } from './commands/automation.js';
import { registerNotificationCommands } from './commands/notifications.js';
import { registerSummaryCommands } from './commands/summary.js';
import { registerGitHubCommands } from './commands/github.js';

const program = new Command();

program
  .name('vk')
  .description('Veritas Kanban CLI - Task management for AI agents')
  .version('0.1.0');

// Register all command groups
registerTaskCommands(program);
registerAgentCommands(program);
registerAutomationCommands(program);
registerNotificationCommands(program);
registerSummaryCommands(program);
registerGitHubCommands(program);

program.parse();
