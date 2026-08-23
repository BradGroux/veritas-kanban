import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import type {
  AgentPermissionConfig,
  ApprovalRequest,
} from '../services/agent-permission-service.js';
import { withFileLock } from '../services/file-lock.js';
import { migrateLegacyFiles } from '../utils/migrate-legacy-files.js';
import { getLegacyRuntimeDirs, getRuntimeDir } from '../utils/paths.js';
import { ensureWithinBase } from '../utils/sanitize.js';
import { atomicWriteFile } from './fs-helpers.js';

const MAX_PERMISSION_STATE_BYTES = 16 * 1024 * 1024;

interface RepositoryMutation<T, R> {
  values: T[];
  result: R;
}

export interface AgentPermissionRepository {
  readPermissions(): Promise<AgentPermissionConfig[]>;
  mutatePermissions<T>(
    updater: (permissions: AgentPermissionConfig[]) => RepositoryMutation<AgentPermissionConfig, T>
  ): Promise<T>;
  readApprovals(): Promise<ApprovalRequest[]>;
  mutateApprovals<T>(
    updater: (approvals: ApprovalRequest[]) => RepositoryMutation<ApprovalRequest, T>
  ): Promise<T>;
}

export class FileAgentPermissionRepository implements AgentPermissionRepository {
  private readonly runtimeDir: string;
  private readonly permissionsFile: string;
  private readonly approvalsFile: string;
  private migrationChecked = false;

  constructor(
    runtimeDir = getRuntimeDir(),
    private readonly legacyRuntimeDirs: readonly string[] = getLegacyRuntimeDirs()
  ) {
    this.runtimeDir = path.resolve(runtimeDir);
    this.permissionsFile = ensureWithinBase(
      this.runtimeDir,
      path.join(this.runtimeDir, 'agent-permissions.json')
    );
    this.approvalsFile = ensureWithinBase(
      this.runtimeDir,
      path.join(this.runtimeDir, 'approval-requests.json')
    );
  }

  async readPermissions(): Promise<AgentPermissionConfig[]> {
    await this.ensureMigrated();
    return this.readArray<AgentPermissionConfig>(this.permissionsFile, 'Agent permissions');
  }

  mutatePermissions<T>(
    updater: (permissions: AgentPermissionConfig[]) => RepositoryMutation<AgentPermissionConfig, T>
  ): Promise<T> {
    return this.mutateArray(this.permissionsFile, 'Agent permissions', updater);
  }

  async readApprovals(): Promise<ApprovalRequest[]> {
    await this.ensureMigrated();
    return this.readArray<ApprovalRequest>(this.approvalsFile, 'Approval requests');
  }

  mutateApprovals<T>(
    updater: (approvals: ApprovalRequest[]) => RepositoryMutation<ApprovalRequest, T>
  ): Promise<T> {
    return this.mutateArray(this.approvalsFile, 'Approval requests', updater);
  }

  private async mutateArray<T, R>(
    filePath: string,
    label: string,
    updater: (values: T[]) => RepositoryMutation<T, R>
  ): Promise<R> {
    await this.ensureMigrated();
    await this.prepareDirectory();
    return withFileLock(filePath, async () => {
      const { values, result } = updater(await this.readArray<T>(filePath, label));
      const content = JSON.stringify(values, null, 2);
      if (Buffer.byteLength(content, 'utf8') > MAX_PERMISSION_STATE_BYTES) {
        throw new Error(`${label} exceed the 16 MiB storage limit`);
      }
      await atomicWriteFile(filePath, content, 'utf8');
      return result;
    });
  }

  private async ensureMigrated(): Promise<void> {
    if (this.migrationChecked) return;
    this.migrationChecked = true;
    await migrateLegacyFiles(
      this.legacyRuntimeDirs,
      this.runtimeDir,
      ['agent-permissions.json', 'approval-requests.json'],
      'agent permission'
    );
  }

  private async prepareDirectory(): Promise<void> {
    await mkdir(this.runtimeDir, { recursive: true, mode: 0o700 });
    const stats = await lstat(this.runtimeDir);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error('Agent permission storage path must use a regular directory');
    }
  }

  private async readArray<T>(filePath: string, label: string): Promise<T[]> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const [pathStats, stats] = await Promise.all([lstat(filePath), handle.stat()]);
      if (
        pathStats.isSymbolicLink() ||
        pathStats.dev !== stats.dev ||
        pathStats.ino !== stats.ino
      ) {
        throw new Error(`${label} must not use a symbolic link or changed file`);
      }
      if (!stats.isFile() || stats.size > MAX_PERMISSION_STATE_BYTES) {
        throw new Error(`${label} must use a bounded regular file`);
      }
      const parsed: unknown = JSON.parse(await handle.readFile({ encoding: 'utf8' }));
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode === 'ENOENT' || error instanceof SyntaxError) return [];
      if (errorCode === 'ELOOP') {
        throw new Error(`${label} must not use a symbolic link`, { cause: error });
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }
}

export class InMemoryAgentPermissionRepository implements AgentPermissionRepository {
  private permissions: AgentPermissionConfig[] = [];
  private approvals: ApprovalRequest[] = [];

  async readPermissions(): Promise<AgentPermissionConfig[]> {
    return this.permissions;
  }

  async mutatePermissions<T>(
    updater: (permissions: AgentPermissionConfig[]) => RepositoryMutation<AgentPermissionConfig, T>
  ): Promise<T> {
    const mutation = updater(this.permissions);
    this.permissions = mutation.values;
    return mutation.result;
  }

  async readApprovals(): Promise<ApprovalRequest[]> {
    return this.approvals;
  }

  async mutateApprovals<T>(
    updater: (approvals: ApprovalRequest[]) => RepositoryMutation<ApprovalRequest, T>
  ): Promise<T> {
    const mutation = updater(this.approvals);
    this.approvals = mutation.values;
    return mutation.result;
  }
}
