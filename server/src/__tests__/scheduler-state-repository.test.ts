import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SchedulerEvent } from '@veritas-kanban/shared';
import { AutomationDraftService } from '../services/automation-draft-service.js';
import { FileSchedulerStateRepository } from '../storage/scheduler-state-repository.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, lstat: vi.fn(actual.lstat) };
});

function event(id: string): SchedulerEvent {
  return {
    id,
    itemId: id,
    sourceId: id,
    kind: 'workflow',
    type: 'manual-run',
    status: 'success',
    summary: id,
    runAt: '2026-08-23T00:00:00.000Z',
  };
}

describe('FileSchedulerStateRepository', () => {
  let root: string;
  let stateFile: string;
  let repository: FileSchedulerStateRepository;

  beforeEach(async () => {
    root = await mkdtemp(path.join(process.cwd(), '.veritas-scheduler-state-'));
    stateFile = path.join(root, 'runtime', 'scheduler-state.json');
    repository = new FileSchedulerStateRepository(stateFile);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('normalizes missing state and preserves concurrent mutations', async () => {
    await expect(repository.read()).resolves.toEqual({
      version: 1,
      items: {},
      events: [],
      drafts: {},
      automationVersions: {},
      automationBindings: {},
      automationClaims: [],
    });
    await Promise.all(
      ['one', 'two'].map((id) =>
        repository.update((state) => ({
          ...state,
          items: { ...state.items, [id]: { attempts: 1 } },
          events: [...state.events, event(id)],
        }))
      )
    );

    const state = await repository.read();
    expect(new Set(Object.keys(state.items))).toEqual(new Set(['one', 'two']));
    expect(new Set(state.events.map(({ id }) => id))).toEqual(new Set(['one', 'two']));
  });

  it('rejects symbolic links, changed files, and non-file paths', async () => {
    const runtimeDir = path.dirname(stateFile);
    await mkdir(runtimeDir, { recursive: true });
    const target = path.join(root, 'outside.json');
    await writeFile(target, JSON.stringify({ version: 1, items: {}, events: [] }), 'utf8');
    await symlink(target, stateFile);
    await expect(repository.read()).rejects.toThrow(/symbolic link/i);

    await rm(stateFile);
    await writeFile(stateFile, JSON.stringify({ version: 1, items: {}, events: [] }), 'utf8');
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(lstat).mockImplementationOnce(async (filePath) => {
      const stats = await actual.lstat(filePath);
      return Object.assign(Object.create(Object.getPrototypeOf(stats)), stats, {
        ino: stats.ino + 1,
      });
    });
    await expect(repository.read()).rejects.toThrow(/changed file/i);

    await rm(stateFile);
    await mkdir(stateFile);
    await expect(repository.read()).rejects.toThrow(/bounded regular file/i);
  });

  it('rejects symbolic-link directories and oversized state', async () => {
    const realDirectory = path.join(root, 'real-runtime');
    const linkedDirectory = path.join(root, 'linked-runtime');
    await mkdir(realDirectory);
    await symlink(realDirectory, linkedDirectory, 'dir');
    const linkedRepository = new FileSchedulerStateRepository(
      path.join(linkedDirectory, 'scheduler-state.json')
    );
    await expect(linkedRepository.update((state) => state)).rejects.toThrow(/regular directory/i);

    await expect(
      repository.update((state) => ({
        ...state,
        items: { large: { lastSummary: 'x'.repeat(8 * 1024 * 1024) } },
      }))
    ).rejects.toThrow(/8 MiB/i);
  });

  it('rejects malformed persisted automation drafts', async () => {
    await mkdir(path.dirname(stateFile), { recursive: true });
    await writeFile(
      stateFile,
      JSON.stringify({ version: 1, items: {}, events: [], drafts: { bad: [{}] } }),
      'utf8'
    );

    await expect(repository.read()).rejects.toThrow();
  });

  it('validates persisted draft collection bounds, revisions, and identity', async () => {
    const draft = await new AutomationDraftService({
      stateRepository: repository,
      workflowExists: async () => false,
      taskExists: async () => false,
      templateExists: async () => false,
      integrationReady: async () => false,
      providerSupported: () => false,
      listSchedulerItems: async () => [],
    }).preview({
      intent: 'Draft a recurring report.',
      requestId: 'coverage-draft',
      requestedBy: 'operator-1',
    });
    const persistDrafts = async (drafts?: unknown): Promise<void> => {
      await mkdir(path.dirname(stateFile), { recursive: true });
      await writeFile(
        stateFile,
        JSON.stringify({
          version: 1,
          items: {},
          events: [],
          ...(drafts === undefined ? {} : { drafts }),
        }),
        'utf8'
      );
    };

    await persistDrafts();
    await expect(repository.read()).resolves.toMatchObject({ drafts: {} });
    await persistDrafts({ [draft.id]: [draft] });
    await expect(repository.read()).resolves.toMatchObject({ drafts: { [draft.id]: [draft] } });

    for (const invalid of [
      null,
      [],
      { [draft.id]: [] },
      { [draft.id]: {} },
      { [draft.id]: Array(51).fill(draft) },
    ]) {
      await persistDrafts(invalid);
      await expect(repository.read()).rejects.toThrow(/automation draft/i);
    }

    await persistDrafts(
      Object.fromEntries(Array.from({ length: 201 }, (_, index) => [`draft-${index}`, [draft]]))
    );
    await expect(repository.read()).rejects.toThrow(/200-draft limit/i);

    await persistDrafts({ automation_ffffffffffffffffffffffff: [draft] });
    await expect(repository.read()).rejects.toThrow(/conflicting identity or revision order/i);
  });

  it('validates persisted automation version, binding, and claim collections', async () => {
    const now = '2026-08-30T15:00:00.000Z';
    const binding = {
      schemaVersion: 'automation-binding/v1',
      id: 'automation_binding_aaaaaaaaaaaaaaaaaaaaaaaa',
      revision: 1,
      automationVersionId: 'automation_version_bbbbbbbbbbbbbbbbbbbbbbbb',
      automationVersion: 1,
      status: 'active',
      acceptedRuns: 0,
      failedRuns: 0,
      aggregateUsage: { runs: 0, costUsd: 0, tokens: 0, durationMinutes: 0 },
      statusReason: 'Active.',
      createdAt: now,
      updatedAt: now,
    };
    const claim = {
      schemaVersion: 'automation-run-claim/v1',
      id: 'automation_claim_cccccccccccccccccccccccc',
      requestId: 'request-1',
      automationVersionId: binding.automationVersionId,
      bindingId: binding.id,
      dueWindow: now,
      trigger: 'manual-run',
      status: 'accepted',
      createdAt: now,
      updatedAt: now,
    };
    const persistAutomation = async (overrides: Record<string, unknown>): Promise<void> => {
      await mkdir(path.dirname(stateFile), { recursive: true });
      await writeFile(
        stateFile,
        JSON.stringify({ version: 1, items: {}, events: [], ...overrides }),
        'utf8'
      );
    };

    await persistAutomation({
      automationBindings: { [binding.id]: binding },
      automationClaims: Array(1_001).fill(claim),
    });
    await expect(repository.read()).resolves.toMatchObject({
      automationBindings: { [binding.id]: binding },
      automationClaims: expect.arrayContaining([claim]),
    });
    expect((await repository.read()).automationClaims).toHaveLength(1_000);

    await persistAutomation({ automationVersions: null });
    await expect(repository.read()).rejects.toThrow(/versions must be a record/i);
    await persistAutomation({ automationBindings: [] });
    await expect(repository.read()).rejects.toThrow(/bindings must be a record/i);
    await persistAutomation({
      automationVersions: Object.fromEntries(
        Array.from({ length: 501 }, (_, index) => [`version-${index}`, {}])
      ),
    });
    await expect(repository.read()).rejects.toThrow(/500-record limit/i);
    await persistAutomation({ automationBindings: { wrong: binding } });
    await expect(repository.read()).rejects.toThrow(/conflicting identity/i);
    await persistAutomation({ automationClaims: {} });
    await expect(repository.read()).rejects.toThrow(/claims must be an array/i);
  });
});
