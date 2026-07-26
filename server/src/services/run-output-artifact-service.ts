import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import type {
  RunOutputArtifactLookup,
  RunOutputArtifactMetadata,
  RunOutputArtifactQuery,
  RunOutputArtifactQueryResult,
} from '@veritas-kanban/shared';
import type { RunOutputArtifactRepository } from '../storage/interfaces.js';
import { getStorage } from '../storage/index.js';
import {
  RunOutputSpillService,
  redactRunOutputText,
  type PrepareRunOutputInput,
} from './run-output-spill-service.js';

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

export interface RunOutputArtifactQueryPolicy {
  maxResultBytes: number;
  maxLineCount: number;
  maxScanBytes: number;
  maxStructuredBytes: number;
  maxJsonDepth: number;
  maxQueriesPerMinute: number;
}

export const DEFAULT_RUN_OUTPUT_ARTIFACT_QUERY_POLICY: RunOutputArtifactQueryPolicy = {
  maxResultBytes: 32 * 1024,
  maxLineCount: 1_000,
  maxScanBytes: 4 * 1024 * 1024,
  maxStructuredBytes: 1024 * 1024,
  maxJsonDepth: 12,
  maxQueriesPerMinute: 60,
};

export interface QueryRunOutputArtifactInput {
  lookup: RunOutputArtifactLookup;
  query: RunOutputArtifactQuery;
  requesterId: string;
  now?: Date;
}

function clipUtf8(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, 'utf-8');
  if (bytes.byteLength <= maxBytes) return text;
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString('utf-8');
}

function decodeUtf8Prefix(content: Uint8Array): string {
  for (let trim = 0; trim <= Math.min(3, content.byteLength); trim += 1) {
    try {
      return UTF8_DECODER.decode(
        trim === 0 ? content : content.subarray(0, content.byteLength - trim)
      );
    } catch {
      // A bounded prefix can end within one UTF-8 code point.
    }
  }
  throw new Error('Run output artifact is not valid UTF-8.');
}

function parseJsonPath(path: string, maxDepth: number): Array<string | number> {
  if (!path.startsWith('$')) throw new Error('JSON path must start with $.');
  const tokens: Array<string | number> = [];
  const suffix = path.slice(1);
  const matcher = /\.([A-Za-z0-9_-]+)|\[(\d+)\]/g;
  let cursor = 0;
  for (const match of suffix.matchAll(matcher)) {
    if (match.index !== cursor) throw new Error('JSON path contains unsupported syntax.');
    tokens.push(match[1] ?? Number(match[2]));
    cursor = match.index + match[0].length;
  }
  if (cursor !== suffix.length) throw new Error('JSON path contains unsupported syntax.');
  if (tokens.length > maxDepth) throw new Error('JSON path exceeds the configured depth limit.');
  return tokens;
}

function selectJsonPath(value: unknown, tokens: Array<string | number>): unknown {
  let selected = value;
  for (const token of tokens) {
    if (
      selected === null ||
      typeof selected !== 'object' ||
      (typeof token === 'number' && !Array.isArray(selected)) ||
      (typeof token === 'string' && Array.isArray(selected))
    ) {
      return null;
    }
    selected = (selected as Record<string | number, unknown>)[token];
  }
  return selected;
}

export class RunOutputArtifactService {
  private readonly queryTimes = new Map<string, number[]>();

  constructor(
    private readonly repository: RunOutputArtifactRepository = getStorage().runOutputArtifacts,
    private readonly spillService = new RunOutputSpillService(),
    private readonly policy = DEFAULT_RUN_OUTPUT_ARTIFACT_QUERY_POLICY
  ) {}

  async spill(input: PrepareRunOutputInput) {
    const prepared = this.spillService.prepare(input);
    if (prepared.artifact) {
      await this.repository.create(prepared.artifact.metadata, prepared.artifact.content);
    }
    return prepared.preview;
  }

  async query(input: QueryRunOutputArtifactInput): Promise<RunOutputArtifactQueryResult | null> {
    const metadata = await this.repository.get(input.lookup);
    if (!metadata) return null;
    if (input.query.operation === 'metadata') {
      return { metadata, operation: 'metadata', truncated: false };
    }
    if (metadata.state !== 'available') {
      return { metadata, operation: input.query.operation, truncated: false };
    }
    this.consumeRateLimit(input.requesterId, metadata.id, input.now ?? new Date());
    switch (input.query.operation) {
      case 'byte-range':
        return this.queryByteRange(metadata, input.lookup, input.query);
      case 'line-range':
        return this.queryLineRange(metadata, input.lookup, input.query);
      case 'json-path':
        return this.queryJsonPath(metadata, input.lookup, input.query);
    }
  }

  async validateForExport(
    lookup: RunOutputArtifactLookup,
    now = new Date()
  ): Promise<RunOutputArtifactMetadata | null> {
    const metadata = await this.repository.get(lookup);
    if (!metadata || metadata.state !== 'available') return metadata;
    const hash = createHash('sha256');
    const decoder =
      metadata.encoding === 'utf-8' ? new TextDecoder('utf-8', { fatal: true }) : undefined;
    let offset = 0;
    let textCarry = '';
    while (offset < metadata.storedBytes) {
      const length = Math.min(this.policy.maxResultBytes, metadata.storedBytes - offset);
      const range = await this.repository.readRange({ ...lookup, offset, length });
      if (!range || range.length === 0) {
        return this.repository.quarantine(lookup, 'integrity-mismatch', now.toISOString());
      }
      hash.update(range.content);
      if (decoder) {
        const decoded = decoder.decode(range.content, {
          stream: offset + range.length < metadata.storedBytes,
        });
        const candidate = `${textCarry}${decoded}`;
        if (redactRunOutputText(candidate) !== candidate) {
          return this.repository.quarantine(lookup, 'secret-validation', now.toISOString());
        }
        textCarry = candidate.slice(-256);
      }
      offset += range.length;
    }
    if (hash.digest('hex') !== metadata.sha256) {
      return this.repository.quarantine(lookup, 'integrity-mismatch', now.toISOString());
    }
    return metadata;
  }

  private async queryByteRange(
    metadata: RunOutputArtifactMetadata,
    lookup: RunOutputArtifactLookup,
    query: Extract<RunOutputArtifactQuery, { operation: 'byte-range' }>
  ): Promise<RunOutputArtifactQueryResult> {
    const length = Math.min(Math.max(query.length, 1), this.policy.maxResultBytes);
    const range = await this.repository.readRange({ ...lookup, offset: query.offset, length });
    if (!range) return { metadata, operation: 'byte-range', truncated: false };
    const utf8 = metadata.encoding === 'utf-8';
    return {
      metadata,
      operation: 'byte-range',
      content: utf8
        ? Buffer.from(range.content).toString('utf-8')
        : Buffer.from(range.content).toString('base64'),
      encoding: utf8 ? 'utf-8' : 'base64',
      offset: range.offset,
      length: range.length,
      truncated: query.length > length || range.offset + range.length < metadata.storedBytes,
    };
  }

  private async queryLineRange(
    metadata: RunOutputArtifactMetadata,
    lookup: RunOutputArtifactLookup,
    query: Extract<RunOutputArtifactQuery, { operation: 'line-range' }>
  ): Promise<RunOutputArtifactQueryResult> {
    if (metadata.encoding !== 'utf-8') throw new Error('Line ranges require UTF-8 content.');
    if (!Number.isInteger(query.startLine) || query.startLine < 1) {
      throw new Error('Line ranges use a positive 1-based start line.');
    }
    if (
      !Number.isInteger(query.lineCount) ||
      query.lineCount < 1 ||
      query.lineCount > this.policy.maxLineCount
    ) {
      throw new Error(`Line count must be between 1 and ${this.policy.maxLineCount}.`);
    }
    const bytes = await this.readAllBounded(metadata, lookup, this.policy.maxScanBytes);
    const text = decodeUtf8Prefix(bytes.content);
    const lines = text.split(/\r?\n/);
    const selected = lines.slice(query.startLine - 1, query.startLine - 1 + query.lineCount);
    const complete = selected.join('\n');
    const content = clipUtf8(complete, this.policy.maxResultBytes);
    return {
      metadata,
      operation: 'line-range',
      content,
      encoding: 'utf-8',
      length: Buffer.byteLength(content, 'utf-8'),
      truncated:
        bytes.truncated ||
        content !== complete ||
        query.startLine - 1 + query.lineCount < lines.length,
    };
  }

  private async queryJsonPath(
    metadata: RunOutputArtifactMetadata,
    lookup: RunOutputArtifactLookup,
    query: Extract<RunOutputArtifactQuery, { operation: 'json-path' }>
  ): Promise<RunOutputArtifactQueryResult> {
    if (metadata.contentClass !== 'json' || metadata.encoding !== 'utf-8') {
      throw new Error('Structured queries require a UTF-8 JSON artifact.');
    }
    if (metadata.storedBytes > this.policy.maxStructuredBytes) {
      throw new Error('JSON artifact exceeds the structured-query size limit.');
    }
    const tokens = parseJsonPath(query.path, this.policy.maxJsonDepth);
    const bytes = await this.readAllBounded(metadata, lookup, this.policy.maxStructuredBytes);
    const selected = selectJsonPath(JSON.parse(UTF8_DECODER.decode(bytes.content)), tokens);
    const complete = JSON.stringify(selected ?? null);
    const content = clipUtf8(complete, this.policy.maxResultBytes);
    return {
      metadata,
      operation: 'json-path',
      content,
      encoding: content === complete ? 'json' : 'utf-8',
      length: Buffer.byteLength(content, 'utf-8'),
      truncated: content !== complete,
    };
  }

  private async readAllBounded(
    metadata: RunOutputArtifactMetadata,
    lookup: RunOutputArtifactLookup,
    maxBytes: number
  ): Promise<{ content: Uint8Array; truncated: boolean }> {
    const requested = Math.min(metadata.storedBytes, maxBytes);
    const range = await this.repository.readRange({ ...lookup, offset: 0, length: requested });
    if (!range) throw new Error('Run output artifact body is unavailable.');
    return {
      content: range.content,
      truncated: metadata.storedBytes > range.length,
    };
  }

  private consumeRateLimit(requesterId: string, artifactId: string, now: Date): void {
    const key = `${requesterId}:${artifactId}`;
    const cutoff = now.getTime() - 60_000;
    const recent = (this.queryTimes.get(key) ?? []).filter((entry) => entry > cutoff);
    if (recent.length >= this.policy.maxQueriesPerMinute) {
      throw new Error('Run output artifact query rate limit exceeded.');
    }
    recent.push(now.getTime());
    this.queryTimes.set(key, recent);
    if (this.queryTimes.size > 10_000) {
      for (const [candidate, timestamps] of this.queryTimes) {
        if (timestamps.every((entry) => entry <= cutoff)) this.queryTimes.delete(candidate);
      }
    }
  }
}
