import { createHash } from 'node:crypto';
import path from 'node:path';
import { simpleGit, type SimpleGit, type StatusResult } from 'simple-git';
import {
  COMPLETION_RESULT_SCHEMA_VERSION,
  TASK_ENVELOPE_SCHEMA_VERSION,
  findProviderRuntimeCapability,
  type ProviderRuntimeManifest,
  type Task,
  type TaskAllowedSideEffect,
  type TaskCompletionArtifact,
  type TaskCompletionChangedFile,
  type TaskCompletionSideEffect,
  type TaskCompletionVerification,
  type TaskCommitPolicy,
  type TaskEnvelope,
  type TaskEvidenceRequirement,
  type TaskExecutionPolicy,
  type TaskExpectedOutput,
  type TaskLaunchBaseline,
  type TaskLaunchBaselineFile,
} from '@veritas-kanban/shared';
import { parseTaskEnvelope } from '../schemas/task-envelope-schemas.js';
import {
  calculateTaskEnvelopeDigest,
  type TaskEnvelopePayload,
} from '../utils/task-envelope-digest.js';
import { sha256WorktreeEntry } from '../utils/worktree-fingerprint.js';

const MAX_BASELINE_FILES = 1000;
const BASELINE_GIT_TIMEOUT_MS = 10_000;
const MAX_BASELINE_CAPTURE_ATTEMPTS = 3;
const MAX_PREEXISTING_COMMITS = 4096;
const INDEX_PATHSPEC_CHUNK_LENGTH = 48_000;
const WORKTREE_HASH_CONCURRENCY = 8;

type BaselineGitClient = Pick<SimpleGit, 'raw' | 'revparse' | 'status'>;
type BaselineGitFactory = (worktreePath: string) => BaselineGitClient;

function createBaselineGit(worktreePath: string): BaselineGitClient {
  return simpleGit({
    baseDir: worktreePath,
    maxConcurrentProcesses: 1,
    timeout: { block: BASELINE_GIT_TIMEOUT_MS },
  });
}

export interface CompletionEvidenceSource {
  captureLaunchBaseline(worktreePath: string, capturedAt: string): Promise<TaskLaunchBaseline>;
  captureCompletionEvidence(
    input: CaptureCompletionEvidenceInput
  ): Promise<CompletionEvidenceSnapshot>;
}

export interface CaptureCompletionEvidenceInput {
  task: Task;
  taskEnvelope: TaskEnvelope;
  capturedAt: string;
  reportedArtifacts: TaskCompletionArtifact[];
}

export interface CompletionEvidenceCommit {
  sha: string;
  summary: string;
}

export interface CompletionEvidenceSnapshot {
  capturedAt: string;
  headSha: string;
  changedFiles: TaskCompletionChangedFile[];
  commits: CompletionEvidenceCommit[];
  artifacts: TaskCompletionArtifact[];
  verification: TaskCompletionVerification[];
  sideEffects: TaskCompletionSideEffect[];
}

export class GitCompletionEvidenceSource implements CompletionEvidenceSource {
  constructor(private readonly gitFactory: BaselineGitFactory = createBaselineGit) {}

  async captureLaunchBaseline(
    worktreePath: string,
    capturedAt: string
  ): Promise<TaskLaunchBaseline> {
    const git = this.gitFactory(worktreePath);

    for (let attempt = 1; attempt <= MAX_BASELINE_CAPTURE_ATTEMPTS; attempt++) {
      const headBefore = (await git.revparse(['HEAD'])).trim();
      const statusBefore = await git.status(['--untracked-files=all']);
      assertBaselineFileLimit(statusBefore);
      const filesBefore = await captureBaselineFiles(git, worktreePath, statusBefore);
      const preexistingCommitsBefore = await capturePreexistingCommits(git, headBefore);

      const headAfter = (await git.revparse(['HEAD'])).trim();
      const statusAfter = await git.status(['--untracked-files=all']);
      assertBaselineFileLimit(statusAfter);
      const preexistingCommitsAfter = await capturePreexistingCommits(git, headAfter);
      if (
        headBefore !== headAfter ||
        statusSignature(statusBefore) !== statusSignature(statusAfter) ||
        JSON.stringify(preexistingCommitsBefore) !== JSON.stringify(preexistingCommitsAfter)
      ) {
        continue;
      }

      const filesAfter = await captureBaselineFiles(git, worktreePath, statusAfter);
      const headFinal = (await git.revparse(['HEAD'])).trim();
      const statusFinal = await git.status(['--untracked-files=all']);
      assertBaselineFileLimit(statusFinal);
      const preexistingCommitsFinal = await capturePreexistingCommits(git, headFinal);
      if (
        headAfter !== headFinal ||
        statusSignature(statusAfter) !== statusSignature(statusFinal) ||
        JSON.stringify(filesBefore) !== JSON.stringify(filesAfter) ||
        JSON.stringify(preexistingCommitsAfter) !== JSON.stringify(preexistingCommitsFinal)
      ) {
        continue;
      }

      return {
        capturedAt,
        headSha: headFinal,
        dirty: !statusFinal.isClean(),
        files: filesAfter,
        preexistingCommitShas: preexistingCommitsFinal,
      };
    }

    throw new Error(
      `Task worktree changed while capturing the launch baseline after ${MAX_BASELINE_CAPTURE_ATTEMPTS} attempts`
    );
  }

  async captureCompletionEvidence(
    input: CaptureCompletionEvidenceInput
  ): Promise<CompletionEvidenceSnapshot> {
    const worktreePath = input.taskEnvelope.workspace.worktreePath;
    const git = this.gitFactory(worktreePath);

    for (let attempt = 1; attempt <= MAX_BASELINE_CAPTURE_ATTEMPTS; attempt++) {
      const before = await captureCompletionGitState(
        git,
        worktreePath,
        input.taskEnvelope.workspace.baseline,
        input.taskEnvelope.workspace.branch
      );
      const after = await captureCompletionGitState(
        git,
        worktreePath,
        input.taskEnvelope.workspace.baseline,
        input.taskEnvelope.workspace.branch
      );
      if (JSON.stringify(before) !== JSON.stringify(after)) continue;

      const artifacts = await verifyReportedArtifacts(
        worktreePath,
        input.reportedArtifacts,
        before.changedFiles
      );
      const verification = input.taskEnvelope.verificationGates.map((gate) => {
        const taskStep = input.task.verificationSteps?.find((step) => step.id === gate.id);
        const checkedAt = taskStep?.checkedAt ? Date.parse(taskStep.checkedAt) : Number.NaN;
        const verifiedAfterLaunch =
          taskStep?.checked === true &&
          Number.isFinite(checkedAt) &&
          checkedAt >= Date.parse(input.taskEnvelope.attempt.createdAt);
        return {
          gateId: gate.id,
          status: verifiedAfterLaunch ? ('passed' as const) : ('unknown' as const),
          summary: verifiedAfterLaunch
            ? 'Task verification state records this gate as passed.'
            : taskStep?.checked
              ? 'The verification gate predates this attempt or has no attributable timestamp.'
              : 'No harness-verifiable completion evidence was recorded for this gate.',
          evidenceIds: verifiedAfterLaunch ? [`verification-${gate.id}`] : [],
        };
      });
      const allowedKinds = new Set(
        input.taskEnvelope.allowedSideEffects.map((sideEffect) => sideEffect.kind)
      );
      const sideEffects: TaskCompletionSideEffect[] = [];
      if (before.changedFiles.length > 0) {
        sideEffects.push({
          kind: 'filesystem-write',
          description: `Changed ${before.changedFiles.length} file${before.changedFiles.length === 1 ? '' : 's'} after launch.`,
          target: worktreePath,
          authorized: allowedKinds.has('filesystem-write'),
          verified: true,
        });
      }
      if (before.commits.length > 0) {
        sideEffects.push({
          kind: 'git-commit',
          description: `Created ${before.commits.length} commit${before.commits.length === 1 ? '' : 's'} after launch.`,
          target: before.commits[0]?.sha ?? null,
          authorized:
            input.taskEnvelope.commitPolicy !== 'forbidden' && allowedKinds.has('git-commit'),
          verified: true,
        });
      }
      if (!before.historyAttributable) {
        sideEffects.push({
          kind: 'git-commit',
          description:
            'Completion HEAD is not attributable to commits created on the launch branch after the baseline.',
          target: before.headSha,
          authorized: false,
          verified: true,
        });
      }
      return {
        capturedAt: input.capturedAt,
        headSha: before.headSha,
        changedFiles: before.changedFiles,
        commits: before.commits,
        artifacts,
        verification,
        sideEffects: sideEffects.slice(0, 256),
      };
    }

    throw new Error(
      `Task worktree changed while capturing completion evidence after ${MAX_BASELINE_CAPTURE_ATTEMPTS} attempts`
    );
  }
}

export interface ResolveTaskCommitPolicyInput {
  runPolicy?: TaskCommitPolicy;
  taskPolicy?: TaskExecutionPolicy;
  legacyAutoCommitOnComplete?: boolean;
}

export function resolveTaskCommitPolicy(input: ResolveTaskCommitPolicyInput): TaskCommitPolicy {
  return (
    input.runPolicy ??
    input.taskPolicy?.commitPolicy ??
    (input.legacyAutoCommitOnComplete ? 'required' : 'allowed')
  );
}

export interface BuildTaskEnvelopeInput {
  task: Task;
  attemptId: string;
  createdAt: string;
  worktreePath: string;
  providerRuntimeManifest: ProviderRuntimeManifest;
  commitPolicy: TaskCommitPolicy;
  profileInstructions?: string;
  networkAccessEnabled?: boolean;
  executionPolicy?: TaskExecutionPolicy;
}

export class TaskEnvelopeService {
  constructor(
    private readonly evidenceSource: CompletionEvidenceSource = new GitCompletionEvidenceSource()
  ) {}

  async build(input: BuildTaskEnvelopeInput): Promise<TaskEnvelope> {
    const baseline = await this.evidenceSource.captureLaunchBaseline(
      input.worktreePath,
      input.createdAt
    );
    const payload: TaskEnvelopePayload = {
      schemaVersion: TASK_ENVELOPE_SCHEMA_VERSION,
      subject: {
        id: input.task.id,
        title: input.task.title,
        objective: input.task.title,
        background: compactTaskEnvelopeStrings([
          input.task.description,
          ...(input.task.observations ?? [])
            .filter(
              (observation) => observation.type === 'context' || observation.type === 'decision'
            )
            .map((observation) => observation.content),
        ]).slice(0, 64),
        constraints: compactTaskEnvelopeStrings([
          input.profileInstructions,
          `Operate only inside the assigned worktree: ${input.worktreePath}`,
        ]).slice(0, 128),
        acceptanceCriteria: compactTaskEnvelopeStrings(
          (input.task.subtasks ?? []).flatMap((subtask) => subtask.acceptanceCriteria ?? [])
        ).slice(0, 256),
      },
      attempt: {
        id: input.attemptId,
        createdAt: input.createdAt,
      },
      workspace: {
        workspaceId: normalizeWorkspaceId(
          input.task.project?.trim() || input.task.git?.repo || input.task.id
        ),
        worktreeId: input.task.id,
        ...(input.task.git?.worktreeManifestId
          ? { worktreeManifestId: input.task.git.worktreeManifestId }
          : {}),
        ...(input.task.git?.worktreeLeaseId
          ? { ownershipLeaseId: input.task.git.worktreeLeaseId }
          : {}),
        ...(input.task.git?.worktreeManifestId && input.task.git.worktreeLeaseId
          ? { ownershipAttemptId: input.attemptId }
          : input.task.git?.worktreeLeaseOwnerAttemptId
            ? { ownershipAttemptId: input.task.git.worktreeLeaseOwnerAttemptId }
            : {}),
        repo: input.task.git?.repo || 'unknown',
        branch: input.task.git?.branch || 'unknown',
        baseBranch: input.task.git?.baseBranch || 'unknown',
        ...(input.task.git?.worktreeBaseCommit
          ? { resolvedBaseCommit: input.task.git.worktreeBaseCommit }
          : {}),
        ...(input.task.git?.worktreeBaseSource
          ? { baseResolutionSource: input.task.git.worktreeBaseSource }
          : {}),
        worktreePath: input.worktreePath,
        baseline,
      },
      commitPolicy: input.commitPolicy,
      allowedSideEffects: buildAllowedSideEffects(input),
      expectedOutputs: buildExpectedOutputs(input),
      verificationGates: (input.task.verificationSteps ?? []).slice(0, 256).map((step) => ({
        id: step.id,
        description: step.description,
        required: true,
        evidenceRequired: true,
      })),
      launchManifest: {
        schemaVersion: input.providerRuntimeManifest.schemaVersion,
        digest: input.providerRuntimeManifest.digest,
        provider: input.providerRuntimeManifest.provider,
        adapter: input.providerRuntimeManifest.adapter,
        protocolVersion: input.providerRuntimeManifest.protocolVersion,
      },
      completionContract: {
        schemaVersion: COMPLETION_RESULT_SCHEMA_VERSION,
        evidenceRequirements: buildEvidenceRequirements(input),
      },
    };
    const envelope = parseTaskEnvelope({
      ...payload,
      digest: calculateTaskEnvelopeDigest(payload),
    });
    return immutableClone(envelope);
  }
}

function buildAllowedSideEffects(input: BuildTaskEnvelopeInput): TaskAllowedSideEffect[] {
  const defaults: TaskAllowedSideEffect[] = [
    { kind: 'filesystem-write', scope: input.worktreePath },
    { kind: 'process-execute', scope: input.worktreePath },
  ];
  if (input.commitPolicy !== 'forbidden') {
    defaults.push({ kind: 'git-commit', scope: input.worktreePath });
  }
  if (input.networkAccessEnabled) {
    defaults.push({ kind: 'network-egress', scope: 'sandbox policy' });
  }
  const artifactCapability = findProviderRuntimeCapability(
    input.providerRuntimeManifest,
    'artifact.write'
  );
  if (artifactCapability?.state === 'supported') {
    defaults.push({ kind: 'artifact-write', scope: input.worktreePath });
  }

  const requested = input.executionPolicy?.allowedSideEffects ?? defaults;
  const effective = uniqueBy(
    requested.flatMap((sideEffect) =>
      defaults
        .filter((sandboxEffect) => sandboxEffect.kind === sideEffect.kind)
        .flatMap((sandboxEffect) => {
          const scope = clampSideEffectScope(sideEffect, sandboxEffect);
          return scope ? [{ ...sideEffect, scope }] : [];
        })
    ),
    (sideEffect) => `${sideEffect.kind}:${sideEffect.scope}`
  ).slice(0, 32);
  if (
    input.commitPolicy === 'required' &&
    !effective.some((sideEffect) => sideEffect.kind === 'git-commit')
  ) {
    throw new Error('Required commit policy must authorize the git-commit side effect');
  }
  return effective;
}

function buildExpectedOutputs(input: BuildTaskEnvelopeInput): TaskExpectedOutput[] {
  const configured = input.executionPolicy?.expectedOutputs;
  const outputs: TaskExpectedOutput[] = [...(configured ?? [])];
  if (!outputs.some((output) => output.id === 'completion-summary')) {
    outputs.unshift({
      id: 'completion-summary',
      kind: 'text',
      description: 'A concise summary of the completed work and remaining risks.',
      required: true,
    });
  }
  if (
    input.commitPolicy === 'required' &&
    !outputs.some((output) => output.kind === 'commit' && output.required)
  ) {
    outputs.push({
      id: 'git-commit',
      kind: 'commit',
      description: 'At least one new commit attributable to this attempt.',
      required: true,
    });
  }
  if (
    input.commitPolicy === 'forbidden' &&
    outputs.some((output) => output.kind === 'commit' && output.required)
  ) {
    throw new Error('Forbidden commit policy cannot require a commit output');
  }
  for (const deliverable of input.task.deliverables ?? []) {
    outputs.push({
      id: `deliverable-${deliverable.id}`,
      kind: deliverable.path ? 'file' : 'artifact',
      description: deliverable.title,
      required: deliverable.status !== 'accepted',
    });
  }
  return uniqueBy(outputs, (output) => output.id).slice(0, 64);
}

function buildEvidenceRequirements(input: BuildTaskEnvelopeInput): TaskEvidenceRequirement[] {
  const requirements: TaskEvidenceRequirement[] = [
    {
      id: 'terminal-state',
      kind: 'provider-output',
      description: 'Harness-verified provider terminal state from the native transport.',
      required: true,
    },
  ];
  if ((input.task.verificationSteps?.length ?? 0) > 0) {
    requirements.push({
      id: 'verification',
      kind: 'verification',
      description: 'Harness-verified evidence for every required verification gate.',
      required: true,
    });
  }
  if (input.commitPolicy === 'required') {
    requirements.push({
      id: 'commit',
      kind: 'commit',
      description: 'Harness-verified commit created after the launch baseline.',
      required: true,
    });
  }
  return requirements;
}

function mapBaselineFile(
  file: StatusResult['files'][number],
  indexBlobHash: string | null,
  worktreeSha256: string | null
): TaskLaunchBaselineFile {
  const code = `${file.index}${file.working_dir}`;
  let status: TaskLaunchBaselineFile['status'] = 'modified';
  if (code.includes('?')) status = 'untracked';
  else if (code.includes('R')) status = 'renamed';
  else if (code.includes('D')) status = 'deleted';
  else if (code.includes('A')) status = 'added';
  return { path: file.path, status, indexBlobHash, worktreeSha256 };
}

function assertBaselineFileLimit(status: StatusResult): void {
  if (status.files.length > MAX_BASELINE_FILES) {
    throw new Error(
      `Task worktree baseline has ${status.files.length} changed files; maximum is ${MAX_BASELINE_FILES}`
    );
  }
}

function statusSignature(status: StatusResult): string {
  return JSON.stringify({
    ahead: status.ahead,
    behind: status.behind,
    current: status.current,
    detached: status.detached,
    tracking: status.tracking,
    files: status.files
      .map((file) => ({
        from: file.from ?? null,
        path: file.path,
        index: file.index,
        workingDir: file.working_dir,
      }))
      .sort((left, right) =>
        `${left.path}\0${left.from ?? ''}`.localeCompare(`${right.path}\0${right.from ?? ''}`)
      ),
  });
}

async function captureBaselineFiles(
  git: BaselineGitClient,
  worktreePath: string,
  status: StatusResult
): Promise<TaskLaunchBaselineFile[]> {
  const statusFiles = [...status.files].sort((left, right) =>
    `${left.path}\0${left.from ?? ''}`.localeCompare(`${right.path}\0${right.from ?? ''}`)
  );
  const indexBlobHashes = await readIndexBlobHashes(
    git,
    statusFiles.map((file) => file.path)
  );
  const result: TaskLaunchBaselineFile[] = [];

  for (let offset = 0; offset < statusFiles.length; offset += WORKTREE_HASH_CONCURRENCY) {
    const batch = statusFiles.slice(offset, offset + WORKTREE_HASH_CONCURRENCY);
    result.push(
      ...(await Promise.all(
        batch.map(async (file) =>
          mapBaselineFile(
            file,
            indexBlobHashes.get(file.path) ?? null,
            await sha256WorktreeEntry(worktreePath, file.path)
          )
        )
      ))
    );
  }
  return result;
}

interface CompletionGitState {
  headSha: string;
  historyAttributable: boolean;
  changedFiles: TaskCompletionChangedFile[];
  commits: CompletionEvidenceCommit[];
}

interface GitNameStatus {
  path: string;
  previousPath: string | null;
  status: TaskCompletionChangedFile['status'];
}

async function captureCompletionGitState(
  git: BaselineGitClient,
  worktreePath: string,
  baseline: TaskLaunchBaseline,
  expectedBranch: string
): Promise<CompletionGitState> {
  const headSha = (await git.revparse(['HEAD'])).trim();
  const status = await git.status(['--untracked-files=all']);
  if (status.files.length > 2000) {
    throw new Error(
      `Task worktree completion has ${status.files.length} changed files; maximum is 2000`
    );
  }
  const currentStatusFiles = await captureBaselineFiles(git, worktreePath, status);
  const currentByPath = new Map(currentStatusFiles.map((file) => [file.path, file]));
  const baselineByPath = new Map(baseline.files.map((file) => [file.path, file]));
  const candidateCommits =
    baseline.headSha === headSha
      ? []
      : parseCompletionCommits(
          await git.raw([
            'log',
            '--format=%H%x00%s%x00',
            '--max-count=256',
            `${baseline.headSha}..${headSha}`,
          ])
        );
  const containsPreexistingHistory =
    baseline.preexistingCommitShas === undefined ||
    candidateCommits.some((commit) => baseline.preexistingCommitShas?.includes(commit.sha));
  const historyAttributable =
    baseline.headSha === headSha ||
    (status.current === expectedBranch &&
      (await isAncestorCommit(git, baseline.headSha, headSha)) &&
      !containsPreexistingHistory);
  const committedChanges =
    baseline.headSha === headSha || !historyAttributable
      ? []
      : parseGitNameStatus(
          await git.raw([
            'diff',
            '--name-status',
            '-z',
            '--find-renames',
            baseline.headSha,
            headSha,
            '--',
          ])
        );
  const candidates = new Map<string, GitNameStatus>();
  for (const change of committedChanges) candidates.set(change.path, change);
  for (const file of status.files) {
    candidates.set(file.path, {
      path: file.path,
      previousPath: file.from ?? null,
      status: mapBaselineFile(file, null, null).status,
    });
  }
  if (candidates.size > 2000) {
    throw new Error(
      `Task worktree completion has ${candidates.size} attributable file candidates; maximum is 2000`
    );
  }

  const candidatePaths = [...candidates.keys()].sort((left, right) => left.localeCompare(right));
  const indexBlobHashes = await readIndexBlobHashes(git, candidatePaths);
  const changedFiles: TaskCompletionChangedFile[] = [];
  for (let offset = 0; offset < candidatePaths.length; offset += WORKTREE_HASH_CONCURRENCY) {
    const batch = candidatePaths.slice(offset, offset + WORKTREE_HASH_CONCURRENCY);
    const entries = await Promise.all(
      batch.map(async (filePath) => {
        const change = candidates.get(filePath);
        if (!change) return null;
        const baselineFile =
          baselineByPath.get(filePath) ??
          (change.previousPath ? baselineByPath.get(change.previousPath) : undefined);
        const currentFile = currentByPath.get(filePath);
        const currentWorktreeSha256 = await sha256WorktreeEntry(worktreePath, filePath);
        const currentIndexBlobHash = indexBlobHashes.get(filePath) ?? null;
        if (
          baselineFile &&
          baselineFile.worktreeSha256 === currentWorktreeSha256 &&
          baselineFile.indexBlobHash === currentIndexBlobHash
        ) {
          return null;
        }
        if (!currentFile && baselineFile && baselineFile.worktreeSha256 === currentWorktreeSha256) {
          return null;
        }
        return {
          path: filePath,
          status: change.status,
          previousPath: change.previousPath,
          verified: true,
        } satisfies TaskCompletionChangedFile;
      })
    );
    for (const entry of entries) {
      if (entry) changedFiles.push(entry);
    }
  }

  const commits = baseline.headSha === headSha || !historyAttributable ? [] : candidateCommits;
  return { headSha, historyAttributable, changedFiles, commits };
}

async function capturePreexistingCommits(
  git: BaselineGitClient,
  headSha: string
): Promise<string[]> {
  const commits = (await git.raw(['rev-list', '--all', '--not', headSha]))
    .split(/\s+/)
    .map((commit) => commit.trim())
    .filter((commit) => /^[a-f0-9]{40,64}$/.test(commit));
  const unique = [...new Set(commits)].sort((left, right) => left.localeCompare(right));
  if (unique.length > MAX_PREEXISTING_COMMITS) {
    throw new Error(
      `Task repository has ${unique.length} pre-existing commits outside the launch HEAD; maximum is ${MAX_PREEXISTING_COMMITS}`
    );
  }
  return unique;
}

async function isAncestorCommit(
  git: BaselineGitClient,
  possibleAncestor: string,
  descendant: string
): Promise<boolean> {
  try {
    await git.raw(['merge-base', '--is-ancestor', possibleAncestor, descendant]);
    return true;
  } catch {
    return false;
  }
}

function parseGitNameStatus(output: string): GitNameStatus[] {
  const fields = output.split('\0');
  const changes: GitNameStatus[] = [];
  for (let index = 0; index < fields.length;) {
    const code = fields[index++];
    if (!code) continue;
    const firstPath = fields[index++];
    if (!firstPath) break;
    if (code.startsWith('R') || code.startsWith('C')) {
      const nextPath = fields[index++];
      if (!nextPath) break;
      changes.push({ path: nextPath, previousPath: firstPath, status: 'renamed' });
      continue;
    }
    changes.push({
      path: firstPath,
      previousPath: null,
      status: code.startsWith('A') ? 'added' : code.startsWith('D') ? 'deleted' : 'modified',
    });
  }
  return changes;
}

function parseCompletionCommits(output: string): CompletionEvidenceCommit[] {
  const fields = output.split('\0');
  const commits: CompletionEvidenceCommit[] = [];
  for (let index = 0; index + 1 < fields.length && commits.length < 256; index += 2) {
    const sha = fields[index]?.trim();
    const summary = fields[index + 1]?.trim();
    if (sha && /^[a-f0-9]{40,64}$/.test(sha)) {
      commits.push({
        sha,
        summary: summary ? summary.slice(0, 500) : '(no commit subject)',
      });
    }
  }
  return commits;
}

async function verifyReportedArtifacts(
  worktreePath: string,
  artifacts: TaskCompletionArtifact[],
  changedFiles: TaskCompletionChangedFile[]
): Promise<TaskCompletionArtifact[]> {
  const verified: TaskCompletionArtifact[] = [];
  const attributablePaths = new Set(changedFiles.map((file) => file.path));
  for (const artifact of artifacts.slice(0, 256)) {
    if (artifact.kind !== 'file') {
      verified.push({ ...artifact, verified: false });
      continue;
    }
    const absolutePath = path.resolve(worktreePath, artifact.reference);
    if (!isPathWithin(path.resolve(worktreePath), absolutePath)) {
      verified.push({ ...artifact, sha256: null, verified: false });
      continue;
    }
    const relativePath = path.relative(worktreePath, absolutePath);
    if (!attributablePaths.has(relativePath)) {
      verified.push({ ...artifact, reference: relativePath, sha256: null, verified: false });
      continue;
    }
    const sha256 = await sha256WorktreeEntry(worktreePath, relativePath);
    verified.push({
      ...artifact,
      reference: relativePath,
      sha256,
      verified: sha256 !== null,
    });
  }
  return verified;
}

async function readIndexBlobHashes(
  git: BaselineGitClient,
  paths: string[]
): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  for (const pathChunk of chunkPathspecs(paths)) {
    const output = await git.raw([
      'ls-files',
      '--stage',
      '-z',
      '--',
      ...pathChunk.map((filePath) => `:(literal)${filePath}`),
    ]);
    for (const record of output.split('\0')) {
      if (!record) continue;
      const tabIndex = record.indexOf('\t');
      if (tabIndex < 0) continue;
      const [mode, objectId, stage] = record.slice(0, tabIndex).split(/\s+/);
      const filePath = record.slice(tabIndex + 1);
      if (!mode || !/^[a-f0-9]{40,64}$/.test(objectId ?? '') || !stage || !filePath) continue;
      if (stage === '0' || !hashes.has(filePath)) hashes.set(filePath, objectId);
    }
  }
  return hashes;
}

function chunkPathspecs(paths: string[]): string[][] {
  const chunks: string[][] = [];
  let chunk: string[] = [];
  let length = 0;
  for (const filePath of paths) {
    if (chunk.length > 0 && length + filePath.length + 1 > INDEX_PATHSPEC_CHUNK_LENGTH) {
      chunks.push(chunk);
      chunk = [];
      length = 0;
    }
    chunk.push(filePath);
    length += filePath.length + 1;
  }
  if (chunk.length > 0) chunks.push(chunk);
  return chunks;
}

const PATH_SCOPED_SIDE_EFFECTS = new Set<TaskAllowedSideEffect['kind']>([
  'filesystem-write',
  'process-execute',
  'git-commit',
  'artifact-write',
]);

function clampSideEffectScope(
  requested: TaskAllowedSideEffect,
  sandboxEffect: TaskAllowedSideEffect
): string | null {
  if (!PATH_SCOPED_SIDE_EFFECTS.has(requested.kind)) return requested.scope;

  const sandboxRoot = path.resolve(sandboxEffect.scope);
  const requestedPath = path.resolve(sandboxRoot, requested.scope);
  if (isPathWithin(sandboxRoot, requestedPath)) return requestedPath;
  if (isPathWithin(requestedPath, sandboxRoot)) return sandboxRoot;
  return null;
}

function isPathWithin(basePath: string, targetPath: string): boolean {
  const relative = path.relative(basePath, targetPath);
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function normalizeWorkspaceId(value: string): string {
  const normalized = value.trim();
  if (normalized.length <= 160) return normalized;
  const suffix = createHash('sha256').update(normalized).digest('hex').slice(0, 16);
  return `${normalized.slice(0, 143).trimEnd()}~${suffix}`;
}

export function compactTaskEnvelopeStrings(values: Array<string | undefined>): string[] {
  return values.flatMap((value) => {
    const normalized = value?.trim();
    if (!normalized) return [];
    const chunks: string[] = [];
    for (let offset = 0; offset < normalized.length; offset += 4000) {
      chunks.push(normalized.slice(offset, offset + 4000));
    }
    return chunks;
  });
}

function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const valueKey = key(value);
    if (seen.has(valueKey)) return false;
    seen.add(valueKey);
    return true;
  });
}

function immutableClone<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}
