#!/usr/bin/env node
// PR Risk Scorer — generic, repo-agnostic
// Usage: node pr-risk-scorer.mjs --config config.json --pr-json pr-data.json
//   or: import { scorePR } from './pr-risk-scorer.mjs'

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

function linearScale(value, low, high) {
  if (value <= low) return 0;
  if (value >= high) return 100;
  return ((value - low) / (high - low)) * 100;
}

function matchesAnyPattern(filePath, patterns) {
  return patterns.some(p => {
    const re = new RegExp(
      '^' + p.replace(/\*\*/g, '__.GLOBSTAR__').replace(/\*/g, '[^/]*').replace(/__.GLOBSTAR__/g, '.*') + '$'
    );
    return re.test(filePath);
  });
}

/**
 * @param {object} pr - PR metadata
 * @param {object} config - parsed config JSON
 * @returns {{ score: number, level: string, breakdown: object, blocked: boolean, requiresSecurityReview: boolean, criticalFiles: string[] }}
 */
export function scorePR(pr, config) {
  const { weights, thresholds, rules, mergeGate } = config;

  const filesScore = linearScale(pr.filesChanged, rules.maxFilesLow, rules.maxFilesHigh);
  const totalLines = (pr.linesAdded || 0) + (pr.linesDeleted || 0);
  const linesScore = linearScale(totalLines, rules.maxLinesLow, rules.maxLinesHigh);
  const testsScore = pr.hasTests ? 0 : 100;

  const criticalFiles = (pr.changedFiles || []).filter(f => matchesAnyPattern(f, rules.criticalFilePatterns));
  const fileTypesScore = criticalFiles.length > 0 ? Math.min(100, criticalFiles.length * 25) : 0;

  const authorScore = pr.authorCommitsLast90d >= 50 ? 0 :
    pr.authorCommitsLast90d >= 10 ? 30 :
    pr.authorCommitsLast90d >= 1 ? 60 : 100;

  const reviewScore = pr.approvals >= 2 ? 0 : pr.approvals === 1 ? 40 : 100;
  const ciScore = pr.ciPassing ? 0 : 100;

  const breakdown = {
    filesChanged: filesScore,
    linesChanged: linesScore,
    hasTests: testsScore,
    fileTypes: fileTypesScore,
    authorFamiliarity: authorScore,
    reviewApprovals: reviewScore,
    ciStatus: ciScore,
  };

  const score = Math.round(
    filesScore * weights.filesChanged +
    linesScore * weights.linesChanged +
    testsScore * weights.hasTests +
    fileTypesScore * weights.fileTypes +
    authorScore * weights.authorFamiliarity +
    reviewScore * weights.reviewApprovals +
    ciScore * weights.ciStatus
  );

  const level = score >= thresholds.high ? 'critical' :
    score >= thresholds.medium ? 'high' :
    score >= thresholds.low ? 'medium' : 'low';

  return {
    score,
    level,
    breakdown,
    criticalFiles,
    blocked: score >= mergeGate.blockAbove,
    requiresSecurityReview: score >= mergeGate.requireSecurityReviewAbove,
  };
}

// CLI entry point
const isMain = import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url === new URL(process.argv[1], 'file://').href;

if (isMain) {
  const { values } = parseArgs({
    options: {
      config: { type: 'string', default: 'example-config.json' },
      'pr-json': { type: 'string' },
    },
  });

  const config = JSON.parse(readFileSync(values.config, 'utf8'));
  const prData = JSON.parse(readFileSync(values['pr-json'], 'utf8'));
  const result = scorePR(prData, config);

  console.log(JSON.stringify(result, null, 2));

  if (result.blocked) {
    console.error(`\n🚫 BLOCKED — risk score ${result.score} exceeds merge gate (${config.mergeGate.blockAbove})`);
    process.exit(1);
  }
  if (result.requiresSecurityReview) {
    console.error(`\n⚠️  Security review required — risk score ${result.score}`);
  }
}
