import { z } from 'zod';

const Hex64Schema = z.string().regex(/^[a-f0-9]{64}$/i);
const SlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9-_]*$/);
const BuzzSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'Buzz definition IDs must be slugs');

export const BuzzDefinitionCoordinateSchema = z
  .object({
    authorPubkey: Hex64Schema,
    kind: z.union([z.literal(30175), z.literal(30176)]),
    dTag: BuzzSlugSchema,
  })
  .strict();

export const BuzzDefinitionActionSchema = z.enum(['create', 'link', 'refresh', 'skip']);

export const BuzzDefinitionPreviewBodySchema = z
  .object({
    coordinate: BuzzDefinitionCoordinateSchema,
    action: BuzzDefinitionActionSchema,
    targetId: SlugSchema.optional(),
  })
  .strict();

export const BuzzDefinitionImportBodySchema = BuzzDefinitionPreviewBodySchema.extend({
  expectedEventId: Hex64Schema,
  expectedLocalRevision: Hex64Schema.optional(),
}).strict();

export const BuzzPersonaContentSchema = z
  .object({
    display_name: z.string().trim().min(1).max(120),
    system_prompt: z.string().max(10_000).nullable().optional(),
    avatar_url: z.url().max(2_048).nullable().optional(),
    runtime: z.string().trim().min(1).max(120).nullable().optional(),
    model: z.string().trim().min(1).max(120).nullable().optional(),
    provider: z.string().trim().min(1).max(120).nullable().optional(),
    name_pool: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
    respond_to: z.string().trim().min(1).max(120).nullable().optional(),
    respond_to_allowlist: z.array(z.string().trim().min(1).max(160)).max(100).nullable().optional(),
    parallelism: z.number().int().min(1).max(100).nullable().optional(),
  })
  .passthrough();

export const BuzzTeamContentSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2_000).nullable().optional(),
    persona_ids: z.array(BuzzSlugSchema).min(1).max(100),
  })
  .passthrough();

const BuzzDefinitionProvenanceSchema = z
  .object({
    schemaVersion: z.literal('buzz-definition-link/v1'),
    adapterId: z.string().trim().min(1).max(80),
    relay: z.url().max(2_048),
    community: z.string().trim().min(1).max(253),
    authorPubkey: Hex64Schema,
    kind: z.union([z.literal(30175), z.literal(30176)]),
    dTag: z.string().trim().min(1).max(80),
    eventId: Hex64Schema,
    createdAt: z.number().int().positive(),
    contentHash: Hex64Schema,
    importedAt: z.string().datetime(),
    refreshedAt: z.string().datetime().optional(),
  })
  .strict();

const BuzzDefinitionSourceSnapshotSchema = z
  .object({
    displayName: z.string().max(120).optional(),
    systemPrompt: z.string().max(10_000).optional(),
    avatarUrl: z.url().max(2_048).optional(),
    runtime: z.string().max(120).optional(),
    model: z.string().max(120).optional(),
    provider: z.string().max(120).optional(),
    namePool: z.array(z.string().max(120)).max(50).optional(),
    respondTo: z.string().max(120).optional(),
    respondToAllowlist: z.array(z.string().max(160)).max(100).optional(),
    parallelism: z.number().int().min(1).max(100).optional(),
    name: z.string().max(160).optional(),
    description: z.string().max(2_000).optional(),
    personaIds: z.array(z.string().max(80)).max(100).optional(),
  })
  .strict();

const BuzzDefinitionFieldReportSchema = z
  .object({
    field: z.string().trim().min(1).max(160),
    disposition: z.enum(['mapped', 'source-only', 'ignored', 'rejected', 'conflict']),
    detail: z.string().trim().min(1).max(500),
  })
  .strict();

export const BuzzDefinitionLinkSchema = z
  .object({
    provenance: BuzzDefinitionProvenanceSchema,
    sourceSnapshot: BuzzDefinitionSourceSnapshotSchema,
    fieldReport: z.array(BuzzDefinitionFieldReportSchema).max(100),
    sourceOwnedFields: z.array(z.string().trim().min(1).max(160)).max(50),
    localRevision: Hex64Schema,
    materializedIds: z.array(SlugSchema).max(100).optional(),
  })
  .strict();
