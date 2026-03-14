#!/usr/bin/env tsx
/**
 * CLI script to reset security settings
 * Usage: pnpm run reset-password
 */

import readline from 'readline';
import { resetSecurityConfig } from '../config/security.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

async function main() {
  console.log('\n🔐 Veritas Kanban - Password Reset\n');
  console.log('This will:');
  console.log('  - Clear the current password');
  console.log('  - Clear the recovery key');
  console.log('  - Invalidate all sessions');
  console.log('  - Show the setup screen on next load\n');

  const answer = await prompt('Are you sure you want to reset? (yes/no): ');

  if (answer.toLowerCase() !== 'yes') {
    console.log('\n❌ Reset cancelled.\n');
    rl.close();
    process.exit(0);
  }

  try {
    resetSecurityConfig();
    console.log('\n✅ Security settings reset successfully!');
    console.log('   Next time you load the app, you will see the setup screen.\n');
  } catch (err) {
    console.error(
      '\n❌ Failed to reset security settings:',
      err instanceof Error ? err.message : 'Unknown error'
    );
    process.exit(1);
  }

  rl.close();
}

main();
