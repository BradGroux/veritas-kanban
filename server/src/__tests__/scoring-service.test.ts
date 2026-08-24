import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ScoringService } from '../services/scoring-service.js';
import {
  boundedRegexTest,
  getScoringRegexRuntimeSnapshot,
} from '../services/scoring-runtime.js';
import { SCORING_REGEX_MAX_CONCURRENCY } from '../config/scoring.js';

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

  it('migrates legacy built-in profiles to bounded scorers', async () => {
    const profilesDir = join(tempDir, 'storage', 'scoring');
    await mkdir(profilesDir, { recursive: true });
    await writeFile(
      join(profilesDir, 'task-efficiency.json'),
      JSON.stringify({
        id: 'task-efficiency',
        name: 'Task Efficiency',
        builtIn: true,
        compositeMethod: 'weightedAvg',
        created: '2026-01-01T00:00:00.000Z',
        updated: '2026-01-01T00:00:00.000Z',
        scorers: [
          {
            id: 'legacy',
            name: 'Legacy',
            type: 'CustomExpression',
            weight: 1,
            expression: 'process.env',
          },
        ],
      })
    );

    const profiles = await service.listProfiles();
    const migrated = profiles.find((profile) => profile.id === 'task-efficiency');
    expect(migrated?.created).toBe('2026-01-01T00:00:00.000Z');
    expect(migrated?.scorers.some((scorer) => scorer.type === 'OccurrenceRatio')).toBe(true);
    expect(migrated?.scorers.some((scorer) => scorer.type === 'CustomExpression')).toBe(false);
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
          type: 'OccurrenceRatio',
          weight: 1,
          needles: ['anything'],
          denominator: 1,
        },
        {
          id: 'fail',
          name: 'Fail',
          type: 'OccurrenceRatio',
          weight: 1,
          needles: ['never-present'],
          denominator: 1,
        },
      ],
    });

    const result = await service.evaluate({
      profileId: profile.id,
      output: 'anything',
    });

    expect(result.compositeScore).toBe(0);
  });

  it.each([
    'typeof process === "object"',
    '({}).constructor.constructor("return process")()',
    'globalThis.process',
  ])('rejects legacy executable scorer state: %s', async (expression) => {
    const profilesDir = join(tempDir, 'storage', 'scoring');
    await service.listProfiles();
    await writeFile(
      join(profilesDir, 'legacy-profile.json'),
      JSON.stringify({
        id: 'legacy-profile',
        name: 'Legacy profile',
        compositeMethod: 'weightedAvg',
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        scorers: [
          {
            id: 'legacy',
            name: 'Legacy',
            type: 'CustomExpression',
            weight: 1,
            expression,
          },
        ],
      })
    );

    await expect(
      service.evaluate({ profileId: 'legacy-profile', output: 'ordinary output' })
    ).rejects.toThrow('legacy custom expression');
  });

  it('terminates regex evaluation that exceeds the bounded runtime', async () => {
    const profile = await service.createProfile({
      name: 'Bounded regex',
      compositeMethod: 'weightedAvg',
      scorers: [
        {
          id: 'regex',
          name: 'Regex',
          type: 'RegexMatch',
          weight: 1,
          pattern: '^(a+)+$',
        },
      ],
    });

    await expect(
      service.evaluate({ profileId: profile.id, output: `${'a'.repeat(50_000)}!` })
    ).rejects.toThrow('100ms limit');
  });

  it('bounds regex workers across concurrent evaluations', async () => {
    const evaluations = Array.from({ length: SCORING_REGEX_MAX_CONCURRENCY + 1 }, () =>
      boundedRegexTest('^(a+)+$', undefined, `${'a'.repeat(50_000)}!`).catch((error) => error)
    );

    await vi.waitFor(() => {
      const snapshot = getScoringRegexRuntimeSnapshot();
      expect(snapshot.activeWorkers).toBe(SCORING_REGEX_MAX_CONCURRENCY);
      expect(snapshot.queuedEvaluations).toBe(1);
    });

    await Promise.all(evaluations);
    expect(getScoringRegexRuntimeSnapshot()).toEqual({ activeWorkers: 0, queuedEvaluations: 0 });
  });

  it('preserves ordinary regex and bounded occurrence scoring', async () => {
    const profile = await service.createProfile({
      name: 'Safe scoring',
      compositeMethod: 'weightedAvg',
      scorers: [
        {
          id: 'regex',
          name: 'Regex',
          type: 'RegexMatch',
          weight: 1,
          pattern: '\\bverified\\b',
          flags: 'gi',
        },
        {
          id: 'ratio',
          name: 'Ratio',
          type: 'OccurrenceRatio',
          weight: 1,
          needles: ['verified'],
          wholeWord: true,
          denominator: 1,
        },
      ],
    });

    const result = await service.evaluate({ profileId: profile.id, output: 'Verified result' });
    expect(result.scores.map((score) => score.score)).toEqual([1, 1]);
  });

  it('does not traverse reserved metadata path segments', async () => {
    const profile = await service.createProfile({
      name: 'Contained metadata path',
      compositeMethod: 'weightedAvg',
      scorers: [
        {
          id: 'ratio',
          name: 'Ratio',
          type: 'OccurrenceRatio',
          weight: 1,
          needles: ['verified'],
          denominatorPath: 'metadata.constructor.prototype.polluted',
        },
      ],
    });

    const result = await service.evaluate({ profileId: profile.id, output: 'verified' });
    expect(result.scores[0]?.score).toBe(1);
  });
});
