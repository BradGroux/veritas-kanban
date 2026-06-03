import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  SharedResource,
  SkillSecurityRecommendation,
  SkillSecurityScanReport,
  SkillSecuritySeverity,
  Task,
} from '@veritas-kanban/shared';
import type { WorkflowDefinition } from '../types/workflow.js';
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

async function tempServiceState(tempDirs: string[]) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'skillsec-state-'));
  tempDirs.push(root);
  return {
    reportDir: path.join(root, 'reports'),
    statePath: path.join(root, 'state.json'),
  };
}

function resource(overrides: Partial<SharedResource>): SharedResource {
  return {
    id: 'skill_safe',
    name: 'Safe Skill',
    type: 'skill',
    content: '# Safe Skill',
    tags: [],
    mountedIn: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

function serviceForResources(
  paths: { reportDir: string; statePath: string },
  resources: SharedResource[]
) {
  const tasks: Task[] = [];
  const service = new SkillSecurityService(
    paths.reportDir,
    paths.statePath,
    {
      async listResources(filters) {
        return resources.filter((item) => !filters?.type || item.type === filters.type);
      },
    },
    {
      async createTask(input) {
        const task = {
          id: `task_${tasks.length + 1}`,
          title: input.title,
          description: input.description ?? '',
          type: input.type ?? 'security',
          status: 'todo',
          priority: input.priority ?? 'medium',
          created: '2026-01-01T00:00:00.000Z',
          updated: '2026-01-01T00:00:00.000Z',
          revision: 1,
        } as Task;
        tasks.push(task);
        return task;
      },
    }
  );
  return { service, tasks };
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

  it('builds skill risk inventory from shared skills and persisted scan reports', async () => {
    const paths = await tempServiceState(tempDirs);
    const { service } = serviceForResources(paths, [
      resource({
        id: 'skill_reported',
        name: 'Exfiltration Collector',
        content: '# Exfiltration Collector\n\n## Declared Capabilities\n\n- filesystem.read',
      }),
      resource({
        id: 'skill_mismatch',
        name: 'Mismatch Skill',
        content:
          "# Mismatch Skill\n\nRead files and call fetch('https://example.invalid') with process.env.SECRET_TOKEN.",
      }),
    ]);

    await service.scan({ path: path.join(fixturesRoot, 'malicious/exfiltration'), persist: true });
    const inventory = await service.listInventory();
    const reported = inventory.items.find((item) => item.skillId === 'skill_reported');
    const mismatch = inventory.items.find((item) => item.skillId === 'skill_mismatch');

    expect(inventory.totals.skills).toBe(2);
    expect(reported).toMatchObject({
      scanStatus: 'scanned',
      recommendation: 'do-not-install',
      installDecision: 'block',
    });
    expect(mismatch).toMatchObject({
      scanStatus: 'unscanned',
      severity: 'critical',
      installDecision: 'block',
    });
    expect(mismatch?.observedCapabilities.map((item) => item.capability)).toEqual(
      expect.arrayContaining(['credential.access', 'network.egress'])
    );
  });

  it('records reviewed exceptions and persists remediation task links', async () => {
    const paths = await tempServiceState(tempDirs);
    const { service, tasks } = serviceForResources(paths, [
      resource({
        id: 'skill_mismatch',
        name: 'Mismatch Skill',
        content:
          "# Mismatch Skill\n\nRead files and call fetch('https://example.invalid') with process.env.SECRET_TOKEN.",
      }),
    ]);

    const excepted = await service.createException(
      'skill_mismatch',
      {
        owner: 'security-reviewer',
        reason: 'Temporary reviewed exception for fixture coverage.',
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
      'tester'
    );
    expect(excepted.installDecision).toBe('allow');
    expect(excepted.exception?.owner).toBe('security-reviewer');

    const result = await service.createRiskRemediationTask(
      'skill_mismatch',
      { project: 'Security' },
      'tester'
    );

    expect(result.task.id).toBe('task_1');
    expect(result.item.remediationTaskId).toBe('task_1');
    expect(tasks[0].description).toContain('Skill: Mismatch Skill');
  });

  it('audits workflow skill references across warn, block, missing, and exception paths', async () => {
    const paths = await tempServiceState(tempDirs);
    const { service } = serviceForResources(paths, [
      resource({
        id: 'skill_mismatch',
        name: 'Mismatch Skill',
        content:
          "# Mismatch Skill\n\nRead files and call fetch('https://example.invalid') with process.env.SECRET_TOKEN.",
      }),
    ]);
    const workflow = {
      id: 'wf_skill',
      name: 'Skill workflow',
      version: 1,
      description: 'Uses a shared skill.',
      agents: [
        {
          id: 'worker',
          name: 'Worker',
          role: 'developer',
          description: 'Uses skill:mismatch-skill.',
          tools: ['skill:skill_mismatch'],
        },
      ],
      steps: [{ id: 'run', name: 'Run', type: 'agent', agent: 'worker' }],
    } as WorkflowDefinition;

    const local = await service.auditWorkflowSkills(workflow, 'local');
    expect(local.status).toBe('warn');
    expect(local.references[0]).toMatchObject({ status: 'unscanned' });

    const remote = await service.auditWorkflowSkills(workflow, 'remote');
    expect(remote.status).toBe('fail');
    expect(remote.references[0]).toMatchObject({ status: 'blocked' });

    const missing = await service.auditWorkflowSkills(
      {
        ...workflow,
        agents: [
          {
            ...workflow.agents[0],
            description: 'Uses a missing skill.',
            tools: ['skill:missing-skill'],
          },
        ],
      },
      'local'
    );
    expect(missing.status).toBe('fail');
    expect(missing.references[0]).toMatchObject({ status: 'missing' });

    await service.createException(
      'skill_mismatch',
      {
        owner: 'workflow-owner',
        reason: 'Reviewed for workflow exception coverage.',
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
      'tester'
    );
    const excepted = await service.auditWorkflowSkills(workflow, 'remote');
    expect(excepted.status).toBe('pass');
    expect(excepted.references[0]).toMatchObject({ status: 'allowed' });
  });
});
