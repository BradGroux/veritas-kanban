import { z } from 'zod';
import {
  KNOWLEDGE_ACCESS_ROLES,
  KNOWLEDGE_CLASSIFICATIONS,
  KNOWLEDGE_COLLECTION_DEFINITION_SCHEMA_VERSION,
  KNOWLEDGE_COLLECTION_SCHEMA_VERSION,
  KNOWLEDGE_SOURCE_SCHEMA_VERSION,
  type KnowledgeCollection,
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
