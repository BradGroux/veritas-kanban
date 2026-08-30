import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import {
  AgentReadinessError,
  clawdbotAgentService,
  type AgentStartOptions,
} from '../services/clawdbot-agent-service.js';
import { getTelemetryService } from '../services/telemetry-service.js';
import { getTaskService } from '../services/task-service.js';
import type {
  AgentType,
  PhaseName,
  ProviderRuntimeCapabilityId,
  TaskCommitPolicy,
  TokenTelemetryEvent,
} from '@veritas-kanban/shared';
import {
  TASK_ARTIFACT_KINDS,
  TASK_COMPLETION_STATUSES,
  TASK_CONTINUATION_KINDS,
  TASK_EVIDENCE_KINDS,
  TASK_VERIFICATION_STATUSES,
} from '@veritas-kanban/shared';
import { asyncHandler } from '../middleware/async-handler.js';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/error-handler.js';
import { requireLocalAgentCapability } from '../middleware/local-agent-capability.js';
import { AgentBudgetPolicySchema } from '../schemas/agent-budget-schemas.js';
import {
  authorizePermission,
  hasPermission,
  type AuthenticatedRequest,
} from '../middleware/auth.js';
import { ProviderRuntimeCapabilityIdSchema } from '../schemas/provider-runtime-manifest-schemas.js';
import { TaskCommitPolicySchema } from '../schemas/task-envelope-schemas.js';
import { RunEventQuerySchema } from '../schemas/run-event-schemas.js';
import {
  RunOutputArtifactDownloadQuerySchema,
  RunOutputArtifactHttpQuerySchema,
} from '../schemas/run-output-artifact-schemas.js';
import {
  RunFileProvenanceListQuerySchema,
  RunFileProvenanceReadQuerySchema,
} from '../schemas/run-file-provenance-schemas.js';
import { RunOutputArtifactService } from '../services/run-output-artifact-service.js';
import { getRunFileProvenanceService } from '../services/run-file-provenance-service.js';
import {
  workspaceExecutionTrustDecisionInputSchema,
  workspaceExecutionTrustRevokeInputSchema,
} from '../schemas/workspace-execution-trust-schemas.js';
import { getWorkspaceExecutionTrustService } from '../services/workspace-execution-trust-service.js';
import {
  phaseNameSchema,
  phaseTransitionRequestInputSchema,
  runAccessChangeInputSchema,
} from '../schemas/phase-capability-schemas.js';
import {
  getPhaseTransitionService,
  type PhaseTransitionActorContext,
} from '../services/phase-transition-service.js';
import { getRunPhaseAuthorityService } from '../services/run-phase-authority-service.js';
import { getRunAccessSummaryService } from '../services/run-access-summary-service.js';
import { getRunAccessChangeService } from '../services/run-access-change-service.js';
import { ProgressWatchdogOverrideInputSchema } from '../schemas/progress-watchdog-schemas.js';
import { ProgressWatchdogControlService } from '../services/progress-watchdog-control-service.js';

const router: RouterType = Router();
const workspaceExecutionTrust = getWorkspaceExecutionTrustService();
let progressWatchdogControl: ProgressWatchdogControlService | undefined;
let runOutputArtifactService: RunOutputArtifactService | undefined;

function getRunOutputArtifactService(): RunOutputArtifactService {
  runOutputArtifactService ??= new RunOutputArtifactService();
  return runOutputArtifactService;
}

// Validation schemas
const AgentTypeSchema = z.string().min(1).max(50);
const runAccessReadQuerySchema = z
  .object({ attemptId: z.string().trim().min(1).max(160) })
  .strict();

const startAgentSchema = z.object({
  agent: AgentTypeSchema.optional(),
  profileId: AgentTypeSchema.optional(),
  overrideReason: z.string().trim().min(8).max(1000).optional(),
  sandboxPresetId: z.string().trim().min(1).max(80).optional(),
  budget: AgentBudgetPolicySchema.optional(),
  requiredRuntimeCapabilities: z.array(ProviderRuntimeCapabilityIdSchema).max(64).optional(),
  commitPolicy: TaskCommitPolicySchema.optional(),
  phase: phaseNameSchema.optional(),
  parentAttemptId: z.string().trim().min(1).max(120).optional(),
  idempotencyKey: z.string().trim().min(8).max(240).optional(),
});

const completionProvenanceSchema = {
  attemptId: z.string().trim().min(1).max(120),
  providerRuntimeManifestDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
};

const completeAgentSchema = z.union([
  z
    .object({
      ...completionProvenanceSchema,
      success: z.boolean(),
      summary: z.string().trim().min(1).max(20_000).optional(),
      error: z.string().trim().min(1).max(20_000).optional(),
    })
    .strict(),
  z
    .object({
      ...completionProvenanceSchema,
      status: z.enum(TASK_COMPLETION_STATUSES),
      summary: z.string().trim().min(1).max(20_000).optional(),
      error: z.string().trim().min(1).max(20_000).optional(),
      blockers: z
        .array(
          z
            .object({
              code: z.string().trim().min(1).max(160),
              summary: z.string().trim().min(1).max(500),
              detail: z.string().trim().min(1).max(20_000),
              retryable: z.boolean(),
            })
            .strict()
        )
        .max(64)
        .optional(),
      evidence: z
        .array(
          z
            .object({
              id: z.string().trim().min(1).max(160),
              kind: z.enum(TASK_EVIDENCE_KINDS),
              summary: z.string().trim().min(1).max(20_000),
              reference: z.string().trim().min(1).max(4096).nullable().optional(),
              requirementIds: z.array(z.string().trim().min(1).max(160)).max(64).optional(),
            })
            .strict()
        )
        .max(128)
        .optional(),
      artifacts: z
        .array(
          z
            .object({
              id: z.string().trim().min(1).max(160),
              kind: z.enum(TASK_ARTIFACT_KINDS),
              name: z.string().trim().min(1).max(500),
              reference: z.string().trim().min(1).max(4096),
              mediaType: z.string().trim().min(1).max(200).nullable().optional(),
              sha256: z
                .string()
                .regex(/^[a-f0-9]{64}$/)
                .nullable()
                .optional(),
            })
            .strict()
        )
        .max(64)
        .optional(),
      verification: z
        .array(
          z
            .object({
              gateId: z.string().trim().min(1).max(160),
              status: z.enum(TASK_VERIFICATION_STATUSES),
              summary: z.string().trim().min(1).max(20_000),
              evidenceIds: z.array(z.string().trim().min(1).max(160)).max(128),
            })
            .strict()
        )
        .max(256)
        .optional(),
      continuation: z
        .object({
          provider: z.string().trim().min(1).max(160),
          kind: z.enum(TASK_CONTINUATION_KINDS),
          reference: z.string().trim().min(1).max(4096),
        })
        .strict()
        .nullable()
        .optional(),
    })
    .strict(),
]);

const sendAgentMessageSchema = z.object({
  attemptId: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(4000),
  actor: z.string().trim().min(1).max(120).optional(),
});

const conversationSteerSchema = sendAgentMessageSchema.omit({ actor: true }).strict();

const runControlSchema = z.object({
  attemptId: z.string().trim().min(1).max(120),
});

const phaseReadQuerySchema = z
  .object({
    attemptId: z.string().trim().min(1).max(240),
    limit: z.coerce.number().int().min(1).max(1_000).default(100),
  })
  .strict();

const conversationTurnSchema = z
  .object({
    sourceAttemptId: z.string().trim().min(1).max(120),
    message: z.string().trim().min(1).max(20_000),
    forkTurnId: z.string().trim().min(1).max(240).optional(),
    idempotencyKey: z.string().trim().min(8).max(240).optional(),
    profileId: AgentTypeSchema.optional(),
    overrideReason: z.string().trim().min(8).max(1000).optional(),
    sandboxPresetId: z.string().trim().min(1).max(80).optional(),
    budget: AgentBudgetPolicySchema.optional(),
    requiredRuntimeCapabilities: z.array(ProviderRuntimeCapabilityIdSchema).max(64).optional(),
    commitPolicy: TaskCommitPolicySchema.optional(),
    phase: phaseNameSchema.optional(),
  })
  .strict();

const conversationFreshSchema = conversationTurnSchema
  .omit({ sourceAttemptId: true, forkTurnId: true })
  .extend({ agent: AgentTypeSchema.optional() })
  .strict();

const conversationControlSchema = runControlSchema.strict();

const workspaceCheckpointRewindSchema = z
  .object({
    attemptId: z.string().trim().min(1).max(120),
    targetCheckpointId: z.string().trim().min(1).max(240),
    descendantCheckpointId: z.string().trim().min(1).max(240),
    requestId: z.string().trim().min(8).max(240),
    resolutions: z
      .array(
        z
          .object({
            path: z
              .string()
              .min(1)
              .max(4_096)
              .refine(
                (value) =>
                  !value.includes('\0') &&
                  !value.includes('\\') &&
                  !value.startsWith('/') &&
                  !/^[A-Za-z]:/.test(value) &&
                  !value.split('/').includes('..'),
                { message: 'Resolution paths must be safe relative paths.' }
              ),
            decision: z.enum(['accept', 'reject', 'leave-untouched']),
          })
          .strict()
      )
      .max(10_000)
      .optional(),
  })
  .strict();

const reportTokensSchema = z.object({
  attemptId: z.string().trim().min(1).max(120),
  inputTokens: z.number({ message: 'inputTokens is required' }).int().nonnegative(),
  outputTokens: z.number({ message: 'outputTokens is required' }).int().nonnegative(),
  totalTokens: z.number().int().nonnegative().optional(),
  cost: z.number().nonnegative().optional(),
  model: z.string().optional(),
  agent: AgentTypeSchema.optional(),
});

async function taskWorkspacePath(taskId: string): Promise<string> {
  const task = await getTaskService().getTask(taskId);
  if (!task) throw new NotFoundError(`Task ${taskId} not found`);
  if (!task.git?.worktreePath) {
    throw new ValidationError('Task must have an active worktree for workspace trust.');
  }
  return task.git.worktreePath;
}

// GET /api/agents/:taskId/workspace-trust - Scan the exact task worktree and show its decision.
router.get(
  '/:taskId/workspace-trust',
  requireLocalAgentCapability,
  asyncHandler(async (req, res) => {
    res.json(
      await workspaceExecutionTrust.scan(await taskWorkspacePath(req.params.taskId as string))
    );
  })
);

// POST /api/agents/:taskId/access/changes/preview - Compile a server-owned access diff.
router.post(
  '/:taskId/access/changes/preview',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const input = runAccessChangeInputSchema.parse(req.body);
    res.json(
      await getRunAccessChangeService().preview(
        req.auth?.workspaceId || 'local',
        req.params.taskId as string,
        input
      )
    );
  })
);

// POST /api/agents/:taskId/access/changes - Apply the exact reviewed access diff.
router.post(
  '/:taskId/access/changes',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const input = runAccessChangeInputSchema.parse(req.body);
    const result = await getRunAccessChangeService().apply(
      req.auth?.workspaceId || 'local',
      req.params.taskId as string,
      input,
      phaseActorContext(req)
    );
    res.status(result.transition.status === 'approval-required' ? 202 : 201).json(result);
  })
);

// POST /api/agents/:taskId/workspace-trust/decisions - Record an exact-inventory decision.
router.post(
  '/:taskId/workspace-trust/decisions',
  requireLocalAgentCapability,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const input = workspaceExecutionTrustDecisionInputSchema.parse(req.body);
    const decision = await workspaceExecutionTrust.recordDecision(
      await taskWorkspacePath(req.params.taskId as string),
      input,
      requestActor(req)
    );
    res.status(201).json(decision);
  })
);

// POST /api/agents/:taskId/workspace-trust/revoke - Revoke the current decision.
router.post(
  '/:taskId/workspace-trust/revoke',
  requireLocalAgentCapability,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const input = workspaceExecutionTrustRevokeInputSchema.parse(req.body);
    res.json(
      await workspaceExecutionTrust.revoke(
        await taskWorkspacePath(req.params.taskId as string),
        input,
        requestActor(req)
      )
    );
  })
);

// POST /api/agents/:taskId/launch-preview - Compile effective launch evidence without dispatch.
router.post(
  '/:taskId/launch-preview',
  requireLocalAgentCapability,
  asyncHandler(async (req, res) => {
    let parsed: z.infer<typeof startAgentSchema>;
    try {
      parsed = startAgentSchema.parse(req.body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.issues);
      }
      throw error;
    }
    let preview;
    try {
      preview = await clawdbotAgentService.previewAgentLaunch(
        req.params.taskId as string,
        parsed.agent as AgentType | undefined,
        {
          profileId: parsed.profileId,
          overrideReason: parsed.overrideReason,
          sandboxPresetId: parsed.sandboxPresetId,
          budget: parsed.budget,
          requiredRuntimeCapabilities: parsed.requiredRuntimeCapabilities as
            ProviderRuntimeCapabilityId[] | undefined,
          commitPolicy: parsed.commitPolicy as TaskCommitPolicy | undefined,
          phase: parsed.phase,
          parentAttemptId: parsed.parentAttemptId,
        }
      );
    } catch (error) {
      if (error instanceof AgentReadinessError) {
        throw new ValidationError(error.message, {
          readiness: error.readiness,
        });
      }
      throw error;
    }
    res.json(preview);
  })
);

// POST /api/agents/:taskId/start - Start agent on task (delegates to Clawdbot)
router.post(
  '/:taskId/start',
  requireLocalAgentCapability,
  asyncHandler(async (req, res) => {
    let agent: AgentType | undefined;
    let profileId: string | undefined;
    let overrideReason: string | undefined;
    let sandboxPresetId: string | undefined;
    let budget: z.infer<typeof AgentBudgetPolicySchema> | undefined;
    let requiredRuntimeCapabilities: ProviderRuntimeCapabilityId[] | undefined;
    let commitPolicy: TaskCommitPolicy | undefined;
    let phase: PhaseName | undefined;
    let parentAttemptId: string | undefined;
    let idempotencyKey: string | undefined;
    try {
      const headerIdempotencyKey = req.get('x-idempotency-key')?.trim();
      ({
        agent,
        profileId,
        overrideReason,
        sandboxPresetId,
        budget,
        requiredRuntimeCapabilities,
        commitPolicy,
        phase,
        parentAttemptId,
        idempotencyKey,
      } = startAgentSchema.parse({
        ...req.body,
        ...(headerIdempotencyKey ? { idempotencyKey: headerIdempotencyKey } : {}),
      }) as {
        agent?: AgentType;
        profileId?: string;
        overrideReason?: string;
        sandboxPresetId?: string;
        budget?: z.infer<typeof AgentBudgetPolicySchema>;
        requiredRuntimeCapabilities?: ProviderRuntimeCapabilityId[];
        commitPolicy?: TaskCommitPolicy;
        phase?: PhaseName;
        parentAttemptId?: string;
        idempotencyKey?: string;
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.issues);
      }
      throw error;
    }
    let status;
    try {
      status = await clawdbotAgentService.startAgent(req.params.taskId as string, agent, {
        profileId,
        overrideReason,
        sandboxPresetId,
        budget,
        requiredRuntimeCapabilities,
        commitPolicy,
        phase,
        parentAttemptId,
        admissionIdempotencyKey: idempotencyKey,
      });
    } catch (error) {
      if (error instanceof AgentReadinessError) {
        throw new ValidationError(error.message, {
          readiness: error.readiness,
        });
      }
      throw error;
    }
    res.status(201).json(status);
  })
);

// POST /api/agents/:taskId/complete - Callback from Clawdbot when agent finishes
router.post(
  '/:taskId/complete',
  asyncHandler(async (req, res) => {
    let parsed: z.infer<typeof completeAgentSchema>;
    try {
      parsed = completeAgentSchema.parse(req.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new ValidationError('Validation failed', err.issues);
      }
      throw err;
    }

    await clawdbotAgentService.completeAgent(
      req.params.taskId as string,
      'success' in parsed
        ? {
            success: parsed.success,
            summary: parsed.summary,
            error: parsed.error,
          }
        : {
            status: parsed.status,
            summary: parsed.summary,
            error: parsed.error,
            blockers: parsed.blockers,
            evidence: parsed.evidence,
            artifacts: parsed.artifacts,
            verification: parsed.verification,
            continuation: parsed.continuation,
          },
      {
        attemptId: parsed.attemptId,
        providerRuntimeManifestDigest: parsed.providerRuntimeManifestDigest,
        terminalSource: 'callback',
      }
    );
    res.json({ received: true });
  })
);

// POST /api/agents/:taskId/stop - Stop running agent
router.post(
  '/:taskId/stop',
  requireLocalAgentCapability,
  asyncHandler(async (req, res) => {
    let attemptId: string;
    try {
      ({ attemptId } = runControlSchema.parse(req.body));
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.issues);
      }
      throw error;
    }
    await clawdbotAgentService.stopAgent(req.params.taskId as string, attemptId);
    res.json({ stopped: true });
  })
);

// GET /api/agents/:taskId/phase - Read durable phase authority and transition history.
router.get(
  '/:taskId/phase',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const query = phaseReadQuerySchema.parse(req.query);
    const workspaceId = req.auth?.workspaceId || 'local';
    const phase = await getRunPhaseAuthorityService().get(
      workspaceId,
      req.params.taskId as string,
      query.attemptId,
      query.limit
    );
    res.json({
      phase,
      current: phase?.current ?? null,
      history: phase?.history ?? [],
    });
  })
);

// GET /api/agents/:taskId/file-provenance/resolve - Resolve provenance for exact bytes.
router.get(
  '/:taskId/file-provenance/resolve',
  authorizePermission('agent:read'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const query = RunFileProvenanceReadQuerySchema.parse(req.query);
    const taskId = req.params.taskId as string;
    const workspaceId = await authorizedTaskWorkspace(req, taskId, query.attemptId);
    res.json(
      await getRunFileProvenanceService().resolve({
        workspaceId,
        taskId,
        attemptId: query.attemptId,
        root: query.root,
        relativePath: query.path,
        sha256: query.sha256,
        limit: query.limit,
      })
    );
  })
);

// GET /api/agents/:taskId/file-provenance - List bounded redacted run evidence.
router.get(
  '/:taskId/file-provenance',
  authorizePermission('agent:read'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const query = RunFileProvenanceListQuerySchema.parse(req.query);
    const taskId = req.params.taskId as string;
    const workspaceId = await authorizedTaskWorkspace(req, taskId, query.attemptId);
    res.json(
      await getRunFileProvenanceService().list(workspaceId, taskId, query.attemptId, query.limit)
    );
  })
);

// GET /api/agents/:taskId/access - Project exact redacted run authority and prior versions.
router.get(
  '/:taskId/access',
  authorizePermission('agent:read'),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const query = runAccessReadQuerySchema.parse(req.query);
    res.json(
      await getRunAccessSummaryService().get(
        req.auth?.workspaceId || 'local',
        req.params.taskId as string,
        query.attemptId
      )
    );
  })
);

// GET /api/agents/:taskId/output-artifacts/:artifactId - Query governed run output.
router.get(
  '/:taskId/output-artifacts/:artifactId',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const input = RunOutputArtifactHttpQuerySchema.parse({
      ...req.query,
      operation: req.query.operation ?? 'metadata',
    });
    const lookup = {
      workspaceId: req.auth?.workspaceId || 'local',
      taskId: req.params.taskId as string,
      runId: input.runId,
      attemptId: input.attemptId,
      turnId: input.turnId,
      artifactId: req.params.artifactId as string,
    };
    const query =
      input.operation === 'json-path'
        ? { operation: input.operation, path: input.jsonPath }
        : input.operation === 'metadata'
          ? { operation: input.operation }
          : input.operation === 'byte-range'
            ? { operation: input.operation, offset: input.offset, length: input.length }
            : {
                operation: input.operation,
                startLine: input.startLine,
                lineCount: input.lineCount,
              };
    const result = await getRunOutputArtifactService().query({
      lookup,
      query,
      requesterId: requestActor(req),
    });
    if (!result) throw new NotFoundError('Run output artifact not found.');
    res.json(result);
  })
);

// GET /api/agents/:taskId/output-artifacts/:artifactId/download - Stream one bounded range.
router.get(
  '/:taskId/output-artifacts/:artifactId/download',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const input = RunOutputArtifactDownloadQuerySchema.parse(req.query);
    const lookup = {
      workspaceId: req.auth?.workspaceId || 'local',
      taskId: req.params.taskId as string,
      runId: input.runId,
      attemptId: input.attemptId,
      turnId: input.turnId,
      artifactId: req.params.artifactId as string,
    };
    const metadata = await getRunOutputArtifactService().query({
      lookup,
      query: { operation: 'metadata' },
      requesterId: requestActor(req),
    });
    if (!metadata) throw new NotFoundError('Run output artifact not found.');
    if (metadata.metadata.state !== 'available') {
      throw new ConflictError(`Run output artifact is ${metadata.metadata.state}.`);
    }
    const range = await getRunOutputArtifactService().readDownloadRange(
      lookup,
      requestActor(req),
      input.offset,
      input.length
    );
    if (!range) throw new ConflictError('Run output artifact body is unavailable.');
    res.status(206);
    res.setHeader('Content-Type', range.metadata.mediaType);
    res.setHeader('Content-Disposition', `attachment; filename="${range.metadata.id}.bin"`);
    res.setHeader(
      'Content-Range',
      `bytes ${range.offset}-${Math.max(range.offset, range.offset + range.length - 1)}/${range.metadata.storedBytes}`
    );
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', String(range.length));
    res.end(Buffer.from(range.content));
  })
);

router.post(
  '/:taskId/phase/transitions',
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const input = phaseTransitionRequestInputSchema.parse(req.body);
    const result = await getPhaseTransitionService().transition(
      req.auth?.workspaceId || 'local',
      req.params.taskId as string,
      input,
      phaseActorContext(req)
    );
    res.status(result.status === 'approval-required' ? 202 : 201).json(result);
  })
);

// GET /api/agents/:taskId/watchdog - Inspect durable watchdog decisions for one attempt.
router.get(
  '/:taskId/watchdog',
  authorizePermission('agent:read'),
  asyncHandler(async (req, res) => {
    const query = z
      .object({ attemptId: z.string().trim().min(1).max(160) })
      .strict()
      .parse(req.query);
    res.json(
      await getProgressWatchdogControl().inspect(req.params.taskId as string, query.attemptId)
    );
  })
);

// POST /api/agents/:taskId/watchdog/:findingId/override - Resolve a paused decision.
router.post(
  '/:taskId/watchdog/:findingId/override',
  authorizePermission('agent:write'),
  requireLocalAgentCapability,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const input = ProgressWatchdogOverrideInputSchema.parse(req.body);
    const findingId = z
      .string()
      .regex(/^watchdog_[a-f0-9]{8}(?:-[a-f0-9]{8}){3}$/)
      .parse(req.params.findingId);
    const result = await getProgressWatchdogControl().override({
      taskId: req.params.taskId as string,
      attemptId: input.attemptId,
      findingId,
      resolution: input.resolution,
      reason: input.reason,
      actor: requestActor(req),
    });
    res.status(result.status === 'completed' ? 200 : 202).json(result);
  })
);

// GET /api/agents/:taskId/recovery - Read the latest durable recovery decision.
router.get(
  '/:taskId/recovery',
  asyncHandler(async (req, res) => {
    const recovery = await clawdbotAgentService.getTaskRecovery(req.params.taskId as string);
    res.json({ recovery });
  })
);

// POST /api/agents/:taskId/recovery/cancel - Cancel the exact pending retry/fallback.
router.post(
  '/:taskId/recovery/cancel',
  requireLocalAgentCapability,
  asyncHandler(async (req, res) => {
    let attemptId: string;
    try {
      ({ attemptId } = runControlSchema.parse(req.body));
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.issues);
      }
      throw error;
    }
    const recovery = await clawdbotAgentService.cancelTaskRecovery(
      req.params.taskId as string,
      attemptId,
      requestActor(req)
    );
    res.json({ cancelled: true, recovery });
  })
);

// POST /api/agents/:taskId/message - Send an attributed operator message to a running agent
router.post(
  '/:taskId/message',
  asyncHandler(async (req, res) => {
    let message: string;
    let attemptId: string;
    try {
      const parsed = sendAgentMessageSchema.parse(req.body);
      message = parsed.message;
      attemptId = parsed.attemptId;
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new ValidationError('Validation failed', err.issues);
      }
      throw err;
    }

    const delivery = await clawdbotAgentService.sendMessage(req.params.taskId as string, message, {
      actor: requestActor(req),
      source: 'agent-route',
      expectedAttemptId: attemptId,
    });
    res.json(delivery);
  })
);

// POST /api/agents/:taskId/workspace/checkpoints/rewind - Preview or execute an approved rewind.
router.post(
  '/:taskId/workspace/checkpoints/rewind',
  requireLocalAgentCapability,
  asyncHandler(async (req, res) => {
    let body: z.infer<typeof workspaceCheckpointRewindSchema>;
    try {
      const headerRequestId = req.get('x-idempotency-key')?.trim();
      body = workspaceCheckpointRewindSchema.parse({
        ...(typeof req.body === 'object' && req.body !== null ? req.body : {}),
        ...(headerRequestId ? { requestId: headerRequestId } : {}),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.issues);
      }
      throw error;
    }
    const result = await clawdbotAgentService.rewindWorkspaceCheckpoint(
      req.params.taskId as string,
      body
    );
    res.status(result.status === 'approval-required' ? 202 : 200).json(result);
  })
);

// POST /api/agents/:taskId/conversation/fresh - Start a provider-neutral first turn.
router.post(
  '/:taskId/conversation/fresh',
  requireLocalAgentCapability,
  asyncHandler(async (req, res) => {
    let body: z.infer<typeof conversationFreshSchema>;
    try {
      body = conversationFreshSchema.parse(withRequestIdempotencyKey(req, req.body));
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.issues);
      }
      throw error;
    }
    const status = await clawdbotAgentService.startAgent(
      req.params.taskId as string,
      body.agent as AgentType | undefined,
      {
        ...conversationStartOptions(body),
        conversation: { mode: 'fresh', intent: 'fresh', message: body.message },
      }
    );
    res.status(201).json(status);
  })
);

// POST /api/agents/:taskId/conversation/resume - Continue a terminal provider conversation.
router.post(
  '/:taskId/conversation/resume',
  requireLocalAgentCapability,
  asyncHandler(async (req, res) => {
    const body = parseConversationTurn(withRequestIdempotencyKey(req, req.body));
    if (body.forkTurnId) {
      throw new ValidationError('Resume cannot specify forkTurnId');
    }
    const status = await clawdbotAgentService.resumeConversation(
      req.params.taskId as string,
      body.sourceAttemptId,
      body.message,
      conversationStartOptions(body)
    );
    res.status(201).json(status);
  })
);

// POST /api/agents/:taskId/conversation/follow-up - Start a native follow-up turn.
router.post(
  '/:taskId/conversation/follow-up',
  requireLocalAgentCapability,
  asyncHandler(async (req, res) => {
    const body = parseConversationTurn(withRequestIdempotencyKey(req, req.body));
    if (body.forkTurnId) {
      throw new ValidationError('Follow-up cannot specify forkTurnId');
    }
    const status = await clawdbotAgentService.followUpConversation(
      req.params.taskId as string,
      body.sourceAttemptId,
      body.message,
      conversationStartOptions(body)
    );
    res.status(201).json(status);
  })
);

// POST /api/agents/:taskId/conversation/fork - Fork native history into this task run.
router.post(
  '/:taskId/conversation/fork',
  requireLocalAgentCapability,
  asyncHandler(async (req, res) => {
    const body = parseConversationTurn(withRequestIdempotencyKey(req, req.body));
    const status = await clawdbotAgentService.forkConversation(
      req.params.taskId as string,
      body.sourceAttemptId,
      body.message,
      body.forkTurnId,
      conversationStartOptions(body)
    );
    res.status(201).json(status);
  })
);

// POST /api/agents/:taskId/conversation/steer - Steer the exact active provider turn.
router.post(
  '/:taskId/conversation/steer',
  requireLocalAgentCapability,
  asyncHandler(async (req, res) => {
    const parsed = parseConversationSteer(req.body);
    res.json(
      await clawdbotAgentService.sendMessage(req.params.taskId as string, parsed.message, {
        actor: requestActor(req),
        source: 'conversation-route',
        expectedAttemptId: parsed.attemptId,
      })
    );
  })
);

// POST /api/agents/:taskId/conversation/interrupt - Interrupt the exact active attempt.
router.post(
  '/:taskId/conversation/interrupt',
  requireLocalAgentCapability,
  asyncHandler(async (req, res) => {
    const body = parseConversationControl(req.body);
    res.json(
      await clawdbotAgentService.interruptConversation(
        req.params.taskId as string,
        body.attemptId,
        requestActor(req)
      )
    );
  })
);

for (const action of ['compact', 'archive', 'close'] as const) {
  router.post(
    `/:taskId/conversation/${action}`,
    requireLocalAgentCapability,
    asyncHandler(async (req, res) => {
      const body = parseConversationControl(req.body);
      const actor = requestActor(req);
      const result =
        action === 'compact'
          ? await clawdbotAgentService.compactConversation(
              req.params.taskId as string,
              body.attemptId,
              actor
            )
          : action === 'archive'
            ? await clawdbotAgentService.archiveConversation(
                req.params.taskId as string,
                body.attemptId,
                actor
              )
            : await clawdbotAgentService.closeConversation(
                req.params.taskId as string,
                body.attemptId,
                actor
              );
      res.json(result);
    })
  );
}

// GET /api/agents/:taskId/status - Get agent status
router.get(
  '/:taskId/status',
  asyncHandler(async (req, res) => {
    const status = await clawdbotAgentService.getAgentStatus(req.params.taskId as string);
    if (!status) {
      return res.json({ running: false });
    }
    res.json({ running: true, ...status });
  })
);

// GET /api/agents/pending - List pending agent requests (for Veritas to poll)
router.get(
  '/pending',
  asyncHandler(async (_req, res) => {
    const requests = await clawdbotAgentService.listPendingRequests();
    res.json(requests);
  })
);

// GET /api/agents/:taskId/attempts - List attempts for task
router.get(
  '/:taskId/attempts',
  asyncHandler(async (req, res) => {
    const attempts = await clawdbotAgentService.listAttempts(req.params.taskId as string);
    res.json(attempts);
  })
);

// GET /api/agents/:taskId/attempts/:attemptId/log - Get attempt log
router.get(
  '/:taskId/attempts/:attemptId/log',
  asyncHandler(async (req, res) => {
    const log = await clawdbotAgentService.getAttemptLog(
      req.params.taskId as string,
      req.params.attemptId as string
    );
    res.type('text/markdown').send(log);
  })
);

// GET /api/agents/:taskId/attempts/:attemptId/events - Replay durable run events
router.get(
  '/:taskId/attempts/:attemptId/events',
  asyncHandler(async (req, res) => {
    let query: z.infer<typeof RunEventQuerySchema>;
    try {
      query = RunEventQuerySchema.parse({
        ...req.query,
        attemptId: req.params.attemptId,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.issues);
      }
      throw error;
    }
    res.json(
      await clawdbotAgentService.getRunEvents(
        req.params.taskId as string,
        query.attemptId,
        query.afterSequence,
        query.limit
      )
    );
  })
);

// POST /api/agents/:taskId/tokens - Report token usage for a run
router.post(
  '/:taskId/tokens',
  asyncHandler(async (req, res) => {
    let attemptId: string;
    let inputTokens: number;
    let outputTokens: number;
    let totalTokens: number | undefined;
    let cost: number | undefined;
    let model: string | undefined;
    let agent: AgentType | undefined;
    try {
      const parsed = reportTokensSchema.parse(req.body);
      attemptId = parsed.attemptId;
      inputTokens = parsed.inputTokens;
      outputTokens = parsed.outputTokens;
      totalTokens = parsed.totalTokens;
      cost = parsed.cost;
      model = parsed.model;
      agent = parsed.agent as AgentType | undefined;
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError('Validation failed', error.issues);
      }
      throw error;
    }

    const taskId = req.params.taskId as string;

    // Get task to find project and current attempt
    const taskService = getTaskService();
    const task = await taskService.getTask(taskId);

    if (!task) {
      throw new NotFoundError('Task not found');
    }

    await clawdbotAgentService.assertActiveRunControl(taskId, 'token-usage', attemptId);
    const resolvedAgent = agent || task.attempt?.agent || 'codex';

    await clawdbotAgentService.recordBudgetUsage(taskId, attemptId, {
      inputTokens,
      outputTokens,
      totalTokens: totalTokens ?? inputTokens + outputTokens,
      costUsd: cost,
    });

    // Emit telemetry event
    const telemetry = getTelemetryService();
    const event = await telemetry.emit<TokenTelemetryEvent>({
      type: 'run.tokens',
      taskId,
      attemptId,
      agent: resolvedAgent,
      project: task.project,
      inputTokens,
      outputTokens,
      totalTokens: totalTokens ?? inputTokens + outputTokens,
      cost,
      model,
    });

    res.status(201).json({
      recorded: true,
      eventId: event.id,
      totalTokens: event.totalTokens,
    });
  })
);

// Export service for WebSocket use
export { router as agentRoutes, clawdbotAgentService as agentService };

async function authorizedTaskWorkspace(
  req: AuthenticatedRequest,
  taskId: string,
  attemptId: string
): Promise<string> {
  const workspaceId = req.auth?.workspaceId || 'local';
  const task = await getTaskService().getTask(taskId);
  const attempt = task
    ? [task.attempt, ...(task.attempts ?? [])].find((candidate) => candidate?.id === attemptId)
    : undefined;
  if (!task || !attempt || attempt.taskEnvelope?.workspace.workspaceId !== workspaceId) {
    throw new NotFoundError('Task not found');
  }
  return workspaceId;
}

function getProgressWatchdogControl(): ProgressWatchdogControlService {
  progressWatchdogControl ??= new ProgressWatchdogControlService(undefined, clawdbotAgentService);
  return progressWatchdogControl;
}

function parseConversationTurn(input: unknown): z.infer<typeof conversationTurnSchema> {
  try {
    return conversationTurnSchema.parse(input);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ValidationError('Validation failed', error.issues);
    }
    throw error;
  }
}

function parseConversationControl(input: unknown): z.infer<typeof conversationControlSchema> {
  try {
    return conversationControlSchema.parse(input);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ValidationError('Validation failed', error.issues);
    }
    throw error;
  }
}

function parseConversationSteer(input: unknown): z.infer<typeof conversationSteerSchema> {
  try {
    return conversationSteerSchema.parse(input);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ValidationError('Validation failed', error.issues);
    }
    throw error;
  }
}

function conversationStartOptions(
  body: z.infer<typeof conversationTurnSchema> | z.infer<typeof conversationFreshSchema>
): Omit<AgentStartOptions, 'conversation' | 'parentAttemptId'> {
  return {
    profileId: body.profileId,
    overrideReason: body.overrideReason,
    sandboxPresetId: body.sandboxPresetId,
    budget: body.budget,
    requiredRuntimeCapabilities: body.requiredRuntimeCapabilities as
      ProviderRuntimeCapabilityId[] | undefined,
    commitPolicy: body.commitPolicy as TaskCommitPolicy | undefined,
    phase: body.phase,
    admissionIdempotencyKey: body.idempotencyKey,
  };
}

function withRequestIdempotencyKey(req: AuthenticatedRequest, input: unknown): unknown {
  const headerIdempotencyKey = req.get('x-idempotency-key')?.trim();
  if (!headerIdempotencyKey) return input;
  return {
    ...(typeof input === 'object' && input !== null ? input : {}),
    idempotencyKey: headerIdempotencyKey,
  };
}

function requestActor(req: AuthenticatedRequest): string {
  const auth = req.auth;
  return (
    auth?.userId || auth?.tokenName || auth?.keyName || auth?.clientId || auth?.role || 'operator'
  );
}

function phaseActorContext(req: AuthenticatedRequest): PhaseTransitionActorContext {
  const auth = req.auth;
  const id = requestActor(req);
  return {
    actor: {
      id,
      label: auth?.tokenName || auth?.keyName || auth?.clientId || auth?.userId || id,
      type: auth?.actorType,
      authMethod: auth?.authMethod,
      authenticatedAt: auth?.authenticatedAt,
      clientMode: auth?.clientMode,
      workspaceId: auth?.workspaceId || 'local',
    },
    administrator: hasPermission(auth, 'admin:manage'),
  };
}
