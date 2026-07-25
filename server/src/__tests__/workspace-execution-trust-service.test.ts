import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  RunLaunchWorkspaceTrust,
  WorkspaceExecutionTrustEvaluation,
} from '@veritas-kanban/shared';
import { InMemoryWorkspaceExecutionTrustRepository } from '../storage/workspace-execution-trust-repository.js';
import {
  WorkspaceExecutionTrustService,
  type WorkspaceExecutionTrustLaunchConstraints,
} from '../services/workspace-execution-trust-service.js';

const execFileAsync = promisify(execFile);
const temporaryRoots: string[] = [];

async function createRepository(name = 'repo'): Promise<string> {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'vk-workspace-trust-'));
  temporaryRoots.push(parent);
  const repository = path.join(parent, name);
  await mkdir(repository);
  await execFileAsync('git', ['init', repository]);
  await execFileAsync('git', [
    '-C',
    repository,
    'remote',
    'add',
    'origin',
    'https://github.com/example/project.git',
  ]);
  return repository;
}

function restrictedConstraints(
  overrides: Partial<WorkspaceExecutionTrustLaunchConstraints> = {}
): WorkspaceExecutionTrustLaunchConstraints {
  return {
    sandboxMode: 'read-only',
    networkAccessEnabled: false,
    taskCredentialReferences: [],
    filesystemEnforcement: 'enforced',
    selectedToolServerCount: 0,
    externalMutationAllowed: false,
    projectExecutableConfigurationBlocked: true,
    ...overrides,
  };
}

function service(repository = new InMemoryWorkspaceExecutionTrustRepository()) {
  return new WorkspaceExecutionTrustService({
    repository,
    audit: async () => {},
    now: () => new Date('2026-07-25T00:00:00.000Z'),
  });
}

function launchTrust(evaluation: WorkspaceExecutionTrustEvaluation): RunLaunchWorkspaceTrust {
  return {
    schemaVersion: evaluation.schemaVersion,
    status: evaluation.status,
    source: evaluation.source,
    policyVersion: evaluation.decision?.policyVersion ?? 1,
    identityDigest: evaluation.identity.digest,
    inventoryDigest: evaluation.inventory.digest,
    inventoryEntryCount: evaluation.inventory.entries.length,
    containsExecutableConfiguration: evaluation.inventory.entries.some(
      (entry) => entry.posture === 'executable'
    ),
    requestedCapabilities: [
      ...new Set(evaluation.inventory.entries.flatMap((entry) => entry.requestedCapabilities)),
    ],
    ...(evaluation.decision
      ? {
          decisionId: evaluation.decision.id,
          decisionMode: evaluation.decision.mode,
        }
      : {}),
    inventory: evaluation.inventory.entries.map((entry) => ({
      id: entry.id,
      pathDigest: entry.canonicalPathDigest,
      kind: entry.kind,
      posture: entry.posture,
      sourceFingerprint: entry.sourceFingerprint,
      requestedCapabilities: entry.requestedCapabilities,
    })),
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe('WorkspaceExecutionTrustService', () => {
  it('provisionally allows a clean workspace and rescans newly added executable config', async () => {
    const repository = await createRepository();
    const trust = service();

    const clean = await trust.evaluateForLaunch({
      workspacePath: repository,
      constraints: restrictedConstraints({ sandboxMode: 'workspace-write' }),
    });
    expect(clean.status).toBe('not-required');
    expect(clean.inventory.entries).toEqual([]);

    await writeFile(
      path.join(repository, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          malicious: { command: 'sh', args: ['-c', 'echo should-not-run'] },
        },
      })
    );
    const changed = await trust.evaluateForLaunch({
      workspacePath: repository,
      constraints: restrictedConstraints(),
    });
    expect(changed.status).toBe('untrusted');
    expect(changed.requiresExplicitDecision).toBe(true);
    expect(changed.inventory.digest).not.toBe(clean.inventory.digest);
    expect(changed.inventory.entries[0]).toMatchObject({
      relativePath: '.mcp.json',
      kind: 'tool-server-configuration',
      posture: 'executable',
    });

    await trust.recordDecision(
      repository,
      {
        inventoryDigest: changed.inventory.digest,
        mode: 'restricted',
        reason: 'Allow only with executable configuration denied.',
      },
      'admin'
    );
    const notBlocked = await trust.evaluateForLaunch({
      workspacePath: repository,
      constraints: restrictedConstraints({
        projectExecutableConfigurationBlocked: false,
      }),
    });
    expect(notBlocked.status).toBe('untrusted');
    expect(
      notBlocked.restrictionChecks.find(
        (check) => check.id === 'project-executable-configuration-blocked'
      )?.satisfied
    ).toBe(false);

    const blocked = await trust.evaluateForLaunch({
      workspacePath: repository,
      constraints: restrictedConstraints(),
    });
    expect(blocked.status).toBe('restricted');
  });

  it('binds trust to the exact inventory and rejects later changes', async () => {
    const repository = await createRepository();
    await writeFile(path.join(repository, 'AGENTS.md'), 'Use repository instructions.\n');
    const trust = service();
    const scan = await trust.scan(repository);

    const decision = await trust.recordDecision(
      repository,
      {
        inventoryDigest: scan.inventory.digest,
        mode: 'trusted',
        reason: 'Reviewed repository instructions and configuration.',
      },
      'admin'
    );
    const trusted = await trust.evaluateForLaunch({
      workspacePath: repository,
      constraints: restrictedConstraints({ sandboxMode: 'workspace-write' }),
    });
    expect(trusted.status).toBe('trusted');
    expect(trusted.decision?.id).toBe(decision.id);

    await writeFile(path.join(repository, '.codex', 'config.toml'), 'model = "example"\n').catch(
      async () => {
        await mkdir(path.join(repository, '.codex'), { recursive: true });
        await writeFile(path.join(repository, '.codex', 'config.toml'), 'model = "example"\n');
      }
    );
    const stale = await trust.evaluateForLaunch({
      workspacePath: repository,
      constraints: restrictedConstraints(),
    });
    expect(stale.status).toBe('untrusted');
    expect(stale.requiresExplicitDecision).toBe(true);
    expect(stale.source).toContain('changed after the recorded trust decision');
  });

  it('keeps explicit distrust effective when repository contents change', async () => {
    const repository = await createRepository();
    await writeFile(path.join(repository, 'AGENTS.md'), 'Untrusted instructions.\n');
    const trust = service();
    const scan = await trust.scan(repository);
    await trust.recordDecision(
      repository,
      {
        inventoryDigest: scan.inventory.digest,
        mode: 'denied',
        reason: 'Repository source is not approved.',
      },
      'admin'
    );
    await writeFile(path.join(repository, 'CLAUDE.md'), 'New instructions.\n');

    const evaluation = await trust.evaluateForLaunch({
      workspacePath: repository,
      constraints: restrictedConstraints(),
    });
    expect(evaluation.status).toBe('untrusted');
    expect(evaluation.requiresExplicitDecision).toBe(false);
    expect(evaluation.source).toContain('distrust decision');
  });

  it('permits model instructions only when every restricted boundary is enforced', async () => {
    const repository = await createRepository();
    await writeFile(path.join(repository, 'AGENTS.md'), 'Read-only guidance.\n');
    const trust = service();

    const restricted = await trust.evaluateForLaunch({
      workspacePath: repository,
      constraints: restrictedConstraints(),
    });
    expect(restricted.status).toBe('restricted');
    expect(restricted.requiresExplicitDecision).toBe(false);

    const writable = await trust.evaluateForLaunch({
      workspacePath: repository,
      constraints: restrictedConstraints({ sandboxMode: 'workspace-write' }),
    });
    expect(writable.status).toBe('untrusted');
    expect(
      writable.restrictionChecks.find((check) => check.id === 'filesystem-read-only')?.satisfied
    ).toBe(false);
  });

  it('lets project policy narrow trust but never widen it', async () => {
    const repository = await createRepository();
    await mkdir(path.join(repository, '.veritas-kanban'), { recursive: true });
    await writeFile(path.join(repository, 'AGENTS.md'), 'Repository instructions.\n');
    await writeFile(
      path.join(repository, '.veritas-kanban', 'workspace-trust.json'),
      JSON.stringify({
        schemaVersion: 'workspace-trust-policy/v1',
        maximumTrust: 'restricted',
      })
    );
    const trust = service();
    const scan = await trust.scan(repository);

    await expect(
      trust.recordDecision(
        repository,
        {
          inventoryDigest: scan.inventory.digest,
          mode: 'trusted',
          reason: 'Attempted trust widening.',
        },
        'admin'
      )
    ).rejects.toThrow('does not permit a trusted decision');

    await trust.recordDecision(
      repository,
      {
        inventoryDigest: scan.inventory.digest,
        mode: 'restricted',
        reason: 'Respect project maximum.',
      },
      'admin'
    );
    const evaluation = await trust.evaluateForLaunch({
      workspacePath: repository,
      constraints: restrictedConstraints(),
    });
    expect(evaluation.status).toBe('restricted');
  });

  it('revokes an active decision without requiring a restart', async () => {
    const repository = await createRepository();
    await writeFile(path.join(repository, 'AGENTS.md'), 'Repository instructions.\n');
    const trust = service();
    const scan = await trust.scan(repository);
    const active = await trust.recordDecision(
      repository,
      {
        inventoryDigest: scan.inventory.digest,
        mode: 'trusted',
        reason: 'Temporary review approval.',
      },
      'admin'
    );

    const revoked = await trust.revoke(
      repository,
      {
        inventoryDigest: scan.inventory.digest,
        reason: 'Approval withdrawn.',
      },
      'admin'
    );
    expect(revoked.mode).toBe('revoked');
    expect(revoked.supersedesDecisionId).toBe(active.id);
    const evaluation = await trust.evaluateForLaunch({
      workspacePath: repository,
      constraints: restrictedConstraints(),
    });
    expect(evaluation.status).toBe('restricted');
    expect(evaluation.decision?.mode).toBe('revoked');
  });

  it('uses filesystem identity to distinguish siblings while surviving symlink and rename', async () => {
    const first = await createRepository('first');
    const parent = path.dirname(first);
    const linked = path.join(parent, 'linked');
    await symlink(first, linked, 'dir');
    const repository = new InMemoryWorkspaceExecutionTrustRepository();
    const original = await repository.inspect(first);
    const throughSymlink = await repository.inspect(linked);
    expect(throughSymlink.identity.digest).toBe(original.identity.digest);

    await execFileAsync('git', [
      '-C',
      first,
      'remote',
      'set-url',
      'origin',
      'https://temporary-token@github.com/example/project.git',
    ]);
    const afterCredentialRotation = await repository.inspect(first);
    expect(afterCredentialRotation.identity.digest).toBe(original.identity.digest);

    const moved = path.join(parent, 'moved');
    await rename(first, moved);
    const afterMove = await repository.inspect(moved);
    expect(afterMove.identity.digest).toBe(original.identity.digest);
    expect(afterMove.digest).toBe(original.digest);

    const sibling = path.join(parent, 'sibling');
    await mkdir(sibling);
    await execFileAsync('git', ['init', sibling]);
    await execFileAsync('git', [
      '-C',
      sibling,
      'remote',
      'add',
      'origin',
      'https://github.com/example/project.git',
    ]);
    const siblingInventory = await repository.inspect(sibling);
    expect(siblingInventory.identity.digest).not.toBe(original.identity.digest);

    const nested = path.join(moved, 'nested');
    await mkdir(nested);
    await expect(repository.inspect(nested)).rejects.toThrow(
      'requires the registered Git worktree root'
    );
  });

  it('does not follow configuration symlinks outside the workspace', async () => {
    const repository = await createRepository();
    const outside = path.join(path.dirname(repository), 'outside-mcp.json');
    await writeFile(outside, '{"secret":"must-not-be-read"}\n');
    await symlink(outside, path.join(repository, '.mcp.json'));
    const outsideDirectory = path.join(path.dirname(repository), 'outside-buzz');
    await mkdir(outsideDirectory);
    await writeFile(
      path.join(outsideDirectory, 'config.toml'),
      'secret = "must-not-be-read-either"\n'
    );
    await symlink(outsideDirectory, path.join(repository, '.buzz'));

    const inventory = await new InMemoryWorkspaceExecutionTrustRepository().inspect(repository);
    const entry = inventory.entries.find((candidate) => candidate.relativePath === '.mcp.json');
    expect(entry).toMatchObject({
      symbolicLink: true,
      posture: 'executable',
    });
    expect(entry?.requestedCapabilities).toContain('filesystem.external-read');
    expect(inventory.entries).toContainEqual(
      expect.objectContaining({
        relativePath: '.buzz',
        kind: 'unknown-executable',
        posture: 'executable',
        symbolicLink: true,
      })
    );
    expect(JSON.stringify(inventory)).not.toContain('must-not-be-read');
    expect(JSON.stringify(inventory)).not.toContain('must-not-be-read-either');
  });

  it('treats harness configuration as executable and rechecks decision state before spawn', async () => {
    const repository = await createRepository();
    await mkdir(path.join(repository, '.buzz'), { recursive: true });
    await writeFile(path.join(repository, '.buzz', 'config.toml'), 'command = "unsafe"\n');
    const trust = service();
    const scan = await trust.scan(repository);
    expect(scan.inventory.entries[0]).toMatchObject({
      relativePath: '.buzz/config.toml',
      kind: 'provider-configuration',
      posture: 'executable',
    });
    await trust.recordDecision(
      repository,
      {
        inventoryDigest: scan.inventory.digest,
        mode: 'trusted',
        reason: 'Reviewed executable harness configuration.',
      },
      'admin'
    );
    const trusted = await trust.evaluateForLaunch({
      workspacePath: repository,
      constraints: restrictedConstraints({ sandboxMode: 'workspace-write' }),
    });
    const expected = launchTrust(trusted);
    await trust.revoke(
      repository,
      {
        inventoryDigest: scan.inventory.digest,
        reason: 'Authorization withdrawn before spawn.',
      },
      'admin'
    );

    await expect(trust.assertFresh(repository, expected)).rejects.toThrow(
      'decision changed before provider activation'
    );
  });
});
