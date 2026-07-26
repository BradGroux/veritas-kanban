import { z } from 'zod';
import {
  KNOWLEDGE_ACCESS_ROLES,
  KNOWLEDGE_CLASSIFICATIONS,
  KNOWLEDGE_COLLECTION_DEFINITION_SCHEMA_VERSION,
  KNOWLEDGE_COLLECTION_SCHEMA_VERSION,
  KNOWLEDGE_PAGE_REVISION_SCHEMA_VERSION,
  KNOWLEDGE_PAGE_SCHEMA_VERSION,
  KNOWLEDGE_SOURCE_SCHEMA_VERSION,
  type KnowledgeCollection,
  type KnowledgePage,
  type KnowledgeSource,
} from '@veritas-kanban/shared';

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[A-Za-z0-9._:-]+$/);
const opaqueTextSchema = z
  .string()
  .min(1)
  .max(4_096)
  .refine((value) => value.trim().length > 0 && !value.includes('\0'), {
    message: 'Value must contain non-whitespace text and no NUL bytes.',
  });
const uniqueStrings = (values: string[]) => new Set(values).size === values.length;

export const KnowledgeCollectionDefinitionSchema = z
  .object({
    schemaVersion: z.literal(KNOWLEDGE_COLLECTION_DEFINITION_SCHEMA_VERSION),
    version: z.number().int().min(1).max(10_000),
    pageKinds: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(80)
          .regex(/^[a-z][a-z0-9-]*$/)
      )
      .min(1)
      .max(100)
      .refine(uniqueStrings, { message: 'Page kinds must be unique.' }),
    requiredMetadata: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(80)
          .regex(/^[a-z][a-zA-Z0-9]*$/)
      )
      .max(100)
      .refine(uniqueStrings, { message: 'Required metadata fields must be unique.' }),
    naming: z.literal('stable-id'),
    links: z.literal('bidirectional'),
    ingestion: z.literal('review-required'),
    maxPageVersions: z.number().int().min(1).max(1_000),
  })
  .strict();

export const KnowledgeCollectionAccessPolicySchema = z
  .object({
    readRoles: z
      .array(z.enum(KNOWLEDGE_ACCESS_ROLES))
      .min(1)
      .max(KNOWLEDGE_ACCESS_ROLES.length)
      .refine(uniqueStrings, { message: 'Read roles must be unique.' }),
    writeRoles: z
      .array(z.enum(KNOWLEDGE_ACCESS_ROLES))
      .min(1)
      .max(KNOWLEDGE_ACCESS_ROLES.length)
      .refine(uniqueStrings, { message: 'Write roles must be unique.' }),
    maxSourceClassification: z.enum(KNOWLEDGE_CLASSIFICATIONS),
    exportPolicy: z.enum(['allowed', 'redacted-only', 'forbidden']),
  })
  .strict()
  .superRefine((policy, context) => {
    for (const role of policy.writeRoles) {
      if (!policy.readRoles.includes(role)) {
        context.addIssue({
          code: 'custom',
          path: ['writeRoles'],
          message: 'Every write role must also have read access.',
        });
      }
    }
    for (const field of ['readRoles', 'writeRoles'] as const) {
      if (!policy[field].includes('admin')) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: 'Admin access cannot be removed from a knowledge collection.',
        });
      }
    }
  });

export const CreateKnowledgeCollectionBodySchema = z
  .object({
    operationId: opaqueTextSchema.max(240),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: z.string().trim().min(1).max(240),
    description: z.string().trim().min(1).max(4_000).optional(),
    definition: KnowledgeCollectionDefinitionSchema,
    accessPolicy: KnowledgeCollectionAccessPolicySchema,
  })
  .strict();

export const RegisterKnowledgeSourceBodySchema = z.discriminatedUnion('storage', [
  z
    .object({
      operationId: opaqueTextSchema.max(240),
      sourceKey: identifierSchema,
      uri: opaqueTextSchema,
      mediaType: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i),
      title: z.string().trim().min(1).max(500).optional(),
      owner: z.string().trim().min(1).max(240),
      classification: z.enum(KNOWLEDGE_CLASSIFICATIONS),
      capturedAt: z.iso.datetime().optional(),
      storage: z.literal('content-addressed-blob'),
      content: z.string().max(8 * 1_024 * 1_024),
    })
    .strict(),
  z
    .object({
      operationId: opaqueTextSchema.max(240),
      sourceKey: identifierSchema,
      uri: opaqueTextSchema,
      mediaType: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i),
      title: z.string().trim().min(1).max(500).optional(),
      owner: z.string().trim().min(1).max(240),
      classification: z.enum(KNOWLEDGE_CLASSIFICATIONS),
      capturedAt: z.iso.datetime().optional(),
      storage: z.literal('content-addressed-reference'),
      contentHash: digestSchema,
      contentBytes: z
        .number()
        .int()
        .nonnegative()
        .max(4 * 1_024 * 1_024 * 1_024),
    })
    .strict(),
]);

export const KnowledgeCollectionSchema = z
  .object({
    schemaVersion: z.literal(KNOWLEDGE_COLLECTION_SCHEMA_VERSION),
    id: identifierSchema,
    workspaceId: identifierSchema,
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: z.string().min(1).max(240),
    description: z.string().min(1).max(4_000).optional(),
    definition: KnowledgeCollectionDefinitionSchema,
    accessPolicy: KnowledgeCollectionAccessPolicySchema,
    version: z.number().int().min(1),
    operationIdDigest: digestSchema,
    requestDigest: digestSchema,
    createdBy: opaqueTextSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    digest: digestSchema,
  })
  .strict();

export const KnowledgeSourceSchema = z
  .object({
    schemaVersion: z.literal(KNOWLEDGE_SOURCE_SCHEMA_VERSION),
    id: identifierSchema,
    workspaceId: identifierSchema,
    collectionId: identifierSchema,
    sourceKey: identifierSchema,
    revision: z.number().int().min(1),
    uri: opaqueTextSchema,
    mediaType: z.string().min(1).max(200),
    title: z.string().min(1).max(500).optional(),
    owner: z.string().min(1).max(240),
    classification: z.enum(KNOWLEDGE_CLASSIFICATIONS),
    storage: z.enum(['content-addressed-blob', 'content-addressed-reference']),
    contentHash: digestSchema,
    contentBytes: z.number().int().nonnegative(),
    blobDigest: digestSchema.optional(),
    supersedesSourceId: identifierSchema.optional(),
    operationIdDigest: digestSchema,
    requestDigest: digestSchema,
    capturedAt: z.iso.datetime(),
    createdBy: opaqueTextSchema,
    digest: digestSchema,
  })
  .strict()
  .superRefine((source, context) => {
    if (
      (source.storage === 'content-addressed-blob') !==
      Boolean(source.blobDigest && source.blobDigest === source.contentHash)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['blobDigest'],
        message: 'Inline source snapshots require a content-addressed blob digest.',
      });
    }
  });

export function parseKnowledgeCollection(value: unknown): KnowledgeCollection {
  return KnowledgeCollectionSchema.parse(value) as KnowledgeCollection;
}

export function parseKnowledgeSource(value: unknown): KnowledgeSource {
  return KnowledgeSourceSchema.parse(value) as KnowledgeSource;
}

const stableKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const aliasSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .refine((value) => !value.includes('\0'), { message: 'Alias cannot contain NUL bytes.' });
const tagSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const metadataKeySchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-zA-Z0-9]*$/);
const metadataValueSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_000)
  .refine((value) => !value.includes('\0'), {
    message: 'Metadata cannot contain NUL bytes.',
  });
const confidenceSchema = z.number().min(0).max(1);
const uniqueCaseInsensitive = (values: string[]) =>
  new Set(values.map((value) => value.toLocaleLowerCase('en-US'))).size === values.length;

export const KnowledgeCitationLocatorSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('line-range'),
      startLine: z.number().int().min(1).max(10_000_000),
      endLine: z.number().int().min(1).max(10_000_000),
    })
    .strict()
    .refine((locator) => locator.endLine >= locator.startLine, {
      message: 'Citation line range must end at or after its start.',
    }),
  z
    .object({
      kind: z.literal('heading'),
      heading: z.string().trim().min(1).max(500),
      occurrence: z.number().int().min(1).max(10_000).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('json-pointer'),
      pointer: z
        .string()
        .max(2_000)
        .refine((value) => value === '' || value.startsWith('/'), {
          message: 'JSON pointer must be empty or begin with a slash.',
        }),
    })
    .strict(),
  z
    .object({
      kind: z.literal('excerpt-hash'),
      excerptHash: digestSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('time-range'),
      startMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      endMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    })
    .strict()
    .refine((locator) => locator.endMs >= locator.startMs, {
      message: 'Citation time range must end at or after its start.',
    }),
]);

export const KnowledgeClaimCitationSchema = z
  .object({
    sourceId: identifierSchema,
    locator: KnowledgeCitationLocatorSchema.optional(),
    excerptHash: digestSchema.optional(),
  })
  .strict();

const KnowledgePageClaimInputSchema = z
  .object({
    claimKey: stableKeySchema,
    text: z.string().trim().min(1).max(10_000),
    citations: z.array(KnowledgeClaimCitationSchema).min(1).max(20),
    confidence: confidenceSchema,
  })
  .strict();

export const KnowledgePageClaimSchema = KnowledgePageClaimInputSchema.extend({
  id: identifierSchema,
}).strict();

const aliasesSchema = z
  .array(aliasSchema)
  .max(100)
  .refine(uniqueCaseInsensitive, { message: 'Knowledge page aliases must be unique.' });
const tagsSchema = z
  .array(tagSchema)
  .max(100)
  .refine(uniqueStrings, { message: 'Knowledge page tags must be unique.' });
const metadataSchema = z
  .record(metadataKeySchema, metadataValueSchema)
  .refine((metadata) => Object.keys(metadata).length <= 100, {
    message: 'Knowledge page metadata cannot exceed 100 fields.',
  });
const pageIdsSchema = z
  .array(identifierSchema)
  .max(1_000)
  .refine(uniqueStrings, { message: 'Knowledge page links must be unique.' });

export const KnowledgePageRevisionSchema = z
  .object({
    schemaVersion: z.literal(KNOWLEDGE_PAGE_REVISION_SCHEMA_VERSION),
    version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    title: z.string().trim().min(1).max(500),
    pageKind: stableKeySchema,
    aliases: aliasesSchema,
    tags: tagsSchema,
    metadata: metadataSchema,
    markdown: z.string().max(2 * 1_024 * 1_024),
    contentHash: digestSchema,
    claims: z
      .array(KnowledgePageClaimSchema)
      .max(500)
      .refine(
        (claims) => uniqueStrings(claims.map((claim) => claim.claimKey)),
        'Knowledge page claim keys must be unique.'
      ),
    outgoingPageIds: pageIdsSchema,
    backlinkPageIds: pageIdsSchema,
    reviewState: z.enum(['draft', 'review-required', 'approved', 'rejected']),
    confidence: confidenceSchema,
    operationIdDigest: digestSchema,
    requestDigest: digestSchema,
    updatedBy: opaqueTextSchema,
    updatedAt: z.iso.datetime(),
    digest: digestSchema,
  })
  .strict();

export const KnowledgePageSchema = z
  .object({
    schemaVersion: z.literal(KNOWLEDGE_PAGE_SCHEMA_VERSION),
    id: identifierSchema,
    workspaceId: identifierSchema,
    collectionId: identifierSchema,
    stableKey: stableKeySchema,
    current: KnowledgePageRevisionSchema,
    history: z.array(KnowledgePageRevisionSchema).max(999),
    createdBy: opaqueTextSchema,
    createdAt: z.iso.datetime(),
    digest: digestSchema,
  })
  .strict()
  .superRefine((page, context) => {
    const versions = [page.current.version, ...page.history.map((revision) => revision.version)];
    if (new Set(versions).size !== versions.length) {
      context.addIssue({
        code: 'custom',
        path: ['history'],
        message: 'Knowledge page revision versions must be unique.',
      });
    }
    if (page.history.some((revision) => revision.version >= page.current.version)) {
      context.addIssue({
        code: 'custom',
        path: ['history'],
        message: 'Knowledge page history must precede the current revision.',
      });
    }
  });

export const UpsertKnowledgePagesBodySchema = z
  .object({
    operationId: opaqueTextSchema.max(240),
    pages: z
      .array(
        z
          .object({
            stableKey: stableKeySchema,
            title: z.string().trim().min(1).max(500),
            pageKind: stableKeySchema,
            aliases: aliasesSchema.optional(),
            tags: tagsSchema.optional(),
            metadata: metadataSchema,
            markdown: z.string().max(2 * 1_024 * 1_024),
            claims: z.array(KnowledgePageClaimInputSchema).max(500),
            links: z.array(aliasSchema).max(1_000).refine(uniqueCaseInsensitive).optional(),
            reviewState: z.enum(['draft', 'review-required', 'approved', 'rejected']),
            confidence: confidenceSchema,
          })
          .strict()
      )
      .min(1)
      .max(100)
      .refine(
        (pages) => uniqueStrings(pages.map((page) => page.stableKey)),
        'Knowledge page candidate stable keys must be unique.'
      ),
  })
  .strict();

export function parseKnowledgePage(value: unknown): KnowledgePage {
  return KnowledgePageSchema.parse(value) as KnowledgePage;
}
