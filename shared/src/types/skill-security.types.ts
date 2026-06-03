import type { SkillCapabilityProfile } from './skill-capability.types.js';
import type { Task } from './task.types.js';

export type SkillSecuritySeverity = 'low' | 'medium' | 'high' | 'critical';
export type SkillSecurityRecommendation = 'safe' | 'caution' | 'do-not-install';
export type SkillSecurityDecision = 'allow' | 'warn' | 'block';
export type SkillSecurityScanTargetType = 'skill-file' | 'skill-directory';
export type SkillSecurityFindingCategory =
  | 'prompt-injection'
  | 'exfiltration'
  | 'credential-access'
  | 'unsafe-execution'
  | 'persistence'
  | 'memory-poisoning'
  | 'trigger-risk'
  | 'capability-mismatch'
  | 'dependency-risk';

export interface SkillSecurityEvidence {
  file: string;
  line: number;
  excerpt: string;
}

export interface SkillSecurityFinding {
  id: string;
  patternId: string;
  category: SkillSecurityFindingCategory;
  severity: SkillSecuritySeverity;
  confidence: number;
  title: string;
  description: string;
  remediation: string;
  evidence: SkillSecurityEvidence[];
}

export interface SkillSecurityScannedFile {
  path: string;
  bytes: number;
  role: 'skill' | 'script' | 'asset' | 'manifest';
  truncated: boolean;
}

export interface SkillSecurityScanInput {
  path: string;
  persist?: boolean;
  includeReferencedFiles?: boolean;
}

export interface SkillSecurityScanSummary {
  id: string;
  targetPath: string;
  targetType: SkillSecurityScanTargetType;
  skillName: string;
  scannedAt: string;
  severity: SkillSecuritySeverity;
  riskScore: number;
  recommendation: SkillSecurityRecommendation;
  findingCount: number;
  persistedJsonPath?: string;
  persistedMarkdownPath?: string;
}

export interface SkillSecurityScanReport extends SkillSecurityScanSummary {
  files: SkillSecurityScannedFile[];
  findings: SkillSecurityFinding[];
  capabilityProfile: SkillCapabilityProfile;
  reportMarkdown: string;
}

export interface SkillSecurityPatternDefinition {
  id: string;
  category: SkillSecurityFindingCategory;
  severity: SkillSecuritySeverity;
  title: string;
  description: string;
}

export interface SkillSecurityException {
  id: string;
  skillId: string;
  owner: string;
  reason: string;
  expiresAt: string;
  createdAt: string;
  createdBy: string;
}

export interface SkillSecurityExceptionInput {
  owner: string;
  reason: string;
  expiresAt: string;
}

export interface SkillRiskRemediationTaskInput {
  project?: string;
  sprint?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
}

export interface SkillRiskRemediationTaskResult {
  item: SkillRiskInventoryItem;
  task: Task;
}

export interface SkillRiskInventoryItem {
  skillId: string;
  name: string;
  version: number;
  sourcePath: string;
  tags: string[];
  mountedIn: string[];
  updatedAt: string;
  lastScannedAt?: string;
  scanStatus: 'scanned' | 'changed' | 'unscanned';
  changedFiles: string[];
  severity: SkillSecuritySeverity;
  riskScore: number;
  recommendation: SkillSecurityRecommendation;
  installDecision: SkillSecurityDecision;
  installReason: string;
  declaredCapabilities: SkillCapabilityProfile['declaredCapabilities'];
  observedCapabilities: SkillCapabilityProfile['observedCapabilities'];
  mismatches: SkillCapabilityProfile['findings'];
  findingCount: number;
  highOrCriticalFindingCount: number;
  latestReportId?: string;
  latestReportPath?: string;
  remediationTaskId?: string;
  exception?: SkillSecurityException;
}

export interface SkillRiskInventorySummary {
  generatedAt: string;
  items: SkillRiskInventoryItem[];
  totals: {
    skills: number;
    blocked: number;
    warnings: number;
    unscanned: number;
    exceptions: number;
  };
}

export interface WorkflowSkillAuditReference {
  reference: string;
  skillId?: string;
  name?: string;
  status: 'matched' | 'missing' | 'unscanned' | 'warning' | 'blocked' | 'allowed';
  severity?: SkillSecuritySeverity;
  riskScore?: number;
  recommendation?: SkillSecurityRecommendation;
  installDecision?: SkillSecurityDecision;
  findingCount?: number;
  exception?: SkillSecurityException;
  message: string;
}

export interface WorkflowSkillAuditSummary {
  status: 'pass' | 'warn' | 'fail';
  mode: 'local' | 'remote' | 'cloud';
  references: WorkflowSkillAuditReference[];
}
