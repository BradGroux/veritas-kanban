import fs from 'fs/promises';
import path from 'path';
import matter from '../utils/frontmatter.js';

export type TaskIdentityLocation = 'active' | 'backlog' | 'archive';
export type TaskIdentityConflictKind = 'task-id' | 'business-id';

export interface TaskIdentityScanSource {
  location: TaskIdentityLocation;
  dir: string;
}

export interface TaskIdentitySource {
  location: TaskIdentityLocation;
  path: string;
  filename: string;
  taskId: string;
  title?: string;
  businessIds: string[];
}

export interface TaskIdentityConflict {
  kind: TaskIdentityConflictKind;
  id: string;
  sources: TaskIdentitySource[];
}

export interface TaskIdentityDiagnostics {
  hasConflicts: boolean;
  conflictCount: number;
  conflicts: TaskIdentityConflict[];
}

export interface TaskIdentityConflictDetails {
  operation: string;
  taskId?: string;
  destinationPath?: string;
  duplicateIds: string[];
  conflicts: TaskIdentityConflict[];
}

export interface TaskIdentityCandidate {
  location: TaskIdentityLocation;
  path: string;
  filename: string;
  taskId: string;
  title?: string;
  git?: unknown;
  github?: unknown;
  businessIds?: string[];
}

export interface TaskIdentityScanOptions {
  candidates?: TaskIdentityCandidate[];
  excludeTaskIds?: string[];
}

const EMPTY_DIAGNOSTICS: TaskIdentityDiagnostics = {
  hasConflicts: false,
  conflictCount: 0,
  conflicts: [],
};

function taskIdFromFilename(filename: string): string {
  return filename.replace(/\.md$/, '').split('-')[0] ?? '';
}

function normalizeGithubBusinessId(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;

  const github = value as Record<string, unknown>;
  const issueNumber =
    typeof github.issueNumber === 'number' || typeof github.issueNumber === 'string'
      ? String(github.issueNumber).trim()
      : '';
  const repo = typeof github.repo === 'string' ? github.repo.trim() : '';

  if (!issueNumber) return null;
  return `github:${repo || 'unknown'}#${issueNumber}`;
}

function normalizeGitPullRequestBusinessId(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;

  const git = value as Record<string, unknown>;
  const prNumber =
    typeof git.prNumber === 'number' || typeof git.prNumber === 'string'
      ? String(git.prNumber).trim()
      : '';
  const repo = typeof git.repo === 'string' ? git.repo.trim() : '';

  if (!prNumber) return null;
  return `git-pr:${repo || 'unknown'}#${prNumber}`;
}

function buildBusinessIds(frontmatter: Record<string, unknown>): string[] {
  return [
    normalizeGithubBusinessId(frontmatter.github),
    normalizeGitPullRequestBusinessId(frontmatter.git),
  ].filter((id): id is string => Boolean(id));
}

function commonRoot(sources: TaskIdentityScanSource[]): string {
  const dirs = sources.map((source) => path.resolve(source.dir));
  if (dirs.length === 0) return process.cwd();

  const [first, ...rest] = dirs.map((dir) => dir.split(path.sep));
  let index = 0;

  while (
    index < first.length &&
    rest.every((parts) => parts[index] !== undefined && parts[index] === first[index])
  ) {
    index += 1;
  }

  return first.slice(0, Math.max(1, index)).join(path.sep) || path.sep;
}

async function readMarkdownSources(
  source: TaskIdentityScanSource,
  rootDir: string
): Promise<TaskIdentitySource[]> {
  let files: string[];
  try {
    files = await fs.readdir(source.dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const markdownFiles = files.filter((filename) => filename.endsWith('.md')).sort();
  const results: TaskIdentitySource[] = [];

  for (const filename of markdownFiles) {
    const filepath = path.join(source.dir, filename);
    const content = await fs.readFile(filepath, 'utf-8');
    const parsed = matter(content);
    const frontmatter = parsed.data as Record<string, unknown>;
    const taskId =
      typeof frontmatter.id === 'string' && frontmatter.id.trim()
        ? frontmatter.id.trim()
        : taskIdFromFilename(filename);

    if (!taskId) continue;

    results.push({
      location: source.location,
      path: path.relative(rootDir, filepath),
      filename,
      taskId,
      title: typeof frontmatter.title === 'string' ? frontmatter.title : undefined,
      businessIds: buildBusinessIds(frontmatter),
    });
  }

  return results;
}

function sourceFromCandidate(
  candidate: TaskIdentityCandidate,
  rootDir: string
): TaskIdentitySource {
  return {
    location: candidate.location,
    path: path.isAbsolute(candidate.path) ? path.relative(rootDir, candidate.path) : candidate.path,
    filename: candidate.filename,
    taskId: candidate.taskId,
    title: candidate.title,
    businessIds:
      candidate.businessIds ?? buildBusinessIds({ github: candidate.github, git: candidate.git }),
  };
}

function conflictsForSources(
  sources: TaskIdentitySource[],
  kind: TaskIdentityConflictKind,
  getIds: (source: TaskIdentitySource) => string[]
): TaskIdentityConflict[] {
  const byId = new Map<string, TaskIdentitySource[]>();

  for (const source of sources) {
    for (const id of getIds(source)) {
      const existing = byId.get(id) ?? [];
      existing.push(source);
      byId.set(id, existing);
    }
  }

  return Array.from(byId.entries())
    .filter(([, values]) => values.length > 1)
    .map(([id, values]) => ({
      kind,
      id,
      sources: values.sort((a, b) => a.path.localeCompare(b.path)),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function scanTaskIdentityDiagnostics(
  sources: TaskIdentityScanSource[],
  options: TaskIdentityScanOptions = {}
): Promise<TaskIdentityDiagnostics> {
  const candidateSources = options.candidates ?? [];
  const uniqueSources = Array.from(
    new Map(
      sources.map((source) => [`${source.location}:${path.resolve(source.dir)}`, source])
    ).values()
  );
  if (uniqueSources.length === 0 && candidateSources.length === 0) return EMPTY_DIAGNOSTICS;

  const rootDir = commonRoot(uniqueSources);
  const excludedTaskIds = new Set(options.excludeTaskIds ?? []);
  const taskSources = (
    await Promise.all(uniqueSources.map((source) => readMarkdownSources(source, rootDir)))
  )
    .flat()
    .filter((source) => !excludedTaskIds.has(source.taskId))
    .concat(candidateSources.map((candidate) => sourceFromCandidate(candidate, rootDir)))
    .sort((a, b) => a.path.localeCompare(b.path));

  const conflicts = [
    ...conflictsForSources(taskSources, 'task-id', (source) => [source.taskId]),
    ...conflictsForSources(taskSources, 'business-id', (source) => source.businessIds),
  ].sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));

  return {
    hasConflicts: conflicts.length > 0,
    conflictCount: conflicts.length,
    conflicts,
  };
}

export function buildTaskIdentityConflictDetails(
  diagnostics: TaskIdentityDiagnostics,
  operation: string,
  options: { taskId?: string; destinationPath?: string } = {}
): TaskIdentityConflictDetails {
  return {
    operation,
    taskId: options.taskId,
    destinationPath: options.destinationPath,
    duplicateIds: diagnostics.conflicts.map((conflict) => conflict.id),
    conflicts: diagnostics.conflicts,
  };
}

export function filterTaskIdentityDiagnostics(
  diagnostics: TaskIdentityDiagnostics,
  taskId?: string
): TaskIdentityDiagnostics {
  if (!taskId) return diagnostics;

  const conflicts = diagnostics.conflicts.filter((conflict) =>
    conflict.sources.some((source) => source.taskId === taskId)
  );

  return {
    hasConflicts: conflicts.length > 0,
    conflictCount: conflicts.length,
    conflicts,
  };
}
