import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  FilesystemSandboxBackendStatus,
  SandboxPolicyDryRunResult,
  SandboxPolicyPreset,
} from '@veritas-kanban/shared';
import {
  FilesystemSandboxService,
  resetFilesystemSandboxServiceForTests,
  type FilesystemSandboxCommandRunner,
} from '../services/filesystem-sandbox-service.js';
import {
  inspectGitMetadataRoots,
  removeRunSandboxDirectory,
  runSandboxDirectories,
} from '../utils/filesystem-sandbox-runtime.js';

const roots: string[] = [];
const SHA = `sha256:${'a'.repeat(64)}`;

afterEach(async () => {
  resetFilesystemSandboxServiceForTests();
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function preset(overrides: Partial<SandboxPolicyPreset> = {}): SandboxPolicyPreset {
  return {
    id: 'required-contained',
    name: 'Required contained',
    enabled: true,
    enforcement: 'required',
    requiredCapabilities: [],
    filesystem: {
      readPaths: ['<workspace>'],
      writePaths: ['<workspace>'],
      deniedPaths: ['~/.ssh'],
      dotfileMasking: true,
      localOnlyHandles: true,
    },
    network: {
      defaultEgress: 'deny',
      allowedHosts: [],
      allowedMethods: [],
      allowedPathPrefixes: [],
      blockPrivateNetwork: true,
      blockMetadataEndpoints: true,
      blockLoopback: true,
    },
    environment: {
      passthrough: ['PATH'],
      redactDisplay: true,
    },
    credentials: {
      mode: 'none',
      brokerRefs: [],
    },
    createdAt: '2026-07-25T00:00:00.000Z',
    updatedAt: '2026-07-25T00:00:00.000Z',
    ...overrides,
  };
}

function policy(
  backend: FilesystemSandboxBackendStatus,
  policyPreset = preset()
): SandboxPolicyDryRunResult {
  return {
    decision: 'allow',
    preset: policyPreset,
    provider: 'codex-cli',
    effective: {
      sandboxMode: 'workspace-write',
      networkAccessEnabled: false,
      envPassthrough: ['PATH'],
      credentialRefs: [],
      filesystemBackend: backend,
    },
    evaluations: [],
    unsupportedRules: [],
    warnings: [],
  };
}

function nativeBackend(): FilesystemSandboxBackendStatus {
  return {
    backend: 'provider-native',
    state: 'native',
    capabilityVersion: 'provider-runtime-manifest/v1@15',
    backendVersion: '1.0.0',
    platformBackend: 'provider-native',
    supported: [
      'filesystem.read',
      'filesystem.write',
      'filesystem.deny-paths',
      'filesystem.dotfile-masking',
      'filesystem.protected-metadata',
      'filesystem.descendants',
      'filesystem.run-scoped-temp',
      'filesystem.cleanup',
    ],
    reason: 'Fixture native evidence.',
  };
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-fs-service-test-'));
  roots.push(root);
  const workspace = path.join(root, 'workspace');
  const outside = path.join(root, 'outside');
  const bin = path.join(root, 'bin');
  const executable = path.join(bin, 'codex');
  const providerExecutable = path.join(bin, 'provider');
  await fs.mkdir(path.join(workspace, '.git'), { recursive: true });
  await fs.mkdir(outside, { recursive: true });
  await fs.mkdir(bin, { recursive: true });
  await fs.writeFile(executable, '#!/bin/sh\nexit 0\n', 'utf8');
  await fs.writeFile(providerExecutable, '#!/bin/sh\nexit 0\n', 'utf8');
  await fs.chmod(executable, 0o755);
  await fs.chmod(providerExecutable, 0o755);
  return { root, workspace, outside, bin, executable, providerExecutable };
}

function conformantRunner(): FilesystemSandboxCommandRunner {
  return vi.fn(async (_command, args) => {
    if (args[0] === '--version') return { stdout: 'codex-cli 0.145.0\n', stderr: '' };
    if (args[0] === 'sandbox' && args[1] === '--help') {
      return {
        stdout: '--sandbox-state-json JSON\n--sandbox-state-disable-network\n',
        stderr: '',
      };
    }
    if (args[0] === 'sandbox') return { stdout: '', stderr: '' };
    throw new Error(`Unexpected command: ${args.join(' ')}`);
  });
}

describe('FilesystemSandboxService', () => {
  it('rejects a symbolic linked-worktree common-directory pointer', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-sandbox-git-metadata-'));
    roots.push(root);
    const workspace = path.join(root, 'workspace');
    const gitDirectory = path.join(root, 'git-directory');
    const commonDirectory = path.join(root, 'common-directory');
    await fs.mkdir(workspace);
    await fs.mkdir(gitDirectory);
    await fs.mkdir(commonDirectory);
    await fs.writeFile(path.join(workspace, '.git'), `gitdir: ${gitDirectory}\n`, 'utf8');
    await fs.symlink(commonDirectory, path.join(gitDirectory, 'commondir'));

    await expect(inspectGitMetadataRoots(workspace)).rejects.toThrow(
      'Filesystem metadata pointer must be a regular file.'
    );
  });

  it.each([
    ['darwin', 'seatbelt'],
    ['linux', 'landlock-bubblewrap'],
    ['win32', 'restricted-token'],
  ] as const)(
    'reports the shared enforcement contract for the %s backend',
    async (platform, platformBackend) => {
      const test = await fixture();
      const service = new FilesystemSandboxService({
        command: test.executable,
        platform,
        environment: { PATH: test.bin },
        runCommand: conformantRunner(),
        mountPoints: async () => [],
        gitIdentity: async () => ({}),
      });

      await expect(service.probe('codex-cli')).resolves.toMatchObject({
        backend: 'codex-sandbox',
        state: 'available',
        platformBackend,
        supported: expect.arrayContaining([
          'filesystem.read',
          'filesystem.write',
          'filesystem.deny-paths',
          'filesystem.dotfile-masking',
          'filesystem.protected-metadata',
          'filesystem.descendants',
          'filesystem.run-scoped-temp',
          'filesystem.cleanup',
        ]),
      });
    }
  );

  it('compiles one redacted wrapper plan with deny precedence, dotfile masking, and run directories', async () => {
    const test = await fixture();
    vi.stubEnv('VERITAS_DATA_DIR', test.root);
    await fs.symlink(test.outside, path.join(test.workspace, 'linked'));
    const runCommand = conformantRunner();
    const service = new FilesystemSandboxService({
      command: test.executable,
      platform: 'darwin',
      environment: { PATH: test.bin },
      runCommand,
      mountPoints: async () => [],
      gitIdentity: async () => ({}),
    });
    const backend = await service.probe('codex-cli');
    expect(backend).toMatchObject({
      backend: 'codex-sandbox',
      state: 'available',
      platformBackend: 'seatbelt',
      backendVersion: '0.145.0',
      capabilityVersion: 'codex-sandbox-state/v0.145.0+vk.2',
      supported: expect.arrayContaining([
        'filesystem.protected-metadata',
        'filesystem.descendants',
        'filesystem.run-scoped-temp',
        'filesystem.cleanup',
      ]),
    });

    const plan = await service.compile({
      taskId: 'task-862',
      attemptId: 'attempt-862',
      provider: 'codex-cli',
      workspacePath: test.workspace,
      providerRuntimeManifestDigest: SHA,
      providerCommand: 'provider',
      sandboxPolicy: policy(
        backend,
        preset({
          filesystem: {
            readPaths: ['<workspace>'],
            writePaths: ['<workspace>'],
            deniedPaths: [path.join(test.outside, 'denied')],
            dotfileMasking: true,
            localOnlyHandles: true,
          },
        })
      ),
    });

    expect(JSON.stringify(plan.evidence)).not.toContain(test.root);
    expect(plan.evidence).toMatchObject({
      providerRuntimeManifestDigest: SHA,
      backend: 'codex-sandbox',
      state: 'enforced',
      backendExecutableDigest: backend.backendExecutableDigest,
      descendantsEnforced: true,
      cleanupOwner: 'run-supervisor',
      protectedPaths: ['.agents', '.codex', '.git', '.veritas-kanban'],
    });
    expect(plan.evidence.roots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ access: 'deny' }),
        expect.objectContaining({ access: 'protected' }),
        expect.objectContaining({ scope: 'run-temp', access: 'write' }),
        expect.objectContaining({ scope: 'run-cache', access: 'write' }),
        expect.objectContaining({ scope: 'platform-runtime', access: 'read' }),
      ])
    );

    const wrapped = service.wrap(plan, 'provider', ['--flag'], test.workspace);
    expect(wrapped.command).toBe(await fs.realpath(test.executable));
    expect(wrapped.args.slice(0, 3)).toEqual([
      'sandbox',
      '--sandbox-state-json',
      expect.any(String),
    ]);
    expect(wrapped.args.slice(-2)).toEqual(['provider', '--flag']);
    const state = JSON.parse(wrapped.args[2]) as {
      permissionProfile: {
        file_system: {
          entries: Array<{
            path: { type: string; path?: string; pattern?: string };
            access: string;
          }>;
        };
      };
    };
    expect(state.permissionProfile.file_system.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: expect.objectContaining({ type: 'path', path: await fs.realpath(test.bin) }),
          access: 'read',
        }),
        expect.objectContaining({
          path: expect.objectContaining({ type: 'path', path: await fs.realpath(test.workspace) }),
          access: 'write',
        }),
        expect.objectContaining({
          path: expect.objectContaining({
            type: 'path',
            path: path.join(await fs.realpath(test.workspace), '.veritas-kanban'),
          }),
          access: 'read',
        }),
        expect.objectContaining({
          path: expect.objectContaining({ type: 'glob_pattern' }),
          access: 'deny',
        }),
      ])
    );

    await service.activate(plan);
    await expect(fs.stat(plan.directories?.tempPath ?? '')).resolves.toBeDefined();
    await service.cleanup(plan);
    await expect(fs.stat(plan.directories?.rootPath ?? '')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('revalidates the sandbox executable bytes immediately before activation', async () => {
    const test = await fixture();
    vi.stubEnv('VERITAS_DATA_DIR', test.root);
    const service = new FilesystemSandboxService({
      command: test.executable,
      platform: 'darwin',
      environment: { PATH: test.bin },
      runCommand: conformantRunner(),
      mountPoints: async () => [],
      gitIdentity: async () => ({}),
    });
    const backend = await service.probe('codex-cli');
    const plan = await service.compile({
      taskId: 'task-862-executable',
      attemptId: 'attempt-862-executable',
      provider: 'codex-cli',
      workspacePath: test.workspace,
      providerRuntimeManifestDigest: SHA,
      sandboxPolicy: policy(backend),
    });
    const originalStat = await fs.stat(test.executable);
    const original = await fs.readFile(test.executable, 'utf8');
    await fs.writeFile(test.executable, original.replace('exit 0', 'exit 1'), 'utf8');
    await fs.utimes(test.executable, originalStat.atime, originalStat.mtime);

    await expect(service.activate(plan)).rejects.toThrow(
      'Filesystem sandbox executable changed after launch manifest compilation'
    );
    await expect(fs.stat(plan.directories?.rootPath ?? '')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('rejects executable replacement between policy evaluation and plan compilation', async () => {
    const test = await fixture();
    const service = new FilesystemSandboxService({
      command: test.executable,
      platform: 'darwin',
      environment: { PATH: test.bin },
      runCommand: conformantRunner(),
      mountPoints: async () => [],
      gitIdentity: async () => ({}),
    });
    const backend = await service.probe('codex-cli');
    const originalStat = await fs.stat(test.executable);
    const original = await fs.readFile(test.executable, 'utf8');
    await fs.writeFile(test.executable, original.replace('exit 0', 'exit 1'), 'utf8');
    await fs.utimes(test.executable, originalStat.atime, originalStat.mtime);

    await expect(
      service.compile({
        taskId: 'task-862-executable-policy',
        attemptId: 'attempt-862-executable-policy',
        provider: 'codex-cli',
        workspacePath: test.workspace,
        providerRuntimeManifestDigest: SHA,
        sandboxPolicy: policy(backend),
      })
    ).rejects.toThrow('Filesystem sandbox backend changed after policy evaluation');
  });

  it('keeps the legacy permissive preset advisory instead of narrowing it with a wrapper', async () => {
    const test = await fixture();
    const service = new FilesystemSandboxService({
      command: test.executable,
      platform: 'darwin',
      environment: { PATH: test.bin },
      runCommand: conformantRunner(),
      mountPoints: async () => [],
      gitIdentity: async () => ({}),
    });
    const backend = await service.probe('codex-cli');
    const plan = await service.compile({
      taskId: 'task-862-legacy',
      attemptId: 'attempt-862-legacy',
      provider: 'codex-cli',
      workspacePath: test.workspace,
      providerRuntimeManifestDigest: SHA,
      sandboxPolicy: policy(
        backend,
        preset({
          id: 'legacy-permissive',
          enforcement: 'advisory',
          filesystem: {
            readPaths: ['<workspace>'],
            writePaths: ['<workspace>'],
            deniedPaths: [],
            dotfileMasking: false,
            localOnlyHandles: false,
          },
        })
      ),
    });

    expect(plan.wrapper).toBeUndefined();
    expect(plan.directories).toBeUndefined();
    expect(plan.environment).toEqual({});
    expect(plan.evidence).toMatchObject({
      backend: 'none',
      state: 'advisory',
      cleanupOwner: 'none',
      descendantsEnforced: false,
    });
  });

  it('fails closed on workspace-relative traversal and symlink aliases', async () => {
    const test = await fixture();
    await fs.symlink(test.outside, path.join(test.workspace, 'linked'));
    const service = new FilesystemSandboxService({
      command: test.executable,
      platform: 'darwin',
      environment: { PATH: test.bin },
      runCommand: conformantRunner(),
      mountPoints: async () => [],
      gitIdentity: async () => ({}),
    });
    const backend = await service.probe('codex-cli');
    const compile = (writePath: string) =>
      service.compile({
        taskId: 'task-862',
        attemptId: 'attempt-862',
        provider: 'codex-cli',
        workspacePath: test.workspace,
        providerRuntimeManifestDigest: SHA,
        sandboxPolicy: policy(
          backend,
          preset({
            filesystem: {
              readPaths: ['<workspace>'],
              writePaths: [writePath],
              deniedPaths: [],
              dotfileMasking: false,
              localOnlyHandles: true,
            },
          })
        ),
      });

    await expect(compile('<workspace>/../outside')).rejects.toThrow('outside the base directory');
    await expect(compile('<workspace>/linked')).rejects.toThrow('outside the base directory');
    await expect(compile('<workspace>/.git')).rejects.toThrow(
      'Protected repository metadata cannot be a writable policy root'
    );
    await expect(compile('<workspace>/.veritas-kanban')).rejects.toThrow(
      'Protected repository metadata cannot be a writable policy root'
    );
    await expect(compile('<workspace>/nested/.git/objects')).rejects.toThrow(
      'Protected repository metadata cannot be a writable policy root'
    );
  });

  it('rejects protected metadata symlinks at compilation and activation', async () => {
    const test = await fixture();
    vi.stubEnv('VERITAS_DATA_DIR', test.root);
    const service = new FilesystemSandboxService({
      command: test.executable,
      platform: 'darwin',
      environment: { PATH: test.bin },
      runCommand: conformantRunner(),
      mountPoints: async () => [],
      gitIdentity: async () => ({}),
    });
    const backend = await service.probe('codex-cli');
    const compile = (attemptId: string) =>
      service.compile({
        taskId: 'task-862-protected-link',
        attemptId,
        provider: 'codex-cli',
        workspacePath: test.workspace,
        providerRuntimeManifestDigest: SHA,
        sandboxPolicy: policy(backend),
      });
    const protectedLink = path.join(test.workspace, '.agents');
    await fs.symlink(test.outside, protectedLink);

    await expect(compile('attempt-862-protected-link-existing')).rejects.toThrow(
      'Protected repository metadata cannot be a symbolic link'
    );

    await fs.unlink(protectedLink);
    const plan = await compile('attempt-862-protected-link-late');
    await fs.symlink(test.outside, protectedLink);
    await expect(service.activate(plan)).rejects.toThrow(
      'Protected repository metadata cannot be a symbolic link'
    );
  });

  it('denies nested mounts and rejects mount topology drift before activation', async () => {
    const test = await fixture();
    const mounted = path.join(test.workspace, 'mounted-volume');
    const laterMount = path.join(test.workspace, 'later-volume');
    await fs.mkdir(mounted);
    await fs.mkdir(laterMount);
    let mountPoints = [mounted];
    const service = new FilesystemSandboxService({
      command: test.executable,
      platform: 'darwin',
      environment: { PATH: test.bin },
      runCommand: conformantRunner(),
      mountPoints: async () => mountPoints,
      gitIdentity: async () => ({}),
    });
    const backend = await service.probe('codex-cli');
    const plan = await service.compile({
      taskId: 'task-862',
      attemptId: 'attempt-862',
      provider: 'codex-cli',
      workspacePath: test.workspace,
      providerRuntimeManifestDigest: SHA,
      providerCommand: 'provider',
      sandboxPolicy: policy(backend),
    });
    const state = JSON.parse(plan.wrapper?.sandboxStateJson ?? '{}') as {
      permissionProfile: {
        file_system: {
          entries: Array<{
            path: { type: string; path?: string };
            access: string;
          }>;
        };
      };
    };
    expect(state.permissionProfile.file_system.entries).toContainEqual({
      path: { type: 'path', path: await fs.realpath(mounted) },
      access: 'deny',
    });
    expect(plan.evidence.roots).toEqual(
      expect.arrayContaining([expect.objectContaining({ access: 'deny', scope: 'absolute' })])
    );

    mountPoints = [mounted, laterMount];
    await expect(service.activate(plan)).rejects.toThrow('mount topology changed');
    await expect(fs.stat(plan.directories?.rootPath ?? '')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('binds narrow Node package and Python virtual-environment roots for CLI launchers', async () => {
    const test = await fixture();
    const nodePackageRoot = path.join(test.root, 'lib', 'node_modules', '@vendor', 'agent-cli');
    const nodeLauncher = path.join(nodePackageRoot, 'bin', 'agent.js');
    const venvRoot = path.join(test.root, 'tools', 'hermes');
    const venvLauncher = path.join(venvRoot, 'bin', 'hermes');
    await fs.mkdir(path.dirname(nodeLauncher), { recursive: true });
    await fs.mkdir(path.dirname(venvLauncher), { recursive: true });
    await fs.writeFile(nodeLauncher, '#!/bin/sh\nexit 0\n', 'utf8');
    await fs.writeFile(venvLauncher, '#!/bin/sh\nexit 0\n', 'utf8');
    await fs.writeFile(path.join(venvRoot, 'pyvenv.cfg'), 'home = /usr/bin\n', 'utf8');
    await fs.chmod(nodeLauncher, 0o755);
    await fs.chmod(venvLauncher, 0o755);
    const service = new FilesystemSandboxService({
      command: test.executable,
      platform: 'darwin',
      environment: { PATH: test.bin },
      runCommand: conformantRunner(),
      mountPoints: async () => [],
      gitIdentity: async () => ({}),
    });
    const backend = await service.probe('codex-cli');

    for (const [providerCommand, expectedRoot, sequence] of [
      [nodeLauncher, nodePackageRoot, 'node'],
      [venvLauncher, venvRoot, 'venv'],
    ] as const) {
      const plan = await service.compile({
        taskId: 'task-862',
        attemptId: `attempt-862-${sequence}`,
        provider: 'codex-cli',
        workspacePath: test.workspace,
        providerRuntimeManifestDigest: SHA,
        providerCommand,
        sandboxPolicy: policy(backend),
      });
      const state = JSON.parse(plan.wrapper?.sandboxStateJson ?? '{}') as {
        permissionProfile: {
          file_system: {
            entries: Array<{
              path: { type: string; path?: string };
              access: string;
            }>;
          };
        };
      };
      expect(state.permissionProfile.file_system.entries).toContainEqual({
        path: { type: 'path', path: await fs.realpath(expectedRoot) },
        access: 'read',
      });
    }
  });

  it('blocks hard links that extend beyond writable roots and rechecks before activation', async () => {
    const test = await fixture();
    vi.stubEnv('VERITAS_DATA_DIR', test.root);
    const service = new FilesystemSandboxService({
      command: test.executable,
      platform: 'darwin',
      environment: { PATH: test.bin },
      runCommand: conformantRunner(),
      mountPoints: async () => [],
      gitIdentity: async () => ({}),
    });
    const backend = await service.probe('codex-cli');
    const outsideTarget = path.join(test.outside, 'outside-target.txt');
    const externalAlias = path.join(test.workspace, 'external-alias.txt');
    await fs.writeFile(outsideTarget, 'outside', 'utf8');
    await fs.link(outsideTarget, externalAlias);

    await expect(
      service.compile({
        taskId: 'task-862-hard-link',
        attemptId: 'attempt-862-external',
        provider: 'codex-cli',
        workspacePath: test.workspace,
        providerRuntimeManifestDigest: SHA,
        sandboxPolicy: policy(
          backend,
          preset({
            filesystem: {
              readPaths: ['<workspace>'],
              writePaths: ['<workspace>'],
              deniedPaths: [test.outside],
              dotfileMasking: false,
              localOnlyHandles: true,
            },
          })
        ),
      })
    ).rejects.toThrow('hard links that extend outside the writable boundary');

    await fs.unlink(externalAlias);
    const internalTarget = path.join(test.workspace, 'internal-target.txt');
    const internalAlias = path.join(test.workspace, 'internal-alias.txt');
    await fs.writeFile(internalTarget, 'inside', 'utf8');
    await fs.link(internalTarget, internalAlias);
    const plan = await service.compile({
      taskId: 'task-862-hard-link',
      attemptId: 'attempt-862-internal',
      provider: 'codex-cli',
      workspacePath: test.workspace,
      providerRuntimeManifestDigest: SHA,
      sandboxPolicy: policy(
        backend,
        preset({
          filesystem: {
            readPaths: ['<workspace>'],
            writePaths: ['<workspace>'],
            deniedPaths: [test.outside],
            dotfileMasking: false,
            localOnlyHandles: true,
          },
        })
      ),
    });

    const lateOutsideTarget = path.join(test.outside, 'late-outside-target.txt');
    const lateExternalAlias = path.join(test.workspace, 'late-external-alias.txt');
    await fs.writeFile(lateOutsideTarget, 'outside', 'utf8');
    await fs.link(lateOutsideTarget, lateExternalAlias);
    await expect(service.activate(plan)).rejects.toThrow(
      'hard links that extend outside the writable boundary'
    );
    await expect(fs.stat(plan.directories?.rootPath ?? '')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('refuses cleanup through a symlinked sandbox ancestor', async () => {
    const test = await fixture();
    vi.stubEnv('VERITAS_DATA_DIR', test.root);
    const directories = runSandboxDirectories('task-862-cleanup', 'attempt-862-cleanup');
    const sandboxBase = path.join(test.root, '.veritas-kanban', 'sandboxes');
    const outsideTask = path.join(test.outside, 'task-target');
    const outsideAttempt = path.join(outsideTask, 'attempt-862-cleanup');
    const marker = path.join(outsideAttempt, 'retain.txt');
    await fs.mkdir(outsideAttempt, { recursive: true });
    await fs.writeFile(marker, 'retain', 'utf8');
    await fs.mkdir(sandboxBase, { recursive: true });
    await fs.symlink(outsideTask, path.join(sandboxBase, 'task-862-cleanup'));

    await expect(removeRunSandboxDirectory(directories.rootPath)).rejects.toThrow('symbolic link');
    await expect(fs.readFile(marker, 'utf8')).resolves.toBe('retain');
  });

  it('fails closed when provider-native evidence cannot resolve a nested mount', async () => {
    const test = await fixture();
    const mounted = path.join(test.workspace, 'mounted-volume');
    await fs.mkdir(mounted);
    const service = new FilesystemSandboxService({
      platform: 'darwin',
      mountPoints: async () => [mounted],
      gitIdentity: async () => ({}),
    });
    await expect(
      service.compile({
        taskId: 'task-862',
        attemptId: 'attempt-862',
        provider: 'codex-sdk',
        workspacePath: test.workspace,
        providerRuntimeManifestDigest: SHA,
        sandboxPolicy: policy(nativeBackend()),
      })
    ).rejects.toThrow('cannot resolve nested mount boundaries');
  });

  it('blocks pre-existing and late external hard links for local provider-native runs', async () => {
    const test = await fixture();
    vi.stubEnv('VERITAS_DATA_DIR', test.root);
    const service = new FilesystemSandboxService({
      platform: 'darwin',
      mountPoints: async () => [],
      gitIdentity: async () => ({}),
    });
    const outsideTarget = path.join(test.outside, 'native-outside-target.txt');
    const externalAlias = path.join(test.workspace, 'native-external-alias.txt');
    await fs.writeFile(outsideTarget, 'outside', 'utf8');
    await fs.link(outsideTarget, externalAlias);

    await expect(
      service.compile({
        taskId: 'task-862-native-hard-link',
        attemptId: 'attempt-862-native-external',
        provider: 'codex-sdk',
        workspacePath: test.workspace,
        providerRuntimeManifestDigest: SHA,
        sandboxPolicy: policy(nativeBackend()),
      })
    ).rejects.toThrow('hard links that extend outside the writable boundary');

    await fs.unlink(externalAlias);
    const plan = await service.compile({
      taskId: 'task-862-native-hard-link',
      attemptId: 'attempt-862-native-late',
      provider: 'codex-sdk',
      workspacePath: test.workspace,
      providerRuntimeManifestDigest: SHA,
      sandboxPolicy: policy(nativeBackend()),
    });
    await fs.link(outsideTarget, externalAlias);

    await expect(service.activate(plan)).rejects.toThrow(
      'hard links that extend outside the writable boundary'
    );
    await expect(fs.stat(plan.directories?.rootPath ?? '')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('gives local provider-native runs supervisor-owned temp, cache, and cleanup roots', async () => {
    const test = await fixture();
    vi.stubEnv('VERITAS_DATA_DIR', test.root);
    const service = new FilesystemSandboxService({
      platform: 'darwin',
      mountPoints: async () => [],
      gitIdentity: async () => ({}),
    });
    const plan = await service.compile({
      taskId: 'task-862-native',
      attemptId: 'attempt-862-native',
      provider: 'codex-sdk',
      workspacePath: test.workspace,
      providerRuntimeManifestDigest: SHA,
      sandboxPolicy: policy(nativeBackend()),
    });

    expect(plan.directories).toBeDefined();
    expect(plan.environment).toMatchObject({
      TMPDIR: plan.directories?.tempPath,
      XDG_CACHE_HOME: plan.directories?.cachePath,
    });
    expect(plan.evidence).toMatchObject({
      backend: 'provider-native',
      cleanupOwner: 'run-supervisor',
      protectedPaths: ['.agents', '.codex', '.git', '.veritas-kanban'],
    });
    expect(plan.evidence.roots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scope: 'run-temp', access: 'write' }),
        expect.objectContaining({ scope: 'run-cache', access: 'write' }),
        expect.objectContaining({ access: 'protected' }),
      ])
    );

    await service.activate(plan);
    await expect(fs.stat(plan.directories?.tempPath ?? '')).resolves.toBeDefined();
    await service.cleanup(plan);
    await expect(fs.stat(plan.directories?.rootPath ?? '')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('requires remote provider-native runs to own their temp and cleanup lifecycle', async () => {
    const test = await fixture();
    const service = new FilesystemSandboxService({
      platform: 'darwin',
      mountPoints: async () => {
        throw new Error('Remote native plans must not inspect host mounts.');
      },
      gitIdentity: async () => ({}),
    });
    const plan = await service.compile({
      taskId: 'task-862-remote-native',
      attemptId: 'attempt-862-remote-native',
      provider: 'openclaw',
      workspacePath: test.workspace,
      providerRuntimeManifestDigest: SHA,
      sandboxPolicy: policy(nativeBackend()),
    });

    expect(plan.directories).toBeUndefined();
    expect(plan.environment).toEqual({});
    expect(plan.evidence).toMatchObject({
      backend: 'provider-native',
      cleanupOwner: 'provider-native',
    });
  });

  it('fails required compilation when the selected local backend is unavailable', async () => {
    const test = await fixture();
    const service = new FilesystemSandboxService({
      command: test.executable,
      platform: 'darwin',
      environment: { PATH: test.bin },
      runCommand: async () => {
        throw new Error('probe unavailable');
      },
      mountPoints: async () => [],
      gitIdentity: async () => ({}),
    });
    const backend = await service.probe('codex-cli');

    await expect(
      service.compile({
        taskId: 'task-862',
        attemptId: 'attempt-862',
        provider: 'codex-cli',
        workspacePath: test.workspace,
        providerRuntimeManifestDigest: SHA,
        sandboxPolicy: policy(backend),
      })
    ).rejects.toThrow('Required filesystem sandbox rules cannot be enforced');
  });

  it('rejects ambiguous relative policy roots before producing launch evidence', async () => {
    const test = await fixture();
    const service = new FilesystemSandboxService({
      command: test.executable,
      platform: 'darwin',
      environment: { PATH: test.bin },
      runCommand: conformantRunner(),
      mountPoints: async () => [],
      gitIdentity: async () => ({}),
    });
    const backend = await service.probe('codex-cli');

    await expect(
      service.compile({
        taskId: 'task-862',
        attemptId: 'attempt-862',
        provider: 'codex-cli',
        workspacePath: test.workspace,
        providerRuntimeManifestDigest: SHA,
        sandboxPolicy: policy(
          backend,
          preset({
            filesystem: {
              readPaths: ['relative/path'],
              writePaths: [],
              deniedPaths: [],
              dotfileMasking: false,
              localOnlyHandles: true,
            },
          })
        ),
      })
    ).rejects.toThrow('must be absolute');
  });

  it.runIf(process.env.VERITAS_RUN_NATIVE_SANDBOX_SMOKE === '1')(
    'passes native conformance and activates a compiled run boundary',
    async () => {
      const test = await fixture();
      vi.stubEnv('VERITAS_DATA_DIR', test.root);
      const primary = path.join(test.root, 'primary');
      const linkedWorktree = path.join(test.root, 'linked-worktree');
      await fs.mkdir(primary);
      execFileSync('git', ['init', '--initial-branch=main', '--quiet'], { cwd: primary });
      execFileSync('git', ['config', 'user.name', 'Veritas Test'], { cwd: primary });
      execFileSync('git', ['config', 'user.email', 'veritas@example.test'], { cwd: primary });
      await fs.writeFile(path.join(primary, 'README.md'), '# sandbox smoke\n', 'utf8');
      execFileSync('git', ['add', 'README.md'], { cwd: primary });
      execFileSync('git', ['commit', '-m', 'test fixture'], { cwd: primary });
      execFileSync('git', ['worktree', 'add', '--quiet', '-b', 'sandbox-smoke', linkedWorktree], {
        cwd: primary,
      });
      const service = new FilesystemSandboxService();
      const status = await service.probe('codex-cli');
      expect(status, status.reason).toMatchObject({
        backend: 'codex-sandbox',
        state: 'available',
      });
      const plan = await service.compile({
        taskId: 'task-862-native',
        attemptId: 'attempt-862-native',
        provider: 'codex-cli',
        workspacePath: linkedWorktree,
        providerRuntimeManifestDigest: SHA,
        providerCommand: 'git',
        sandboxPolicy: policy(
          status,
          preset({
            filesystem: {
              readPaths: ['<workspace>'],
              writePaths: ['<workspace>'],
              deniedPaths: ['~/.ssh'],
              dotfileMasking: false,
              localOnlyHandles: true,
            },
          })
        ),
      });
      await service.activate(plan);
      await expect(fs.stat(plan.directories?.tempPath ?? '')).resolves.toBeDefined();
      const launch = service.wrap(plan, 'git', ['status', '--short'], linkedWorktree);
      expect(
        execFileSync(launch.command, launch.args, {
          cwd: launch.cwd,
          env: { ...process.env, ...launch.environment },
          encoding: 'utf8',
        })
      ).toBe('');
      await service.cleanup(plan);
    }
  );
});
