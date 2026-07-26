import { createHash, randomUUID } from 'node:crypto';
import { constants, type Dirent } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { DependencyCircuitOverride } from '@veritas-kanban/shared';
import { DependencyCircuitOverrideSchema } from '../schemas/dependency-circuit-schemas.js';
import { ensureWithinBase } from '../utils/sanitize.js';

const MAX_OVERRIDE_BYTES = 16 * 1024;
const MAX_OVERRIDES = 10_000;

export interface DependencyCircuitOverrideRepository {
  list(): Promise<DependencyCircuitOverride[]>;
  save(override: DependencyCircuitOverride): Promise<void>;
  delete(circuitKey: string): Promise<boolean>;
}

export class FileDependencyCircuitOverrideRepository
  implements DependencyCircuitOverrideRepository
{
  private readonly directory: string;

  constructor(directory: string) {
    this.directory = path.resolve(directory);
  }

  async list(): Promise<DependencyCircuitOverride[]> {
    let entries: Dirent[];
    try {
      entries = await readdir(this.directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const candidates = entries.filter((entry) => entry.name.endsWith('.json'));
    if (candidates.length > MAX_OVERRIDES) {
      throw new Error('Dependency circuit override directory exceeded its entry limit.');
    }
    const overrides: DependencyCircuitOverride[] = [];
    for (const entry of candidates.sort((left, right) =>
      left.name.localeCompare(right.name)
    )) {
      if (!entry.isFile()) {
        throw new Error('Dependency circuit override directory contains a non-regular entry.');
      }
      const filePath = ensureWithinBase(
        this.directory,
        path.join(this.directory, entry.name)
      );
      const override = await this.readPath(filePath);
      if (filePath !== this.pathForKey(override.circuitKey)) {
        throw new Error('Dependency circuit override filename does not match its circuit key.');
      }
      overrides.push(override);
    }
    return overrides;
  }

  async save(input: DependencyCircuitOverride): Promise<void> {
    const override = DependencyCircuitOverrideSchema.parse(input);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const directoryStat = await lstat(this.directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      throw new Error('Dependency circuit override directory must be a private regular directory.');
    }
    const content = `${JSON.stringify(override)}\n`;
    if (Buffer.byteLength(content, 'utf8') > MAX_OVERRIDE_BYTES) {
      throw new Error('Dependency circuit override exceeded its bounded byte limit.');
    }
    const destination = this.pathForKey(override.circuitKey);
    const temporaryPath = ensureWithinBase(
      this.directory,
      `${destination}.replace-${process.pid}-${randomUUID()}`
    );
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(
        temporaryPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600
      );
      await handle.writeFile(content, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporaryPath, destination);
    } catch (error) {
      await handle?.close().catch(() => {});
      await unlink(temporaryPath).catch(() => {});
      throw error;
    }
  }

  async delete(circuitKey: string): Promise<boolean> {
    try {
      await unlink(this.pathForKey(circuitKey));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  private async readPath(filePath: string): Promise<DependencyCircuitOverride> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_OVERRIDE_BYTES) {
        throw new Error('Dependency circuit override is not a bounded regular file.');
      }
      return DependencyCircuitOverrideSchema.parse(
        JSON.parse(await handle.readFile({ encoding: 'utf8' }))
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
        throw new Error('Dependency circuit override is not a bounded regular file.', {
          cause: error,
        });
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }

  private pathForKey(circuitKey: string): string {
    const digest = createHash('sha256').update(circuitKey).digest('hex');
    return ensureWithinBase(this.directory, path.join(this.directory, `${digest}.json`));
  }
}

export class InMemoryDependencyCircuitOverrideRepository
  implements DependencyCircuitOverrideRepository
{
  private readonly overrides = new Map<string, DependencyCircuitOverride>();

  async list(): Promise<DependencyCircuitOverride[]> {
    return [...this.overrides.values()]
      .sort((left, right) => left.circuitKey.localeCompare(right.circuitKey))
      .map((override) => structuredClone(override));
  }

  async save(input: DependencyCircuitOverride): Promise<void> {
    const override = DependencyCircuitOverrideSchema.parse(input);
    this.overrides.set(override.circuitKey, structuredClone(override));
  }

  async delete(circuitKey: string): Promise<boolean> {
    return this.overrides.delete(circuitKey);
  }
}
