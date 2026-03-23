import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { CreateDecisionInput } from '@veritas-kanban/shared';

// We need to mock getStorageRoot before importing DecisionService
vi.mock('../../utils/paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/paths.js')>();
  return {
    ...actual,
    getStorageRoot: () => process.cwd(),
    getDecisionsDir: () => join(process.cwd(), 'storage', 'decisions'),
  };
});

// Import after the mock
import { DecisionService } from '../../services/decision-service.js';

describe('DecisionService', () => {
  const originalCwd = process.cwd();
  let tempDir: string;
  let service: DecisionService;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'vk-decisions-'));
    process.chdir(tempDir);

    // Create a new instance for each test to ensure it uses the current cwd
    service = new DecisionService();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('creates a decision and saves it to disk', async () => {
    const input: CreateDecisionInput = {
      inputContext: 'Context A',
      outputAction: 'Action A',
      confidenceLevel: 0.9,
      riskScore: 0.1,
      assumptions: ['Assumption 1', { text: 'Assumption 2' }],
      agentId: 'jules',
    };

    const decision = await service.create(input);

    expect(decision.id).toMatch(/^decision_\d+_.+$/);
    expect(decision.inputContext).toBe('Context A');
    expect(decision.outputAction).toBe('Action A');
    expect(decision.confidenceLevel).toBe(0.9);
    expect(decision.riskScore).toBe(0.1);
    expect(decision.agentId).toBe('jules');

    // Check normalized assumptions
    expect(decision.assumptions).toHaveLength(2);
    expect(decision.assumptions[0]?.text).toBe('Assumption 1');
    expect(decision.assumptions[0]?.status).toBe('pending');
    expect(decision.assumptions[1]?.text).toBe('Assumption 2');
    expect(decision.assumptions[1]?.status).toBe('pending');

    // Retrieve it to ensure it was saved
    const retrieved = await service.getById(decision.id);
    expect(retrieved).toEqual(decision);
  });

  it('rejects creation if parent decision does not exist', async () => {
    const input: CreateDecisionInput = {
      inputContext: 'Context',
      outputAction: 'Action',
      confidenceLevel: 0.9,
      riskScore: 0.1,
      parentDecisionId: 'nonexistent-parent',
    };

    await expect(service.create(input)).rejects.toThrow('Parent decision not found: nonexistent-parent');
  });

  it('lists and filters decisions', async () => {
    const dec1 = await service.create({
      inputContext: 'Context 1',
      outputAction: 'Action 1',
      confidenceLevel: 0.5,
      riskScore: 0.5,
      agentId: 'agent-1',
    });

    // Wait a tiny bit to ensure different timestamps
    await new Promise(resolve => setTimeout(resolve, 10));

    const dec2 = await service.create({
      inputContext: 'Context 2',
      outputAction: 'Action 2',
      confidenceLevel: 0.9,
      riskScore: 0.1,
      agentId: 'agent-2',
    });

    // List all
    const all = await service.list();
    expect(all).toHaveLength(2);
    // Should be sorted newest first
    expect(all[0]?.id).toBe(dec2.id);
    expect(all[1]?.id).toBe(dec1.id);

    // Filter by agent
    const agent1List = await service.list({ agent: 'agent-1' });
    expect(agent1List).toHaveLength(1);
    expect(agent1List[0]?.id).toBe(dec1.id);

    // Filter by confidence
    const highConf = await service.list({ minConfidence: 0.8 });
    expect(highConf).toHaveLength(1);
    expect(highConf[0]?.id).toBe(dec2.id);

    // Filter by risk
    const highRisk = await service.list({ minRisk: 0.4 });
    expect(highRisk).toHaveLength(1);
    expect(highRisk[0]?.id).toBe(dec1.id);
  });

  it('retrieves a decision chain', async () => {
    const p1 = await service.create({
      inputContext: 'Parent',
      outputAction: 'Action P1',
      confidenceLevel: 0.9,
      riskScore: 0.1,
    });

    const c1 = await service.create({
      inputContext: 'Child',
      outputAction: 'Action C1',
      confidenceLevel: 0.9,
      riskScore: 0.1,
      parentDecisionId: p1.id,
    });

    const gc1 = await service.create({
      inputContext: 'Grandchild',
      outputAction: 'Action GC1',
      confidenceLevel: 0.9,
      riskScore: 0.1,
      parentDecisionId: c1.id,
    });

    const chain = await service.getChain(gc1.id);

    expect(chain).toHaveLength(3);
    // Should be in order from oldest parent to newest child
    expect(chain[0]?.id).toBe(p1.id);
    expect(chain[1]?.id).toBe(c1.id);
    expect(chain[2]?.id).toBe(gc1.id);
  });

  it('handles decision chain cycles gracefully', async () => {
    const d1 = await service.create({
      inputContext: 'D1',
      outputAction: 'A1',
      confidenceLevel: 0.9,
      riskScore: 0.1,
    });

    const d2 = await service.create({
      inputContext: 'D2',
      outputAction: 'A2',
      confidenceLevel: 0.9,
      riskScore: 0.1,
      parentDecisionId: d1.id,
    });

    // Force cycle: D1 -> D2 -> D1
    const fs = await import('fs/promises');
    const d1Path = join(process.cwd(), 'storage', 'decisions', `${d1.id}.json`);
    const d1Data = JSON.parse(await fs.readFile(d1Path, 'utf8'));
    d1Data.parentDecisionId = d2.id;
    await fs.writeFile(d1Path, JSON.stringify(d1Data));

    const chain = await service.getChain(d2.id);

    // Should break cycle and return what it found: D1 and D2
    expect(chain).toHaveLength(2);
    expect(chain.map(c => c.id)).toContain(d1.id);
    expect(chain.map(c => c.id)).toContain(d2.id);
  });

  it('updates an assumption', async () => {
    const decision = await service.create({
      inputContext: 'Context',
      outputAction: 'Action',
      confidenceLevel: 0.9,
      riskScore: 0.1,
      assumptions: ['First assumption'],
    });

    const updated = await service.updateAssumption(decision.id, 0, {
      status: 'verified',
      note: 'Checked it myself',
    });

    expect(updated.assumptions[0]?.status).toBe('verified');
    expect(updated.assumptions[0]?.note).toBe('Checked it myself');
    expect(updated.assumptions[0]?.updatedAt).not.toBe(decision.assumptions[0]?.updatedAt);

    // Verify it persisted
    const retrieved = await service.getById(decision.id);
    expect(retrieved?.assumptions[0]?.status).toBe('verified');
  });

  it('throws NotFoundError for invalid decision or assumption index', async () => {
    const decision = await service.create({
      inputContext: 'Context',
      outputAction: 'Action',
      confidenceLevel: 0.9,
      riskScore: 0.1,
      assumptions: ['First assumption'],
    });

    await expect(service.updateAssumption('nonexistent', 0, { status: 'verified' }))
      .rejects.toThrow('Decision not found');

    await expect(service.updateAssumption(decision.id, 99, { status: 'verified' }))
      .rejects.toThrow('Assumption not found');
  });
});
