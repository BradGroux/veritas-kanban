import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PolicyService } from '../../services/policy-service.js';
import { ToolPolicyService } from '../../services/tool-policy-service.js';
import {
  createTestSqliteDatabase,
  type TestSqliteDatabase,
} from '../../storage/sqlite/test-helpers.js';

describe('SQLite audit and policy repositories', () => {
  let fixture: TestSqliteDatabase;
  let testRoot: string;

  beforeEach(async () => {
    fixture = createTestSqliteDatabase();
    fixture.database.open();
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-sqlite-audit-policy-'));
  });

  afterEach(async () => {
    fixture.cleanup();
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it('stores agent policies in SQLite without creating policy files', async () => {
    const policiesDir = path.join(testRoot, 'storage', 'policies');
    const service = new PolicyService({
      policiesDir,
      storageType: 'sqlite',
      sqliteDatabase: fixture.database,
    });
    await service.waitForInit();

    expect((await service.listPolicies()).map((policy) => policy.preset).sort()).toEqual([
      'balanced',
      'permissive',
      'strict',
    ]);

    await service.createPolicy({
      id: 'block-force-push',
      name: 'Block Force Push',
      type: 'block-action-type',
      enabled: true,
      scope: {
        agents: ['codex'],
        projects: ['core'],
        actionTypes: [],
      },
      responseAction: 'block',
      config: {
        actionTypes: ['git.force-push'],
      },
    });

    const result = await service.evaluatePolicies({
      agent: 'codex',
      project: 'core',
      actionType: 'git.force-push',
    });

    expect(result.decision).toBe('block');
    expect(result.blockedBy).toEqual(['block-force-push']);

    const existing = await service.getPolicy('block-force-push');
    if (!existing) {
      throw new Error('Expected policy to exist before update');
    }

    const updated = await service.updatePolicy('block-force-push', {
      ...existing,
      enabled: false,
    });
    expect(updated.enabled).toBe(false);

    await service.deletePolicy('block-force-push');
    expect(await service.getPolicy('block-force-push')).toBeNull();
    await expect(fs.access(policiesDir)).rejects.toThrow();
  });

  it('stores tool policies in SQLite without creating policy files', async () => {
    const policiesDir = path.join(testRoot, 'storage', 'tool-policies');
    const service = new ToolPolicyService({
      policiesDir,
      storageType: 'sqlite',
      sqliteDatabase: fixture.database,
    });
    await service.waitForInit();

    expect((await service.getToolPolicy('developer'))?.allowed).toEqual(['*']);

    await service.savePolicy({
      role: 'Sandboxed',
      allowed: ['Read'],
      denied: ['exec'],
      description: 'Restricted test role',
    });

    expect(await service.validateToolAccess('sandboxed', 'Read')).toBe(true);
    expect(await service.validateToolAccess('sandboxed', 'exec')).toBe(false);
    expect(await service.getToolFilterForRole('sandboxed')).toEqual({
      allowed: ['Read'],
      denied: ['exec'],
    });

    const roles = (await service.listPolicies()).map((policy) => policy.role);
    expect(roles).toEqual(expect.arrayContaining(['developer', 'sandboxed']));

    await service.deletePolicy('sandboxed');
    expect(await service.getToolPolicy('sandboxed')).toBeNull();
    await expect(fs.access(policiesDir)).rejects.toThrow();
  });
});

describe('SQLite audit log repository', () => {
  let fixture: TestSqliteDatabase;
  let testRoot: string;

  beforeEach(async () => {
    fixture = createTestSqliteDatabase();
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-sqlite-audit-'));
    process.env.VERITAS_STORAGE = 'sqlite';
    process.env.VERITAS_SQLITE_PATH = fixture.databasePath;
    process.env.DATA_DIR = testRoot;
    vi.resetModules();
  });

  afterEach(async () => {
    const mod = await import('../../services/audit-service.js');
    mod._resetAuditState();
    delete process.env.VERITAS_STORAGE;
    delete process.env.VERITAS_SQLITE_PATH;
    delete process.env.DATA_DIR;
    vi.resetModules();
    fixture.cleanup();
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it('stores audit entries in SQLite with hash-chain verification and recent reads', async () => {
    const mod = await import('../../services/audit-service.js');
    mod._resetAuditState();

    await mod.auditLog({
      action: 'auth.login',
      actor: 'admin',
      resource: 'session',
      details: { ip: '127.0.0.1' },
    });
    await mod.auditLog({ action: 'task.create', actor: 'admin', resource: 'task_1' });
    await mod.auditLog({ action: 'settings.update', actor: 'admin', resource: 'theme' });

    expect(mod.getCurrentAuditLogPath()).toBe('sqlite://audit/current');
    expect(await mod.verifyAuditLog(mod.getCurrentAuditLogPath())).toEqual({
      valid: true,
      entries: 3,
    });

    const recent = await mod.readRecentAuditEntries(2);
    expect(recent.map((entry) => entry.action)).toEqual(['settings.update', 'task.create']);

    mod._resetAuditState();
    await mod.auditLog({ action: 'after-restart', actor: 'system' });
    expect(await mod.verifyAuditLog(mod.getCurrentAuditLogPath())).toEqual({
      valid: true,
      entries: 4,
    });

    await expect(fs.access(path.join(testRoot, '.veritas-kanban', 'audit'))).rejects.toThrow();
  });
});
