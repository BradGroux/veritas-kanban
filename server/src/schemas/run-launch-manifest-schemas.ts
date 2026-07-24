import { z } from 'zod';
import {
  HARNESS_SUPPORT_TIERS,
  RUN_LAUNCH_MANIFEST_SCHEMA_VERSION,
  type RunLaunchManifest,
} from '@veritas-kanban/shared';
import { AgentBudgetPolicySchema } from './agent-budget-schemas.js';
import { calculateRunLaunchManifestDigest } from '../utils/run-launch-manifest-digest.js';
import { containsUnredactedProviderRuntimeSecret } from '../utils/provider-runtime-manifest-sanitize.js';

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const identifierSchema = z.string().trim().min(1).max(160);
const safeTextSchema = z.string().trim().min(1).max(1000);
const stringListSchema = z.array(identifierSchema).max(128);
const resourceReferenceListSchema = z.array(z.string().trim().min(1).max(600)).max(128);
const environmentKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const enforcementSchema = z.enum(['enforced', 'not-required', 'unavailable']);

const manifestReferenceSchema = z
  .object({
    schemaVersion: identifierSchema,
    digest: digestSchema,
  })
  .strict();

export const RunLaunchManifestSchema = z
  .object({
    schemaVersion: z.literal(RUN_LAUNCH_MANIFEST_SCHEMA_VERSION),
    digest: digestSchema,
    createdAt: z.iso.datetime(),
    taskId: identifierSchema,
    attemptId: identifierSchema,
    taskEnvelope: manifestReferenceSchema.extend({ materialDigest: digestSchema }).strict(),
    providerRuntime: manifestReferenceSchema
      .extend({
        materialDigest: digestSchema,
        probeRevision: z.number().int().positive(),
        provider: identifierSchema,
        adapter: identifierSchema,
        protocolVersion: identifierSchema,
        providerVersion: z.string().trim().min(1).max(200),
        providerBuild: z.string().trim().min(1).max(300).optional(),
      })
      .strict(),
    providerRequirements: z
      .object({
        required: stringListSchema,
        capabilities: z
          .array(
            z
              .object({
                id: identifierSchema,
                state: z.enum(['supported', 'advisory', 'unsupported', 'unknown']),
                satisfied: z.boolean(),
                advisory: z.boolean(),
                reason: safeTextSchema,
              })
              .strict()
          )
          .max(128),
      })
      .strict(),
    harnessSupport: z
      .object({
        profileId: identifierSchema,
        adapterId: identifierSchema.optional(),
        transport: z.enum([
          'process-jsonl',
          'process-text',
          'sdk',
          'http-tools',
          'acp',
          'app-server',
          'unsupported',
        ]),
        supportTier: z.enum(HARNESS_SUPPORT_TIERS),
      })
      .strict(),
    routing: z
      .object({
        requestedAgent: identifierSchema,
        selectedAgent: identifierSchema,
        selectedHost: identifierSchema,
        reason: safeTextSchema,
        fallbackAgent: identifierSchema.nullable(),
        fallbackAllowed: z.boolean(),
      })
      .strict(),
    profile: z
      .object({
        id: identifierSchema,
        version: identifierSchema,
        role: identifierSchema,
      })
      .strict()
      .optional(),
    readiness: z
      .object({
        ready: z.boolean(),
        overridden: z.boolean(),
        passed: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
        missingRequired: stringListSchema,
        warnings: stringListSchema,
        overrideReasonDigest: digestSchema.optional(),
      })
      .strict(),
    instructions: z
      .array(
        z
          .object({
            id: identifierSchema,
            kind: z.enum(['task', 'profile', 'template', 'repository', 'system', 'other']),
            digest: digestSchema,
            materialDigest: digestSchema,
            byteLength: z.number().int().min(0).max(5_000_000),
            origin: identifierSchema,
            precedence: z.number().int().min(0).max(10_000),
          })
          .strict()
      )
      .max(128),
    workspace: z
      .object({
        worktreeId: identifierSchema,
        worktreeManifestId: identifierSchema.optional(),
        ownershipLeaseId: identifierSchema.optional(),
        ownershipAttemptId: identifierSchema.optional(),
        repo: identifierSchema,
        branch: identifierSchema,
        baseBranch: identifierSchema,
        resolvedBaseCommit: z.string().regex(/^[a-f0-9]{40,64}$/),
        baseResolutionSource: z.enum([
          'remote',
          'local-stale',
          'legacy-adopted',
          'legacy-launch-head',
        ]),
      })
      .strict()
      .optional(),
    runtime: z
      .object({
        model: z.string().trim().min(1).max(200).optional(),
        command: z.string().trim().min(1).max(500),
        args: z.array(z.string().max(1000)).max(128),
        workingDirectory: z.enum(['task-worktree', 'workspace', 'provider-managed']),
        worktree: z.enum(['required', 'supported', 'provider-managed']),
        environmentKeys: z.array(environmentKeySchema).max(128),
        credentialReferences: z.array(z.string().trim().min(1).max(300)).max(128),
      })
      .strict(),
    tools: z
      .object({
        allowed: stringListSchema,
        denied: stringListSchema,
        policyIds: stringListSchema,
        mcpServers: stringListSchema,
        enforcement: enforcementSchema,
      })
      .strict(),
    permissions: z
      .object({
        level: z.enum(['intern', 'specialist', 'lead']),
        required: stringListSchema,
        enforcement: enforcementSchema,
      })
      .strict(),
    resources: z
      .object({
        skills: resourceReferenceListSchema,
        shared: resourceReferenceListSchema,
        enforcement: enforcementSchema,
      })
      .strict(),
    requiredHealthChecks: stringListSchema,
    sandbox: z
      .object({
        presetId: identifierSchema,
        enforcement: z.enum(['required', 'advisory']),
        decision: z.enum(['allow', 'warn', 'block']),
        effective: z
          .object({
            sandboxMode: z.enum(['read-only', 'workspace-write', 'danger-full-access']),
            networkAccessEnabled: z.boolean(),
            environmentKeys: z.array(environmentKeySchema).max(128),
            credentialReferences: z.array(z.string().trim().min(1).max(300)).max(128),
          })
          .strict(),
        unsupportedRules: z
          .array(
            z
              .object({
                id: identifierSchema,
                capability: identifierSchema,
                status: z.enum(['supported', 'unsupported', 'advisory']),
              })
              .strict()
          )
          .max(128),
        warnings: z.array(safeTextSchema).max(128),
      })
      .strict(),
    budget: AgentBudgetPolicySchema,
    workspaceTrust: z
      .object({
        status: z.enum(['trusted', 'untrusted', 'not-required']),
        source: safeTextSchema,
      })
      .strict(),
    origins: z
      .array(
        z
          .object({
            field: identifierSchema,
            scope: z.enum([
              'run',
              'task-envelope',
              'agent-profile',
              'workflow',
              'template',
              'provider',
              'workspace',
              'system-default',
            ]),
            source: identifierSchema,
            precedence: z.number().int().min(0).max(10_000),
          })
          .strict()
      )
      .max(256),
    enforcement: z
      .object({
        enforceable: z.boolean(),
        blockers: z
          .array(
            z
              .object({
                code: identifierSchema,
                field: identifierSchema,
                detail: safeTextSchema,
                remediation: safeTextSchema,
              })
              .strict()
          )
          .max(128),
        warnings: z.array(safeTextSchema).max(128),
      })
      .strict(),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (manifest.enforcement.enforceable !== (manifest.enforcement.blockers.length === 0)) {
      context.addIssue({
        code: 'custom',
        path: ['enforcement', 'enforceable'],
        message: 'Launch manifest enforceable state must match the blocker set',
      });
    }
    if (manifest.readiness.overridden !== Boolean(manifest.readiness.overrideReasonDigest)) {
      context.addIssue({
        code: 'custom',
        path: ['readiness', 'overridden'],
        message: 'Readiness override state must match the override reason fingerprint',
      });
    }
    if (manifest.digest !== calculateRunLaunchManifestDigest(manifest)) {
      context.addIssue({
        code: 'custom',
        path: ['digest'],
        message: 'Run launch manifest digest does not match its canonical payload',
      });
    }
    for (const [path, value] of collectStringLeaves(manifest)) {
      if (containsUnredactedProviderRuntimeSecret(value)) {
        context.addIssue({
          code: 'custom',
          path,
          message: 'Run launch manifest evidence must redact credentials and secrets',
        });
      }
    }
  });

export function parseRunLaunchManifest(input: unknown): RunLaunchManifest {
  return RunLaunchManifestSchema.parse(input) as RunLaunchManifest;
}

function collectStringLeaves(
  value: unknown,
  path: Array<string | number> = []
): Array<[Array<string | number>, string]> {
  if (typeof value === 'string') {
    return [[path, value]];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectStringLeaves(entry, [...path, index]));
  }
  if (!value || typeof value !== 'object') {
    return [];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) =>
    collectStringLeaves(entry, [...path, key])
  );
}
