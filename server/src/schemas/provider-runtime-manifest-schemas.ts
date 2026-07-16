import { z } from 'zod';
import {
  KNOWN_PROVIDER_RUNTIME_CAPABILITY_IDS,
  PROVIDER_RUNTIME_MANIFEST_SCHEMA_VERSION,
  PROVIDER_RUNTIME_PROBE_REVISION,
  type ProviderRuntimeManifest,
} from '@veritas-kanban/shared';
import { calculateProviderRuntimeManifestDigest } from '../utils/provider-runtime-manifest-digest.js';
import { containsUnredactedProviderRuntimeSecret } from '../utils/provider-runtime-manifest-sanitize.js';

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z][a-zA-Z0-9._:/-]*$/, 'Invalid runtime identifier');

export const ProviderRuntimeCapabilityIdSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[a-z][a-z0-9.-]*$/, 'Invalid capability identifier');

export const ProviderRuntimeCapabilityEvidenceSchema = z
  .object({
    id: ProviderRuntimeCapabilityIdSchema,
    state: z.enum(['supported', 'advisory', 'unsupported', 'unknown']),
    source: z.enum(['runtime-probe', 'contract-test', 'host-enforced']),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();

export const ProviderRuntimeManifestSchema = z
  .object({
    schemaVersion: z.literal(PROVIDER_RUNTIME_MANIFEST_SCHEMA_VERSION),
    probeRevision: z.number().int().min(1).max(PROVIDER_RUNTIME_PROBE_REVISION),
    provider: identifierSchema,
    adapter: identifierSchema,
    protocolVersion: identifierSchema,
    providerVersion: z.string().trim().min(1).max(200),
    providerBuild: z.string().trim().min(1).max(300).optional(),
    models: z.array(z.string().trim().min(1).max(200)).max(100),
    capabilities: z.array(ProviderRuntimeCapabilityEvidenceSchema).min(1).max(128),
    probe: z
      .object({
        state: z.enum(['ready', 'degraded', 'failed']),
        probedAt: z.iso.datetime(),
        source: z.string().trim().min(1).max(200),
        diagnostics: z.array(z.string().trim().min(1).max(1000)).max(32),
      })
      .strict(),
    digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  })
  .strict()
  .superRefine((manifest, context) => {
    const seen = new Set<string>();
    for (const [index, capability] of manifest.capabilities.entries()) {
      if (seen.has(capability.id)) {
        context.addIssue({
          code: 'custom',
          path: ['capabilities', index, 'id'],
          message: `Duplicate capability: ${capability.id}`,
        });
      }
      seen.add(capability.id);
    }
    for (const capabilityId of KNOWN_PROVIDER_RUNTIME_CAPABILITY_IDS) {
      if (!seen.has(capabilityId)) {
        context.addIssue({
          code: 'custom',
          path: ['capabilities'],
          message: `Missing known capability: ${capabilityId}`,
        });
      }
    }
    if (manifest.digest !== calculateProviderRuntimeManifestDigest(manifest)) {
      context.addIssue({
        code: 'custom',
        path: ['digest'],
        message: 'Provider runtime manifest digest does not match its canonical payload',
      });
    }
    const sensitiveFields: Array<{ path: (string | number)[]; value: string }> = [
      { path: ['providerVersion'], value: manifest.providerVersion },
      ...(manifest.providerBuild
        ? [{ path: ['providerBuild'], value: manifest.providerBuild }]
        : []),
      { path: ['probe', 'source'], value: manifest.probe.source },
      ...manifest.probe.diagnostics.map((value, index) => ({
        path: ['probe', 'diagnostics', index],
        value,
      })),
      ...manifest.capabilities.map((capability, index) => ({
        path: ['capabilities', index, 'reason'],
        value: capability.reason,
      })),
    ];
    for (const field of sensitiveFields) {
      if (containsUnredactedProviderRuntimeSecret(field.value)) {
        context.addIssue({
          code: 'custom',
          path: field.path,
          message: 'Provider runtime evidence must redact credentials and secrets before ingestion',
        });
      }
    }
  });

export function parseProviderRuntimeManifest(input: unknown): ProviderRuntimeManifest {
  return ProviderRuntimeManifestSchema.parse(input) as ProviderRuntimeManifest;
}
