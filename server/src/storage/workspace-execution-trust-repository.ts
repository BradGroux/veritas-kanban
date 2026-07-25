import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, readlink, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import {
  WORKSPACE_EXECUTION_TRUST_INVENTORY_SCHEMA_VERSION,
  WORKSPACE_EXECUTION_TRUST_SCHEMA_VERSION,
  type WorkspaceExecutionTrustComponentKind,
  type WorkspaceExecutionTrustDecision,
  type WorkspaceExecutionTrustInventory,
  type WorkspaceExecutionTrustInventoryEntry,
  type WorkspaceExecutionTrustPosture,
  type WorkspaceExecutionTrustProjectPolicy,
} from '@veritas-kanban/shared';
import {
  workspaceExecutionTrustDecisionSchema,
  workspaceExecutionTrustInventorySchema,
  workspaceExecutionTrustProjectFileSchema,
} from '../schemas/workspace-execution-trust-schemas.js';
import { withFileLock } from '../services/file-lock.js';
import { getRuntimeDir } from '../utils/paths.js';
import { ensureWithinBase } from '../utils/sanitize.js';
import { atomicWriteFile, fileExists, mkdir } from './fs-helpers.js';
import type { WorkspaceExecutionTrustRepository } from './interfaces.js';

const execFileAsync = promisify(execFile);
const STATE_SCHEMA_VERSION = 'workspace-execution-trust-state/v1' as const;
const SCANNER_REVISION = 1;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_INVENTORY_ENTRIES = 2_000;
const MAX_DIRECTORY_DEPTH = 12;

const stateSchema = z
  .object({
    schemaVersion: z.literal(STATE_SCHEMA_VERSION),
    decisions: z.array(workspaceExecutionTrustDecisionSchema).max(10_000),
  })
  .strict();

interface WorkspaceExecutionTrustState {
  schemaVersion: typeof STATE_SCHEMA_VERSION;
  decisions: WorkspaceExecutionTrustDecision[];
}

interface ComponentDescriptor {
  kind: WorkspaceExecutionTrustComponentKind;
  posture: WorkspaceExecutionTrustPosture;
  requestedCapabilities: string[];
}

interface Candidate extends ComponentDescriptor {
  absolutePath: string;
  relativePath: string;
  scope: WorkspaceExecutionTrustInventoryEntry['scope'];
}

const EXACT_COMPONENTS = new Map<string, ComponentDescriptor>([
  [
    'AGENTS.md',
    {
      kind: 'agent-instruction',
      posture: 'model-influencing',
      requestedCapabilities: ['model.instructions'],
    },
  ],
  [
    'CLAUDE.md',
    {
      kind: 'provider-instruction',
      posture: 'model-influencing',
      requestedCapabilities: ['model.instructions'],
    },
  ],
  [
    'GEMINI.md',
    {
      kind: 'provider-instruction',
      posture: 'model-influencing',
      requestedCapabilities: ['model.instructions'],
    },
  ],
  [
    '.github/copilot-instructions.md',
    {
      kind: 'provider-instruction',
      posture: 'model-influencing',
      requestedCapabilities: ['model.instructions'],
    },
  ],
  [
    '.mcp.json',
    {
      kind: 'tool-server-configuration',
      posture: 'executable',
      requestedCapabilities: ['process.spawn', 'tool.mcp'],
    },
  ],
  [
    '.codex/config.toml',
    {
      kind: 'provider-configuration',
      posture: 'executable',
      requestedCapabilities: ['provider.override', 'process.spawn', 'tool.mcp'],
    },
  ],
  [
    '.claude/settings.json',
    {
      kind: 'provider-configuration',
      posture: 'executable',
      requestedCapabilities: ['provider.override', 'process.spawn', 'runtime.hook'],
    },
  ],
  [
    '.claude/settings.local.json',
    {
      kind: 'provider-configuration',
      posture: 'executable',
      requestedCapabilities: ['provider.override', 'process.spawn', 'runtime.hook'],
    },
  ],
  [
    '.claude/mcp.json',
    {
      kind: 'tool-server-configuration',
      posture: 'executable',
      requestedCapabilities: ['process.spawn', 'tool.mcp'],
    },
  ],
  [
    '.copilot/mcp-config.json',
    {
      kind: 'tool-server-configuration',
      posture: 'executable',
      requestedCapabilities: ['process.spawn', 'tool.mcp'],
    },
  ],
  [
    '.github/copilot/mcp.json',
    {
      kind: 'tool-server-configuration',
      posture: 'executable',
      requestedCapabilities: ['process.spawn', 'tool.mcp'],
    },
  ],
  [
    '.vscode/mcp.json',
    {
      kind: 'tool-server-configuration',
      posture: 'executable',
      requestedCapabilities: ['process.spawn', 'tool.mcp'],
    },
  ],
  [
    '.vscode/settings.json',
    {
      kind: 'language-server-configuration',
      posture: 'executable',
      requestedCapabilities: ['language-server.start', 'process.spawn'],
    },
  ],
  [
    '.vscode/tasks.json',
    {
      kind: 'workflow-configuration',
      posture: 'executable',
      requestedCapabilities: ['process.spawn', 'workflow.execute'],
    },
  ],
  [
    '.vscode/extensions.json',
    {
      kind: 'extension-configuration',
      posture: 'executable',
      requestedCapabilities: ['extension.install', 'extension.load'],
    },
  ],
  [
    '.devcontainer/devcontainer.json',
    {
      kind: 'extension-configuration',
      posture: 'executable',
      requestedCapabilities: ['container.start', 'process.spawn'],
    },
  ],
  [
    '.envrc',
    {
      kind: 'runtime-hook',
      posture: 'executable',
      requestedCapabilities: ['environment.mutate', 'process.spawn'],
    },
  ],
  [
    '.veritas-kanban/workspace-trust.json',
    {
      kind: 'project-trust-policy',
      posture: 'declarative-only',
      requestedCapabilities: ['policy.narrow'],
    },
  ],
]);

function emptyState(): WorkspaceExecutionTrustState {
  return { schemaVersion: STATE_SCHEMA_VERSION, decisions: [] };
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function fingerprintRemoteIdentity(remote: string): string {
  const withoutCredentials = remote
    .trim()
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi, '$1')
    .replace(/\/\/[^/@\s]+@/g, '//')
    .replace(/([?&](?:access_token|api_key|token|key|secret|password)=)[^&#\s]+/gi, '$1[redacted]');
  return sha256(withoutCredentials);
}

function normalizedRelativePath(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join('/');
}

function descriptorForRecursivePath(relativePath: string): ComponentDescriptor | null {
  if (/^\.github\/instructions\/.+\.instructions\.md$/i.test(relativePath)) {
    return {
      kind: 'provider-instruction',
      posture: 'model-influencing',
      requestedCapabilities: ['model.instructions'],
    };
  }
  if (/^\.github\/workflows\/.+\.(?:ya?ml)$/i.test(relativePath)) {
    return {
      kind: 'workflow-configuration',
      posture: 'executable',
      requestedCapabilities: ['external.mutation', 'workflow.execute'],
    };
  }
  if (/^\.cursor\/rules\/.+\.mdc$/i.test(relativePath)) {
    return {
      kind: 'provider-instruction',
      posture: 'model-influencing',
      requestedCapabilities: ['model.instructions'],
    };
  }
  if (/^\.claude\/agents\/.+\.(?:md|json)$/i.test(relativePath)) {
    return {
      kind: 'agent-definition',
      posture: 'model-influencing',
      requestedCapabilities: ['agent.load', 'model.instructions'],
    };
  }
  if (/^\.claude\/commands\/.+\.md$/i.test(relativePath)) {
    return {
      kind: 'provider-instruction',
      posture: 'model-influencing',
      requestedCapabilities: ['model.instructions', 'workflow.execute'],
    };
  }
  if (/^\.claude\/skills\/.+\/SKILL\.md$/i.test(relativePath)) {
    return {
      kind: 'skill-definition',
      posture: 'model-influencing',
      requestedCapabilities: ['model.instructions', 'skill.load'],
    };
  }
  if (/^\.claude\/hooks\/.+/i.test(relativePath)) {
    return {
      kind: 'runtime-hook',
      posture: 'executable',
      requestedCapabilities: ['process.spawn', 'runtime.hook'],
    };
  }
  if (/^\.codex\/skills\/.+\/SKILL\.md$/i.test(relativePath)) {
    return {
      kind: 'skill-definition',
      posture: 'model-influencing',
      requestedCapabilities: ['model.instructions', 'skill.load'],
    };
  }
  if (/^\.codex\/rules\/.+\.rules$/i.test(relativePath)) {
    return {
      kind: 'provider-configuration',
      posture: 'executable',
      requestedCapabilities: ['command.policy', 'provider.override'],
    };
  }
  if (/^\.(?:agent|agents|buzz|grok-build)\/.+\.md$/i.test(relativePath)) {
    return {
      kind: 'agent-definition',
      posture: 'model-influencing',
      requestedCapabilities: ['agent.load', 'model.instructions'],
    };
  }
  if (/^\.(?:agent|agents|buzz|grok-build)\/.+\.(?:json|toml|ya?ml)$/i.test(relativePath)) {
    return {
      kind: 'provider-configuration',
      posture: 'executable',
      requestedCapabilities: ['process.spawn', 'provider.override'],
    };
  }
  return null;
}

async function gitValue(root: string, args: string[]): Promise<string> {
  try {
    const result = await execFileAsync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      timeout: 10_000,
    });
    return result.stdout.trim();
  } catch (error) {
    const diagnostic = error instanceof Error ? error.message : 'git command failed';
    throw new Error(`Workspace execution trust requires a valid Git worktree: ${diagnostic}`, {
      cause: error,
    });
  }
}

async function readBoundedFingerprint(filePath: string, size: number): Promise<string> {
  if (size > MAX_FILE_BYTES) {
    throw new Error(
      `Workspace execution configuration exceeds the ${MAX_FILE_BYTES}-byte scan limit.`
    );
  }
  return sha256(await readFile(filePath));
}

async function inventoryEntry(
  root: string,
  candidate: Candidate
): Promise<WorkspaceExecutionTrustInventoryEntry | null> {
  let fileStat;
  try {
    fileStat = await lstat(candidate.absolutePath);
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error.code === 'ENOENT' || error.code === 'ENOTDIR')
    ) {
      return null;
    }
    throw error;
  }

  if (!fileStat.isFile() && !fileStat.isSymbolicLink()) return null;
  const symbolicLink = fileStat.isSymbolicLink();
  let sourceFingerprint: string;
  const canonicalPathDigest = sha256(
    JSON.stringify({
      scope: candidate.scope,
      relativePath: candidate.relativePath,
    })
  );
  let requestedCapabilities = [...candidate.requestedCapabilities];
  let posture = candidate.posture;
  let kind = candidate.kind;

  if (symbolicLink) {
    sourceFingerprint = sha256(await readlink(candidate.absolutePath));
    requestedCapabilities = [...new Set([...requestedCapabilities, 'filesystem.external-read'])];
    posture = 'executable';
    kind = kind === 'project-trust-policy' ? 'unknown-executable' : kind;
  } else {
    const canonicalPath = await realpath(candidate.absolutePath);
    ensureWithinBase(root, canonicalPath);
    sourceFingerprint = await readBoundedFingerprint(canonicalPath, fileStat.size);
  }

  const material = {
    relativePath: candidate.relativePath,
    sourceFingerprint,
    canonicalPathDigest,
    kind,
    posture,
    symbolicLink,
  };
  return {
    id: `workspace_component_${sha256(JSON.stringify(material)).slice('sha256:'.length, 25)}`,
    relativePath: candidate.relativePath,
    canonicalPathDigest,
    scope: candidate.scope,
    kind,
    posture,
    sourceFingerprint,
    byteLength: symbolicLink
      ? Buffer.byteLength(await readlink(candidate.absolutePath))
      : fileStat.size,
    symbolicLink,
    requestedCapabilities: requestedCapabilities.sort(),
  };
}

async function recursiveCandidates(root: string, startRelativePath: string): Promise<Candidate[]> {
  const start = path.resolve(root, startRelativePath);
  ensureWithinBase(root, start);
  const candidates: Candidate[] = [];

  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > MAX_DIRECTORY_DEPTH) {
      throw new Error('Workspace execution configuration exceeds the supported directory depth.');
    }
    let directoryStat;
    try {
      directoryStat = await lstat(directory);
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error.code === 'ENOENT' || error.code === 'ENOTDIR')
      ) {
        return;
      }
      throw error;
    }
    if (directoryStat.isSymbolicLink()) {
      candidates.push({
        absolutePath: directory,
        relativePath: normalizedRelativePath(root, directory),
        scope: 'workspace-descendant',
        kind: 'unknown-executable',
        posture: 'executable',
        requestedCapabilities: ['filesystem.external-read', 'process.spawn'],
      });
      return;
    }
    if (!directoryStat.isDirectory()) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error.code === 'ENOENT' || error.code === 'ENOTDIR')
      ) {
        return;
      }
      throw error;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = normalizedRelativePath(root, absolutePath);
      const descriptor = descriptorForRecursivePath(relativePath);
      if (entry.isSymbolicLink()) {
        candidates.push({
          ...(descriptor ?? {
            kind: 'unknown-executable',
            posture: 'executable',
            requestedCapabilities: ['filesystem.external-read', 'process.spawn'],
          }),
          absolutePath,
          relativePath,
          scope: 'workspace-descendant',
        });
        continue;
      }
      if (entry.isDirectory()) {
        await visit(absolutePath, depth + 1);
        continue;
      }
      if (!descriptor) continue;
      candidates.push({
        ...descriptor,
        absolutePath,
        relativePath,
        scope: 'workspace-descendant',
      });
      if (candidates.length > MAX_INVENTORY_ENTRIES) {
        throw new Error('Workspace execution configuration inventory exceeds the bounded limit.');
      }
    }
  }

  await visit(start, 0);
  return candidates;
}

async function gitHookCandidates(root: string): Promise<Candidate[]> {
  const hooksPath = await gitValue(root, ['config', '--local', '--get', 'core.hooksPath']).catch(
    () => ''
  );
  if (!hooksPath) return [];
  const resolved = path.isAbsolute(hooksPath)
    ? path.resolve(hooksPath)
    : path.resolve(root, hooksPath);
  if (!resolved.startsWith(`${root}${path.sep}`) && resolved !== root) {
    return [
      {
        absolutePath: resolved,
        relativePath: 'git:core.hooksPath',
        scope: 'git-common-directory',
        kind: 'runtime-hook',
        posture: 'executable',
        requestedCapabilities: ['filesystem.external-read', 'process.spawn', 'runtime.hook'],
      },
    ];
  }
  let entries;
  try {
    entries = await readdir(resolved, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile() || entry.isSymbolicLink())
    .map((entry) => {
      const absolutePath = path.join(resolved, entry.name);
      return {
        absolutePath,
        relativePath: normalizedRelativePath(root, absolutePath),
        scope: 'workspace-descendant' as const,
        kind: 'runtime-hook' as const,
        posture: 'executable' as const,
        requestedCapabilities: ['process.spawn', 'runtime.hook'],
      };
    });
}

async function inspectWorkspace(workspacePath: string): Promise<WorkspaceExecutionTrustInventory> {
  const canonicalWorkspacePath = await realpath(workspacePath);
  const repositoryRootRaw = await gitValue(canonicalWorkspacePath, [
    'rev-parse',
    '--show-toplevel',
  ]);
  const canonicalRepositoryRoot = await realpath(repositoryRootRaw);
  ensureWithinBase(canonicalRepositoryRoot, canonicalWorkspacePath);
  if (canonicalWorkspacePath !== canonicalRepositoryRoot) {
    throw new Error(
      'Workspace execution trust requires the registered Git worktree root, not a nested path.'
    );
  }
  const commonDirectoryRaw = await gitValue(canonicalRepositoryRoot, [
    'rev-parse',
    '--git-common-dir',
  ]);
  const canonicalCommonDirectory = await realpath(
    path.isAbsolute(commonDirectoryRaw)
      ? commonDirectoryRaw
      : path.resolve(canonicalRepositoryRoot, commonDirectoryRaw)
  );
  const remoteIdentity = await gitValue(canonicalRepositoryRoot, [
    'config',
    '--get',
    'remote.origin.url',
  ]).catch(() => 'no-origin-remote');
  const [workspaceStat, rootStat, commonStat] = await Promise.all([
    lstat(canonicalWorkspacePath),
    lstat(canonicalRepositoryRoot),
    lstat(canonicalCommonDirectory),
  ]);
  if (!workspaceStat.isDirectory() || !rootStat.isDirectory() || !commonStat.isDirectory()) {
    throw new Error('Workspace execution trust identity requires regular directories.');
  }
  const identityMaterial = {
    workspaceDevice: String(workspaceStat.dev),
    workspaceInode: String(workspaceStat.ino),
    repositoryDevice: String(rootStat.dev),
    repositoryInode: String(rootStat.ino),
    commonDevice: String(commonStat.dev),
    commonInode: String(commonStat.ino),
    remoteIdentityDigest: fingerprintRemoteIdentity(remoteIdentity),
  };
  const identity = {
    schemaVersion: WORKSPACE_EXECUTION_TRUST_SCHEMA_VERSION,
    digest: sha256(JSON.stringify(identityMaterial)),
    canonicalWorkspacePathDigest: sha256(canonicalWorkspacePath),
    canonicalRepositoryRootDigest: sha256(canonicalRepositoryRoot),
    gitCommonDirectoryDigest: sha256(canonicalCommonDirectory),
    remoteIdentityDigest: identityMaterial.remoteIdentityDigest,
  } as const;

  const candidates: Candidate[] = [...EXACT_COMPONENTS.entries()].map(
    ([relativePath, descriptor]) => ({
      ...descriptor,
      absolutePath: path.resolve(canonicalWorkspacePath, relativePath),
      relativePath,
      scope: 'workspace-root',
    })
  );
  for (const directory of [
    '.github/instructions',
    '.github/workflows',
    '.cursor/rules',
    '.claude/agents',
    '.claude/commands',
    '.claude/skills',
    '.claude/hooks',
    '.codex/skills',
    '.codex/rules',
    '.agent',
    '.agents',
    '.buzz',
    '.grok-build',
  ]) {
    candidates.push(...(await recursiveCandidates(canonicalWorkspacePath, directory)));
  }
  candidates.push(...(await gitHookCandidates(canonicalWorkspacePath)));

  const inventory = new Map<string, WorkspaceExecutionTrustInventoryEntry>();
  for (const candidate of candidates) {
    if (candidate.relativePath === 'git:core.hooksPath') {
      const sourceFingerprint = sha256(candidate.absolutePath);
      inventory.set(candidate.relativePath, {
        id: `workspace_component_${sourceFingerprint.slice('sha256:'.length, 25)}`,
        relativePath: candidate.relativePath,
        canonicalPathDigest: sourceFingerprint,
        scope: candidate.scope,
        kind: candidate.kind,
        posture: candidate.posture,
        sourceFingerprint,
        byteLength: Buffer.byteLength(candidate.absolutePath),
        symbolicLink: false,
        requestedCapabilities: [...candidate.requestedCapabilities].sort(),
      });
      continue;
    }
    const entry = await inventoryEntry(canonicalWorkspacePath, candidate);
    if (entry) inventory.set(entry.relativePath, entry);
    if (inventory.size > MAX_INVENTORY_ENTRIES) {
      throw new Error('Workspace execution configuration inventory exceeds the bounded limit.');
    }
  }
  const entries = [...inventory.values()].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  );

  let projectPolicy: WorkspaceExecutionTrustProjectPolicy = {
    maximumTrust: 'trusted',
    valid: true,
  };
  const policyEntry = entries.find(
    (entry) => entry.relativePath === '.veritas-kanban/workspace-trust.json'
  );
  if (policyEntry) {
    if (policyEntry.symbolicLink) {
      projectPolicy = {
        maximumTrust: 'denied',
        sourceFingerprint: policyEntry.sourceFingerprint,
        valid: false,
        diagnostic: 'The project trust policy must be a regular file inside the workspace.',
      };
    } else {
      try {
        const policy = workspaceExecutionTrustProjectFileSchema.parse(
          JSON.parse(
            await readFile(
              path.resolve(canonicalWorkspacePath, '.veritas-kanban/workspace-trust.json'),
              'utf8'
            )
          )
        );
        projectPolicy = {
          maximumTrust: policy.maximumTrust,
          sourceFingerprint: policyEntry.sourceFingerprint,
          valid: true,
        };
      } catch {
        projectPolicy = {
          maximumTrust: 'denied',
          sourceFingerprint: policyEntry.sourceFingerprint,
          valid: false,
          diagnostic: 'The project trust policy is invalid and therefore narrows trust to denied.',
        };
      }
    }
  }

  const material = {
    scannerRevision: SCANNER_REVISION,
    identityDigest: identity.digest,
    entries: entries.map((entry) => ({
      relativePath: entry.relativePath,
      canonicalPathDigest: entry.canonicalPathDigest,
      kind: entry.kind,
      posture: entry.posture,
      sourceFingerprint: entry.sourceFingerprint,
      byteLength: entry.byteLength,
      symbolicLink: entry.symbolicLink,
      requestedCapabilities: entry.requestedCapabilities,
    })),
    projectPolicy,
  };
  return workspaceExecutionTrustInventorySchema.parse({
    schemaVersion: WORKSPACE_EXECUTION_TRUST_INVENTORY_SCHEMA_VERSION,
    digest: sha256(JSON.stringify(material)),
    scannerRevision: SCANNER_REVISION,
    scannedAt: new Date().toISOString(),
    identity,
    entries,
    projectPolicy,
  });
}

export class InMemoryWorkspaceExecutionTrustRepository implements WorkspaceExecutionTrustRepository {
  private decisions: WorkspaceExecutionTrustDecision[] = [];

  inspect(workspacePath: string): Promise<WorkspaceExecutionTrustInventory> {
    return inspectWorkspace(workspacePath);
  }

  async listDecisions(identityDigest?: string): Promise<WorkspaceExecutionTrustDecision[]> {
    return structuredClone(
      this.decisions.filter(
        (decision) => !identityDigest || decision.identityDigest === identityDigest
      )
    );
  }

  async appendDecision(
    decision: WorkspaceExecutionTrustDecision
  ): Promise<WorkspaceExecutionTrustDecision> {
    const parsed = workspaceExecutionTrustDecisionSchema.parse(decision);
    if (this.decisions.some((entry) => entry.id === parsed.id)) {
      throw new Error('Workspace execution trust decision ID already exists.');
    }
    this.decisions.push(parsed);
    return structuredClone(parsed);
  }
}

export class FileWorkspaceExecutionTrustRepository implements WorkspaceExecutionTrustRepository {
  private readonly statePath: string;

  constructor(statePath = path.join(getRuntimeDir(), 'workspace-execution-trust', 'state.json')) {
    this.statePath = statePath;
    ensureWithinBase(path.dirname(statePath), statePath);
  }

  inspect(workspacePath: string): Promise<WorkspaceExecutionTrustInventory> {
    return inspectWorkspace(workspacePath);
  }

  async listDecisions(identityDigest?: string): Promise<WorkspaceExecutionTrustDecision[]> {
    const state = await this.read();
    return structuredClone(
      state.decisions.filter(
        (decision) => !identityDigest || decision.identityDigest === identityDigest
      )
    );
  }

  async appendDecision(
    decision: WorkspaceExecutionTrustDecision
  ): Promise<WorkspaceExecutionTrustDecision> {
    const parsed = workspaceExecutionTrustDecisionSchema.parse(decision);
    await mkdir(path.dirname(this.statePath), { recursive: true });
    return withFileLock(this.statePath, async () => {
      const state = await this.read();
      if (state.decisions.some((entry) => entry.id === parsed.id)) {
        throw new Error('Workspace execution trust decision ID already exists.');
      }
      state.decisions.push(parsed);
      const normalized = stateSchema.parse(state);
      await atomicWriteFile(this.statePath, `${JSON.stringify(normalized, null, 2)}\n`);
      return structuredClone(parsed);
    });
  }

  private async read(): Promise<WorkspaceExecutionTrustState> {
    if (!(await fileExists(this.statePath))) return emptyState();
    return stateSchema.parse(JSON.parse(await readFile(this.statePath, 'utf8')));
  }
}
