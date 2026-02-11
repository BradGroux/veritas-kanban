export interface TrackedDocument {
  id: string;
  title: string;
  path: string; // file path or URL
  project?: string;
  type: 'readme' | 'api-docs' | 'runbook' | 'architecture' | 'sop' | 'guide' | 'other';
  lastReviewedAt: string;
  lastReviewedBy?: string;
  freshnessScore: number; // 0-100, computed
  maxAgeDays: number; // threshold before considered stale
  tags: string[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FreshnessAlert {
  id: string;
  documentId: string;
  documentTitle: string;
  type: 'stale' | 'expired' | 'review-due';
  severity: 'info' | 'warning' | 'critical';
  createdAt: string;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
}
