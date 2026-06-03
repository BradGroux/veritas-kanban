import type {
  SkillSecurityPatternDefinition,
  SkillSecurityExceptionInput,
  SkillSecurityScanInput,
  SkillSecurityScanReport,
  SkillSecurityScanSummary,
  SkillRiskInventorySummary,
  SkillRiskRemediationTaskInput,
  SkillRiskRemediationTaskResult,
} from '@veritas-kanban/shared';
import { apiFetch } from './helpers';

export const skillSecurityApi = {
  patterns: (): Promise<SkillSecurityPatternDefinition[]> =>
    apiFetch<SkillSecurityPatternDefinition[]>('/api/skills/security/patterns'),

  scan: (input: SkillSecurityScanInput): Promise<SkillSecurityScanReport> =>
    apiFetch<SkillSecurityScanReport>('/api/skills/security/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),

  maintenanceScan: (input: SkillSecurityScanInput): Promise<SkillSecurityScanReport> =>
    apiFetch<SkillSecurityScanReport>('/api/maintenance/skill-security/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),

  listReports: (): Promise<SkillSecurityScanSummary[]> =>
    apiFetch<SkillSecurityScanSummary[]>('/api/skills/security/scans'),

  getReport: (id: string): Promise<SkillSecurityScanReport> =>
    apiFetch<SkillSecurityScanReport>(`/api/skills/security/scans/${encodeURIComponent(id)}`),

  inventory: (): Promise<SkillRiskInventorySummary> =>
    apiFetch<SkillRiskInventorySummary>('/api/skills/security/inventory'),

  createRemediationTask: (
    skillId: string,
    input: SkillRiskRemediationTaskInput = {}
  ): Promise<SkillRiskRemediationTaskResult> =>
    apiFetch<SkillRiskRemediationTaskResult>(
      `/api/skills/security/inventory/${encodeURIComponent(skillId)}/remediation-task`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }
    ),

  createException: (skillId: string, input: SkillSecurityExceptionInput) =>
    apiFetch<SkillRiskInventorySummary['items'][number]>(
      `/api/skills/security/inventory/${encodeURIComponent(skillId)}/exceptions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }
    ),
};
