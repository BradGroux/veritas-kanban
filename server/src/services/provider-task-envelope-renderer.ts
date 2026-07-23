import type { ExecutableAgentProvider, Task, TaskEnvelope } from '@veritas-kanban/shared';
import { compactTaskEnvelopeStrings } from './task-envelope-service.js';

export type ProviderTaskEnvelopeCallbackPosture = 'veritas-http' | 'harness-owned';

export const PROVIDER_TASK_ENVELOPE_TRANSPORT_SCHEMA_VERSION =
  'provider-task-envelope-transport/v1' as const;

export interface ProviderTaskEnvelopeTransport {
  schemaVersion: typeof PROVIDER_TASK_ENVELOPE_TRANSPORT_SCHEMA_VERSION;
  provider: ExecutableAgentProvider;
  taskEnvelopeDigest: string;
  callbackPosture: ProviderTaskEnvelopeCallbackPosture;
  completionNormalization: 'harness';
  content: string;
}

export interface ProviderTaskEnvelopeRenderInput {
  taskEnvelope: TaskEnvelope;
  profileInstructions?: string;
  checkpoint?: NonNullable<Task['checkpoint']>;
}

const MAX_PROFILE_INSTRUCTIONS = 20_000;
const MAX_CHECKPOINT_STATE = 20_000;
const MAX_BASELINE_FILES = 200;

export function renderOpenClawTaskEnvelope(
  input: ProviderTaskEnvelopeRenderInput
): ProviderTaskEnvelopeTransport {
  assertEnvelopeTransport(input.taskEnvelope, 'openclaw');
  return immutableTransport({
    schemaVersion: PROVIDER_TASK_ENVELOPE_TRANSPORT_SCHEMA_VERSION,
    provider: 'openclaw',
    taskEnvelopeDigest: input.taskEnvelope.digest,
    callbackPosture: 'veritas-http',
    completionNormalization: 'harness',
    content: renderEnvelopeContent('OpenClaw', input, renderOpenClawCompletion(input.taskEnvelope)),
  });
}

export function renderCodexCliTaskEnvelope(
  input: ProviderTaskEnvelopeRenderInput
): ProviderTaskEnvelopeTransport {
  assertEnvelopeTransport(input.taskEnvelope, 'codex-cli');
  return immutableTransport({
    schemaVersion: PROVIDER_TASK_ENVELOPE_TRANSPORT_SCHEMA_VERSION,
    provider: 'codex-cli',
    taskEnvelopeDigest: input.taskEnvelope.digest,
    callbackPosture: 'harness-owned',
    completionNormalization: 'harness',
    content: renderEnvelopeContent(
      'Codex CLI',
      input,
      renderHarnessOwnedCompletion(
        'Codex CLI process',
        'Return the final response through the process output captured by Veritas.',
        'process output'
      )
    ),
  });
}

export function renderCodexSdkTaskEnvelope(
  input: ProviderTaskEnvelopeRenderInput
): ProviderTaskEnvelopeTransport {
  assertEnvelopeTransport(input.taskEnvelope, 'codex-sdk');
  return immutableTransport({
    schemaVersion: PROVIDER_TASK_ENVELOPE_TRANSPORT_SCHEMA_VERSION,
    provider: 'codex-sdk',
    taskEnvelopeDigest: input.taskEnvelope.digest,
    callbackPosture: 'harness-owned',
    completionNormalization: 'harness',
    content: renderEnvelopeContent(
      'Codex SDK',
      input,
      renderHarnessOwnedCompletion(
        'Codex SDK stream',
        'Return the final response through the SDK event stream captured by Veritas.',
        'SDK stream events'
      )
    ),
  });
}

export function renderHermesTaskEnvelope(
  input: ProviderTaskEnvelopeRenderInput
): ProviderTaskEnvelopeTransport {
  assertEnvelopeTransport(input.taskEnvelope, 'hermes-cli');
  return immutableTransport({
    schemaVersion: PROVIDER_TASK_ENVELOPE_TRANSPORT_SCHEMA_VERSION,
    provider: 'hermes-cli',
    taskEnvelopeDigest: input.taskEnvelope.digest,
    callbackPosture: 'harness-owned',
    completionNormalization: 'harness',
    content: renderEnvelopeContent(
      'Hermes',
      input,
      renderHarnessOwnedCompletion(
        'Hermes scripted process',
        'Return the final response through scripted stdout captured by Veritas.',
        'scripted process output'
      )
    ),
  });
}

function immutableTransport(
  transport: ProviderTaskEnvelopeTransport
): ProviderTaskEnvelopeTransport {
  return Object.freeze(transport);
}

function assertEnvelopeTransport(
  taskEnvelope: TaskEnvelope,
  provider: ExecutableAgentProvider
): void {
  if (
    taskEnvelope.launchManifest.provider !== provider ||
    taskEnvelope.launchManifest.adapter !== provider
  ) {
    throw new Error(
      `Task envelope transport mismatch: expected ${provider}, received provider ` +
        `${taskEnvelope.launchManifest.provider} with adapter ${taskEnvelope.launchManifest.adapter}`
    );
  }
}

function renderEnvelopeContent(
  transportName: string,
  input: ProviderTaskEnvelopeRenderInput,
  completionSection: string
): string {
  const { taskEnvelope } = input;
  const sourceProfileInstructions = input.profileInstructions?.trim();
  const profileInstructions = boundedText(sourceProfileInstructions, MAX_PROFILE_INSTRUCTIONS);
  const profileConstraintChunks = compactTaskEnvelopeStrings([sourceProfileInstructions]);
  const hasAttributedProfilePrefix = profileConstraintChunks.every(
    (chunk, index) => taskEnvelope.subject.constraints[index] === chunk
  );
  const constraints =
    profileConstraintChunks.length > 0 && hasAttributedProfilePrefix
      ? taskEnvelope.subject.constraints.slice(profileConstraintChunks.length)
      : taskEnvelope.subject.constraints;

  return `# ${transportName} Task Envelope

## Transport

- Envelope: \`${taskEnvelope.schemaVersion}\`
- Digest: \`${taskEnvelope.digest}\`
- Provider: \`${taskEnvelope.launchManifest.provider}\`
- Adapter: \`${taskEnvelope.launchManifest.adapter}\`
- Runtime manifest: \`${taskEnvelope.launchManifest.digest}\`
- Protocol: \`${taskEnvelope.launchManifest.protocolVersion}\`
- Task: \`${taskEnvelope.subject.id}\`
- Attempt: \`${taskEnvelope.attempt.id}\`

## Objective

${taskEnvelope.subject.objective}

${renderListSection('Background', taskEnvelope.subject.background)}
${renderListSection('Constraints', constraints)}
${renderWorkspace(taskEnvelope)}
## Commit Policy

${renderCommitPolicy(taskEnvelope)}

${renderListSection('Acceptance Criteria', taskEnvelope.subject.acceptanceCriteria)}
${renderSideEffects(taskEnvelope)}
${renderExpectedOutputs(taskEnvelope)}
${renderVerificationGates(taskEnvelope)}
${renderCompletionContract(taskEnvelope)}
${renderProfileInstructions(profileInstructions)}
${renderCheckpoint(input.checkpoint)}
${completionSection}`.trimEnd();
}

function renderWorkspace(taskEnvelope: TaskEnvelope): string {
  const { workspace } = taskEnvelope;
  const baselineFiles = workspace.baseline.files.slice(0, MAX_BASELINE_FILES);
  const fileLines =
    baselineFiles.length > 0
      ? baselineFiles.map((file) => `- \`${file.status}\` \`${file.path}\``).join('\n')
      : '- None.';
  const remainder = workspace.baseline.files.length - baselineFiles.length;
  return `## Workspace

- Repository: \`${workspace.repo}\`
- Branch: \`${workspace.branch}\`
- Base branch: \`${workspace.baseBranch}\`
- Worktree: \`${workspace.worktreePath}\`
- Launch HEAD: \`${workspace.baseline.headSha}\`
- Launch state: ${workspace.baseline.dirty ? 'dirty' : 'clean'}

### Launch Baseline Files

${fileLines}
${remainder > 0 ? `- ${remainder} additional baseline file(s) omitted by Veritas.` : ''}

`;
}

function renderCommitPolicy(taskEnvelope: TaskEnvelope): string {
  if (taskEnvelope.commitPolicy === 'forbidden') {
    return 'Forbidden: do not create a commit. Leave permitted worktree changes uncommitted.';
  }
  if (taskEnvelope.commitPolicy === 'required') {
    return 'Required: create at least one new commit attributable to this attempt.';
  }
  return 'Allowed: a commit is permitted, but successful completion does not require one.';
}

function renderListSection(title: string, values: string[]): string {
  return `## ${title}

${values.length > 0 ? values.map((value) => `- ${value}`).join('\n') : '- None.'}

`;
}

function renderSideEffects(taskEnvelope: TaskEnvelope): string {
  return `## Allowed Side Effects

${
  taskEnvelope.allowedSideEffects.length > 0
    ? taskEnvelope.allowedSideEffects
        .map((sideEffect) => `- \`${sideEffect.kind}\` within \`${sideEffect.scope}\``)
        .join('\n')
    : '- None.'
}

`;
}

function renderExpectedOutputs(taskEnvelope: TaskEnvelope): string {
  return `## Expected Outputs

${
  taskEnvelope.expectedOutputs.length > 0
    ? taskEnvelope.expectedOutputs
        .map(
          (output) =>
            `- ${output.required ? 'Required' : 'Optional'} \`${output.kind}\` ` +
            `\`${output.id}\`: ${output.description}`
        )
        .join('\n')
    : '- None.'
}

`;
}

function renderVerificationGates(taskEnvelope: TaskEnvelope): string {
  return `## Verification Gates

${
  taskEnvelope.verificationGates.length > 0
    ? taskEnvelope.verificationGates
        .map(
          (gate) =>
            `- ${gate.required ? 'Required' : 'Optional'} \`${gate.id}\`: ${gate.description}` +
            `${gate.evidenceRequired ? ' Evidence is required.' : ''}`
        )
        .join('\n')
    : '- None.'
}

`;
}

function renderCompletionContract(taskEnvelope: TaskEnvelope): string {
  return `## Completion Evidence Contract

- Schema: \`${taskEnvelope.completionContract.schemaVersion}\`
${
  taskEnvelope.completionContract.evidenceRequirements.length > 0
    ? taskEnvelope.completionContract.evidenceRequirements
        .map(
          (requirement) =>
            `- ${requirement.required ? 'Required' : 'Optional'} \`${requirement.kind}\` ` +
            `\`${requirement.id}\`: ${requirement.description}`
        )
        .join('\n')
    : '- None.'
}

`;
}

function renderProfileInstructions(profileInstructions: string | undefined): string {
  if (!profileInstructions) return '';
  return `## Profile Instructions (agent profile)

${profileInstructions}

`;
}

function renderCheckpoint(checkpoint: ProviderTaskEnvelopeRenderInput['checkpoint']): string {
  if (!checkpoint) return '';
  const checkpointState = boundedText(
    JSON.stringify(checkpoint.state, null, 2),
    MAX_CHECKPOINT_STATE
  );
  return `## Resume Context (task checkpoint)

- Resume count: ${checkpoint.resumeCount ?? 0}
- Captured at: ${checkpoint.timestamp}
- Last step: ${checkpoint.step}

\`\`\`json
${checkpointState}
\`\`\`

Continue from this checkpoint. Do not repeat work already represented in the saved state.

`;
}

function renderOpenClawCompletion(taskEnvelope: TaskEnvelope): string {
  const callbackUrl = `http://localhost:3001/api/agents/${taskEnvelope.subject.id}/complete`;
  const payload = JSON.stringify({
    attemptId: taskEnvelope.attempt.id,
    providerRuntimeManifestDigest: taskEnvelope.launchManifest.digest,
    success: true,
    summary: 'Brief description of what was done',
  });
  return `## Completion (OpenClaw callback)

When the work reaches a terminal state, report it to Veritas.

- Endpoint: \`POST ${callbackUrl}\`

\`\`\`bash
curl -X POST ${callbackUrl} \\
  -H "Content-Type: application/json" \\
  -d '${payload}'
\`\`\`

For failure, send \`success: false\` and include an \`error\` message.

No native structured-output support is assumed; Veritas validates and normalizes the callback.
`;
}

function renderHarnessOwnedCompletion(
  transportName: string,
  instruction: string,
  evidenceSource: string
): string {
  return `## Completion (${transportName})

${instruction}

Do not call the Veritas completion callback. The harness owns terminal-state capture.

No native structured-output support is assumed; Veritas validates and normalizes ${evidenceSource}.
`;
}

function boundedText(value: string | undefined, maxLength: number): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}\n[truncated by Veritas]`;
}
