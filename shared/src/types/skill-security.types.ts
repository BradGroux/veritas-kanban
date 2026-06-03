import type { SkillCapabilityProfile } from './skill-capability.types.js';

export type SkillSecuritySeverity = 'low' | 'medium' | 'high' | 'critical';
export type SkillSecurityRecommendation = 'safe' | 'caution' | 'do-not-install';
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
