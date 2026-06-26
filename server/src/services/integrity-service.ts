import fs from 'fs/promises';
import path from 'path';
import matter, { type MarkdownFrontmatterFile } from '../utils/frontmatter.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('integrity');

// ============================================
// Types
// ============================================

export interface IntegrityIssue {
  file: string;
  type: 'invalid-json' | 'invalid-frontmatter' | 'missing-field' | 'orphaned-ref' | 'unknown';
  message: string;
  recovered: boolean;
}

export interface IntegrityReport {
  filesChecked: number;
  issuesFound: number;
  issues: IntegrityIssue[];
  recoveredCount: number;
}

/** Required frontmatter fields for task files */
const REQUIRED_TASK_FIELDS = ['id', 'title', 'status', 'created'] as const;

/** Maximum number of backups to keep */
const MAX_BACKUPS = 5;

// ============================================
// Backup
// ============================================

/**
 * Create a timestamped backup of the entire data directory.
 * Skips if the data directory is empty or doesn't exist (fresh install).
 * Rotates to keep only the last `MAX_BACKUPS` backups.
 *
 * @returns The backup directory path, or empty string if skipped.
 */
export async function createBackup(dataDir: string): Promise<string> {
  const resolvedDir = path.resolve(dataDir);

  // Skip if data directory doesn't exist or is empty (fresh install)
  const exists = await dirExists(resolvedDir);
  if (!exists) {
    log.info({ dataDir: resolvedDir }, 'Data directory does not exist — skipping backup');
    return '';
  }

  const entries = await fs.readdir(resolvedDir);
  // Exclude the backups directory itself when checking emptiness
  const meaningful = entries.filter((e) => e !== 'backups');
  if (meaningful.length === 0) {
    log.info({ dataDir: resolvedDir }, 'Data directory is empty — skipping backup');
    return '';
  }

  // Build timestamped backup path
  const now = new Date();
  const stamp = formatTimestamp(now);
  const backupsRoot = path.join(resolvedDir, 'backups');
  const backupDir = path.join(backupsRoot, `backup-${stamp}`);

  await fs.mkdir(backupDir, { recursive: true });

  // Copy everything except the backups directory itself
  await copyDir(resolvedDir, backupDir, ['backups']);

  log.info({ backupDir }, 'Backup created');

  // Rotate: keep only the last MAX_BACKUPS
  await rotateBackups(backupsRoot);

  return backupDir;
}

// ============================================
// Integrity Checks
// ============================================

/**
 * Run integrity checks on all data files.
 *
 * - Validates JSON files in the data directory
 * - Validates task markdown files (frontmatter has required fields)
 * - Checks for orphaned subtask references
 * - Attempts recovery from latest backup for corrupt files
 *
 * Never throws — all issues are reported in the returned IntegrityReport.
 */
export async function runIntegrityChecks(dataDir: string): Promise<IntegrityReport> {
  const resolvedDir = path.resolve(dataDir);
  const report: IntegrityReport = {
    filesChecked: 0,
    issuesFound: 0,
    issues: [],
    recoveredCount: 0,
  };

  const exists = await dirExists(resolvedDir);
  if (!exists) {
    log.warn({ dataDir: resolvedDir }, 'Data directory does not exist — skipping integrity checks');
    return report;
  }

  // 1. Validate JSON config files in the data directory root
  await checkJsonFiles(resolvedDir, report);

  // 2. Validate task files (markdown with frontmatter)
  //    Tasks live at {projectRoot}/tasks/active/ — resolve relative to the
  //    data dir which sits at {projectRoot}/.veritas-kanban
  const projectRoot = path.resolve(resolvedDir, '..');
  const tasksDir = path.join(projectRoot, 'tasks', 'active');
  const tasksExist = await dirExists(tasksDir);
  if (tasksExist) {
    await checkTaskFiles(tasksDir, resolvedDir, report);
  }

  // 3. Check for orphaned subtask references
  if (tasksExist) {
    await checkOrphanedRefs(tasksDir, report);
  }

  if (report.issuesFound > 0) {
    log.warn(
      { issues: report.issuesFound, recovered: report.recoveredCount },
      'Integrity check completed with issues'
    );
  } else {
    log.info({ filesChecked: report.filesChecked }, 'Integrity check passed — no issues');
  }

  return report;
}

// ============================================
// Internal: JSON file validation
// ============================================

async function checkJsonFiles(dataDir: string, report: IntegrityReport): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(dataDir);
  } catch {
    return;
  }

  const jsonFiles = entries.filter((f) => f.endsWith('.json'));

  for (const file of jsonFiles) {
    const filePath = path.join(dataDir, file);
    report.filesChecked++;
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      JSON.parse(raw);
    } catch (err) {
      const issue: IntegrityIssue = {
        file: filePath,
        type: 'invalid-json',
        message: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
        recovered: false,
      };
      report.issuesFound++;

      // Attempt recovery from latest backup
      const recovered = await tryRecover(filePath, dataDir);
      if (recovered) {
        issue.recovered = true;
        report.recoveredCount++;
        log.info({ file: filePath }, 'Recovered corrupt JSON file from backup');
      } else {
        log.warn({ file: filePath }, 'Corrupt JSON file — no backup available for recovery');
      }

      report.issues.push(issue);
    }
  }
}

// ============================================
// Internal: Task file validation
// ============================================

async function checkTaskFiles(
  tasksDir: string,
  dataDir: string,
  report: IntegrityReport
): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(tasksDir);
  } catch {
    return;
  }

  const mdFiles = entries.filter((f) => f.endsWith('.md'));

  for (const file of mdFiles) {
    const filePath = path.join(tasksDir, file);
    report.filesChecked++;
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      let parsed: MarkdownFrontmatterFile<string>;
      try {
        parsed = matter(raw);
      } catch (fmErr) {
        const issue: IntegrityIssue = {
          file: filePath,
          type: 'invalid-frontmatter',
          message: `Invalid frontmatter: ${fmErr instanceof Error ? fmErr.message : String(fmErr)}`,
          recovered: false,
        };
        report.issuesFound++;

        // Attempt recovery
        const recovered = await tryRecoverTask(filePath, dataDir);
        if (recovered) {
          issue.recovered = true;
          report.recoveredCount++;
          log.info({ file: filePath }, 'Recovered corrupt task file from backup');
        }

        report.issues.push(issue);
        continue;
      }

      // Check required fields
      const data = parsed.data as Record<string, unknown>;
      for (const field of REQUIRED_TASK_FIELDS) {
        if (data[field] === undefined || data[field] === null || data[field] === '') {
          report.issuesFound++;
          report.issues.push({
            file: filePath,
            type: 'missing-field',
            message: `Missing required field: ${field}`,
            recovered: false,
          });
        }
      }
    } catch (err) {
      report.issuesFound++;
      report.issues.push({
        file: filePath,
        type: 'unknown',
        message: `Could not read file: ${err instanceof Error ? err.message : String(err)}`,
        recovered: false,
      });
    }
  }
}

// ============================================
// Internal: Orphaned reference checks
// ============================================

async function checkOrphanedRefs(tasksDir: string, report: IntegrityReport): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(tasksDir);
  } catch {
    return;
  }

  const mdFiles = entries.filter((f) => f.endsWith('.md'));

  // Build a set of all known task IDs
  const knownIds = new Set<string>();
  const taskParents = new Map<string, string>(); // taskId -> parentId

  for (const file of mdFiles) {
    const filePath = path.join(tasksDir, file);
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const parsed = matter(raw);
      const data = parsed.data as Record<string, unknown>;
      if (typeof data.id === 'string') {
        knownIds.add(data.id);
      }
      if (typeof data.parentId === 'string' && data.parentId) {
        taskParents.set(data.id as string, data.parentId);
      }
    } catch {
      // Already reported in checkTaskFiles — skip here
    }
  }

  // Check for orphaned parent references
  for (const [childId, parentId] of taskParents.entries()) {
    if (!knownIds.has(parentId)) {
      report.issuesFound++;
      report.issues.push({
        file: `task:${childId}`,
        type: 'orphaned-ref',
        message: `Task "${childId}" references non-existent parent "${parentId}"`,
        recovered: false,
      });
    }
  }
}

// ============================================
// Internal: Recovery
// ============================================

/**
 * Attempt to restore a corrupt data-dir file from the latest backup.
 */
async function tryRecover(filePath: string, dataDir: string): Promise<boolean> {
  const backupsRoot = path.join(dataDir, 'backups');
  const latestBackup = await getLatestBackup(backupsRoot);
  if (!latestBackup) return false;

  // Compute relative path within data dir
  const relativePath = path.relative(dataDir, filePath);
  const backupFile = path.join(latestBackup, relativePath);

  try {
    await fs.access(backupFile);
    const content = await fs.readFile(backupFile, 'utf-8');
    // Verify the backup copy is valid JSON before restoring
    JSON.parse(content);
    await fs.writeFile(filePath, content, 'utf-8');
    log.info({ file: filePath, backup: backupFile }, 'Restored file from backup');
    return true;
  } catch {
    return false;
  }
}

/**
 * Attempt to restore a corrupt task file from the latest backup.
 * Task files live outside the data dir, so we compute their backup location
 * relative to the project root.
 */
async function tryRecoverTask(filePath: string, dataDir: string): Promise<boolean> {
  const backupsRoot = path.join(dataDir, 'backups');
  const latestBackup = await getLatestBackup(backupsRoot);
  if (!latestBackup) return false;

  // Tasks are backed up under {backup}/tasks/active/
  const projectRoot = path.resolve(dataDir, '..');
  const relativePath = path.relative(projectRoot, filePath);
  // The backup mirrors {dataDir} which is {projectRoot}/.veritas-kanban
  // We don't back up tasks into the .veritas-kanban backup (they're outside it).
  // So task recovery isn't available via data-dir backup.
  // However, if the backup includes a tasks/ mirror, try it:
  const backupFile = path.join(latestBackup, '..', '..', relativePath);

  try {
    await fs.access(backupFile);
    const content = await fs.readFile(backupFile, 'utf-8');
    // Verify frontmatter parses
    matter(content);
    await fs.writeFile(filePath, content, 'utf-8');
    log.info({ file: filePath, backup: backupFile }, 'Restored task file from backup');
    return true;
  } catch {
    return false;
  }
}

async function getLatestBackup(backupsRoot: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(backupsRoot);
    const backups = entries
      .filter((e) => e.startsWith('backup-'))
      .sort()
      .reverse();
    if (backups.length === 0) return null;
    return path.join(backupsRoot, backups[0]);
  } catch {
    return null;
  }
}

// ============================================
// Internal: Backup rotation
// ============================================

async function rotateBackups(backupsRoot: string): Promise<void> {
  try {
    const entries = await fs.readdir(backupsRoot);
    const backups = entries.filter((e) => e.startsWith('backup-')).sort();

    if (backups.length <= MAX_BACKUPS) return;

    const toDelete = backups.slice(0, backups.length - MAX_BACKUPS);
    for (const dir of toDelete) {
      const fullPath = path.join(backupsRoot, dir);
      await fs.rm(fullPath, { recursive: true, force: true });
      log.info({ deleted: fullPath }, 'Rotated old backup');
    }
  } catch (err) {
    log.warn({ err }, 'Failed to rotate backups');
  }
}

// ============================================
// Internal: Helpers
// ============================================

async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function formatTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

/**
 * Recursively copy a directory, excluding specified top-level names.
 */
async function copyDir(src: string, dest: string, exclude: string[] = []): Promise<void> {
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    if (exclude.includes(entry.name)) continue;

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await fs.mkdir(destPath, { recursive: true });
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}
