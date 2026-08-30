import { createHash } from 'node:crypto';
import path from 'node:path';
import type {
  FileWorkProductRender,
  WorkProduct,
  WorkProductArtifactMetadata,
} from '@veritas-kanban/shared';
import { WORK_PRODUCT_ARTIFACT_SCHEMA_VERSION } from '@veritas-kanban/shared';
import { BadRequestError, ForbiddenError, NotFoundError } from '../middleware/error-handler.js';
import { parseRunLaunchManifest } from '../schemas/run-launch-manifest-schemas.js';
import { getStorage, getStorageTypeFromEnv } from '../storage/index.js';
import type {
  WorkProductArtifactDownload,
  WorkProductArtifactRepository,
  WorkProductArtifactSourceReader,
} from '../storage/work-product-artifact-repository.js';
import {
  FileWorkProductArtifactRepository,
  SecureWorkProductArtifactSourceReader,
} from '../storage/work-product-artifact-repository.js';
import { digestSandboxPath, runSandboxDirectories } from '../utils/filesystem-sandbox-runtime.js';
import { validatePathSegment } from '../utils/sanitize.js';
import { redactRunOutputText } from './run-output-spill-service.js';
import type { RunEventJournalService } from './run-event-journal-service.js';
import { getRunEventJournalService } from './run-event-journal-service.js';
import { getTaskService } from './task-service.js';
import type { WorkProductService } from './work-product-service.js';
import { getWorkProductService } from './work-product-service.js';

const DEFAULT_MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const EXECUTABLE_MEDIA_TYPES = new Set([
  'application/x-executable',
  'application/x-mach-binary',
  'application/vnd.microsoft.portable-executable',
]);

export interface WorkProductArtifactScope {
  workspaceId: string;
  taskId: string;
  runId: string;
  attemptId: string;
}

export interface WorkProductArtifactGrant {
  artifactRoot: string;
  manifestDigest: string;
}

export interface RegisterWorkProductArtifactInput extends WorkProductArtifactScope {
  requestId: string;
  producingEventId: string;
  relativePath: string;
  title: string;
  mediaType: string;
  workProductId?: string;
}

export interface WorkProductArtifactRegistration {
  product: WorkProduct;
  metadata: WorkProductArtifactMetadata;
}

export interface WorkProductArtifactPurgeResult {
  productId: string;
  artifactsDeleted: number;
  bytesDeleted: number;
}

export interface WorkProductArtifactServiceOptions {
  repository: WorkProductArtifactRepository;
  workProducts: Pick<
    WorkProductService,
    'create' | 'get' | 'update' | 'list' | 'listVersions' | 'purge'
  >;
  events: Pick<RunEventJournalService, 'append'>;
  resolveGrant: (scope: WorkProductArtifactScope) => Promise<WorkProductArtifactGrant | null>;
  sourceReader?: WorkProductArtifactSourceReader;
  maxArtifactBytes?: number;
}

export class WorkProductArtifactService {
  private readonly sourceReader: WorkProductArtifactSourceReader;
  private readonly maxArtifactBytes: number;
  private readonly registrationLocks = new Map<string, Promise<void>>();

  constructor(private readonly options: WorkProductArtifactServiceOptions) {
    this.sourceReader = options.sourceReader ?? new SecureWorkProductArtifactSourceReader();
    this.maxArtifactBytes = options.maxArtifactBytes ?? DEFAULT_MAX_ARTIFACT_BYTES;
  }

  async register(
    input: RegisterWorkProductArtifactInput
  ): Promise<WorkProductArtifactRegistration> {
    this.validateInput(input);
    const requestIdDigest = digest(`request:${input.requestId}`);
    const productId = input.workProductId ?? deterministicId('wp', input, requestIdDigest);
    return this.withRegistrationLock(`${input.workspaceId}:${productId}`, () =>
      this.registerUnlocked(input, requestIdDigest, productId)
    );
  }

  private async registerUnlocked(
    input: RegisterWorkProductArtifactInput,
    requestIdDigest: string,
    productId: string
  ): Promise<WorkProductArtifactRegistration> {
    const grant = await this.options.resolveGrant(input);
    if (!grant) {
      throw new ForbiddenError('This run was not granted file-backed artifact output.');
    }
    if (!/^sha256:[a-f0-9]{64}$/.test(grant.manifestDigest)) {
      throw new ForbiddenError('Artifact output grant is not bound to a valid launch manifest.');
    }

    const existing = await this.options.workProducts.get(productId);
    if (existing && existing.workspaceId !== input.workspaceId) {
      throw new ForbiddenError('Work product belongs to another workspace.');
    }
    if (existing && existing.kind !== 'file') {
      throw new BadRequestError('Artifact refinement requires an existing file work product.');
    }
    if (existing?.taskId && existing.taskId !== input.taskId) {
      throw new BadRequestError('Artifact refinement cannot move a Work Product between tasks.');
    }
    if (existing) {
      const idempotentVersion = (await this.options.workProducts.listVersions(existing.id)).find(
        (version) =>
          version.render.kind === 'file' &&
          version.render.artifact.requestIdDigest === requestIdDigest
      );
      if (idempotentVersion?.render.kind === 'file') {
        const artifact = idempotentVersion.render.artifact;
        if (
          idempotentVersion.title !== input.title ||
          artifact.taskId !== input.taskId ||
          artifact.runId !== input.runId ||
          artifact.attemptId !== input.attemptId ||
          artifact.producingEventId !== input.producingEventId ||
          artifact.mediaType !== input.mediaType ||
          artifact.safeName !== path.basename(input.relativePath) ||
          artifact.launchManifestDigest !== grant.manifestDigest
        ) {
          throw new BadRequestError(
            'The request ID is already bound to a different artifact registration.'
          );
        }
        await this.appendCreatedEvent(input, idempotentVersion.render.artifact);
        return {
          product: {
            ...existing,
            title: idempotentVersion.title,
            kind: 'file',
            render: idempotentVersion.render,
            version: idempotentVersion.version,
            agent: idempotentVersion.agent,
            model: idempotentVersion.model,
            redaction: idempotentVersion.redaction,
            updatedAt: idempotentVersion.createdAt,
          },
          metadata: idempotentVersion.render.artifact,
        };
      }
    }

    const version = (existing?.version ?? 0) + 1;
    const source = await this.sourceReader.read(
      grant.artifactRoot,
      input.relativePath,
      this.maxArtifactBytes
    );
    const quarantine = this.quarantineDecision(input.mediaType, source.content);
    const metadata: WorkProductArtifactMetadata = {
      schemaVersion: WORK_PRODUCT_ARTIFACT_SCHEMA_VERSION,
      id: deterministicId('wpa', input, requestIdDigest, productId),
      productId,
      version,
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      runId: input.runId,
      attemptId: input.attemptId,
      producingEventId: input.producingEventId,
      requestIdDigest,
      launchManifestDigest: grant.manifestDigest,
      mediaType: input.mediaType,
      byteSize: source.byteSize,
      sha256: source.sha256,
      safeName: source.safeName,
      state: quarantine ? 'quarantined' : 'available',
      ...(quarantine ? { quarantineReason: quarantine.reason } : {}),
      redaction: quarantine
        ? { state: 'quarantined', reason: quarantine.detail }
        : { state: 'none' },
      createdAt: new Date().toISOString(),
    };
    const stored = await this.options.repository.create(
      metadata,
      quarantine ? null : source.content
    );
    const render: FileWorkProductRender = {
      schemaVersion: 1,
      kind: 'file',
      artifact: stored.metadata,
    };
    const product = existing
      ? await this.options.workProducts.update(existing.id, {
          title: input.title,
          render,
          status: 'active',
          taskId: input.taskId,
          sourceRunId: input.runId,
          redaction: quarantine
            ? {
                level: 'strict',
                containsSensitiveContent: true,
                notes: [quarantine.detail],
                exportDefault: 'redacted',
              }
            : { level: 'none', exportDefault: 'full' },
          metadata: this.productMetadata(stored.metadata),
          changeType: 'regenerate',
          changeSummary: `Registered ${stored.metadata.safeName}`,
        })
      : await this.options.workProducts.create(
          {
            kind: 'file',
            title: input.title,
            render,
            workspaceId: input.workspaceId,
            taskId: input.taskId,
            sourceRunId: input.runId,
            redaction: quarantine
              ? {
                  level: 'strict',
                  containsSensitiveContent: true,
                  notes: [quarantine.detail],
                  exportDefault: 'redacted',
                }
              : { level: 'none', exportDefault: 'full' },
            metadata: this.productMetadata(stored.metadata),
            changeSummary: `Registered ${stored.metadata.safeName}`,
          },
          { id: productId }
        );
    if (!product) throw new NotFoundError('Work product disappeared during artifact registration.');

    await this.appendCreatedEvent(input, stored.metadata);
    return { product, metadata: stored.metadata };
  }

  async download(input: {
    workspaceId: string;
    productId: string;
    version?: number;
  }): Promise<WorkProductArtifactDownload | null> {
    const product = await this.options.workProducts.get(input.productId);
    if (!product) return null;
    if (product.workspaceId !== input.workspaceId) {
      throw new ForbiddenError('Work product belongs to another workspace.');
    }
    const version = input.version ?? product.version;
    const render =
      version === product.version
        ? product.render
        : (await this.options.workProducts.listVersions(product.id)).find(
            (candidate) => candidate.version === version
          )?.render;
    if (!render || render.kind !== 'file') return null;
    const metadata = render.artifact;
    if (metadata.state !== 'available') return null;
    return this.options.repository.read({
      workspaceId: metadata.workspaceId,
      productId: metadata.productId,
      version: metadata.version,
      artifactId: metadata.id,
    });
  }

  async inspect(input: { workspaceId: string; productId: string }): Promise<WorkProduct | null> {
    const product = await this.options.workProducts.get(input.productId);
    if (!product || product.kind !== 'file') return null;
    if (product.workspaceId !== input.workspaceId) {
      throw new ForbiddenError('Work product belongs to another workspace.');
    }
    return product;
  }

  async list(input: {
    workspaceId: string;
    taskId?: string;
    sourceRunId?: string;
    includeArchived?: boolean;
    limit?: number;
  }): Promise<WorkProduct[]> {
    const products = await this.options.workProducts.list({
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      sourceRunId: input.sourceRunId,
      kind: 'file',
      includeArchived: input.includeArchived,
      limit: input.limit,
    });
    return products.filter((product) => product.workspaceId === input.workspaceId);
  }

  async listVersions(input: {
    workspaceId: string;
    productId: string;
  }): Promise<WorkProductArtifactMetadata[]> {
    const product = await this.options.workProducts.get(input.productId);
    if (!product) throw new NotFoundError('Work product not found');
    if (product.workspaceId !== input.workspaceId) {
      throw new ForbiddenError('Work product belongs to another workspace.');
    }
    const artifacts = (await this.options.workProducts.listVersions(input.productId))
      .filter((version) => version.render.kind === 'file')
      .map((version) => (version.render as FileWorkProductRender).artifact);
    return Array.from(new Map(artifacts.map((artifact) => [artifact.id, artifact])).values());
  }

  async purge(input: {
    workspaceId: string;
    productId: string;
    confirmation: string;
  }): Promise<WorkProductArtifactPurgeResult> {
    return this.withRegistrationLock(`${input.workspaceId}:${input.productId}`, async () => {
      const product = await this.options.workProducts.get(input.productId);
      if (!product || product.kind !== 'file')
        throw new NotFoundError('File work product not found');
      if (product.workspaceId !== input.workspaceId) {
        throw new ForbiddenError('Work product belongs to another workspace.');
      }
      if (product.status !== 'archived') {
        throw new BadRequestError('Only archived file Work Products can be physically purged.');
      }
      if (input.confirmation !== product.id) {
        throw new BadRequestError(
          'Physical purge confirmation must exactly match the Work Product ID.'
        );
      }

      const deleted = await this.options.repository.deleteProduct(input.workspaceId, product.id);
      if (!(await this.options.workProducts.purge(product.id))) {
        throw new NotFoundError('Work product disappeared during physical purge.');
      }
      return { productId: product.id, ...deleted };
    });
  }

  private productMetadata(
    artifact: WorkProductArtifactMetadata
  ): Record<string, string | number | boolean | null> {
    return {
      artifactId: artifact.id,
      mediaType: artifact.mediaType,
      byteSize: artifact.byteSize,
      sha256: artifact.sha256,
      artifactState: artifact.state,
      producingAttemptId: artifact.attemptId,
      producingEventId: artifact.producingEventId,
    };
  }

  private async appendCreatedEvent(
    input: RegisterWorkProductArtifactInput,
    metadata: WorkProductArtifactMetadata
  ): Promise<void> {
    await this.options.events.append({
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      attemptId: input.attemptId,
      causalEventId: input.producingEventId,
      kind: 'artifact.created',
      source: { provider: 'system', adapter: 'work-product-artifact/v1' },
      payload: {
        artifactId: metadata.id,
        workProductId: metadata.productId,
        version: metadata.version,
        mediaType: metadata.mediaType,
        byteSize: metadata.byteSize,
        sha256: metadata.sha256,
        safeName: metadata.safeName,
        state: metadata.state,
      },
      dedupeKey: `work-product-artifact:${metadata.requestIdDigest}`,
    });
  }

  private quarantineDecision(
    mediaType: string,
    content: Uint8Array
  ): { reason: 'content-policy' | 'secret-validation'; detail: string } | undefined {
    const normalizedMediaType = mediaType.toLowerCase().split(';', 1)[0]?.trim() ?? '';
    if (EXECUTABLE_MEDIA_TYPES.has(normalizedMediaType) || looksExecutable(content)) {
      return {
        reason: 'content-policy',
        detail: `Executable artifact content is not publishable as ${normalizedMediaType || 'an unknown media type'}.`,
      };
    }
    const text = Buffer.from(content).toString('utf8');
    if (redactRunOutputText(text) !== text) {
      return {
        reason: 'secret-validation',
        detail: 'Artifact content matched a protected secret pattern.',
      };
    }
    return undefined;
  }

  private validateInput(input: RegisterWorkProductArtifactInput): void {
    for (const [field, value] of Object.entries({
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      runId: input.runId,
      attemptId: input.attemptId,
      requestId: input.requestId,
      producingEventId: input.producingEventId,
      relativePath: input.relativePath,
      title: input.title,
      mediaType: input.mediaType,
    })) {
      if (typeof value !== 'string' || !value.trim() || value.length > 1_000) {
        throw new BadRequestError(`${field} must be a non-empty bounded string.`);
      }
    }
    if (path.isAbsolute(input.relativePath)) {
      throw new BadRequestError('Artifact path must remain inside the granted artifact root.');
    }
    const segments = input.relativePath.split(/[\\/]+/);
    if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
      throw new BadRequestError('Artifact path contains an invalid path segment.');
    }
    try {
      for (const segment of segments) {
        if (
          [...segment].some((character) => {
            const codePoint = character.codePointAt(0) ?? 0;
            return codePoint < 32 || codePoint === 127;
          })
        ) {
          throw new BadRequestError('Artifact path contains control characters.');
        }
        validatePathSegment(segment);
      }
    } catch (error) {
      if (error instanceof BadRequestError) throw error;
      throw new BadRequestError('Artifact path contains an invalid path segment.');
    }
  }

  private async withRegistrationLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.registrationLocks.get(key) ?? Promise.resolve();
    let release = () => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.registrationLocks.set(key, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.registrationLocks.get(key) === tail) this.registrationLocks.delete(key);
    }
  }
}

function looksExecutable(content: Uint8Array): boolean {
  if (content.byteLength >= 4) {
    const magic = Buffer.from(content.buffer, content.byteOffset, 4).readUInt32BE(0);
    if (
      magic === 0x7f454c46 ||
      magic === 0xfeedface ||
      magic === 0xfeedfacf ||
      magic === 0xcefaedfe ||
      magic === 0xcffaedfe ||
      magic === 0xcafebabe ||
      magic === 0xbebafeca
    ) {
      return true;
    }
  }
  return content.byteLength >= 2 && content[0] === 0x4d && content[1] === 0x5a;
}

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function deterministicId(
  prefix: 'wp' | 'wpa',
  input: WorkProductArtifactScope,
  requestIdDigest: string,
  productId?: string
): string {
  const identity = [
    prefix,
    input.taskId,
    input.runId,
    input.attemptId,
    productId ?? '',
    requestIdDigest,
  ].join('\0');
  return `${prefix}_${createHash('sha256').update(identity).digest('base64url').slice(0, 24)}`;
}

export async function resolveWorkProductArtifactGrant(
  scope: WorkProductArtifactScope
): Promise<WorkProductArtifactGrant | null> {
  const task = await getTaskService().getTask(scope.taskId);
  if (!task) return null;
  const attempt = [task.attempt, ...(task.attempts ?? [])].find(
    (candidate) => candidate?.id === scope.attemptId
  );
  if (attempt?.status !== 'running' || !attempt.runLaunchManifest) return null;
  const manifest = parseRunLaunchManifest(attempt.runLaunchManifest);
  if (manifest.taskId !== scope.taskId || manifest.attemptId !== scope.attemptId) return null;
  const directories = runSandboxDirectories(scope.taskId, scope.attemptId);
  const artifactRootDigest = digestSandboxPath(directories.artifactPath);
  const granted = manifest.sandbox.filesystem?.roots.some(
    (root) =>
      root.scope === 'run-artifact' &&
      root.access === 'write' &&
      root.pathDigest === artifactRootDigest
  );
  if (!granted || !manifest.enforcement.enforceable) return null;
  return { artifactRoot: directories.artifactPath, manifestDigest: manifest.digest };
}

let workProductArtifactService: WorkProductArtifactService | undefined;

export function getWorkProductArtifactService(): WorkProductArtifactService {
  workProductArtifactService ??= new WorkProductArtifactService({
    repository:
      getStorageTypeFromEnv() === 'sqlite'
        ? getStorage().workProductArtifacts
        : new FileWorkProductArtifactRepository(),
    workProducts: getWorkProductService(),
    events: getRunEventJournalService(),
    resolveGrant: resolveWorkProductArtifactGrant,
  });
  return workProductArtifactService;
}

export function resetWorkProductArtifactServiceForTests(): void {
  workProductArtifactService = undefined;
}
