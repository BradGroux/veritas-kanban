import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { nanoid } from 'nanoid';
import {
  RUN_OUTPUT_ARTIFACT_SCHEMA_VERSION,
  RUN_OUTPUT_PREVIEW_SCHEMA_VERSION,
  type RunOutputArtifactMetadata,
  type RunOutputArtifactScope,
  type RunOutputArtifactSource,
  type RunOutputContentClass,
  type RunOutputPreview,
  type RunOutputQueryOperation,
  type RunOutputSpillPolicy,
  type RunOutputTruncationReason,
} from '@veritas-kanban/shared';
import { redactString } from '../lib/redact.js';
import {
  RunOutputArtifactMetadataSchema,
  RunOutputPreviewSchema,
  RunOutputSpillPolicySchema,
} from '../schemas/run-output-artifact-schemas.js';

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });
const COMPRESSED_MEDIA_TYPE =
  /(?:gzip|zip|x-7z-compressed|x-rar-compressed|x-tar|zstd|compressed)/i;
const JSON_MEDIA_TYPE = /(?:^application\/json$|\+json$)/i;
const TEXT_MEDIA_TYPE = /^(?:text\/|application\/(?:xml|javascript|x-ndjson))/i;
const SECRET_ASSIGNMENT =
  /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|authorization|password|secret)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,"'}]+)/gi;

export const DEFAULT_RUN_OUTPUT_SPILL_POLICY: RunOutputSpillPolicy = {
  schemaVersion: 'run-output-spill-policy/v1',
  inlineBytes: 8 * 1024,
  maxQueryBytes: 32 * 1024,
  maxJsonDepth: 12,
  retentionSeconds: 7 * 24 * 60 * 60,
  activeLeaseSeconds: 24 * 60 * 60,
  allowBinaryPersistence: false,
  allowCompressedPersistence: false,
};

export interface PrepareRunOutputInput {
  scope: RunOutputArtifactScope;
  source: RunOutputArtifactSource;
  content: string | Uint8Array;
  mediaType?: string;
  truncationReason?: RunOutputTruncationReason;
  now?: Date;
}

export interface PreparedRunOutput {
  preview: RunOutputPreview;
  artifact?: {
    metadata: RunOutputArtifactMetadata;
    content: Uint8Array | null;
  };
}

interface ClassifiedContent {
  contentClass: RunOutputContentClass;
  encoding: 'utf-8' | 'binary';
  text?: string;
}

interface RedactedContent {
  content: Uint8Array;
  text: string;
  state: 'none' | 'redacted';
  fields: string[];
}

function addSeconds(timestamp: Date, seconds: number): string {
  return new Date(timestamp.getTime() + seconds * 1000).toISOString();
}

function sha256(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

function clipUtf8(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, 'utf-8');
  if (bytes.byteLength <= maxBytes) return text;
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString('utf-8');
}

function redactAssignments(value: string): string {
  return value.replace(SECRET_ASSIGNMENT, (_match, key: string) => `${key}=[REDACTED]`);
}

export function redactRunOutputText(value: string): string {
  return redactString(redactAssignments(value));
}

function redactText(value: string): RedactedContent {
  const redacted = redactRunOutputText(value);
  return {
    content: Buffer.from(redacted, 'utf-8'),
    text: redacted,
    state: redacted === value ? 'none' : 'redacted',
    fields: redacted === value ? [] : ['$'],
  };
}

function redactJson(value: string): RedactedContent {
  const fields: string[] = [];
  const sensitiveKey =
    /^(?:authorization|api[_-]?key|apikey|token|access[_-]?token|refresh[_-]?token|secret|password|credentials?|private[_-]?key|cookie)$/i;
  const parsed = JSON.parse(value) as unknown;
  const seen = new WeakSet<object>();

  const visit = (candidate: unknown, path: string, depth: number): unknown => {
    if (depth > 64) {
      fields.push(path);
      return '[depth limit]';
    }
    if (typeof candidate === 'string') {
      const redacted = redactRunOutputText(candidate);
      if (redacted !== candidate) fields.push(path);
      return redacted;
    }
    if (!candidate || typeof candidate !== 'object') return candidate;
    if (seen.has(candidate)) {
      fields.push(path);
      return '[circular]';
    }
    seen.add(candidate);
    if (Array.isArray(candidate)) {
      const result = candidate.map((entry, index) => visit(entry, `${path}[${index}]`, depth + 1));
      seen.delete(candidate);
      return result;
    }
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(candidate as Record<string, unknown>)) {
      const childPath = `${path}.${key}`;
      if (sensitiveKey.test(key)) {
        result[key] = '[REDACTED]';
        fields.push(childPath);
      } else {
        result[key] = visit(entry, childPath, depth + 1);
      }
    }
    seen.delete(candidate);
    return result;
  };

  const text = JSON.stringify(visit(parsed, '$', 0));
  return {
    content: Buffer.from(text, 'utf-8'),
    text,
    state: fields.length > 0 ? 'redacted' : 'none',
    fields: [...new Set(fields)].slice(0, 256),
  };
}

function classifyContent(content: Uint8Array, mediaType: string): ClassifiedContent {
  if (COMPRESSED_MEDIA_TYPE.test(mediaType)) {
    return { contentClass: 'compressed', encoding: 'binary' };
  }
  let text: string;
  try {
    text = UTF8_DECODER.decode(content);
  } catch {
    return {
      contentClass:
        TEXT_MEDIA_TYPE.test(mediaType) || JSON_MEDIA_TYPE.test(mediaType) ? 'invalid-utf8' : 'binary',
      encoding: 'binary',
    };
  }
  if (JSON_MEDIA_TYPE.test(mediaType)) {
    try {
      JSON.parse(text);
      return { contentClass: 'json', encoding: 'utf-8', text };
    } catch {
      return { contentClass: 'text', encoding: 'utf-8', text };
    }
  }
  return {
    contentClass: TEXT_MEDIA_TYPE.test(mediaType) ? 'text' : 'text',
    encoding: 'utf-8',
    text,
  };
}

function operationsFor(contentClass: RunOutputContentClass): RunOutputQueryOperation[] {
  const operations: RunOutputQueryOperation[] = ['metadata', 'byte-range'];
  if (contentClass === 'text') operations.push('line-range');
  if (contentClass === 'json') operations.push('line-range', 'json-path');
  operations.push('download');
  return operations;
}

function defaultMediaType(content: string | Uint8Array): string {
  return typeof content === 'string' ? 'text/plain' : 'application/octet-stream';
}

export class RunOutputSpillService {
  private readonly policy: RunOutputSpillPolicy;

  constructor(policy: RunOutputSpillPolicy = DEFAULT_RUN_OUTPUT_SPILL_POLICY) {
    this.policy = RunOutputSpillPolicySchema.parse(policy);
  }

  prepare(input: PrepareRunOutputInput): PreparedRunOutput {
    const now = input.now ?? new Date();
    const mediaType = (input.mediaType ?? defaultMediaType(input.content)).trim().toLowerCase();
    const original = typeof input.content === 'string' ? Buffer.from(input.content) : input.content;
    const classified = classifyContent(original, mediaType);
    const unsafeByPolicy =
      classified.contentClass === 'invalid-utf8' ||
      (classified.contentClass === 'binary' && !this.policy.allowBinaryPersistence) ||
      (classified.contentClass === 'compressed' && !this.policy.allowCompressedPersistence);
    const redacted =
      classified.text === undefined
        ? undefined
        : classified.contentClass === 'json'
          ? redactJson(classified.text)
          : redactText(classified.text);
    const stored = redacted?.content ?? original;
    const requiresArtifact =
      unsafeByPolicy || stored.byteLength > this.policy.inlineBytes || classified.encoding === 'binary';
    const previewText =
      redacted?.text === undefined
        ? `[${classified.contentClass} output withheld by content policy]`
        : clipUtf8(redacted.text, this.policy.inlineBytes);
    const previewBytes = Buffer.byteLength(previewText, 'utf-8');

    if (!requiresArtifact) {
      return {
        preview: RunOutputPreviewSchema.parse({
          schemaVersion: RUN_OUTPUT_PREVIEW_SCHEMA_VERSION,
          inline: true,
          content: previewText,
          mediaType,
          contentClass: classified.contentClass,
          originalBytes: original.byteLength,
          previewBytes,
          truncated: false,
        }),
      };
    }

    const reason = unsafeByPolicy
      ? 'content-policy'
      : (input.truncationReason ?? 'inline-limit');
    const state = unsafeByPolicy ? 'quarantined' : 'available';
    const operations = unsafeByPolicy ? ['metadata'] : operationsFor(classified.contentClass);
    const artifactId = `spill_${nanoid(24)}`;
    const createdAt = now.toISOString();
    const metadata = RunOutputArtifactMetadataSchema.parse({
      schemaVersion: RUN_OUTPUT_ARTIFACT_SCHEMA_VERSION,
      id: artifactId,
      scope: input.scope,
      source: input.source,
      mediaType,
      encoding: classified.encoding,
      contentClass: classified.contentClass,
      originalBytes: original.byteLength,
      storedBytes: unsafeByPolicy ? 0 : stored.byteLength,
      previewBytes,
      truncationReason: reason,
      sha256: sha256(unsafeByPolicy ? original : stored),
      redaction: {
        state: unsafeByPolicy ? 'quarantined' : (redacted?.state ?? 'none'),
        fields: redacted?.fields ?? [],
        validatedAt: createdAt,
      },
      retention: {
        createdAt,
        expiresAt: addSeconds(now, this.policy.retentionSeconds),
        ...(this.policy.activeLeaseSeconds > 0
          ? { activeLeaseUntil: addSeconds(now, this.policy.activeLeaseSeconds) }
          : {}),
      },
      state,
      ...(unsafeByPolicy ? { quarantineReason: 'content-policy' } : {}),
    });
    const preview = RunOutputPreviewSchema.parse({
      schemaVersion: RUN_OUTPUT_PREVIEW_SCHEMA_VERSION,
      inline: false,
      content: previewText,
      mediaType,
      contentClass: classified.contentClass,
      originalBytes: original.byteLength,
      previewBytes,
      truncated: true,
      truncationReason: reason,
      artifact: { artifactId, state, operations },
      queryHints: {
        maxResultBytes: this.policy.maxQueryBytes,
        maxJsonDepth: this.policy.maxJsonDepth,
        operations,
      },
    });

    return {
      preview,
      artifact: {
        metadata,
        content: unsafeByPolicy ? null : stored,
      },
    };
  }
}
