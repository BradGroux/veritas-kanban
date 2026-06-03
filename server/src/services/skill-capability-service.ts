import type {
  CreateTaskInput,
  SharedResource,
  SkillCapabilityDefinition,
  SkillCapabilityEvidence,
  SkillCapabilityFinding,
  SkillCapabilityId,
  SkillCapabilityListFilters,
  SkillCapabilityObservation,
  SkillCapabilityProfile,
  SkillCapabilityRemediationTaskInput,
  SkillCapabilityRisk,
  SkillCapabilitySource,
  Task,
} from '@veritas-kanban/shared';
import { auditLog } from './audit-service.js';
import { getSharedResourcesService } from './shared-resources-service.js';
import { getTaskService } from './task-service.js';
import { redactString } from '../lib/redact.js';

interface SkillResourceProvider {
  listResources(filters?: { type?: 'skill' }): Promise<SharedResource[]>;
  getResource(id: string): Promise<SharedResource | null>;
}

interface TaskCreator {
  createTask(input: CreateTaskInput): Promise<Task>;
}

interface CapabilityPattern {
  id: string;
  capability: SkillCapabilityId;
  source: SkillCapabilitySource;
  confidence: number;
  pattern: RegExp;
  label: string;
}

export const SKILL_CAPABILITY_TAXONOMY: SkillCapabilityDefinition[] = [
  {
    id: 'filesystem.read',
    label: 'Filesystem Read',
    description: 'Reads local files, directories, manifests, or repository content.',
    risk: 'medium',
  },
  {
    id: 'filesystem.write',
    label: 'Filesystem Write',
    description: 'Creates, edits, deletes, or moves local files.',
    risk: 'high',
  },
  {
    id: 'shell.execute',
    label: 'Shell Execution',
    description: 'Runs shell commands, subprocesses, interpreters, or package scripts.',
    risk: 'high',
  },
  {
    id: 'network.egress',
    label: 'Network Egress',
    description: 'Calls remote URLs, APIs, webhooks, or downloads external resources.',
    risk: 'high',
  },
  {
    id: 'credential.access',
    label: 'Credential Access',
    description: 'Reads tokens, API keys, environment variables, secrets, or keychains.',
    risk: 'critical',
  },
  {
    id: 'external.message',
    label: 'External Messaging',
    description: 'Sends email, chat, comments, posts, issues, pull requests, or public replies.',
    risk: 'high',
  },
  {
    id: 'memory.write',
    label: 'Memory Write',
    description: 'Writes persistent agent memory, durable notes, or long-lived instructions.',
    risk: 'medium',
  },
  {
    id: 'task.mutate',
    label: 'Task Mutation',
    description:
      'Creates or changes Veritas tasks, projects, issues, PR metadata, or workflow state.',
    risk: 'medium',
  },
  {
    id: 'schedule.persist',
    label: 'Persistent Scheduling',
    description:
      'Creates recurring jobs, daemons, watchers, cron entries, or background automation.',
    risk: 'high',
  },
  {
    id: 'browser.session',
    label: 'Browser Session',
    description: 'Uses browser automation, cookies, authenticated tabs, or session storage.',
    risk: 'high',
  },
  {
    id: 'mcp.tool',
    label: 'MCP or Tool Access',
    description: 'Invokes plugins, connectors, MCP tools, or delegated tool runtimes.',
    risk: 'medium',
  },
];

const TAXONOMY_BY_ID = new Map(
  SKILL_CAPABILITY_TAXONOMY.map((definition) => [definition.id, definition])
);
const CAPABILITY_IDS = new Set(SKILL_CAPABILITY_TAXONOMY.map((definition) => definition.id));
const RISK_RANK: Record<SkillCapabilityRisk, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const DECLARED_HEADING = /^#{2,4}\s+declared capabilities\b/i;
const NEXT_HEADING = /^#{1,4}\s+/;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

const CAPABILITY_ALIASES: Record<string, SkillCapabilityId> = {
  all: 'mcp.tool',
  '*': 'mcp.tool',
  'fs.read': 'filesystem.read',
  'file.read': 'filesystem.read',
  'filesystem.read': 'filesystem.read',
  'fs.write': 'filesystem.write',
  'file.write': 'filesystem.write',
  'filesystem.write': 'filesystem.write',
  shell: 'shell.execute',
  'shell.execute': 'shell.execute',
  command: 'shell.execute',
  network: 'network.egress',
  'network.egress': 'network.egress',
  http: 'network.egress',
  credentials: 'credential.access',
  secrets: 'credential.access',
  'credential.access': 'credential.access',
  messaging: 'external.message',
  'external.message': 'external.message',
  memory: 'memory.write',
  'memory.write': 'memory.write',
  tasks: 'task.mutate',
  'task.mutate': 'task.mutate',
  schedule: 'schedule.persist',
  'schedule.persist': 'schedule.persist',
  browser: 'browser.session',
  'browser.session': 'browser.session',
  mcp: 'mcp.tool',
  tool: 'mcp.tool',
  'mcp.tool': 'mcp.tool',
};

const OBSERVED_PATTERNS: CapabilityPattern[] = [
  {
    id: 'node-fs-read',
    capability: 'filesystem.read',
    source: 'content-pattern',
    confidence: 0.82,
    pattern:
      /\b(readFile|readdir|createReadStream|glob|grep|ripgrep|rg\s+|cat\s+|find\s+|list files|read files)\b/i,
    label: 'File read or enumeration reference',
  },
  {
    id: 'node-fs-write',
    capability: 'filesystem.write',
    source: 'content-pattern',
    confidence: 0.85,
    pattern:
      /\b(writeFile|appendFile|unlink|rm\s+-rf|mv\s+|apply_patch|edit files|write files|delete files)\b/i,
    label: 'File write or deletion reference',
  },
  {
    id: 'subprocess',
    capability: 'shell.execute',
    source: 'content-pattern',
    confidence: 0.9,
    pattern:
      /\b(child_process|execFile|spawn|subprocess|shell command|bash|zsh|powershell|pnpm\s+|npm\s+|python\s+|node\s+)\b/i,
    label: 'Shell or subprocess reference',
  },
  {
    id: 'remote-network',
    capability: 'network.egress',
    source: 'content-pattern',
    confidence: 0.86,
    pattern: /\b(fetch|axios|curl|wget|webhook|remote API|https?:\/\/|POST to|download from)\b/i,
    label: 'Remote network call reference',
  },
  {
    id: 'credential-reference',
    capability: 'credential.access',
    source: 'content-pattern',
    confidence: 0.92,
    pattern:
      /\b(process\.env|environment variable|env var|secret|token|api[_ -]?key|credential|authorization|keychain|password)\b/i,
    label: 'Credential or secret reference',
  },
  {
    id: 'external-send',
    capability: 'external.message',
    source: 'content-pattern',
    confidence: 0.84,
    pattern:
      /\b(send email|post message|send message|reply in|slack|teams|discord|twitter|tweet|github comment|create issue|create pull request|gh issue|gh pr)\b/i,
    label: 'External message or public write reference',
  },
  {
    id: 'memory-write',
    capability: 'memory.write',
    source: 'content-pattern',
    confidence: 0.78,
    pattern:
      /\b(write memory|update memory|remember this|persisted note|durable memory|memory folder)\b/i,
    label: 'Persistent memory reference',
  },
  {
    id: 'task-mutation',
    capability: 'task.mutate',
    source: 'content-pattern',
    confidence: 0.8,
    pattern:
      /\b(create task|update task|close issue|open issue|merge PR|create PR|kanban mutation|change status)\b/i,
    label: 'Task or issue mutation reference',
  },
  {
    id: 'persistent-schedule',
    capability: 'schedule.persist',
    source: 'content-pattern',
    confidence: 0.85,
    pattern:
      /\b(cron|schedule recurring|recurring automation|daemon|launchd|systemd|background job|watcher|keep running)\b/i,
    label: 'Persistent schedule reference',
  },
  {
    id: 'browser-session',
    capability: 'browser.session',
    source: 'content-pattern',
    confidence: 0.82,
    pattern:
      /\b(playwright|browser session|chrome|authenticated browser|cookies?|localStorage|sessionStorage)\b/i,
    label: 'Browser or session reference',
  },
  {
    id: 'mcp-tool',
    capability: 'mcp.tool',
    source: 'content-pattern',
    confidence: 0.75,
    pattern: /\b(MCP|connector|plugin|tool call|tool runtime|use tool|invoke tool)\b/i,
    label: 'MCP or tool runtime reference',
  },
  {
    id: 'script-reference',
    capability: 'shell.execute',
    source: 'script-reference',
    confidence: 0.7,
    pattern: /\b(scripts?\/[A-Za-z0-9._/-]+|\.sh\b|\.py\b|\.mjs\b|\.js\b)\b/i,
    label: 'Referenced executable script',
  },
];

function normalizeToken(value: string): string {
  return value
    .trim()
    .replace(/^[-*`'"\s]+|[`'"\s,]+$/g, '')
    .replace(/_/g, '.')
    .toLowerCase();
}

function normalizeCapability(value: string): SkillCapabilityId | '*' | null {
  const raw = value.trim().replace(/^`|`$/g, '');
  if (raw === '*' || raw.toLowerCase() === 'all') return '*';
  const token = normalizeToken(value);
  if (token === '*' || token === 'all') return '*';
  if (CAPABILITY_IDS.has(token as SkillCapabilityId)) return token as SkillCapabilityId;
  return CAPABILITY_ALIASES[token] ?? null;
}

function uniqueCapabilities(
  values: Array<SkillCapabilityId | '*' | null>
): Array<SkillCapabilityId | '*'> {
  return Array.from(
    new Set(values.filter((value): value is SkillCapabilityId | '*' => value !== null))
  );
}

function parseInlineCapabilities(value: string): Array<SkillCapabilityId | '*'> {
  const cleaned = value
    .replace(/^\s*capabilities\s*:\s*/i, '')
    .trim()
    .replace(/^\[|\]$/g, '');
  return uniqueCapabilities(cleaned.split(/[,\s]+/).map(normalizeCapability));
}

function parseDeclaredCapabilities(content: string): {
  capabilities: SkillCapabilityId[];
  wildcard: boolean;
  sources: SkillCapabilitySource[];
} {
  const declared: Array<SkillCapabilityId | '*'> = [];
  const sources = new Set<SkillCapabilitySource>();

  const frontmatter = content.match(FRONTMATTER);
  if (frontmatter) {
    const lines = frontmatter[1].split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (/^\s*(capabilities|declaredCapabilities|declared_capabilities)\s*:/i.test(line)) {
        sources.add('frontmatter');
        declared.push(...parseInlineCapabilities(line.replace(/^[^:]+:/, '')));
        for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
          const nextLine = lines[nextIndex];
          if (/^\S/.test(nextLine)) break;
          const bullet = nextLine.match(/^\s*-\s*(.+)$/);
          if (bullet) {
            const capability = normalizeCapability(bullet[1]);
            if (capability) declared.push(capability);
          }
        }
      }
    }
  }

  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (!DECLARED_HEADING.test(lines[index])) continue;
    sources.add('declared-section');
    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
      const line = lines[nextIndex];
      if (NEXT_HEADING.test(line)) break;
      const matches = line.match(
        /`([^`]+)`|[-*]\s*([A-Za-z0-9.*_-]+)|\b([A-Za-z]+(?:[._-][A-Za-z]+)+)\b/g
      );
      if (!matches) continue;
      for (const match of matches) {
        const capability = normalizeCapability(match.replace(/^[-*]\s*/, '').replace(/`/g, ''));
        if (capability) declared.push(capability);
      }
    }
  }

  const unique = uniqueCapabilities(declared);
  const wildcard = unique.includes('*');
  return {
    capabilities: unique.filter((value): value is SkillCapabilityId => value !== '*'),
    wildcard,
    sources: Array.from(sources),
  };
}

function stripDeclaredCapabilityText(content: string): string {
  const withoutFrontmatter = content.replace(FRONTMATTER, '');
  const lines = withoutFrontmatter.split(/\r?\n/);
  const kept: string[] = [];
  let inDeclaredSection = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (DECLARED_HEADING.test(line)) {
      inDeclaredSection = true;
      continue;
    }

    if (inDeclaredSection) {
      const trimmed = line.trim();
      if (!trimmed) {
        inDeclaredSection = false;
        kept.push(line);
        continue;
      }
      if (NEXT_HEADING.test(line)) {
        inDeclaredSection = false;
        kept.push(line);
        continue;
      }
      if (/^[-*]\s+/.test(trimmed) || /`[A-Za-z0-9.*_-]+`/.test(trimmed)) {
        continue;
      }
      inDeclaredSection = false;
    }

    kept.push(line);
  }

  return kept.join('\n');
}

function evidenceForPattern(
  content: string,
  pattern: CapabilityPattern
): SkillCapabilityEvidence | null {
  const lines = content.split(/\r?\n/);
  const index = lines.findIndex((line) => pattern.pattern.test(line));
  if (index === -1) return null;
  const excerpt = redactString(lines[index].trim()).slice(0, 220);
  return {
    source: pattern.source,
    label: `${pattern.label} on line ${index + 1}`,
    excerpt,
    patternId: pattern.id,
  };
}

function observeCapabilities(content: string): SkillCapabilityObservation[] {
  const observableContent = stripDeclaredCapabilityText(content);
  const byCapability = new Map<SkillCapabilityId, SkillCapabilityObservation>();

  for (const pattern of OBSERVED_PATTERNS) {
    const evidence = evidenceForPattern(observableContent, pattern);
    if (!evidence) continue;

    const existing = byCapability.get(pattern.capability);
    if (existing) {
      existing.confidence = Math.max(existing.confidence, pattern.confidence);
      existing.evidence.push(evidence);
    } else {
      byCapability.set(pattern.capability, {
        capability: pattern.capability,
        confidence: pattern.confidence,
        evidence: [evidence],
      });
    }
  }

  return Array.from(byCapability.values()).sort((a, b) => a.capability.localeCompare(b.capability));
}

function severityFor(
  capability: SkillCapabilityId | undefined,
  fallback: SkillCapabilityRisk
): SkillCapabilityRisk {
  if (!capability) return fallback;
  return TAXONOMY_BY_ID.get(capability)?.risk ?? fallback;
}

function maxSeverity(values: SkillCapabilityRisk[]): SkillCapabilityRisk {
  return values.reduce<SkillCapabilityRisk>(
    (max, value) => (RISK_RANK[value] > RISK_RANK[max] ? value : max),
    'low'
  );
}

function findingId(kind: string, capability?: SkillCapabilityId): string {
  return capability ? `${kind}:${capability}` : kind;
}

function buildFindings(input: {
  declared: SkillCapabilityId[];
  observed: SkillCapabilityObservation[];
  wildcard: boolean;
  matched: SkillCapabilityId[];
  undeclared: SkillCapabilityId[];
  unobserved: SkillCapabilityId[];
}): SkillCapabilityFinding[] {
  const evidenceByCapability = new Map(
    input.observed.map((observation) => [observation.capability, observation.evidence])
  );
  const findings: SkillCapabilityFinding[] = [];

  if (input.declared.length === 0 && !input.wildcard && input.observed.length > 0) {
    findings.push({
      id: findingId('missing-declaration'),
      kind: 'missing-declaration',
      severity: 'medium',
      message: 'Skill has observed capabilities but no declared capability block.',
      remediation:
        'Add a declared capabilities frontmatter block or Declared Capabilities section before install or execution review.',
      evidence: [{ source: 'missing-declaration', label: 'No declaration found' }],
    });
  }

  if (input.wildcard) {
    findings.push({
      id: findingId('wildcard-declaration'),
      kind: 'wildcard-declaration',
      severity: 'medium',
      message: 'Skill declares wildcard capability access.',
      remediation:
        'Replace wildcard access with the narrow capability list the skill actually needs.',
      evidence: [{ source: 'wildcard', label: 'Wildcard capability declaration' }],
    });
  }

  for (const capability of input.undeclared) {
    findings.push({
      id: findingId('undeclared-observed', capability),
      kind: 'undeclared-observed',
      capability,
      severity: severityFor(capability, 'high'),
      message: `${capability} is observed but not declared.`,
      remediation: `Declare ${capability} or remove the behavior before the skill is approved.`,
      evidence: evidenceByCapability.get(capability) ?? [],
    });
  }

  for (const capability of input.unobserved) {
    findings.push({
      id: findingId('declared-unobserved', capability),
      kind: 'declared-unobserved',
      capability,
      severity: 'low',
      message: `${capability} is declared but not observed in the current static profile.`,
      remediation:
        'Remove unused capability declarations or add reviewer notes explaining the need.',
      evidence: [],
    });
  }

  return findings;
}

function profileMatches(
  profile: SkillCapabilityProfile,
  filters: SkillCapabilityListFilters
): boolean {
  if (filters.status && profile.status !== filters.status) return false;
  if (filters.severity && RISK_RANK[profile.severity] < RISK_RANK[filters.severity]) return false;
  if (
    filters.capability &&
    !profile.declaredCapabilities.includes(filters.capability) &&
    !profile.observedCapabilities.some((observed) => observed.capability === filters.capability)
  ) {
    return false;
  }
  if (filters.q) {
    const query = filters.q.toLowerCase();
    const haystack = [
      profile.name,
      profile.skillId,
      profile.tags.join(' '),
      profile.findings.map((finding) => finding.message).join(' '),
    ]
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  return true;
}

export class SkillCapabilityService {
  private auditedSignatures = new Set<string>();

  constructor(
    private readonly resources: SkillResourceProvider = getSharedResourcesService(),
    private readonly tasks: TaskCreator = getTaskService()
  ) {}

  getTaxonomy(): SkillCapabilityDefinition[] {
    return SKILL_CAPABILITY_TAXONOMY;
  }

  async listProfiles(filters: SkillCapabilityListFilters = {}): Promise<SkillCapabilityProfile[]> {
    const resources = await this.resources.listResources({ type: 'skill' });
    const profiles = resources.map((resource) => this.profileResource(resource));
    await this.auditMismatches(profiles);
    return profiles.filter((profile) => profileMatches(profile, filters));
  }

  async getProfile(skillId: string): Promise<SkillCapabilityProfile | null> {
    const resource = await this.resources.getResource(skillId);
    if (!resource || resource.type !== 'skill') return null;
    const profile = this.profileResource(resource);
    await this.auditMismatches([profile]);
    return profile;
  }

  async createRemediationTask(
    skillId: string,
    input: SkillCapabilityRemediationTaskInput,
    actor = 'system'
  ): Promise<{ profile: SkillCapabilityProfile; task: Task }> {
    const profile = await this.getProfile(skillId);
    if (!profile) {
      throw new Error('Skill capability profile not found');
    }
    if (profile.findings.length === 0) {
      throw new Error('Skill capability profile has no findings to remediate');
    }

    const priority =
      input.priority ?? (RISK_RANK[profile.severity] >= RISK_RANK.high ? 'high' : 'medium');
    const description = [
      `Review declared-vs-observed capability mismatch for skill ${profile.name}.`,
      '',
      `Skill ID: ${profile.skillId}`,
      `Status: ${profile.status}`,
      `Severity: ${profile.severity}`,
      `Declared: ${profile.declaredCapabilities.join(', ') || 'none'}`,
      `Observed: ${profile.observedCapabilities.map((item) => item.capability).join(', ') || 'none'}`,
      '',
      'Findings:',
      ...profile.findings.map((finding) => `- ${finding.message} ${finding.remediation}`),
    ].join('\n');

    const task = await this.tasks.createTask({
      title: `Review skill capability mismatch: ${profile.name}`,
      description,
      type: 'security',
      priority,
      project: input.project,
      sprint: input.sprint,
      createdBy: actor,
      updatedBy: actor,
    });

    await auditLog({
      action: 'skill.capability.remediation_task.create',
      actor,
      resource: profile.skillId,
      details: {
        taskId: task.id,
        status: profile.status,
        severity: profile.severity,
        findings: profile.findings.map((finding) => finding.id),
      },
    });

    return { profile: { ...profile, remediationTaskId: task.id }, task };
  }

  private profileResource(resource: SharedResource): SkillCapabilityProfile {
    const declaration = parseDeclaredCapabilities(resource.content);
    const observed = observeCapabilities(resource.content);
    const observedIds = observed.map((item) => item.capability);
    const declaredSet = new Set(declaration.capabilities);
    const observedSet = new Set(observedIds);
    const matched = declaration.wildcard
      ? [...observedSet]
      : [...observedSet].filter((capability) => declaredSet.has(capability));
    const undeclared = declaration.wildcard
      ? []
      : [...observedSet].filter((capability) => !declaredSet.has(capability));
    const unobserved = [...declaredSet].filter((capability) => !observedSet.has(capability));
    const findings = buildFindings({
      declared: declaration.capabilities,
      observed,
      wildcard: declaration.wildcard,
      matched,
      undeclared,
      unobserved,
    });
    const status =
      declaration.capabilities.length === 0 && !declaration.wildcard && observed.length > 0
        ? 'missing-declaration'
        : findings.some((finding) => finding.kind !== 'declared-unobserved')
          ? 'mismatch'
          : 'aligned';

    return {
      id: `skillcap_${resource.id}`,
      skillId: resource.id,
      name: resource.name,
      version: resource.version,
      tags: resource.tags,
      mountedIn: resource.mountedIn,
      scannedAt: new Date().toISOString(),
      declaredCapabilities: declaration.capabilities,
      observedCapabilities: observed,
      matchedCapabilities: matched.sort(),
      undeclaredObservedCapabilities: undeclared.sort(),
      declaredUnobservedCapabilities: unobserved.sort(),
      declarationSources: declaration.sources,
      status,
      severity: findings.length ? maxSeverity(findings.map((finding) => finding.severity)) : 'low',
      findings,
    };
  }

  private async auditMismatches(profiles: SkillCapabilityProfile[]): Promise<void> {
    await Promise.all(
      profiles
        .filter((profile) => profile.findings.length > 0)
        .map(async (profile) => {
          const signature = `${profile.skillId}:${profile.version}:${profile.findings
            .map((finding) => finding.id)
            .sort()
            .join('|')}`;
          if (this.auditedSignatures.has(signature)) return;
          this.auditedSignatures.add(signature);
          await auditLog({
            action: 'skill.capability.mismatch.detected',
            actor: 'system',
            resource: profile.skillId,
            details: {
              skillName: profile.name,
              status: profile.status,
              severity: profile.severity,
              declared: profile.declaredCapabilities,
              observed: profile.observedCapabilities.map((observed) => observed.capability),
              findings: profile.findings.map((finding) => finding.id),
            },
          });
        })
    );
  }
}

let instance: SkillCapabilityService | null = null;

export function getSkillCapabilityService(): SkillCapabilityService {
  if (!instance) {
    instance = new SkillCapabilityService();
  }
  return instance;
}
