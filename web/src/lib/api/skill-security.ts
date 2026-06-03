import type {
  SkillSecurityPatternDefinition,
  SkillSecurityScanInput,
  SkillSecurityScanReport,
  SkillSecurityScanSummary,
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
};
