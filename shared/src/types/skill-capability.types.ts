export type SkillCapabilityId =
  | 'filesystem.read'
  | 'filesystem.write'
  | 'shell.execute'
  | 'network.egress'
  | 'credential.access'
  | 'external.message'
  | 'memory.write'
  | 'task.mutate'
  | 'schedule.persist'
  | 'browser.session'
  | 'mcp.tool';

export type SkillCapabilityRisk = 'low' | 'medium' | 'high' | 'critical';
export type SkillCapabilitySource =
  | 'frontmatter'
  | 'declared-section'
  | 'content-pattern'
  | 'script-reference'
  | 'missing-declaration'
  | 'wildcard';
export type SkillCapabilityStatus = 'aligned' | 'mismatch' | 'missing-declaration';
export type SkillCapabilityFindingKind =
  | 'undeclared-observed'
  | 'declared-unobserved'
  | 'missing-declaration'
  | 'wildcard-declaration';

export interface SkillCapabilityDefinition {
  id: SkillCapabilityId;
  label: string;
  description: string;
  risk: SkillCapabilityRisk;
}

export interface SkillCapabilityEvidence {
  source: SkillCapabilitySource;
  label: string;
  excerpt?: string;
  patternId?: string;
}

export interface SkillCapabilityObservation {
  capability: SkillCapabilityId;
  confidence: number;
  evidence: SkillCapabilityEvidence[];
}

export interface SkillCapabilityFinding {
  id: string;
  kind: SkillCapabilityFindingKind;
  capability?: SkillCapabilityId;
  severity: SkillCapabilityRisk;
  message: string;
  remediation: string;
  evidence: SkillCapabilityEvidence[];
}

export interface SkillCapabilityProfile {
  id: string;
  skillId: string;
  name: string;
  version: number;
  tags: string[];
  mountedIn: string[];
  scannedAt: string;
  declaredCapabilities: SkillCapabilityId[];
  observedCapabilities: SkillCapabilityObservation[];
  matchedCapabilities: SkillCapabilityId[];
  undeclaredObservedCapabilities: SkillCapabilityId[];
  declaredUnobservedCapabilities: SkillCapabilityId[];
  declarationSources: SkillCapabilitySource[];
  status: SkillCapabilityStatus;
  severity: SkillCapabilityRisk;
  findings: SkillCapabilityFinding[];
  remediationTaskId?: string;
}

export interface SkillCapabilityListFilters {
  status?: SkillCapabilityStatus;
  severity?: SkillCapabilityRisk;
  capability?: SkillCapabilityId;
  q?: string;
}

export interface SkillCapabilityRemediationTaskInput {
  project?: string;
  sprint?: string;
  priority?: 'low' | 'medium' | 'high';
}
