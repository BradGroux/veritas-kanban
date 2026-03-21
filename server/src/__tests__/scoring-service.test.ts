import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ScoringService } from '../services/scoring-service.js';

describe('ScoringService', () => {
  const originalCwd = process.cwd();
  let tempDir: string;
  let service: ScoringService;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'vk-scoring-'));
    process.chdir(tempDir);
    service = new ScoringService();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  });

  it('seeds built-in profiles', async () => {
    const profiles = await service.listProfiles();
    expect(profiles.map((profile) => profile.id)).toEqual(
      expect.arrayContaining(['code-quality', 'task-efficiency', 'convention-compliance'])
    );
  });

  it('evaluates profiles and stores history', async () => {
    const profile = await service.createProfile({
      name: 'Weighted score',
      compositeMethod: 'weightedAvg',
      scorers: [
        {
          id: 'keywords',
          name: 'Keywords',
          type: 'KeywordContains',
          weight: 0.7,
          target: 'output',
          keywords: ['verified', 'tested'],
          matchMode: 'any',
          partialCredit: true,
        },
        {
          id: 'length',
          name: 'Length',
          type: 'NumericRange',
          weight: 0.3,
          valuePath: 'metadata.outputWordCount',
          min: 2,
          max: 20,
        },
      ],
    });

    const result = await service.evaluate({
      profileId: profile.id,
      agent: 'veritas',
      taskId: 'TASK-180',
      output: 'verified result',
    });

    expect(result.profileId).toBe(profile.id);
    expect(result.compositeScore).toBeGreaterThan(0.9);

    const history = await service.getHistory({ profileId: profile.id, agent: 'veritas' });
    expect(history).toHaveLength(1);
    expect(history[0]?.taskId).toBe('TASK-180');
  });

  it('uses geometric mean and returns zero when one scorer fails', async () => {
    const profile = await service.createProfile({
      name: 'Geometric',
      compositeMethod: 'geometricMean',
      scorers: [
        {
          id: 'pass',
          name: 'Pass',
          type: 'CustomExpression',
          weight: 1,
          expression: '1',
        },
        {
          id: 'fail',
          name: 'Fail',
          type: 'CustomExpression',
          weight: 1,
          expression: '0',
        },
      ],
    });

    const result = await service.evaluate({
      profileId: profile.id,
      output: 'anything',
    });

    expect(result.compositeScore).toBe(0);
  });
});
