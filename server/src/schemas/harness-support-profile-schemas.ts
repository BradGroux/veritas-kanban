import { z } from 'zod';
import {
  EXECUTABLE_AGENT_PROVIDERS,
  HARNESS_SUPPORT_PROFILE_SCHEMA_VERSION,
  HARNESS_SUPPORT_TIERS,
} from '@veritas-kanban/shared';
import { containsUnredactedProviderRuntimeSecret } from '../utils/provider-runtime-manifest-sanitize.js';

const identifier = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/);
const safeText = z.string().trim().min(1).max(1000);
const environmentKey = z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/);

export const HarnessSupportProfileSchema = z
  .object({
    schemaVersion: z.literal(HARNESS_SUPPORT_PROFILE_SCHEMA_VERSION),
    id: identifier,
    displayName: z.string().trim().min(1).max(120),
    adapterId: z.enum(EXECUTABLE_AGENT_PROVIDERS).optional(),
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
    supportReason: safeText,
    executable: z
      .object({
        command: z.string().trim().min(1).max(500),
        versionArgs: z.array(z.string().max(500)).max(16),
      })
      .strict(),
    authentication: z
      .object({
        kind: z.enum(['command', 'environment', 'provider-managed', 'none']),
        commandArgs: z.array(z.string().max(500)).max(16).optional(),
        environmentKeys: z.array(environmentKey).max(32).optional(),
        nonMutating: z.literal(true),
      })
      .strict(),
    compatibility: z
      .object({
        policy: safeText,
        testedVersions: z.array(z.string().trim().min(1).max(200)).max(100),
        invalidateOn: z
          .array(
            z.enum(['provider-version', 'provider-build', 'configuration-digest', 'probe-revision'])
          )
          .min(1)
          .max(4),
        configurationDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      })
      .strict(),
    platforms: z
      .array(z.enum(['darwin', 'linux', 'win32']))
      .min(1)
      .max(3),
    launch: z
      .object({
        args: z.array(z.string().max(500)).max(64),
        workingDirectory: z.enum(['task-worktree', 'workspace', 'provider-managed']),
        worktree: z.enum(['required', 'supported', 'provider-managed']),
        environmentAllowlist: z.array(environmentKey).max(64),
        credentialAllowlist: z.array(environmentKey).max(64),
      })
      .strict(),
    conformance: z
      .object({
        fixtureSet: identifier,
        status: z.enum(['not-run', 'passed', 'failed', 'stale']),
        certifiedAt: z.iso.datetime().optional(),
        providerVersion: z.string().trim().min(1).max(200).optional(),
        providerBuild: z.string().trim().min(1).max(300).optional(),
        manifestDigest: z
          .string()
          .regex(/^sha256:[a-f0-9]{64}$/)
          .optional(),
        configurationDigest: z
          .string()
          .regex(/^sha256:[a-f0-9]{64}$/)
          .optional(),
        probeRevision: z.number().int().positive().optional(),
      })
      .strict(),
    documentationUrl: z.string().trim().min(1).max(500),
    remediation: z.array(safeText).min(1).max(16),
  })
  .strict()
  .superRefine((profile, context) => {
    if (profile.supportTier !== 'unsupported' && !profile.adapterId) {
      context.addIssue({
        code: 'custom',
        path: ['adapterId'],
        message: 'A configured executable support profile must name an executable adapter.',
      });
    }
    if (profile.adapterId && profile.transport === 'unsupported') {
      context.addIssue({
        code: 'custom',
        path: ['transport'],
        message: 'An executable adapter must declare its real transport.',
      });
    }
    if (
      profile.conformance.status === 'passed' &&
      (!profile.conformance.certifiedAt ||
        !profile.conformance.providerVersion ||
        !profile.conformance.manifestDigest ||
        !profile.conformance.configurationDigest ||
        !profile.conformance.probeRevision)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['conformance'],
        message: 'Passing certification requires timestamp, provider version, and manifest digest.',
      });
    }
    const publicText = [
      profile.displayName,
      profile.supportReason,
      profile.executable.command,
      ...profile.executable.versionArgs,
      ...(profile.authentication.commandArgs ?? []),
      profile.compatibility.policy,
      ...profile.compatibility.testedVersions,
      ...profile.launch.args,
      ...(profile.conformance.providerVersion ? [profile.conformance.providerVersion] : []),
      ...(profile.conformance.providerBuild ? [profile.conformance.providerBuild] : []),
      profile.documentationUrl,
      ...profile.remediation,
    ];
    if (publicText.some(containsUnredactedProviderRuntimeSecret)) {
      context.addIssue({
        code: 'custom',
        path: ['remediation'],
        message: 'Harness support diagnostics must not contain credentials or secrets.',
      });
    }
  });
