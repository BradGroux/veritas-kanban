import { createHash, randomUUID } from 'node:crypto';
import { constants, type Dirent } from 'node:fs';
import path from 'node:path';
import { lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import type { DependencyCircuitPersistedState } from '@veritas-kanban/shared';
import { DependencyCircuitPersistedStateSchema } from '../schemas/dependency-circuit-schemas.js';
import { ensureWithinBase } from '../utils/sanitize.js';

const MAX_STATE_BYTES = 512 * 1024;
const MAX_CIRCUITS = 10_000;

export interface DependencyCircuitStateRepository {
  read(key: string): Promise<DependencyCircuitPersistedState | null>;
  list(): Promise<DependencyCircuitPersistedState[]>;
  save(state: DependencyCircuitPersistedState): Promise<void>;
  delete(key: string): Promise<boolean>;
}

export class FileDependencyCircuitStateRepository
  implements DependencyCircuitStateRepository
{
  private readonly directory: string;

  constructor(directory: string) {
    this.directory = path.resolve(directory);
  }

  async read(key: string): Promise<DependencyCircuitPersistedState | null> {
    const filePath = this.pathForKey(key);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_STATE_BYTES) {
        throw new Error('Dependency circuit state is not a bounded regular file.');
      }
      const state = DependencyCircuitPersistedStateSchema.parse(
        JSON.parse(await handle.readFile({ encoding: 'utf8' }))
      );
      if (state.snapshot.key !== key) {
        throw new Error('Dependency circuit state key does not match its requested identity.');
      }
      return state;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return null;
      if (code === 'ELOOP') {
        throw new Error('Dependency circuit state is not a bounded regular file.', {
          cause: error,
        });
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }

  async list(): Promise<DependencyCircuitPersistedState[]> {
    let entries: Dirent[];
    try {
      entries = await readdir(this.directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const candidates = entries.filter((entry) => entry.name.endsWith('.json'));
    if (candidates.length > MAX_CIRCUITS) {
      throw new Error('Dependency circuit state directory exceeded its bounded entry limit.');
    }
    const states: DependencyCircuitPersistedState[] = [];
    for (const entry of candidates.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isFile()) {
        throw new Error('Dependency circuit state directory contains a non-regular state entry.');
      }
      const state = await this.readPath(
        ensureWithinBase(this.directory, path.join(this.directory, entry.name))
      );
      if (this.pathForKey(state.snapshot.key) !== path.join(this.directory, entry.name)) {
        throw new Error('Dependency circuit state filename does not match its circuit key.');
      }
      states.push(state);
    }
    return states;
  }

  async save(input: DependencyCircuitPersistedState): Promise<void> {
    const state = DependencyCircuitPersistedStateSchema.parse(input);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const directoryStat = await lstat(this.directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      throw new Error('Dependency circuit state directory must be a private regular directory.');
    }
    const content = `${JSON.stringify(state)}\n`;
    if (Buffer.byteLength(content, 'utf8') > MAX_STATE_BYTES) {
      throw new Error('Dependency circuit state exceeded its bounded byte limit.');
    }
    const destination = this.pathForKey(state.snapshot.key);
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

  async delete(key: string): Promise<boolean> {
    try {
      await unlink(this.pathForKey(key));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  private async readPath(filePath: string): Promise<DependencyCircuitPersistedState> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_STATE_BYTES) {
        throw new Error('Dependency circuit state is not a bounded regular file.');
      }
      return DependencyCircuitPersistedStateSchema.parse(
        JSON.parse(await handle.readFile({ encoding: 'utf8' }))
      );
    } finally {
      await handle?.close();
    }
  }

  private pathForKey(key: string): string {
    const digest = createHash('sha256').update(key).digest('hex');
    return ensureWithinBase(this.directory, path.join(this.directory, `${digest}.json`));
  }
}

export class InMemoryDependencyCircuitStateRepository
  implements DependencyCircuitStateRepository
{
  private readonly states = new Map<string, DependencyCircuitPersistedState>();

  async read(key: string): Promise<DependencyCircuitPersistedState | null> {
    const state = this.states.get(key);
    return state ? structuredClone(state) : null;
  }

  async list(): Promise<DependencyCircuitPersistedState[]> {
    return [...this.states.values()]
      .sort((left, right) => left.snapshot.key.localeCompare(right.snapshot.key))
      .map((state) => structuredClone(state));
  }

  async save(input: DependencyCircuitPersistedState): Promise<void> {
    const state = DependencyCircuitPersistedStateSchema.parse(input);
    this.states.set(state.snapshot.key, structuredClone(state));
  }

  async delete(key: string): Promise<boolean> {
    return this.states.delete(key);
  }
}
