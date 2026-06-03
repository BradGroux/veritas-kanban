import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  SkillSecurityRecommendation,
  SkillSecurityScanReport,
  SkillSecuritySeverity,
} from '@veritas-kanban/shared';
import { SkillSecurityService } from '../services/skill-security-service.js';

vi.mock('../services/audit-service.js', () => ({
  auditLog: vi.fn(async () => undefined),
}));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.resolve(__dirname, '../__fixtures__/skill-security');

const severityRank: Record<SkillSecuritySeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

interface ExpectedFinding {
  patternId: string;
  severity: SkillSecuritySeverity;
}

interface FixtureExpectation {
  expectedFindings: ExpectedFinding[];
  absentPatternIds: string[];
  maxSeverity: SkillSecuritySeverity;
  recommendation: SkillSecurityRecommendation;
  redactedAbsentText?: string;
}

const fixturePaths = [
  'benign/document-formatter',
  'benign/review-checklist',
  'malicious/capability-mismatch',
  'malicious/exfiltration',
  'malicious/hidden-instruction',
  'malicious/persistence',
  'malicious/remote-script',
  'malicious/unpinned-dependency',
];

async function tempReportDir(tempDirs: string[]): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'skillscan-'));
  tempDirs.push(dir);
  return dir;
}

async function readExpectation(fixturePath: string): Promise<FixtureExpectation> {
  const content = await readFile(path.join(fixturesRoot, fixturePath, 'expected.json'), 'utf8');
  return JSON.parse(content) as FixtureExpectation;
}

function patternSeverity(
  report: SkillSecurityScanReport,
  patternId: string
): SkillSecuritySeverity[] {
  return report.findings
    .filter((finding) => finding.patternId === patternId)
    .map((finding) => finding.severity);
}

function assertMaxSeverityAtMost(
  severity: SkillSecuritySeverity,
  maxSeverity: SkillSecuritySeverity
) {
  expect(severityRank[severity]).toBeLessThanOrEqual(severityRank[maxSeverity]);
}

describe('SkillSecurityService', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it.each(fixturePaths)('matches fixture contract for %s', async (fixturePath) => {
    const expectation = await readExpectation(fixturePath);
    const service = new SkillSecurityService(await tempReportDir(tempDirs));
    const report = await service.scan({
      path: path.join(fixturesRoot, fixturePath),
      persist: false,
    });

    for (const expected of expectation.expectedFindings) {
      expect(patternSeverity(report, expected.patternId)).toContain(expected.severity);
    }

    for (const absentPatternId of expectation.absentPatternIds) {
      expect(report.findings.some((finding) => finding.patternId === absentPatternId)).toBe(false);
    }

    assertMaxSeverityAtMost(report.severity, expectation.maxSeverity);
    expect(report.recommendation).toBe(expectation.recommendation);

    if (expectation.redactedAbsentText) {
      expect(JSON.stringify(report)).not.toContain(expectation.redactedAbsentText);
    }
  });

  it('scans a single SKILL.md and follows referenced scripts when requested', async () => {
    const service = new SkillSecurityService(await tempReportDir(tempDirs));
    const report = await service.scan({
      path: path.join(fixturesRoot, 'malicious/exfiltration/SKILL.md'),
      persist: false,
      includeReferencedFiles: true,
    });

    expect(report.targetType).toBe('skill-file');
    expect(report.files.map((file) => file.path).sort()).toEqual([
      'SKILL.md',
      'scripts/collect.js',
    ]);
    expect(report.reportMarkdown).toContain('# Skill Security Scan: Exfiltration Collector');
    expect(patternSeverity(report, 'exfil.file-to-network')).toContain('critical');
  });

  it('persists redacted JSON and Markdown reports for audit review', async () => {
    const reportDir = await tempReportDir(tempDirs);
    const service = new SkillSecurityService(reportDir);

    const report = await service.scan({
      path: path.join(fixturesRoot, 'malicious/exfiltration'),
      persist: true,
    });

    expect(report.persistedJsonPath).toMatch(/\.json$/);
    expect(report.persistedMarkdownPath).toMatch(/\.md$/);

    const [json, markdown, summaries] = await Promise.all([
      readFile(report.persistedJsonPath ?? '', 'utf8'),
      readFile(report.persistedMarkdownPath ?? '', 'utf8'),
      service.listReports(),
    ]);

    expect(json).toContain('"patternId": "exfil.file-to-network"');
    expect(markdown).toContain('## Findings');
    expect(json).not.toContain('sk_test_example_placeholder_000000000000');
    expect(summaries[0]?.id).toBe(report.id);
    expect(summaries[0]).not.toHaveProperty('findings');
  });

  it('exposes all first-pass scanner patterns', () => {
    const service = new SkillSecurityService();
    expect(service.getPatterns().map((pattern) => pattern.id)).toEqual(
      expect.arrayContaining([
        'prompt.hidden-instruction',
        'prompt.zero-width-or-comment',
        'credential.env-harvest',
        'exfil.network-egress',
        'exfil.remote-script-fetch',
        'exfil.file-to-network',
        'execution.subprocess-or-eval',
        'persistence.background-execution',
        'persistence.self-modification',
        'memory.poisoning',
        'trigger.overbroad',
        'capability.undeclared-observed',
        'dependency.unpinned',
      ])
    );
  });
});
