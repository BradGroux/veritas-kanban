import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { DecisionReviewService } from '../services/decision-review-service.js';
import type { DecisionService } from '../services/decision-service.js';
import type { WorkProductService } from '../services/work-product-service.js';

describe('DecisionReviewService', () => {
  let tmpDir: string;
  let service: DecisionReviewService;
  const decisionService = {
    create: vi.fn(),
  };
  const workProductService = {
    create: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'decision-review-service-'));
    decisionService.create.mockResolvedValue({ id: 'decision_review_audit' });
    workProductService.create.mockResolvedValue({ id: 'wp_decision_review' });
    service = new DecisionReviewService({
      filePath: path.join(tmpDir, 'decision-review-sessions.json'),
      decisionService: decisionService as unknown as DecisionService,
      workProductService: workProductService as unknown as WorkProductService,
    });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function createSession() {
    return service.create({
      taskId: 'task-724',
      title: 'Choose release approach',
      prompt: 'Should we cut 5.1 after the remaining PRs?',
      context: 'Open issues require docs and packaging work.',
      rounds: 1,
      participants: [
        { id: 'architect', label: 'Architect', agentId: 'codex', model: 'gpt-5' },
        { id: 'reviewer', label: 'Reviewer', profileId: 'qa-reviewer' },
      ],
    });
  }

  it('creates and lists review sessions newest first', async () => {
    const session = await createSession();

    expect(session.status).toBe('collecting');
    expect(session.participants).toHaveLength(2);
    expect(await service.list({ taskId: 'task-724' })).toHaveLength(1);
    expect(await service.get(session.id)).toMatchObject({ id: session.id });
  });

  it('requires every initial response before critique rounds start', async () => {
    const session = await createSession();

    await service.recordInitialResponse(session.id, {
      participantId: 'architect',
      response: 'Ship only after packaging proof.',
    });

    await expect(
      service.recordCritique(session.id, {
        participantId: 'architect',
        round: 1,
        response: 'The reviewer has not responded yet.',
      })
    ).rejects.toThrow(/All initial responses/);

    const ready = await service.recordInitialResponse(session.id, {
      participantId: 'reviewer',
      response: 'Require a release checklist and artifact evidence.',
    });
    expect(ready.status).toBe('critiquing');
  });

  it('finalizes with a work product and linked decision record after all critiques', async () => {
    const session = await createSession();

    await service.recordInitialResponse(session.id, {
      participantId: 'architect',
      response: 'Use a single release branch after issue PRs merge.',
    });
    await service.recordInitialResponse(session.id, {
      participantId: 'reviewer',
      response: 'Hold until docs and tap validation are complete.',
    });
    await service.recordCritique(session.id, {
      participantId: 'architect',
      round: 1,
      response: 'Reviewer is right to require tap validation.',
      critiquesParticipantIds: ['reviewer'],
    });
    await service.recordCritique(session.id, {
      participantId: 'reviewer',
      round: 1,
      response: 'Architect should spell out release rollback.',
      critiquesParticipantIds: ['architect'],
    });

    const finalized = await service.finalize(session.id, {
      recommendation: 'Cut 5.1 only after all issue PRs merge and artifacts validate.',
      assumptions: ['CI remains green'],
      risks: ['Packaging metadata can drift'],
      validationPlan: ['Run release validation'],
      followUpTasks: ['Update Homebrew tap if checksum changes'],
      confidenceLevel: 82,
      riskScore: 44,
    });

    expect(finalized.status).toBe('synthesized');
    expect(finalized.finalPacket?.workProductId).toBe('wp_decision_review');
    expect(finalized.finalPacket?.decisionId).toBe('decision_review_audit');
    expect(workProductService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'report',
        taskId: 'task-724',
        metadata: expect.objectContaining({ packetType: 'decision_review' }),
      })
    );
    expect(decisionService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        outputAction: 'Cut 5.1 only after all issue PRs merge and artifacts validate.',
        confidenceLevel: 82,
        riskScore: 44,
      })
    );
    expect(service.exportMarkdown(finalized)).toContain(
      '# Decision Review: Choose release approach'
    );
  });
});
