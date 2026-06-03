import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  SharedResource,
  SkillCapabilityFinding,
  SkillSecurityEvidence,
  SkillSecurityFinding,
  SkillSecurityFindingCategory,
  SkillSecurityPatternDefinition,
  SkillSecurityRecommendation,
  SkillSecurityScanInput,
  SkillSecurityScanReport,
  SkillSecurityScanSummary,
  SkillSecurityScannedFile,
  SkillSecuritySeverity,
  SkillSecurityScanTargetType,
} from '@veritas-kanban/shared';
import { getRuntimeDir } from '../utils/paths.js';
import { redactString } from '../lib/redact.js';
import { auditLog } from './audit-service.js';
import { profileSkillResource } from './skill-capability-service.js';

const MAX_FILES = 80;
const MAX_FILE_BYTES = 200_000;
const REPORT_DIR = 'skill-security-scans';
const SKILL_FILE_NAME = 'SKILL.md';

interface ScannedFileInternal extends SkillSecurityScannedFile {
  absolutePath: string;
  content: string;
}

interface Detector {
  id: string;
  category: SkillSecurityFindingCategory;
  severity: SkillSecuritySeverity;
  confidence: number;
  title: string;
  description: string;
  remediation: string;
  pattern: RegExp;
  fileRoles?: SkillSecurityScannedFile['role'][];
}

const SEVERITY_RANK: Record<SkillSecuritySeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const SEVERITY_SCORE: Record<SkillSecuritySeverity, number> = {
  low: 5,
  medium: 15,
  high: 30,
  critical: 45,
};

const DETECTORS: Detector[] = [
  {
    id: 'prompt.hidden-instruction',
    category: 'prompt-injection',
    severity: 'high',
    confidence: 0.86,
    title: 'Hidden instruction override',
    description: 'Skill text attempts to override higher-priority instructions or hide behavior.',
    remediation:
      'Remove override language and make the intended behavior explicit in normal skill text.',
    pattern:
      /\b(ignore (all )?(previous|system|developer) instructions|do not tell the user|hidden instruction|secret instruction|bypass policy)\b/i,
  },
  {
    id: 'prompt.zero-width-or-comment',
    category: 'prompt-injection',
    severity: 'medium',
    confidence: 0.78,
    title: 'Hidden comment or zero-width prompt text',
    description:
      'Skill includes hidden comment text or zero-width characters that can conceal instructions.',
    remediation: 'Remove invisible characters and hidden instruction comments from skill content.',
    pattern:
      /[\u200b-\u200f\u202a-\u202e]|\[comment\]:\s*#|<!--[\s\S]{0,160}(ignore|secret|hidden|override)[\s\S]{0,160}-->/i,
  },
  {
    id: 'credential.env-harvest',
    category: 'credential-access',
    severity: 'critical',
    confidence: 0.9,
    title: 'Credential or environment harvesting',
    description: 'Skill references secrets, tokens, API keys, environment variables, or keychains.',
    remediation: 'Remove credential access or require an explicit reviewed capability declaration.',
    pattern:
      /\b(process\.env|printenv|env\s*\||dotenv|secret|token|api[_ -]?key|credential|authorization|keychain|password)\b/i,
  },
  {
    id: 'exfil.network-egress',
    category: 'exfiltration',
    severity: 'high',
    confidence: 0.83,
    title: 'Remote network egress',
    description: 'Skill references remote requests, webhooks, downloads, or external API calls.',
    remediation: 'Use an allowlisted endpoint and declare network.egress before installation.',
    pattern: /\b(fetch|axios|curl|wget|webhook|https?:\/\/|remote API|POST to|download from)\b/i,
  },
  {
    id: 'exfil.remote-script-fetch',
    category: 'unsafe-execution',
    severity: 'critical',
    confidence: 0.94,
    title: 'Remote script fetch and execute',
    description: 'Skill fetches remote code and pipes it into a shell or interpreter.',
    remediation:
      'Vendor reviewed scripts locally or require checksum verification before execution.',
    pattern: /\b(curl|wget)\b[^\n|;&]{0,160}\|\s*(bash|sh|zsh|python|node)\b/i,
  },
  {
    id: 'execution.subprocess-or-eval',
    category: 'unsafe-execution',
    severity: 'high',
    confidence: 0.88,
    title: 'Subprocess, eval, or dynamic code execution',
    description: 'Skill uses shell execution, child processes, eval, or dynamic imports.',
    remediation: 'Replace dynamic execution with bounded tool calls or reviewed scripts.',
    pattern:
      /\b(child_process|execFile|spawn|subprocess|eval\s*\(|Function\s*\(|dynamic import|shell command|bash|zsh|powershell)\b/i,
  },
  {
    id: 'persistence.background-execution',
    category: 'persistence',
    severity: 'high',
    confidence: 0.84,
    title: 'Persistent or recurring execution',
    description: 'Skill references cron, daemons, launch agents, watchers, or background jobs.',
    remediation:
      'Move recurring execution into Veritas automation with explicit owner, schedule, and audit trail.',
    pattern:
      /\b(cron|crontab|launchd|systemd|daemon|background job|watcher|while true|keep running|recurring automation)\b/i,
  },
  {
    id: 'persistence.self-modification',
    category: 'persistence',
    severity: 'high',
    confidence: 0.8,
    title: 'Self-modification',
    description: 'Skill appears to modify its own instructions or files.',
    remediation:
      'Remove self-modifying behavior and ship changes through reviewed resource updates.',
    pattern:
      /\b(modify (this )?skill|rewrite SKILL\.md|edit its own files|self-modify|overwrite this file)\b/i,
  },
  {
    id: 'memory.poisoning',
    category: 'memory-poisoning',
    severity: 'high',
    confidence: 0.8,
    title: 'Memory poisoning',
    description: 'Skill attempts to write durable memory or persistent instructions.',
    remediation: 'Restrict memory writes to explicit user-approved memory workflows.',
    pattern:
      /\b(write memory|update memory|remember this|persist this instruction|durable memory|poison memory)\b/i,
  },
  {
    id: 'trigger.overbroad',
    category: 'trigger-risk',
    severity: 'medium',
    confidence: 0.72,
    title: 'Overbroad trigger language',
    description: 'Skill claims broad activation across most or all requests.',
    remediation: 'Narrow trigger rules to concrete task classes and avoid shadowing other skills.',
    pattern:
      /\b(always use|for any request|all tasks|every task|whenever possible|default skill|takes precedence)\b/i,
  },
];

const FILE_READ_PATTERN =
  /\b(readFile|readdir|createReadStream|glob|grep|rg\s+|cat\s+|find\s+|read files|list files)\b/i;
const NETWORK_PATTERN = /\b(fetch|axios|curl|wget|webhook|https?:\/\/|POST to|remote API)\b/i;

function severityMax(values: SkillSecuritySeverity[]): SkillSecuritySeverity {
  return values.reduce<SkillSecuritySeverity>(
    (max, value) => (SEVERITY_RANK[value] > SEVERITY_RANK[max] ? value : max),
    'low'
  );
}

function recommendationFor(
  severity: SkillSecuritySeverity,
  riskScore: number
): SkillSecurityRecommendation {
  if (severity === 'critical' || riskScore >= 70) return 'do-not-install';
  if (severity === 'high' || riskScore >= 30) return 'caution';
  return 'safe';
}

function reportId(targetPath: string, findings: SkillSecurityFinding[]): string {
  const hash = crypto
    .createHash('sha256')
    .update(`${targetPath}:${Date.now()}:${findings.map((finding) => finding.id).join('|')}`)
    .digest('hex')
    .slice(0, 8);
  return `skillscan_${Date.now()}_${hash}`;
}

function safeExcerpt(line: string): string {
  return redactString(line.trim()).slice(0, 240);
}

function evidenceFor(file: ScannedFileInternal, pattern: RegExp): SkillSecurityEvidence[] {
  const lines = file.content.split(/\r?\n/);
  const evidence: SkillSecurityEvidence[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!pattern.test(lines[index])) continue;
    evidence.push({
      file: file.path,
      line: index + 1,
      excerpt: safeExcerpt(lines[index]),
    });
    if (evidence.length >= 3) break;
  }
  return evidence;
}

function skillNameFromContent(content: string, fallback: string): string {
  const heading = content.match(/^#\s+(.+)$/m);
  if (heading) return heading[1].trim();
  return fallback;
}

function roleForFile(relativePath: string): SkillSecurityScannedFile['role'] {
  const basename = path.basename(relativePath);
  if (basename === SKILL_FILE_NAME) return 'skill';
  if (/^(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|requirements\.txt)$/i.test(basename)) {
    return 'manifest';
  }
  if (/\.(?:sh|bash|zsh|js|mjs|cjs|ts|tsx|py|rb|pl|ps1)$/i.test(basename)) return 'script';
  return 'asset';
}

function shouldIncludeFile(relativePath: string): boolean {
  const parts = relativePath.split(path.sep);
  if (parts.some((part) => ['node_modules', '.git', 'dist', 'out', 'build'].includes(part))) {
    return false;
  }
  const basename = path.basename(relativePath);
  return (
    basename === SKILL_FILE_NAME ||
    /^(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|requirements\.txt)$/i.test(basename) ||
    parts[0] === 'scripts' ||
    parts[0] === 'assets'
  );
}

async function walkFiles(root: string, dir = root, depth = 0): Promise<string[]> {
  if (depth > 4) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    const relative = path.relative(root, absolute);
    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'dist', 'out', 'build'].includes(entry.name)) continue;
      files.push(...(await walkFiles(root, absolute, depth + 1)));
    } else if (entry.isFile() && shouldIncludeFile(relative)) {
      files.push(absolute);
    }
    if (files.length >= MAX_FILES) break;
  }
  return files.slice(0, MAX_FILES);
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function referencedFiles(content: string, root: string): string[] {
  const matches = content.match(/\b(?:scripts|assets)\/[A-Za-z0-9._/-]+/g) ?? [];
  return Array.from(new Set(matches))
    .map((relative) => path.resolve(root, relative))
    .filter((absolute) => isWithinRoot(root, absolute));
}

async function readScannedFile(filePath: string, root: string): Promise<ScannedFileInternal> {
  const stat = await fs.stat(filePath);
  const handle = await fs.open(filePath, 'r');
  let buffer = Buffer.alloc(0);
  try {
    const bytesToRead = Math.min(stat.size, MAX_FILE_BYTES);
    buffer = Buffer.alloc(bytesToRead);
    await handle.read(buffer, 0, bytesToRead, 0);
  } finally {
    await handle.close();
  }
  const relative = path.relative(root, filePath) || path.basename(filePath);
  return {
    absolutePath: filePath,
    path: relative,
    bytes: stat.size,
    role: roleForFile(relative),
    truncated: stat.size > MAX_FILE_BYTES,
    content: buffer.toString('utf8'),
  };
}

function scanDetectors(files: ScannedFileInternal[]): SkillSecurityFinding[] {
  const findings: SkillSecurityFinding[] = [];
  for (const detector of DETECTORS) {
    const evidence = files
      .filter((file) => !detector.fileRoles || detector.fileRoles.includes(file.role))
      .flatMap((file) => evidenceFor(file, detector.pattern));
    if (evidence.length === 0) continue;
    findings.push({
      id: detector.id,
      patternId: detector.id,
      category: detector.category,
      severity: detector.severity,
      confidence: detector.confidence,
      title: detector.title,
      description: detector.description,
      remediation: detector.remediation,
      evidence,
    });
  }
  return findings;
}

function scanFileToNetworkExfil(files: ScannedFileInternal[]): SkillSecurityFinding[] {
  const findings: SkillSecurityFinding[] = [];
  for (const file of files) {
    const readEvidence = evidenceFor(file, FILE_READ_PATTERN);
    const networkEvidence = evidenceFor(file, NETWORK_PATTERN);
    if (readEvidence.length === 0 || networkEvidence.length === 0) continue;
    findings.push({
      id: 'exfil.file-to-network',
      patternId: 'exfil.file-to-network',
      category: 'exfiltration',
      severity: 'critical',
      confidence: 0.88,
      title: 'File-to-network exfiltration path',
      description: 'The same file references local file access and remote network egress.',
      remediation:
        'Remove the combined file read and network send path or require explicit review.',
      evidence: [...readEvidence.slice(0, 2), ...networkEvidence.slice(0, 2)],
    });
  }
  return findings;
}

function scanPackageManifests(files: ScannedFileInternal[]): SkillSecurityFinding[] {
  const findings: SkillSecurityFinding[] = [];
  for (const file of files.filter((candidate) => candidate.role === 'manifest')) {
    if (path.basename(file.path) !== 'package.json') continue;
    let parsed: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    try {
      parsed = JSON.parse(file.content) as typeof parsed;
    } catch {
      continue;
    }
    const dependencies = { ...(parsed.dependencies ?? {}), ...(parsed.devDependencies ?? {}) };
    const risky = Object.entries(dependencies).filter(([, version]) =>
      /^(latest|\*|workspace:\*|file:|git\+|https?:\/\/|\^|~)/i.test(version)
    );
    if (risky.length === 0) continue;
    findings.push({
      id: 'dependency.unpinned',
      patternId: 'dependency.unpinned',
      category: 'dependency-risk',
      severity: 'medium',
      confidence: 0.74,
      title: 'Unpinned or non-registry dependency reference',
      description:
        'Skill package manifest contains dependencies that are not exact registry versions.',
      remediation: 'Pin dependency versions or remove package execution from the skill.',
      evidence: risky.slice(0, 5).map(([name, version]) => ({
        file: file.path,
        line: 1,
        excerpt: safeExcerpt(`${name}@${version}`),
      })),
    });
  }
  return findings;
}

function severityFromCapability(
  severity: SkillCapabilityFinding['severity']
): SkillSecuritySeverity {
  return severity;
}

function scanCapabilityMismatch(
  profile: ReturnType<typeof profileSkillResource>
): SkillSecurityFinding[] {
  return profile.findings
    .filter((finding) => finding.kind !== 'declared-unobserved')
    .map((finding) => ({
      id: `capability.${finding.id}`,
      patternId: `capability.${finding.kind}`,
      category: 'capability-mismatch',
      severity: severityFromCapability(finding.severity),
      confidence: 0.86,
      title: 'Declared capability mismatch',
      description: finding.message,
      remediation: finding.remediation,
      evidence:
        finding.evidence.length > 0
          ? finding.evidence.map((evidence) => ({
              file: SKILL_FILE_NAME,
              line: 1,
              excerpt: safeExcerpt(evidence.excerpt ?? evidence.label),
            }))
          : [{ file: SKILL_FILE_NAME, line: 1, excerpt: finding.message }],
    }));
}

function dedupeFindings(findings: SkillSecurityFinding[]): SkillSecurityFinding[] {
  const byId = new Map<string, SkillSecurityFinding>();
  for (const finding of findings) {
    const existing = byId.get(finding.id);
    if (!existing) {
      byId.set(finding.id, finding);
      continue;
    }
    existing.evidence.push(...finding.evidence);
    existing.evidence = existing.evidence.slice(0, 5);
    existing.confidence = Math.max(existing.confidence, finding.confidence);
  }
  return Array.from(byId.values()).sort((a, b) => {
    const severity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    return severity !== 0 ? severity : a.id.localeCompare(b.id);
  });
}

function riskScoreFor(findings: SkillSecurityFinding[]): number {
  return Math.min(
    100,
    findings.reduce((total, finding) => total + SEVERITY_SCORE[finding.severity], 0)
  );
}

function renderMarkdown(report: Omit<SkillSecurityScanReport, 'reportMarkdown'>): string {
  const lines = [
    `# Skill Security Scan: ${report.skillName}`,
    '',
    `- Scan ID: \`${report.id}\``,
    `- Target: \`${report.targetPath}\``,
    `- Severity: \`${report.severity}\``,
    `- Risk score: \`${report.riskScore}\``,
    `- Recommendation: \`${report.recommendation}\``,
    `- Files scanned: \`${report.files.length}\``,
    '',
    '## Findings',
    '',
  ];

  if (report.findings.length === 0) {
    lines.push('No findings.');
  } else {
    for (const finding of report.findings) {
      lines.push(`### ${finding.patternId}: ${finding.title}`);
      lines.push('');
      lines.push(`- Severity: \`${finding.severity}\``);
      lines.push(`- Confidence: \`${finding.confidence}\``);
      lines.push(`- Category: \`${finding.category}\``);
      lines.push(`- Remediation: ${finding.remediation}`);
      for (const evidence of finding.evidence.slice(0, 3)) {
        lines.push(`- Evidence: \`${evidence.file}:${evidence.line}\` ${evidence.excerpt}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

export class SkillSecurityService {
  constructor(private readonly reportRoot = path.join(getRuntimeDir(), REPORT_DIR)) {}

  getPatterns(): SkillSecurityPatternDefinition[] {
    return [
      ...DETECTORS.map((detector) => ({
        id: detector.id,
        category: detector.category,
        severity: detector.severity,
        title: detector.title,
        description: detector.description,
      })),
      {
        id: 'exfil.file-to-network',
        category: 'exfiltration',
        severity: 'critical',
        title: 'File-to-network exfiltration path',
        description: 'The same file references local file access and remote network egress.',
      },
      {
        id: 'dependency.unpinned',
        category: 'dependency-risk',
        severity: 'medium',
        title: 'Unpinned or non-registry dependency reference',
        description: 'Package manifest contains dependencies that are not exact registry versions.',
      },
      {
        id: 'capability.undeclared-observed',
        category: 'capability-mismatch',
        severity: 'high',
        title: 'Declared capability mismatch',
        description: 'Observed behavior exceeds declared skill capabilities.',
      },
    ];
  }

  async scan(input: SkillSecurityScanInput): Promise<SkillSecurityScanReport> {
    const targetPath = path.resolve(input.path);
    const stat = await fs.stat(targetPath);
    const targetType: SkillSecurityScanTargetType = stat.isDirectory()
      ? 'skill-directory'
      : 'skill-file';
    const root = stat.isDirectory() ? targetPath : path.dirname(targetPath);
    const files = await this.collectFiles(
      targetPath,
      targetType,
      input.includeReferencedFiles ?? true
    );
    const skillFile =
      files.find((file) => path.basename(file.path) === SKILL_FILE_NAME) ?? files[0];
    const skillName = skillNameFromContent(skillFile.content, path.basename(root));
    const capabilityProfile = profileSkillResource({
      id: crypto.createHash('sha1').update(targetPath).digest('hex').slice(0, 12),
      name: skillName,
      type: 'skill',
      content: skillFile.content,
      tags: [],
      mountedIn: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    } satisfies SharedResource);
    const findings = dedupeFindings([
      ...scanDetectors(files),
      ...scanFileToNetworkExfil(files),
      ...scanPackageManifests(files),
      ...scanCapabilityMismatch(capabilityProfile),
    ]);
    const riskScore = riskScoreFor(findings);
    const severity = findings.length
      ? severityMax(findings.map((finding) => finding.severity))
      : 'low';
    const id = reportId(targetPath, findings);
    const summary: Omit<SkillSecurityScanReport, 'reportMarkdown'> = {
      id,
      targetPath,
      targetType,
      skillName,
      scannedAt: new Date().toISOString(),
      severity,
      riskScore,
      recommendation: recommendationFor(severity, riskScore),
      findingCount: findings.length,
      files: files.map(({ absolutePath: _absolutePath, content: _content, ...file }) => file),
      findings,
      capabilityProfile,
    };
    let report: SkillSecurityScanReport = {
      ...summary,
      reportMarkdown: renderMarkdown(summary),
    };

    if (input.persist !== false) {
      report = await this.persist(report);
    }

    await auditLog({
      action: 'skill.security.scan.completed',
      actor: 'system',
      resource: targetPath,
      details: {
        scanId: report.id,
        severity: report.severity,
        riskScore: report.riskScore,
        recommendation: report.recommendation,
        findingCount: report.findingCount,
      },
    });

    return report;
  }

  async listReports(): Promise<SkillSecurityScanSummary[]> {
    await fs.mkdir(this.reportRoot, { recursive: true });
    const entries = await fs.readdir(this.reportRoot);
    const summaries = await Promise.all(
      entries
        .filter((entry) => entry.endsWith('.json'))
        .map(async (entry) => {
          const content = await fs.readFile(path.join(this.reportRoot, entry), 'utf8');
          const report = JSON.parse(content) as SkillSecurityScanReport;
          const {
            files: _files,
            findings: _findings,
            capabilityProfile: _profile,
            reportMarkdown: _markdown,
            ...summary
          } = report;
          return summary;
        })
    );
    return summaries.sort((a, b) => b.scannedAt.localeCompare(a.scannedAt));
  }

  async getReport(id: string): Promise<SkillSecurityScanReport | null> {
    try {
      const content = await fs.readFile(path.join(this.reportRoot, `${id}.json`), 'utf8');
      return JSON.parse(content) as SkillSecurityScanReport;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  private async collectFiles(
    targetPath: string,
    targetType: SkillSecurityScanTargetType,
    includeReferencedFiles: boolean
  ): Promise<ScannedFileInternal[]> {
    if (targetType === 'skill-directory') {
      const paths = await walkFiles(targetPath);
      if (!paths.some((filePath) => path.basename(filePath) === SKILL_FILE_NAME)) {
        throw new Error(`Skill directory must contain ${SKILL_FILE_NAME}`);
      }
      return Promise.all(paths.map((filePath) => readScannedFile(filePath, targetPath)));
    }

    const root = path.dirname(targetPath);
    const files = [await readScannedFile(targetPath, root)];
    if (includeReferencedFiles) {
      const references = referencedFiles(files[0].content, root);
      for (const reference of references.slice(0, MAX_FILES - 1)) {
        try {
          const stat = await fs.stat(reference);
          if (stat.isFile()) {
            files.push(await readScannedFile(reference, root));
          }
        } catch {
          // Missing referenced files are handled by future scanner rules.
        }
      }
    }
    return files;
  }

  private async persist(report: SkillSecurityScanReport): Promise<SkillSecurityScanReport> {
    await fs.mkdir(this.reportRoot, { recursive: true });
    const jsonPath = path.join(this.reportRoot, `${report.id}.json`);
    const markdownPath = path.join(this.reportRoot, `${report.id}.md`);
    const persisted = {
      ...report,
      persistedJsonPath: jsonPath,
      persistedMarkdownPath: markdownPath,
    };
    await fs.writeFile(jsonPath, JSON.stringify(persisted, null, 2), 'utf8');
    await fs.writeFile(markdownPath, persisted.reportMarkdown, 'utf8');
    return persisted;
  }
}

let instance: SkillSecurityService | null = null;

export function getSkillSecurityService(): SkillSecurityService {
  if (!instance) {
    instance = new SkillSecurityService();
  }
  return instance;
}
