import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  AgentPermissionService,
  type AgentPermissionConfig,
  type ApprovalRequest,
} from '../services/agent-permission-service.js';
import {
  FileAgentPermissionRepository,
  InMemoryAgentPermissionRepository,
} from '../storage/agent-permission-repository.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, lstat: vi.fn(actual.lstat) };
});

function permission(agentId: string): AgentPermissionConfig {
  return {
    agentId,
    level: 'specialist',
    canCreateTasks: true,
    canDelegate: false,
    canApprove: false,
    autoComplete: true,
    updatedAt: '2026-08-23T20:00:00.000Z',
  };
}

function approval(id: string): ApprovalRequest {
  return {
    id,
    agentId: 'tars',
    action: 'create_task',
    status: 'pending',
    createdAt: '2026-08-23T20:00:00.000Z',
  };
}

describe('FileAgentPermissionRepository', () => {
  let root: string;
  let runtimeDir: string;
  let repository: FileAgentPermissionRepository;

  beforeEach(async () => {
    root = await mkdtemp(path.join(process.cwd(), '.veritas-agent-permission-'));
    runtimeDir = path.join(root, 'runtime');
    repository = new FileAgentPermissionRepository(runtimeDir, []);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('serializes concurrent permission and approval mutations', async () => {
    await expect(repository.readPermissions()).resolves.toEqual([]);
    await expect(repository.readApprovals()).resolves.toEqual([]);
    await Promise.all([
      repository.mutatePermissions((values) => ({
        values: [...values, permission('tars')],
        result: undefined,
      })),
      repository.mutatePermissions((values) => ({
        values: [...values, permission('case')],
        result: undefined,
      })),
      repository.mutateApprovals((values) => ({
        values: [...values, approval('one')],
        result: undefined,
      })),
      repository.mutateApprovals((values) => ({
        values: [...values, approval('two')],
        result: undefined,
      })),
    ]);
    expect((await repository.readPermissions()).map(({ agentId }) => agentId)).toEqual(
      expect.arrayContaining(['tars', 'case'])
    );
    expect((await repository.readApprovals()).map(({ id }) => id)).toEqual(
      expect.arrayContaining(['one', 'two'])
    );
  });

  it('migrates legacy state and tolerates malformed or non-array JSON', async () => {
    const legacyDir = path.join(root, 'legacy');
    await mkdir(legacyDir);
    await writeFile(
      path.join(legacyDir, 'agent-permissions.json'),
      JSON.stringify([permission('legacy')]),
      'utf8'
    );
    await writeFile(
      path.join(legacyDir, 'approval-requests.json'),
      JSON.stringify([approval('legacy')]),
      'utf8'
    );
    const migratingRepository = new FileAgentPermissionRepository(runtimeDir, [legacyDir]);
    await expect(migratingRepository.readPermissions()).resolves.toEqual([permission('legacy')]);
    await expect(migratingRepository.readApprovals()).resolves.toEqual([approval('legacy')]);

    await writeFile(path.join(runtimeDir, 'agent-permissions.json'), '{broken', 'utf8');
    await expect(repository.readPermissions()).resolves.toEqual([]);
    await writeFile(path.join(runtimeDir, 'agent-permissions.json'), '{}', 'utf8');
    await expect(repository.readPermissions()).resolves.toEqual([]);
  });

  it('rejects symbolic links, changed files, and non-file paths', async () => {
    await mkdir(runtimeDir, { recursive: true });
    const stateFile = path.join(runtimeDir, 'agent-permissions.json');
    const target = path.join(root, 'outside.json');
    await writeFile(target, '[]', 'utf8');
    await symlink(target, stateFile);
    await expect(repository.readPermissions()).rejects.toThrow(/symbolic link/i);

    await rm(stateFile);
    await writeFile(stateFile, '[]', 'utf8');
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(lstat).mockImplementationOnce(async (filePath) => {
      const stats = await actual.lstat(filePath);
      return Object.assign(Object.create(Object.getPrototypeOf(stats)), stats, {
        ino: stats.ino + 1,
      });
    });
    await expect(repository.readPermissions()).rejects.toThrow(/changed file/i);

    await rm(stateFile);
    await mkdir(stateFile);
    await expect(repository.readPermissions()).rejects.toThrow(/bounded regular file/i);
  });

  it('rejects symbolic-link directories and oversized state', async () => {
    const realDirectory = path.join(root, 'real-runtime');
    const linkedDirectory = path.join(root, 'linked-runtime');
    await mkdir(realDirectory);
    await symlink(realDirectory, linkedDirectory, 'dir');
    const linkedRepository = new FileAgentPermissionRepository(linkedDirectory, []);
    await expect(
      linkedRepository.mutatePermissions(() => ({ values: [permission('unsafe')], result: null }))
    ).rejects.toThrow(/regular directory/i);

    await expect(
      repository.mutatePermissions(() => ({
        values: [{ ...permission('large'), restrictions: ['x'.repeat(16 * 1024 * 1024)] }],
        result: null,
      }))
    ).rejects.toThrow(/16 MiB/i);
  });
});

describe('AgentPermissionService storage integration', () => {
  it('manages levels, restrictions, and approval requests through the repository', async () => {
    const repository = new InMemoryAgentPermissionRepository();
    const service = new AgentPermissionService(repository);
    await expect(service.getPermissions('TARS')).resolves.toMatchObject({
      agentId: 'tars',
      level: 'specialist',
    });

    await service.setLevel('TARS', 'intern');
    await service.updatePermissions('TARS', { restrictions: ['deploy'] });
    await expect(service.checkPermission('TARS', 'deploy_production')).resolves.toMatchObject({
      allowed: false,
    });
    await expect(service.listPermissions()).resolves.toHaveLength(1);

    const request = await service.requestApproval({ agentId: 'TARS', action: 'create_task' });
    await expect(service.getPendingApprovals({ agentId: 'TARS' })).resolves.toHaveLength(1);
    await expect(service.reviewApproval(request.id, 'approved', 'brad')).resolves.toMatchObject({
      status: 'approved',
      reviewedBy: 'brad',
    });
    await expect(service.getPendingApprovals()).resolves.toEqual([]);
  });
});
