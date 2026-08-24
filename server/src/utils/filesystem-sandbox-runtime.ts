import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { ensureWithinBase, validatePathSegment } from './sanitize.js';
import { getRuntimeDir } from './paths.js';

const execFileAsync = promisify(execFile);

export interface RunSandboxDirectories {
  rootPath: string;
  tempPath: string;
  cachePath: string;
}

export interface ResolvedSandboxPath {
  path: string;
  scope: 'workspace' | 'home' | 'absolute';
}

export interface FilesystemSandboxProbeFixture {
  rootPath: string;
  workspacePath: string;
  outsidePath: string;
  allowedFile: string;
  deniedFile: string;
  dotfile: string;
  symlinkPath: string;
  protectedFile: string;
  veritasProtectedFile: string;
}

export interface FilesystemSandboxExecutableIdentity {
  path: string;
  fingerprint: string;
}

export interface RuntimeSandboxAccessEntry {
  path: string;
  access: 'read' | 'write' | 'deny';
}

export class FilesystemSandboxRuntimeError extends Error {
  constructor(
    message: string,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'FilesystemSandboxRuntimeError';
  }
}

export function runSandboxDirectories(taskId: string, attemptId: string): RunSandboxDirectories {
  validatePathSegment(taskId);
  validatePathSegment(attemptId);
  const basePath = path.join(getRuntimeDir(), 'sandboxes');
  const rootPath = ensureWithinBase(basePath, path.join(basePath, taskId, attemptId));
  return {
    rootPath,
    tempPath: ensureWithinBase(rootPath, path.join(rootPath, 'tmp')),
    cachePath: ensureWithinBase(rootPath, path.join(rootPath, 'cache')),
  };
}

export async function activateRunSandboxDirectories(
  directories: RunSandboxDirectories
): Promise<void> {
  const basePath = path.join(getRuntimeDir(), 'sandboxes');
  ensureWithinBase(basePath, directories.rootPath);
  ensureWithinBase(directories.rootPath, directories.tempPath);
  ensureWithinBase(directories.rootPath, directories.cachePath);
  await fs.mkdir(directories.tempPath, { recursive: true, mode: 0o700 });
  await fs.mkdir(directories.cachePath, { recursive: true, mode: 0o700 });
  await fs.chmod(directories.rootPath, 0o700);
  await fs.chmod(directories.tempPath, 0o700);
  await fs.chmod(directories.cachePath, 0o700);
}

export async function removeRunSandboxDirectory(rootPath: string): Promise<void> {
  const basePath = path.join(getRuntimeDir(), 'sandboxes');
  const resolvedRoot = ensureWithinBase(basePath, rootPath);
  if (resolvedRoot === path.resolve(basePath)) {
    throw new Error('Refusing to remove the filesystem sandbox base directory');
  }
  if (!(await pathExists(basePath))) return;

  const canonicalBase = await fs.realpath(basePath);
  const relativeRoot = path.relative(path.resolve(basePath), resolvedRoot);
  let candidate = path.resolve(basePath);
  for (const component of relativeRoot.split(path.sep).filter(Boolean)) {
    candidate = path.join(candidate, component);
    let stat;
    try {
      stat = await fs.lstat(candidate);
    } catch (error) {
      if (isMissingPathError(error)) return;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new Error('Refusing to remove a filesystem sandbox through a symbolic link');
    }
    if (candidate !== resolvedRoot && !stat.isDirectory()) {
      throw new Error('Refusing to remove a filesystem sandbox through a non-directory ancestor');
    }
  }

  const canonicalRoot = await fs.realpath(resolvedRoot);
  ensureWithinBase(canonicalBase, canonicalRoot);
  if (canonicalRoot === canonicalBase) {
    throw new Error('Refusing to remove the filesystem sandbox base directory');
  }
  await fs.rm(resolvedRoot, { recursive: true, force: true });
}

export async function createFilesystemSandboxProbeFixture(): Promise<FilesystemSandboxProbeFixture> {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-fs-sandbox-probe-'));
  const workspacePath = path.join(rootPath, 'workspace');
  const outsidePath = path.join(rootPath, 'outside');
  const allowedFile = path.join(workspacePath, 'allowed.txt');
  const deniedFile = path.join(outsidePath, 'denied.txt');
  const dotfile = path.join(workspacePath, '.secret');
  const symlinkPath = path.join(workspacePath, 'outside-link');
  const protectedFile = path.join(workspacePath, '.git', 'HEAD');
  const veritasProtectedFile = path.join(workspacePath, '.veritas-kanban', 'state.json');
  await fs.mkdir(path.dirname(protectedFile), { recursive: true });
  await fs.mkdir(path.dirname(veritasProtectedFile), { recursive: true });
  await fs.mkdir(outsidePath, { recursive: true });
  await fs.writeFile(allowedFile, 'allowed', 'utf8');
  await fs.writeFile(deniedFile, 'denied', 'utf8');
  await fs.writeFile(dotfile, 'masked', 'utf8');
  await fs.writeFile(protectedFile, 'ref: refs/heads/main\n', 'utf8');
  await fs.writeFile(veritasProtectedFile, '{"state":"protected"}\n', 'utf8');
  await fs.symlink(deniedFile, symlinkPath);
  return {
    rootPath,
    workspacePath,
    outsidePath,
    allowedFile,
    deniedFile,
    dotfile,
    symlinkPath,
    protectedFile,
    veritasProtectedFile,
  };
}

export async function removeFilesystemSandboxProbeFixture(rootPath: string): Promise<void> {
  const resolved = path.resolve(rootPath);
  const tempRoot = path.resolve(os.tmpdir());
  ensureWithinBase(tempRoot, resolved);
  if (!path.basename(resolved).startsWith('veritas-fs-sandbox-probe-')) {
    throw new Error('Refusing to remove an unrecognized filesystem sandbox probe directory');
  }
  await fs.rm(resolved, { recursive: true, force: true });
}

export async function resolveFilesystemSandboxExecutable(
  command: string,
  environment: NodeJS.ProcessEnv = process.env
): Promise<FilesystemSandboxExecutableIdentity> {
  const candidates = executableCandidates(command, environment);
  for (const candidate of candidates) {
    try {
      await fs.access(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
      const canonical = await fs.realpath(candidate);
      return {
        path: canonical,
        fingerprint: await digestFileContents(canonical),
      };
    } catch {
      // Try the next PATH candidate.
    }
  }
  throw new Error(`Filesystem sandbox executable was not found: ${command}`);
}

export async function resolveSandboxPolicyPath(
  value: string,
  workspacePath: string
): Promise<ResolvedSandboxPath> {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes('\0')) {
    throw new Error('Filesystem sandbox paths must be non-empty and cannot contain null bytes');
  }
  const workspace = await canonicalizePreservingMissing(path.resolve(workspacePath));
  if (trimmed === '<workspace>') {
    return { path: workspace, scope: 'workspace' };
  }
  if (trimmed.startsWith('<workspace>/') || trimmed.startsWith('<workspace>\\')) {
    const relative = trimmed.slice('<workspace>'.length + 1);
    const resolved = await canonicalizePreservingMissing(path.resolve(workspace, relative));
    return {
      path: ensureWithinBase(workspace, resolved),
      scope: 'workspace',
    };
  }
  if (trimmed === '~' || trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    const homePath = await canonicalizePreservingMissing(path.resolve(os.homedir()));
    const relative = trimmed === '~' ? '' : trimmed.slice(2);
    const resolved = await canonicalizePreservingMissing(path.resolve(homePath, relative));
    return {
      path: ensureWithinBase(homePath, resolved),
      scope: 'home',
    };
  }
  if (!path.isAbsolute(trimmed)) {
    throw new Error(
      `Filesystem sandbox path "${trimmed}" must be absolute, "~"-relative, or workspace-relative`
    );
  }
  return {
    path: await canonicalizePreservingMissing(path.resolve(trimmed)),
    scope: 'absolute',
  };
}

export function digestSandboxPath(value: string): string {
  return `sha256:${createHash('sha256').update(path.normalize(value)).digest('hex')}`;
}

export async function inspectGitMetadataRoots(workspacePath: string): Promise<string[]> {
  const workspace = await resolveSandboxPolicyPath('<workspace>', workspacePath);
  const dotGitPath = path.join(workspace.path, '.git');
  let dotGitStat;
  try {
    dotGitStat = await fs.lstat(dotGitPath);
  } catch (error) {
    if (isMissingPathError(error)) return [];
    throw new Error('Git metadata cannot be inspected for filesystem sandboxing.', {
      cause: error,
    });
  }
  if (dotGitStat.isSymbolicLink()) {
    throw new Error('Workspace .git metadata cannot be a symbolic link.');
  }

  let gitDirectory: string;
  if (dotGitStat.isDirectory()) {
    gitDirectory = await fs.realpath(dotGitPath);
    if (pathIsWithin(workspace.path, gitDirectory)) return [];
  } else if (dotGitStat.isFile()) {
    const pointer = await readBoundedPathFile(dotGitPath, 4_096);
    const match = pointer.match(/^gitdir:\s*(.+)\s*$/im);
    if (!match?.[1] || match[1].includes('\0')) {
      throw new Error('Linked-worktree .git metadata pointer is malformed.');
    }
    const rawGitDirectory = match[1].trim();
    gitDirectory = (
      await resolveSandboxPolicyPath(
        path.isAbsolute(rawGitDirectory)
          ? rawGitDirectory
          : path.resolve(workspace.path, rawGitDirectory),
        workspace.path
      )
    ).path;
  } else {
    throw new Error('Workspace .git metadata is neither a directory nor a worktree pointer.');
  }

  const metadataRoots = [gitDirectory];
  const commonDirectoryFile = path.join(gitDirectory, 'commondir');
  try {
    const rawCommonDirectory = (await readBoundedPathFile(commonDirectoryFile, 4_096)).trim();
    if (!rawCommonDirectory || rawCommonDirectory.includes('\0')) {
      throw new Error('Linked-worktree common Git directory pointer is malformed.');
    }
    metadataRoots.push(
      (
        await resolveSandboxPolicyPath(
          path.isAbsolute(rawCommonDirectory)
            ? rawCommonDirectory
            : path.resolve(gitDirectory, rawCommonDirectory),
          workspace.path
        )
      ).path
    );
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
  }

  return [...new Set(metadataRoots)].sort();
}

export async function canonicalizeExistingPaths(values: string[]): Promise<string[]> {
  const canonical = await Promise.all(
    values
      .filter((value) => path.isAbsolute(value))
      .map((value) => fs.realpath(path.resolve(value)))
  );
  return [...new Set(canonical)].sort();
}

export async function assertNoExternalHardLinksRuntime(input: {
  entries: RuntimeSandboxAccessEntry[];
  dotfileMasking: boolean;
  protectedMetadataNames: string[];
  maxEntries: number;
}): Promise<void> {
  const writeRoots = uniqueSortedPaths(
    input.entries.filter((entry) => entry.access === 'write').map((entry) => entry.path)
  ).filter((root) => effectivePathAccess(root, input.entries) === 'write');
  if (writeRoots.length === 0) return;

  const visitedPaths = new Set<string>();
  const linkedInodes = new Map<string, { linkCount: number; visibleAliases: number }>();
  let scannedEntries = 0;

  const scan = async (candidatePath: string, root: string): Promise<void> => {
    const resolvedCandidate = path.resolve(candidatePath);
    if (visitedPaths.has(resolvedCandidate)) return;
    visitedPaths.add(resolvedCandidate);
    if (effectivePathAccess(resolvedCandidate, input.entries) !== 'write') return;
    if (isProtectedMetadataChild(resolvedCandidate, writeRoots, input.protectedMetadataNames)) {
      return;
    }
    if (input.dotfileMasking && isMaskedDotfile(resolvedCandidate, writeRoots)) return;

    let stat;
    try {
      stat = await fs.lstat(resolvedCandidate);
    } catch (error) {
      if (isMissingPathError(error)) return;
      throw new FilesystemSandboxRuntimeError(
        'Writable filesystem roots cannot be inspected for hard links.',
        {
          scannedEntries,
          remediation:
            'Make every writable root locally inspectable or narrow the filesystem policy.',
        }
      );
    }
    scannedEntries += 1;
    if (scannedEntries > input.maxEntries) {
      throw new FilesystemSandboxRuntimeError(
        'Writable filesystem roots exceed the hard-link scan limit.',
        {
          maxEntries: input.maxEntries,
          remediation:
            'Narrow the writable roots or remove the required filesystem policy for this run.',
        }
      );
    }
    if (stat.isSymbolicLink()) {
      if (resolvedCandidate === root) {
        throw new FilesystemSandboxRuntimeError(
          'A writable filesystem root became a symbolic link.',
          {
            remediation: 'Re-evaluate the filesystem policy against the canonical writable root.',
          }
        );
      }
      return;
    }
    if (stat.isDirectory()) {
      let children;
      try {
        children = await fs.readdir(resolvedCandidate, { withFileTypes: true });
      } catch {
        throw new FilesystemSandboxRuntimeError(
          'Writable filesystem roots cannot be enumerated safely.',
          {
            scannedEntries,
            remediation:
              'Make every writable root locally inspectable or narrow the filesystem policy.',
          }
        );
      }
      for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
        await scan(path.join(resolvedCandidate, child.name), root);
      }
      return;
    }
    if (!stat.isFile() || stat.nlink <= 1) return;
    const inodeKey = `${stat.dev}:${stat.ino}`;
    const existing = linkedInodes.get(inodeKey);
    if (existing) {
      existing.visibleAliases += 1;
      existing.linkCount = Math.max(existing.linkCount, stat.nlink);
    } else {
      linkedInodes.set(inodeKey, { linkCount: stat.nlink, visibleAliases: 1 });
    }
  };

  for (const root of writeRoots) await scan(root, root);

  const ambiguousInodes = [...linkedInodes.values()].filter(
    (inode) => inode.visibleAliases < inode.linkCount
  ).length;
  if (ambiguousInodes > 0) {
    throw new FilesystemSandboxRuntimeError(
      'Writable filesystem roots contain hard links that extend outside the writable boundary.',
      {
        ambiguousInodes,
        scannedEntries,
        remediation:
          'Replace external hard links with independent files before launching the provider.',
      }
    );
  }
}

export async function assertProtectedMetadataPathsRuntime(input: {
  entries: RuntimeSandboxAccessEntry[];
  protectedMetadataNames: string[];
}): Promise<void> {
  const writeRoots = uniqueSortedPaths(
    input.entries.filter((entry) => entry.access === 'write').map((entry) => entry.path)
  ).filter((root) => effectivePathAccess(root, input.entries) === 'write');

  for (const writeRoot of writeRoots) {
    for (const protectedName of input.protectedMetadataNames) {
      const candidate = path.join(writeRoot, protectedName);
      if (effectivePathAccess(candidate, input.entries) === 'deny') continue;
      try {
        const stat = await fs.lstat(candidate);
        if (stat.isSymbolicLink()) {
          throw new FilesystemSandboxRuntimeError(
            'Protected repository metadata cannot be a symbolic link.',
            {
              protectedName,
              remediation:
                'Replace the protected metadata symlink with local metadata before launching the provider.',
            }
          );
        }
      } catch (error) {
        if (isMissingPathError(error)) continue;
        if (error instanceof FilesystemSandboxRuntimeError) throw error;
        throw new FilesystemSandboxRuntimeError(
          'Protected repository metadata cannot be inspected safely.',
          {
            protectedName,
            remediation:
              'Make protected metadata locally inspectable before launching the provider.',
          }
        );
      }
    }
  }
}

export async function runtimePackageRoot(executablePath: string): Promise<string> {
  const normalized = path.resolve(executablePath);
  const filesystemRoot = path.parse(normalized).root;
  const parts = normalized.slice(filesystemRoot.length).split(path.sep).filter(Boolean);
  for (const marker of ['Cellar', 'Caskroom']) {
    const index = parts.indexOf(marker);
    if (index >= 0 && parts.length > index + 2) {
      return path.join(filesystemRoot, ...parts.slice(0, index + 3));
    }
  }
  const nodeModulesIndex = parts.lastIndexOf('node_modules');
  if (nodeModulesIndex >= 0 && parts.length > nodeModulesIndex + 1) {
    const packageSegments = parts[nodeModulesIndex + 1]?.startsWith('@') ? 2 : 1;
    if (parts.length >= nodeModulesIndex + 1 + packageSegments) {
      return path.join(filesystemRoot, ...parts.slice(0, nodeModulesIndex + 1 + packageSegments));
    }
  }
  let candidate = path.dirname(normalized);
  for (let depth = 0; depth < 6; depth += 1) {
    try {
      await fs.access(path.join(candidate, 'pyvenv.cfg'));
      return candidate;
    } catch {
      const parent = path.dirname(candidate);
      if (parent === candidate) break;
      candidate = parent;
    }
  }
  return path.dirname(normalized);
}

export async function resolveGitIdentity(cwd: string): Promise<{ name?: string; email?: string }> {
  const [name, email] = await Promise.all([
    readGitIdentityValue(cwd, 'user.name'),
    readGitIdentityValue(cwd, 'user.email'),
  ]);
  return {
    ...(name ? { name } : {}),
    ...(email ? { email } : {}),
  };
}

export async function systemMountPoints(platform: NodeJS.Platform): Promise<string[]> {
  let mountPoints: string[];
  if (platform === 'linux') {
    const mountInfo = await fs.readFile('/proc/self/mountinfo', 'utf8');
    mountPoints = mountInfo
      .split('\n')
      .map((line) => line.trim().split(/\s+/)[4])
      .filter((value): value is string => Boolean(value))
      .map(decodeMountPath);
  } else if (platform === 'darwin') {
    const result = await execFileAsync('/sbin/mount', [], {
      timeout: 3_000,
      maxBuffer: 1024 * 1024,
      encoding: 'utf8',
    });
    mountPoints = (result.stdout ?? '')
      .split('\n')
      .map((line) => line.match(/\son\s(.+)\s\([^)]*\)$/)?.[1])
      .filter((value): value is string => Boolean(value))
      .map(decodeMountPath);
  } else if (platform === 'win32') {
    const result = await execFileAsync('mountvol', [], {
      timeout: 3_000,
      maxBuffer: 1024 * 1024,
      encoding: 'utf8',
    });
    mountPoints = (result.stdout ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^[A-Za-z]:\\/.test(line))
      .map((line) => (line.length > 3 ? line.replace(/[\\/]$/, '') : line));
  } else {
    throw new Error(`Mount topology inspection is unavailable for ${platform}.`);
  }
  const normalized = uniqueSortedPaths(mountPoints);
  if (normalized.length === 0) {
    throw new Error(`Mount topology inspection returned no mount points for ${platform}.`);
  }
  return normalized;
}

async function digestFileContents(filePath: string): Promise<string> {
  const handle = await fs.open(filePath, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile()) {
      throw new Error('Filesystem sandbox executable is not a regular file.');
    }
    const hash = createHash('sha256');
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      hash.update(chunk);
    }
    const after = await handle.stat();
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs
    ) {
      throw new Error('Filesystem sandbox executable changed while it was being inspected.');
    }
    return `sha256:${hash.digest('hex')}`;
  } finally {
    await handle.close();
  }
}

async function readBoundedPathFile(filePath: string, maxBytes: number): Promise<string> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
    handle = await fs.open(filePath, constants.O_RDONLY | noFollow);
    const before = await handle.stat();
    if (!before.isFile()) {
      throw new Error('Filesystem metadata pointer must be a regular file.');
    }
    if (before.size > maxBytes) {
      throw new Error(`Filesystem metadata file exceeds ${maxBytes} bytes.`);
    }

    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const after = await handle.stat();
    if (
      bytesRead > maxBytes ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs
    ) {
      throw new Error('Filesystem metadata file changed while it was being inspected.');
    }
    return buffer.subarray(0, bytesRead).toString('utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      throw new Error('Filesystem metadata pointer must be a regular file.', { cause: error });
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

async function readGitIdentityValue(cwd: string, key: 'user.name' | 'user.email') {
  try {
    const result = await execFileAsync('git', ['config', '--get', key], {
      cwd,
      timeout: 3_000,
      maxBuffer: 16 * 1024,
      encoding: 'utf8',
    });
    const value = (result.stdout ?? '').trim();
    if (!value || value.length > 512 || /[\0\r\n]/.test(value)) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

function decodeMountPath(value: string): string {
  return value
    .replaceAll('\\040', ' ')
    .replaceAll('\\011', '\t')
    .replaceAll('\\012', '\n')
    .replaceAll('\\134', '\\');
}

function uniqueSortedPaths(values: string[]): string[] {
  return [
    ...new Set(
      values.filter((value) => path.isAbsolute(value)).map((value) => path.resolve(value))
    ),
  ].sort();
}

function effectivePathAccess(
  candidate: string,
  entries: RuntimeSandboxAccessEntry[]
): RuntimeSandboxAccessEntry['access'] | undefined {
  return entries
    .filter((entry) => pathIsWithin(entry.path, candidate))
    .sort((left, right) => {
      const depthDelta = pathDepth(right.path) - pathDepth(left.path);
      if (depthDelta !== 0) return depthDelta;
      return accessPrecedence(right.access) - accessPrecedence(left.access);
    })[0]?.access;
}

function pathDepth(value: string): number {
  return path.resolve(value).split(path.sep).filter(Boolean).length;
}

function accessPrecedence(access: RuntimeSandboxAccessEntry['access']): number {
  if (access === 'deny') return 3;
  if (access === 'write') return 2;
  return 1;
}

function isProtectedMetadataChild(
  candidate: string,
  writeRoots: string[],
  protectedMetadataNames: string[]
): boolean {
  return writeRoots.some((root) => {
    const relative = path.relative(root, candidate);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false;
    return protectedMetadataNames.includes(relative.split(path.sep)[0]);
  });
}

function isMaskedDotfile(candidate: string, writeRoots: string[]): boolean {
  return writeRoots.some((root) => {
    const relative = path.relative(root, candidate);
    return (
      Boolean(relative) &&
      !relative.startsWith('..') &&
      !path.isAbsolute(relative) &&
      relative.split(path.sep).some((component) => component.startsWith('.'))
    );
  });
}

function pathIsWithin(basePath: string, targetPath: string): boolean {
  const relative = path.relative(basePath, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function pathExists(value: string): Promise<boolean> {
  try {
    await fs.lstat(value);
    return true;
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw error;
  }
}

async function canonicalizePreservingMissing(input: string): Promise<string> {
  const suffix: string[] = [];
  let candidate = path.resolve(input);
  while (true) {
    try {
      const canonical = await fs.realpath(candidate);
      return path.join(canonical, ...suffix);
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw new Error(`Filesystem sandbox path cannot be resolved: ${input}`, { cause: error });
      }
      const parent = path.dirname(candidate);
      if (parent === candidate) {
        throw new Error(`Filesystem sandbox path has no resolvable ancestor: ${input}`, {
          cause: error,
        });
      }
      suffix.unshift(path.basename(candidate));
      candidate = parent;
    }
  }
}

function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

function executableCandidates(command: string, environment: NodeJS.ProcessEnv): string[] {
  if (path.isAbsolute(command) || command.includes(path.sep)) return [path.resolve(command)];
  const pathValue = environment.PATH ?? '';
  const extensions =
    process.platform === 'win32'
      ? (environment.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
      : [''];
  return pathValue
    .split(path.delimiter)
    .filter(Boolean)
    .flatMap((entry) => extensions.map((extension) => path.join(entry, `${command}${extension}`)));
}
