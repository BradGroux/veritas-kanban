import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { WorkProductArtifactMetadata } from '@veritas-kanban/shared';
import { WorkProductArtifactMetadataSchema } from '../schemas/work-product-schemas.js';
import { getRuntimeDir } from '../utils/paths.js';
import { ensureWithinBase, validatePathSegment } from '../utils/sanitize.js';

export interface WorkProductArtifactLookup {
  workspaceId: string;
  productId: string;
  version: number;
  artifactId: string;
}

export interface WorkProductArtifactCreateResult {
  metadata: WorkProductArtifactMetadata;
  created: boolean;
}

export interface WorkProductArtifactDownload {
  metadata: WorkProductArtifactMetadata;
  content: Uint8Array;
}

export interface WorkProductArtifactDeleteResult {
  artifactsDeleted: number;
  bytesDeleted: number;
}

export interface ValidatedWorkProductArtifactSource {
  content: Uint8Array;
  byteSize: number;
  sha256: string;
  safeName: string;
}

export interface WorkProductArtifactRepository {
  create(
    metadata: WorkProductArtifactMetadata,
    content: Uint8Array | null
  ): Promise<WorkProductArtifactCreateResult>;
  get(lookup: WorkProductArtifactLookup): Promise<WorkProductArtifactMetadata | null>;
  read(lookup: WorkProductArtifactLookup): Promise<WorkProductArtifactDownload | null>;
  deleteProduct(workspaceId: string, productId: string): Promise<WorkProductArtifactDeleteResult>;
}

export interface WorkProductArtifactSourceReader {
  read(
    rootPath: string,
    relativePath: string,
    maxBytes: number
  ): Promise<ValidatedWorkProductArtifactSource>;
}

function sha256(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

function sameIdentity(
  left: WorkProductArtifactMetadata,
  right: WorkProductArtifactMetadata
): boolean {
  return (
    left.id === right.id &&
    left.productId === right.productId &&
    left.version === right.version &&
    left.workspaceId === right.workspaceId &&
    left.taskId === right.taskId &&
    left.runId === right.runId &&
    left.attemptId === right.attemptId &&
    left.producingEventId === right.producingEventId &&
    left.requestIdDigest === right.requestIdDigest &&
    left.launchManifestDigest === right.launchManifestDigest &&
    left.mediaType === right.mediaType &&
    left.byteSize === right.byteSize &&
    left.sha256 === right.sha256 &&
    left.safeName === right.safeName &&
    left.state === right.state &&
    left.quarantineReason === right.quarantineReason &&
    left.redaction.state === right.redaction.state &&
    left.redaction.reason === right.redaction.reason &&
    left.expiresAt === right.expiresAt
  );
}

export class SecureWorkProductArtifactSourceReader implements WorkProductArtifactSourceReader {
  async read(
    rootPath: string,
    relativePath: string,
    maxBytes: number
  ): Promise<ValidatedWorkProductArtifactSource> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
      throw new Error('Artifact size limit must be a positive safe integer.');
    }
    if (!relativePath || path.isAbsolute(relativePath)) {
      throw new Error('Artifact path must be relative to the granted artifact root.');
    }
    const segments = relativePath.split(/[\\/]+/);
    if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
      throw new Error('Artifact path contains an invalid path segment.');
    }
    for (const segment of segments) {
      validatePathSegment(segment);
      if (
        [...segment].some((character) => {
          const codePoint = character.codePointAt(0) ?? 0;
          return codePoint < 32 || codePoint === 127;
        })
      ) {
        throw new Error('Artifact path contains control characters.');
      }
    }

    const resolvedRoot = path.resolve(rootPath);
    const sourcePath = ensureWithinBase(resolvedRoot, path.resolve(resolvedRoot, relativePath));
    const canonicalRoot = await realpath(resolvedRoot);
    const handle = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = await handle.stat();
      if (!before.isFile()) throw new Error('Artifact source must be a regular file.');
      if (before.nlink !== 1) {
        throw new Error('Artifact source cannot have external hard-link aliases.');
      }
      const [sourceLstat, canonicalSource] = await Promise.all([
        lstat(sourcePath),
        realpath(sourcePath),
      ]);
      if (sourceLstat.isSymbolicLink() || !sourceLstat.isFile()) {
        throw new Error('Artifact source must be a regular file and cannot be a symbolic link.');
      }
      ensureWithinBase(canonicalRoot, canonicalSource);
      if (before.ino !== sourceLstat.ino || before.dev !== sourceLstat.dev) {
        throw new Error('Artifact source identity changed before registration.');
      }
      if (before.size > maxBytes) {
        throw new Error(`Artifact source exceeds the ${maxBytes}-byte size limit.`);
      }
      const content = Buffer.allocUnsafe(before.size);
      let offset = 0;
      while (offset < content.byteLength) {
        const result = await handle.read(content, offset, content.byteLength - offset, offset);
        if (result.bytesRead < 1) {
          throw new Error('Artifact source changed while it was being registered.');
        }
        offset += result.bytesRead;
      }
      const overflowProbe = Buffer.allocUnsafe(1);
      const overflow = await handle.read(overflowProbe, 0, 1, content.byteLength);
      if (overflow.bytesRead > 0) {
        throw new Error(`Artifact source exceeds the ${maxBytes}-byte size limit.`);
      }
      const after = await handle.stat();
      if (
        content.byteLength !== before.size ||
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs ||
        after.ctimeMs !== before.ctimeMs ||
        after.ino !== before.ino ||
        after.dev !== before.dev
      ) {
        throw new Error('Artifact source changed while it was being registered.');
      }
      return {
        content,
        byteSize: content.byteLength,
        sha256: sha256(content),
        safeName: path.basename(sourcePath),
      };
    } finally {
      await handle.close();
    }
  }
}

export function getWorkProductArtifactsDir(): string {
  return path.join(getRuntimeDir(), 'work-product-artifacts');
}

export class FileWorkProductArtifactRepository implements WorkProductArtifactRepository {
  constructor(private readonly baseDir = getWorkProductArtifactsDir()) {
    ensureWithinBase(path.dirname(baseDir), baseDir);
  }

  async create(
    candidate: WorkProductArtifactMetadata,
    content: Uint8Array | null
  ): Promise<WorkProductArtifactCreateResult> {
    await this.ensureBaseDir();
    const metadata = WorkProductArtifactMetadataSchema.parse(candidate);
    if (metadata.state === 'available' && !content) {
      throw new Error('Available work product artifacts require persisted download bytes.');
    }
    if (metadata.state !== 'available' && content) {
      throw new Error('Quarantined work product artifacts cannot persist download bytes.');
    }
    if (
      content &&
      (content.byteLength !== metadata.byteSize || sha256(content) !== metadata.sha256)
    ) {
      throw new Error('Work product artifact bytes do not match their integrity metadata.');
    }
    const artifactDir = this.artifactPath(this.lookupFor(metadata));
    const existing = await this.get(this.lookupFor(metadata));
    if (existing) {
      if (!sameIdentity(existing, metadata)) {
        throw new Error(`Work product artifact ${metadata.id} has conflicting identity.`);
      }
      if (existing.state === 'available' && !(await this.read(this.lookupFor(existing)))) {
        throw new Error(`Work product artifact ${metadata.id} lost its immutable payload.`);
      }
      return { metadata: existing, created: false };
    }

    const parent = path.dirname(artifactDir);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const temporaryDir = path.join(parent, `.tmp-${metadata.id}-${nanoid(8)}`);
    ensureWithinBase(parent, temporaryDir);
    await mkdir(temporaryDir, { mode: 0o700 });
    try {
      await this.writeExclusive(
        path.join(temporaryDir, 'metadata.json'),
        Buffer.from(JSON.stringify(metadata), 'utf8')
      );
      if (content) await this.writeExclusive(path.join(temporaryDir, 'payload.bin'), content);
      await this.syncDirectory(temporaryDir);
      await rename(temporaryDir, artifactDir);
      await this.syncDirectory(parent);
      return { metadata, created: true };
    } catch (error) {
      const raced = await this.get(this.lookupFor(metadata));
      if (raced && sameIdentity(raced, metadata)) {
        if (raced.state === 'available' && !(await this.read(this.lookupFor(raced)))) throw error;
        return { metadata: raced, created: false };
      }
      throw error;
    } finally {
      await rm(temporaryDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async get(lookup: WorkProductArtifactLookup): Promise<WorkProductArtifactMetadata | null> {
    await this.ensureBaseDir();
    const metadataPath = path.join(this.artifactPath(lookup), 'metadata.json');
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(metadataPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 64 * 1024) {
        throw new Error('Work product artifact metadata is not a bounded regular file.');
      }
      const metadata = WorkProductArtifactMetadataSchema.parse(
        JSON.parse((await this.readStableFile(handle, stat, 'metadata')).toString('utf8'))
      );
      return this.matchesLookup(metadata, lookup) ? metadata : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    } finally {
      await handle?.close();
    }
  }

  async read(lookup: WorkProductArtifactLookup): Promise<WorkProductArtifactDownload | null> {
    const metadata = await this.get(lookup);
    if (!metadata || metadata.state !== 'available') return null;
    const payloadPath = path.join(this.artifactPath(lookup), 'payload.bin');
    const handle = await open(payloadPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size !== metadata.byteSize) {
        throw new Error('Work product artifact payload failed its size integrity check.');
      }
      const content = await this.readStableFile(handle, stat, 'payload');
      if (sha256(content) !== metadata.sha256) {
        throw new Error('Work product artifact payload failed its digest integrity check.');
      }
      return { metadata, content };
    } finally {
      await handle.close();
    }
  }

  async deleteProduct(
    workspaceId: string,
    productId: string
  ): Promise<WorkProductArtifactDeleteResult> {
    await this.ensureBaseDir();
    validatePathSegment(workspaceId);
    validatePathSegment(productId);
    const workspaceDir = ensureWithinBase(this.baseDir, path.join(this.baseDir, workspaceId));
    const productDir = ensureWithinBase(workspaceDir, path.join(workspaceDir, productId));
    try {
      const productStat = await lstat(productDir);
      if (!productStat.isDirectory() || productStat.isSymbolicLink()) {
        throw new Error('Work product artifact storage is not a private regular directory.');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { artifactsDeleted: 0, bytesDeleted: 0 };
      }
      throw error;
    }

    let artifactsDeleted = 0;
    let bytesDeleted = 0;
    for (const versionEntry of await readdir(productDir, { withFileTypes: true })) {
      if (!versionEntry.isDirectory() || versionEntry.isSymbolicLink()) continue;
      const versionDir = ensureWithinBase(productDir, path.join(productDir, versionEntry.name));
      for (const artifactEntry of await readdir(versionDir, { withFileTypes: true })) {
        if (!artifactEntry.isDirectory() || artifactEntry.isSymbolicLink()) continue;
        artifactsDeleted += 1;
        const payloadPath = ensureWithinBase(
          versionDir,
          path.join(versionDir, artifactEntry.name, 'payload.bin')
        );
        try {
          const payloadStat = await lstat(payloadPath);
          if (payloadStat.isFile() && !payloadStat.isSymbolicLink())
            bytesDeleted += payloadStat.size;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
    }

    await rm(productDir, { recursive: true, force: true });
    await this.syncDirectory(workspaceDir);
    return { artifactsDeleted, bytesDeleted };
  }

  private lookupFor(metadata: WorkProductArtifactMetadata): WorkProductArtifactLookup {
    return {
      workspaceId: metadata.workspaceId,
      productId: metadata.productId,
      version: metadata.version,
      artifactId: metadata.id,
    };
  }

  private matchesLookup(
    metadata: WorkProductArtifactMetadata,
    lookup: WorkProductArtifactLookup
  ): boolean {
    return (
      metadata.workspaceId === lookup.workspaceId &&
      metadata.productId === lookup.productId &&
      metadata.version === lookup.version &&
      metadata.id === lookup.artifactId
    );
  }

  private artifactPath(lookup: WorkProductArtifactLookup): string {
    validatePathSegment(lookup.workspaceId);
    validatePathSegment(lookup.productId);
    validatePathSegment(lookup.artifactId);
    if (!Number.isSafeInteger(lookup.version) || lookup.version < 1) {
      throw new Error('Work product artifact version must be a positive safe integer.');
    }
    return ensureWithinBase(
      this.baseDir,
      path.join(
        this.baseDir,
        lookup.workspaceId,
        lookup.productId,
        String(lookup.version),
        lookup.artifactId
      )
    );
  }

  private async ensureBaseDir(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true, mode: 0o700 });
    const baseStat = await lstat(this.baseDir);
    if (!baseStat.isDirectory() || baseStat.isSymbolicLink()) {
      throw new Error('Work product artifact storage must be a regular directory.');
    }
  }

  private async writeExclusive(filePath: string, content: Uint8Array): Promise<void> {
    const handle = await open(
      filePath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600
    );
    try {
      let offset = 0;
      while (offset < content.byteLength) {
        const result = await handle.write(content, offset, content.byteLength - offset, offset);
        if (result.bytesWritten < 1) {
          throw new Error('Work product artifact write made no forward progress.');
        }
        offset += result.bytesWritten;
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  private async readStableFile(
    handle: Awaited<ReturnType<typeof open>>,
    before: {
      size: number;
      ino: number;
      dev: number;
      mtimeMs: number;
      ctimeMs: number;
    },
    label: string
  ): Promise<Buffer> {
    const content = Buffer.allocUnsafe(before.size);
    let offset = 0;
    while (offset < content.byteLength) {
      const result = await handle.read(content, offset, content.byteLength - offset, offset);
      if (result.bytesRead < 1) {
        throw new Error(`Work product artifact ${label} changed during its integrity read.`);
      }
      offset += result.bytesRead;
    }
    const overflowProbe = Buffer.allocUnsafe(1);
    const overflow = await handle.read(overflowProbe, 0, 1, content.byteLength);
    const after = await handle.stat();
    if (
      overflow.bytesRead > 0 ||
      after.size !== before.size ||
      after.ino !== before.ino ||
      after.dev !== before.dev ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    ) {
      throw new Error(`Work product artifact ${label} changed during its integrity read.`);
    }
    return content;
  }

  private async syncDirectory(directoryPath: string): Promise<void> {
    if (process.platform === 'win32') return;
    const handle = await open(directoryPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}
