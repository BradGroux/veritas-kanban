import { createHash } from 'node:crypto';
import path from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';
import {
  DEFAULT_RUN_FILE_EXECUTION_PROJECT_POLICY,
  RUN_FILE_EXECUTION_EVIDENCE_SCHEMA_VERSION,
  type RunFileExecutionApprovalEvidence,
  type RunFileExecutionProjectPolicy,
  type RunFileExecutionReferenceEvidence,
  type RunFileExecutionReferenceKind,
  type RunFileProvenanceSource,
  type RunTerminalExecuteRequest,
  type TaskLaunchBaseline,
} from '@veritas-kanban/shared';
import { ConflictError } from '../middleware/error-handler.js';
import { lstat, open, realpath } from '../storage/fs-helpers.js';
import { ensureWithinBase } from '../utils/sanitize.js';
import { calculateRunFileExecutionEvidenceDigest } from '../utils/run-file-execution-digest.js';
import {
  getRunFileProvenanceService,
  type RunFileProvenanceService,
} from './run-file-provenance-service.js';
import { digestTerminalRequest, runTerminalCommandId } from './run-terminal-service.js';

const MAX_REFERENCES = 16;
const MAX_REFERENCED_FILE_BYTES = 512 * 1024 * 1024;
const EXTERNAL_SOURCES = new Set<RunFileProvenanceSource>([
  'attachment-derived',
  'connector-derived',
  'downloaded-external',
  'unknown',
]);

export interface RunFileExecutionEvaluationInput {
  workspaceId: string;
  taskId: string;
  rootObjectiveId: string;
  executionNodeId: string;
  runId: string;
  attemptId: string;
  workflowStepId: string | null;
  launchManifestDigest: string;
  phaseEvidenceDigest: string | null;
  worktreeRoot: string;
  baseline: TaskLaunchBaseline;
  request: RunTerminalExecuteRequest;
  policy?: RunFileExecutionProjectPolicy;
}

interface FileSnapshot {
  relativePath: string;
  sha256: string;
  byteSize: number;
}

interface ReferenceCandidate {
  kind: RunFileExecutionReferenceKind;
  value: string;
}

export interface RunFileExecutionPolicyServiceOptions {
  provenance?: Pick<RunFileProvenanceService, 'approvalEvidence' | 'resolve'>;
  git?: (cwd: string) => Pick<SimpleGit, 'raw'>;
}

export class RunFileExecutionPolicyService {
  private readonly provenance: Pick<RunFileProvenanceService, 'approvalEvidence' | 'resolve'>;
  private readonly git: (cwd: string) => Pick<SimpleGit, 'raw'>;

  constructor(options: RunFileExecutionPolicyServiceOptions = {}) {
    this.provenance = options.provenance ?? getRunFileProvenanceService();
    this.git = options.git ?? ((cwd) => simpleGit({ baseDir: cwd, maxConcurrentProcesses: 1 }));
  }

  async evaluate(
    input: RunFileExecutionEvaluationInput
  ): Promise<RunFileExecutionApprovalEvidence> {
    const policy = input.policy ?? DEFAULT_RUN_FILE_EXECUTION_PROJECT_POLICY;
    assertSupportedInvocation(input.request);
    const canonicalRoot = await realpath(path.resolve(input.worktreeRoot));
    const requestedCwd = path.resolve(canonicalRoot, input.request.cwd ?? '.');
    ensureWithinBase(canonicalRoot, requestedCwd);
    const canonicalCwd = await realpath(requestedCwd);
    ensureWithinBase(canonicalRoot, canonicalCwd);
    const candidates = referenceCandidates(input.request);
    if (candidates.length > MAX_REFERENCES) {
      throw new ConflictError('Run file execution reference count exceeds its safety bound.', {
        code: 'run-file-execution-reference-limit',
        maximum: MAX_REFERENCES,
      });
    }

    const references: RunFileExecutionReferenceEvidence[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      const snapshot = await snapshotCandidate(canonicalRoot, canonicalCwd, candidate);
      if (!snapshot) continue;
      const identity = `${candidate.kind}\0${snapshot.relativePath}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      references.push(await this.referenceEvidence(input, policy, candidate.kind, snapshot));
    }
    references.sort(
      (left, right) =>
        left.relativePath.localeCompare(right.relativePath) || left.kind.localeCompare(right.kind)
    );

    const decision = references.some((reference) => reference.decision === 'deny')
      ? 'deny'
      : references.some((reference) => reference.decision === 'human-approval')
        ? 'human-approval'
        : 'standard-approval';
    const reasonCode =
      references.length === 0
        ? 'no-referenced-files'
        : decision === 'deny'
          ? 'project-policy-deny'
          : references.some((reference) => EXTERNAL_SOURCES.has(reference.source))
            ? 'external-or-unknown-file'
            : references.some((reference) => reference.provenanceStatus === 'exact')
              ? 'run-produced-file'
              : 'baseline-only';
    const material = {
      schemaVersion: RUN_FILE_EXECUTION_EVIDENCE_SCHEMA_VERSION,
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      rootObjectiveId: input.rootObjectiveId,
      executionNodeId: input.executionNodeId,
      runId: input.runId,
      attemptId: input.attemptId,
      workflowStepId: input.workflowStepId,
      terminalRequestId: input.request.requestId,
      terminalRequestDigest: digestTerminalRequest(input.request),
      commandId: runTerminalCommandId(input.request.command, input.request.args),
      launchManifestDigest: input.launchManifestDigest,
      phaseEvidenceDigest: input.phaseEvidenceDigest,
      policy,
      references,
      decision,
      reasonCode,
    } satisfies Omit<RunFileExecutionApprovalEvidence, 'digest'>;
    return { ...material, digest: calculateRunFileExecutionEvidenceDigest(material) };
  }

  async revalidate(
    input: RunFileExecutionEvaluationInput,
    expected: RunFileExecutionApprovalEvidence
  ): Promise<void> {
    const current = await this.evaluate(input);
    if (current.digest !== expected.digest) {
      throw new ConflictError('Referenced file identity changed after approval.', {
        code: 'run-file-execution-evidence-drift',
        expectedEvidenceDigest: expected.digest,
        currentEvidenceDigest: current.digest,
        terminalRequestId: input.request.requestId,
      });
    }
  }

  private async referenceEvidence(
    input: RunFileExecutionEvaluationInput,
    policy: RunFileExecutionProjectPolicy,
    kind: RunFileExecutionReferenceKind,
    snapshot: FileSnapshot
  ): Promise<RunFileExecutionReferenceEvidence> {
    const provenance = await this.provenance.approvalEvidence({
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      attemptId: input.attemptId,
      root: 'worktree',
      relativePath: snapshot.relativePath,
      sha256: snapshot.sha256,
    });
    if (provenance.status === 'exact' && provenance.currentRecordId) {
      const resolved = await this.exactRecord(input, snapshot.relativePath, snapshot.sha256);
      if (
        resolved.current?.id !== provenance.currentRecordId ||
        resolved.current?.digest !== provenance.currentRecordDigest
      ) {
        throw new ConflictError('File provenance changed during approval evaluation.', {
          code: 'run-file-execution-provenance-race',
          relativePath: snapshot.relativePath,
        });
      }
      const source = resolved.current.source;
      return {
        kind,
        root: 'worktree',
        relativePath: snapshot.relativePath,
        contentSha256: snapshot.sha256,
        byteSize: snapshot.byteSize,
        source,
        provenanceStatus: 'exact',
        provenanceRecordId: provenance.currentRecordId,
        provenanceRecordDigest: provenance.currentRecordDigest,
        provenanceEvidenceDigest: provenance.digest,
        decision: decisionForSource(source, policy),
      };
    }

    const launchSource = await this.launchBaselineSource(input, snapshot);
    if (launchSource) {
      return {
        kind,
        root: 'worktree',
        relativePath: snapshot.relativePath,
        contentSha256: snapshot.sha256,
        byteSize: snapshot.byteSize,
        source: launchSource,
        provenanceStatus: 'launch-baseline',
        provenanceRecordId: null,
        provenanceRecordDigest: null,
        provenanceEvidenceDigest: digest({
          status: 'launch-baseline',
          source: launchSource,
          headSha: input.baseline.headSha,
          relativePath: snapshot.relativePath,
          sha256: snapshot.sha256,
        }),
        decision: 'standard-approval',
      };
    }

    return {
      kind,
      root: 'worktree',
      relativePath: snapshot.relativePath,
      contentSha256: snapshot.sha256,
      byteSize: snapshot.byteSize,
      source: 'unknown',
      provenanceStatus: provenance.status,
      provenanceRecordId: provenance.currentRecordId,
      provenanceRecordDigest: provenance.currentRecordDigest,
      provenanceEvidenceDigest: provenance.digest,
      decision: 'human-approval',
    };
  }

  private async exactRecord(
    input: RunFileExecutionEvaluationInput,
    relativePath: string,
    sha256: string
  ) {
    const resolved = await this.provenance.resolve({
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      attemptId: input.attemptId,
      root: 'worktree',
      relativePath,
      sha256,
    });
    if (resolved.status !== 'exact' || !resolved.current) {
      throw new ConflictError('File provenance changed during approval evaluation.', {
        code: 'run-file-execution-provenance-race',
        relativePath,
      });
    }
    return resolved;
  }

  private async launchBaselineSource(
    input: RunFileExecutionEvaluationInput,
    snapshot: FileSnapshot
  ): Promise<'repository-baseline' | 'operator-provided' | null> {
    const captured = input.baseline.files.find((file) => file.path === snapshot.relativePath);
    if (captured?.worktreeSha256 === snapshot.sha256.slice('sha256:'.length)) {
      return 'operator-provided';
    }
    if (captured) return null;
    if (!/^[a-f0-9]{40,64}$/.test(input.baseline.headSha)) return null;
    try {
      const git = this.git(input.worktreeRoot);
      const worktreeObject = await git.raw(['hash-object', '--', snapshot.relativePath]);
      const baselineObject = await git.raw([
        'rev-parse',
        `${input.baseline.headSha}:${snapshot.relativePath}`,
      ]);
      return worktreeObject.trim() === baselineObject.trim() ? 'repository-baseline' : null;
    } catch {
      return null;
    }
  }
}

function decisionForSource(
  source: RunFileProvenanceSource,
  policy: RunFileExecutionProjectPolicy
): RunFileExecutionReferenceEvidence['decision'] {
  if (EXTERNAL_SOURCES.has(source)) return 'human-approval';
  if (source === 'agent-created') return policy.agentCreated;
  if (source === 'command-created') return policy.commandCreated;
  if (source === 'tool-created') return policy.toolCreated;
  return 'standard-approval';
}

function referenceCandidates(request: RunTerminalExecuteRequest): ReferenceCandidate[] {
  const candidates: ReferenceCandidate[] = [];
  if (pathLike(request.command)) {
    candidates.push({ kind: 'direct-executable', value: request.command });
  }
  const executable = path
    .basename(request.command)
    .toLowerCase()
    .replace(/\.exe$/, '');
  if (executable === 'node') {
    candidates.push(...nodeReferences(request.args));
  } else if (executable === 'bun') {
    if (['run', 'test', 'install', 'add', 'remove', 'x'].includes(request.args[0] ?? '')) {
      candidates.push({ kind: 'configuration-input', value: 'package.json' });
    } else {
      candidates.push(...nodeReferences(request.args));
    }
  } else if (executable === 'deno') {
    const denoArgs = request.args[0] === 'run' ? request.args.slice(1) : request.args;
    candidates.push(...nodeReferences(denoArgs));
  } else if (/^python(?:\d+(?:\.\d+)*)?$/.test(executable)) {
    candidates.push(...positionalScript(request.args, ['-c', '-m'], ['-W', '-X']));
  } else if (['bash', 'sh', 'zsh', 'dash', 'ruby', 'perl'].includes(executable)) {
    candidates.push(...positionalScript(request.args, ['-c', '-e'], []));
  } else if (['pwsh', 'powershell'].includes(executable)) {
    const file = optionValue(request.args, ['-file']);
    if (file) candidates.push({ kind: 'interpreter-script', value: file });
  } else if (executable === 'java') {
    const archive = optionValue(request.args, ['-jar']);
    if (archive) candidates.push({ kind: 'archive-input', value: archive });
  } else if (executable === 'dotnet') {
    const script = request.args.find((argument) => !argument.startsWith('-'));
    if (script?.toLowerCase().endsWith('.dll')) {
      candidates.push({ kind: 'interpreter-script', value: script });
    }
  } else if (
    ['npm', 'pnpm', 'yarn'].includes(executable) &&
    packageCommandUsesConfig(request.args)
  ) {
    candidates.push({ kind: 'configuration-input', value: 'package.json' });
  } else if (executable === 'unzip') {
    const archive = request.args.find((argument) => !argument.startsWith('-'));
    if (archive) candidates.push({ kind: 'archive-input', value: archive });
  } else if (executable === 'tar') {
    const archive = optionValue(request.args, ['-f', '--file']);
    if (archive) candidates.push({ kind: 'archive-input', value: archive });
  }
  return candidates;
}

function assertSupportedInvocation(request: RunTerminalExecuteRequest): void {
  const loadPathEnvironment = request.environmentKeys.find((key) =>
    [
      'NODE_PATH',
      'PYTHONPATH',
      'RUBYLIB',
      'PERL5LIB',
      'LD_LIBRARY_PATH',
      'DYLD_LIBRARY_PATH',
    ].includes(key)
  );
  if (loadPathEnvironment) {
    throw unsupportedIndirect('environment-load-path', loadPathEnvironment);
  }
  const executable = path
    .basename(request.command)
    .toLowerCase()
    .replace(/\.exe$/, '');
  if (['node', 'bun', 'deno'].includes(executable)) {
    const inline = request.args.find((argument) =>
      ['-e', '--eval', '-p', '--print'].includes(argument)
    );
    if (inline) throw unsupportedIndirect('inline-interpreter', inline);
  }
  if (/^python(?:\d+(?:\.\d+)*)?$/.test(executable)) {
    const indirect = request.args.find((argument) => ['-c', '-m'].includes(argument));
    if (indirect) throw unsupportedIndirect('python-indirect', indirect);
  }
  if (['bash', 'sh', 'zsh', 'dash', 'ruby', 'perl'].includes(executable)) {
    const inline = request.args.find((argument) => ['-c', '-e'].includes(argument));
    if (inline) throw unsupportedIndirect('inline-shell-or-interpreter', inline);
  }
  if (['npm', 'pnpm', 'yarn'].includes(executable) && packageCommandUsesConfig(request.args)) {
    throw unsupportedIndirect('package-script-dispatch', executable);
  }
  if (executable === 'bun' && ['run', 'test', 'x'].includes(request.args[0] ?? '')) {
    throw unsupportedIndirect('package-script-dispatch', executable);
  }
}

function nodeReferences(args: string[]): ReferenceCandidate[] {
  const candidates: ReferenceCandidate[] = [];
  for (const [names, kind] of [
    [['-r', '--require', '--import', '--loader'], 'loader-input'],
    [['--config', '--env-file'], 'configuration-input'],
  ] as const) {
    for (const name of names) {
      const value = optionValue(args, [name]);
      if (value) candidates.push({ kind, value });
    }
  }
  if (args.some((argument) => ['-e', '--eval', '-p', '--print'].includes(argument))) {
    return candidates;
  }
  const consumed = new Set<number>();
  for (let index = 0; index < args.length; index += 1) {
    if (
      ['-r', '--require', '--import', '--loader', '--config', '--env-file'].includes(args[index])
    ) {
      consumed.add(index);
      consumed.add(index + 1);
    }
  }
  const script = args.find((argument, index) => !consumed.has(index) && !argument.startsWith('-'));
  if (script) candidates.push({ kind: 'interpreter-script', value: script });
  return candidates;
}

function positionalScript(
  args: string[],
  inlineFlags: string[],
  valueFlags: string[]
): ReferenceCandidate[] {
  if (args.some((argument) => inlineFlags.includes(argument))) return [];
  const consumed = new Set<number>();
  for (let index = 0; index < args.length; index += 1) {
    if (valueFlags.includes(args[index])) {
      consumed.add(index);
      consumed.add(index + 1);
    }
  }
  const script = args.find((argument, index) => !consumed.has(index) && !argument.startsWith('-'));
  return script ? [{ kind: 'interpreter-script', value: script }] : [];
}

function optionValue(args: string[], names: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (names.includes(argument)) return args[index + 1];
    for (const name of names) {
      if (argument.startsWith(`${name}=`)) return argument.slice(name.length + 1);
    }
  }
  return undefined;
}

function packageCommandUsesConfig(args: string[]): boolean {
  if (args.some((argument) => ['--version', '-v', '--help', '-h'].includes(argument))) return false;
  const command = args.find((argument) => !argument.startsWith('-'))?.toLowerCase();
  if (!command) return false;
  return !['config', 'help', 'list', 'view', 'why', 'outdated'].includes(command);
}

async function snapshotCandidate(
  canonicalRoot: string,
  canonicalCwd: string,
  candidate: ReferenceCandidate
): Promise<FileSnapshot | null> {
  if (!candidate.value || candidate.value.includes('\0') || candidate.value.startsWith('file:')) {
    throw unsupportedIdentity(candidate);
  }
  const absolutePath = path.resolve(canonicalCwd, candidate.value);
  try {
    ensureWithinBase(canonicalRoot, absolutePath);
  } catch {
    if (candidate.kind === 'direct-executable' && path.isAbsolute(candidate.value)) return null;
    throw unsupportedIdentity(candidate);
  }
  let before;
  try {
    before = await lstat(absolutePath);
  } catch {
    if (candidate.kind === 'direct-executable' && !pathLike(candidate.value)) return null;
    throw unsupportedIdentity(candidate);
  }
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
    throw unsupportedIdentity(candidate);
  }
  if (before.size > MAX_REFERENCED_FILE_BYTES) {
    throw new ConflictError('Referenced execution input exceeds its hashing bound.', {
      code: 'run-file-execution-file-too-large',
      kind: candidate.kind,
      maximumBytes: MAX_REFERENCED_FILE_BYTES,
    });
  }
  const canonicalPath = await realpath(absolutePath);
  ensureWithinBase(canonicalRoot, canonicalPath);
  const handle = await open(absolutePath, 'r');
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.size !== before.size) {
      throw unsupportedIdentity(candidate);
    }
    const hash = createHash('sha256');
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
    const after = await lstat(absolutePath);
    const afterCanonical = await realpath(absolutePath);
    if (
      after.isSymbolicLink() ||
      after.nlink !== 1 ||
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.size !== opened.size ||
      afterCanonical !== canonicalPath
    ) {
      throw unsupportedIdentity(candidate);
    }
    return {
      relativePath: path.relative(canonicalRoot, canonicalPath).split(path.sep).join('/'),
      sha256: `sha256:${hash.digest('hex')}`,
      byteSize: opened.size,
    };
  } finally {
    await handle.close();
  }
}

function unsupportedIdentity(candidate: ReferenceCandidate): ConflictError {
  return new ConflictError('Referenced execution input identity cannot be certified.', {
    code: 'run-file-execution-unsupported-identity',
    kind: candidate.kind,
  });
}

function unsupportedIndirect(kind: string, control: string): ConflictError {
  return new ConflictError('Indirect file execution cannot be certified by this runtime.', {
    code: 'run-file-execution-unsupported-indirect',
    kind,
    control,
    remediation:
      'Use an explicit direct executable, interpreter script, loader, archive, or config path.',
  });
}

function pathLike(value: string): boolean {
  return path.isAbsolute(value) || value.startsWith('.') || /[\\/]/.test(value);
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

let runFileExecutionPolicyService: RunFileExecutionPolicyService | undefined;

export function getRunFileExecutionPolicyService(): RunFileExecutionPolicyService {
  runFileExecutionPolicyService ??= new RunFileExecutionPolicyService();
  return runFileExecutionPolicyService;
}
