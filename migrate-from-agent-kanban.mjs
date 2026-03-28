#!/usr/bin/env node
/**
 * Migration script: agent-kanban → Veritas Kanban
 * Reads kanban.json from old agent-kanban and creates tasks via Veritas API.
 */

import { readFileSync } from 'fs';

const API_URL = process.env.VERITAS_URL || 'https://bot.srv929662.hstgr.cloud/kanban/api/v1';
const API_KEY = process.env.VERITAS_ADMIN_KEY || '97df4be74d8c2b258e9983b728b05ca39a9baa79ec671558';
const SOURCE_FILE = process.env.SOURCE_FILE || '/home/francois352/agent-kanban/kanban.json';
const DRY_RUN = process.argv.includes('--dry-run');

// Status mapping: agent-kanban → Veritas
// Valid Veritas statuses: todo, in-progress, blocked, done, cancelled
const STATUS_MAP = {
  'todo': 'todo',
  'in-progress': 'in-progress',
  'done': 'done',
  'blocked': 'blocked',
  'backlog': 'todo',       // no backlog in Veritas → todo
  'archive': 'done',       // archive → done
};

// Priority mapping (both use low/medium/high)
const PRIORITY_MAP = {
  'low': 'low',
  'medium': 'medium',
  'high': 'high',
  'critical': 'high', // no critical in Veritas
};

async function apiCall(method, path, body = null, retries = 3) {
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);

  for (let attempt = 0; attempt < retries; attempt++) {
    const resp = await fetch(`${API_URL}${path}`, opts);
    const text = await resp.text();
    let result;
    try { result = JSON.parse(text); } catch { result = { raw: text, status: resp.status }; }

    // Retry on rate limiting
    if (result?.error?.message?.includes('Too many write requests')) {
      const wait = 3000 * (attempt + 1);
      console.log(`  Rate limited, waiting ${wait}ms (attempt ${attempt + 1}/${retries})...`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    return result;
  }
  return { success: false, error: { message: 'Max retries exceeded' } };
}

async function migrateTask(task) {
  const priority = PRIORITY_MAP[task.priority] || 'medium';
  const status = STATUS_MAP[task.status] || 'todo';

  // Build description with metadata from old system
  let desc = task.description || '';
  if (task.blockedReason) desc += `\n\n**Blocked reason:** ${task.blockedReason}`;
  if (task.subtasks?.length) {
    desc += '\n\n**Subtasks:**\n';
    for (const st of task.subtasks) {
      desc += `- [${st.done ? 'x' : ' '}] ${st.title}\n`;
    }
  }
  if (task.tags?.length) desc += `\n\n**Tags:** ${task.tags.join(', ')}`;
  if (task.assignee) desc += `\n\n**Original assignee:** ${task.assignee}`;
  desc += `\n\n---\n*Migrated from agent-kanban (${task.id})*`;

  const createBody = {
    title: task.title.substring(0, 200),
    description: desc,
    priority,
    project: task.project !== '?' ? task.project : undefined,
    // Don't set agent — requires registry. Assignee info is in description.
  };

  if (DRY_RUN) {
    console.log(`[DRY] Would create: ${task.id} → "${task.title}" (${status})`);
    return { id: 'dry-run', title: task.title };
  }

  // Create task (starts as 'todo')
  const created = await apiCall('POST', '/tasks', createBody);
  if (!created.success) {
    console.error(`FAIL create ${task.id}: ${JSON.stringify(created)}`);
    return null;
  }

  const newId = created.data.id;
  console.log(`Created: ${task.id} → ${newId} "${task.title}"`);

  // Update status if not 'todo'
  if (status !== 'todo') {
    const patched = await apiCall('PATCH', `/tasks/${newId}`, { status });
    if (!patched.success) {
      console.warn(`  WARN: status update to '${status}' failed for ${newId}`);
    } else {
      console.log(`  Status → ${status}`);
    }
  }

  // Add comments
  if (task.comments?.length) {
    for (const c of task.comments) {
      const commentBody = {
        content: `[${c.author || 'unknown'}] ${c.text}`,
        author: c.author || 'migration',
      };
      const commented = await apiCall('POST', `/tasks/${newId}/comments`, commentBody);
      if (commented.success) {
        console.log(`  Comment added (${c.author})`);
      }
    }
  }

  return created.data;
}

async function main() {
  console.log(`Reading ${SOURCE_FILE}...`);
  const raw = readFileSync(SOURCE_FILE, 'utf8');
  const data = JSON.parse(raw);
  const tasks = data.tasks;

  console.log(`Found ${tasks.length} tasks to migrate`);
  if (DRY_RUN) console.log('DRY RUN — no changes will be made\n');

  let success = 0, failed = 0;

  for (const task of tasks) {
    try {
      const result = await migrateTask(task);
      if (result) success++;
      else failed++;
    } catch (err) {
      console.error(`ERROR ${task.id}: ${err.message}`);
      failed++;
    }
    // Delay to avoid rate limiting (Veritas has write throttling)
    if (!DRY_RUN) await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`\nMigration complete: ${success} succeeded, ${failed} failed`);
}

main().catch(console.error);
