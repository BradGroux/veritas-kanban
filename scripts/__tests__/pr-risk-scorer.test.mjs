import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scorePR } from '../pr-risk-scorer.mjs';

describe('scorePR', () => {
  it('returns low risk for a small PR with tests', () => {
    const result = scorePR({
      files: ['src/foo.ts', 'src/foo.test.ts'],
      additions: 20,
      deletions: 5,
    });
    assert.equal(result.tier, 'low');
    assert.equal(result.score, 0);
    assert.equal(result.details.hasTests, true);
  });

  it('penalizes missing tests', () => {
    const result = scorePR({
      files: ['src/foo.ts'],
      additions: 10,
      deletions: 0,
    });
    assert.equal(result.details.hasTests, false);
    assert.ok(result.score >= 15, `expected >=15, got ${result.score}`);
    assert.ok(result.reasons.some((r) => r.includes('No test files')));
  });

  it('scores sensitive paths', () => {
    const result = scorePR({
      files: ['server/src/routes/auth.ts', 'src/app.test.ts'],
      additions: 10,
      deletions: 5,
    });
    assert.equal(result.details.sensitivePaths.length, 1);
    assert.ok(result.score >= 8);
  });

  it('scores dependency file changes', () => {
    const result = scorePR({
      files: ['package.json', 'pnpm-lock.yaml', 'src/index.test.ts'],
      additions: 50,
      deletions: 10,
    });
    assert.equal(result.details.dependencyFiles.length, 2);
    assert.ok(result.score >= 10);
  });

  it('scores large PRs with many files', () => {
    const files = Array.from({ length: 30 }, (_, i) => `src/file${i}.ts`);
    const result = scorePR({ files, additions: 500, deletions: 200 });
    assert.ok(result.score >= 30, `expected >=30, got ${result.score}`);
    assert.ok(result.tier !== 'low');
  });

  it('returns high risk for very large sensitive PRs', () => {
    const files = [
      ...Array.from({ length: 20 }, (_, i) => `src/file${i}.ts`),
      '.github/workflows/ci.yml',
      'server/src/routes/auth.ts',
      'server/src/middleware/validate.ts',
      'Dockerfile',
      'package.json',
      'pnpm-lock.yaml',
    ];
    const result = scorePR({ files, additions: 1000, deletions: 500 });
    assert.equal(result.tier, 'high');
    assert.ok(result.score >= 60);
  });

  it('respects custom thresholds', () => {
    const result = scorePR(
      { files: ['a.ts'], additions: 10, deletions: 0 },
      { thresholdMedium: 5, thresholdHigh: 10 },
    );
    assert.equal(result.tier, 'high');
  });

  it('clamps score to 100', () => {
    const files = [
      ...Array.from({ length: 50 }, (_, i) => `src/file${i}.ts`),
      ...Array.from({ length: 10 }, (_, i) => `.github/workflows/w${i}.yml`),
      'package.json', 'pnpm-lock.yaml',
    ];
    const result = scorePR({ files, additions: 5000, deletions: 3000 });
    assert.ok(result.score <= 100);
  });

  it('handles empty PR', () => {
    const result = scorePR({ files: [], additions: 0, deletions: 0 });
    assert.equal(result.score, 0);
    assert.equal(result.tier, 'low');
    assert.equal(result.reasons.length, 0);
  });

  it('detects test files in __tests__ directories', () => {
    const result = scorePR({
      files: ['src/__tests__/foo.test.ts', 'src/bar.ts'],
      additions: 30,
      deletions: 10,
    });
    assert.equal(result.details.hasTests, true);
  });
});
