import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BuzzChannelMapping } from '@veritas-kanban/shared';
import {
  BuzzWorkflowTriggerService,
  type BuzzWorkflowTriggerEvent,
} from '../services/buzz-workflow-trigger-service.js';
import { RuntimeHookBusService } from '../services/runtime-hook-bus-service.js';
import type { WorkflowRunService } from '../services/workflow-run-service.js';

const EVENT_ID = 'a'.repeat(64);
const AUTHOR = 'b'.repeat(64);
const mapping: BuzzChannelMapping = {
  id: 'buzz_map_primary',
  adapterId: 'buzz-default',
  community: 'community.example',
  channelId: '11111111-1111-4111-8111-111111111111',
  target: { kind: 'squad' },
  enabled: true,
  createdAt: '2026-07-24T12:00:00.000Z',
  updatedAt: '2026-07-24T12:00:00.000Z',
};

const event: BuzzWorkflowTriggerEvent = {
  adapterId: 'buzz-default',
  mapping,
  eventId: EVENT_ID,
  authorPubkey: AUTHOR,
  content: 'ship release candidate',
  occurredAt: '2026-07-24T12:01:00.000Z',
};

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true }))
  );
});

function workflowRuns(overrides: Partial<WorkflowRunService> = {}): WorkflowRunService {
  return {
    listRuns: vi.fn().mockResolvedValue([]),
    startRun: vi.fn().mockResolvedValue({ id: 'run_1753358460000_trigger1' }),
    ...overrides,
  } as unknown as WorkflowRunService;
}

async function configuredService(options: {
  persist?: boolean;
  storageDir?: string;
  workflowRuns?: WorkflowRunService;
  runtimeHooks?: RuntimeHookBusService;
  enabled?: boolean;
  authorPubkey?: string;
  contentIncludes?: string;
}) {
  const service = new BuzzWorkflowTriggerService({
    storageDir: options.storageDir ?? '/unused',
    persist: options.persist ?? false,
    workflowRuns: options.workflowRuns ?? workflowRuns(),
    runtimeHooks: options.runtimeHooks ?? new RuntimeHookBusService(),
  });
  const rule = await service.createRule(
    event.adapterId,
    mapping,
    {
      mappingId: mapping.id,
      workflowId: 'workflow-test',
      enabled: options.enabled,
      authorPubkey: options.authorPubkey,
      contentIncludes: options.contentIncludes,
    },
    'operator'
  );
  return { service, rule };
}

describe('BuzzWorkflowTriggerService', () => {
  it('dispatches one allowlisted root message through the runtime hook bus', async () => {
    const runs = workflowRuns();
    const { service, rule } = await configuredService({ workflowRuns: runs });

    const audits = await service.processEvent(event);

    expect(audits.at(-1)).toMatchObject({
      disposition: 'dispatched',
      ruleId: rule.id,
      runId: 'run_1753358460000_trigger1',
      causalKey: `buzz:${mapping.community}:${EVENT_ID}:${rule.id}`,
    });
    expect(runs.startRun).toHaveBeenCalledOnce();
    expect(runs.startRun).toHaveBeenCalledWith(
      'workflow-test',
      undefined,
      expect.objectContaining({
        externalTrigger: expect.objectContaining({
          provider: 'buzz',
          event: 'message.posted',
          content: event.content,
        }),
      })
    );
    expect((await service.listAudits()).map((audit) => audit.disposition)).toEqual([
      'dispatched',
      'accepted',
    ]);
  });

  it('deduplicates a replay by the durable causal key', async () => {
    const runs = workflowRuns();
    const { service } = await configuredService({ workflowRuns: runs });

    await service.processEvent(event);
    const replay = await service.processEvent(event);

    expect(replay[0]).toMatchObject({
      disposition: 'duplicate',
      runId: 'run_1753358460000_trigger1',
    });
    expect(runs.startRun).toHaveBeenCalledOnce();
  });

  it('suppresses replies, echoes, disabled rules, and predicate mismatches', async () => {
    const runs = workflowRuns();
    const { service } = await configuredService({
      workflowRuns: runs,
      authorPubkey: AUTHOR,
      contentIncludes: 'release',
    });

    expect(
      (await service.processEvent({ ...event, rootEventId: 'c'.repeat(64) }))[0].disposition
    ).toBe('ignored-policy');
    expect(
      (await service.processEvent({ ...event, eventId: 'd'.repeat(64), echo: true }))[0].disposition
    ).toBe('echo');
    expect(
      (
        await service.processEvent({
          ...event,
          eventId: 'e'.repeat(64),
          content: 'unrelated message',
        })
      )[0].disposition
    ).toBe('ignored-policy');

    const disabled = await configuredService({ workflowRuns: runs, enabled: false });
    expect((await disabled.service.processEvent(event))[0].disposition).toBe('ignored-policy');
    expect(runs.startRun).not.toHaveBeenCalled();
  });

  it('reconciles a persisted accepted dispatch to an existing workflow run after restart', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vk-buzz-trigger-'));
    temporaryDirectories.push(directory);
    const failingRuns = workflowRuns({
      startRun: vi.fn().mockRejectedValue(new Error('process stopped before journal update')),
    });
    const first = await configuredService({
      persist: true,
      storageDir: directory,
      workflowRuns: failingRuns,
    });
    const failed = await first.service.processEvent(event);
    const causalKey = failed[0].causalKey;

    const recoveredRuns = workflowRuns({
      listRuns: vi.fn().mockResolvedValue([
        {
          id: 'run_1753358460000_recover1',
          context: { externalTrigger: { causalKey } },
        },
      ]),
    });
    const recovered = new BuzzWorkflowTriggerService({
      storageDir: directory,
      persist: true,
      workflowRuns: recoveredRuns,
      runtimeHooks: new RuntimeHookBusService(),
    });
    const result = await recovered.processEvent(event);

    expect(result[0]).toMatchObject({
      disposition: 'dispatched',
      runId: 'run_1753358460000_recover1',
    });
    expect(recoveredRuns.startRun).not.toHaveBeenCalled();
  });

  it('fails closed when the runtime hook policy denies dispatch', async () => {
    const hooks = {
      registerHandler: vi.fn(),
      registerDefinition: vi.fn(),
      dispatch: vi.fn().mockResolvedValue({ allowed: false, outcomes: [] }),
    } as unknown as RuntimeHookBusService;
    const runs = workflowRuns();
    const { service } = await configuredService({ runtimeHooks: hooks, workflowRuns: runs });

    const audits = await service.processEvent(event);

    expect(audits[0]).toMatchObject({
      disposition: 'dispatch-failed',
      detail: expect.stringContaining('policy denied'),
    });
    expect(runs.startRun).not.toHaveBeenCalled();
  });
});
