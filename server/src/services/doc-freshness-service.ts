import { createLogger } from '../lib/logger.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getRuntimeDir } from '../utils/paths.js';
import type { FreshnessAlert, TrackedDocument } from '@veritas-kanban/shared';

const log = createLogger('doc-freshness');
const DATA_DIR = getRuntimeDir();

const DOCUMENTS_FILE = 'tracked-documents.json';
const ALERTS_FILE = 'freshness-alerts.json';

const RESERVED_DOC_PATHS = new Set(['stats', 'directories', 'search', 'file', 'alerts', 'summary']);

type FreshnessStatus = 'fresh' | 'review-due' | 'stale' | 'expired';

type AlertType = FreshnessAlert['type'];

type AlertSeverity = FreshnessAlert['severity'];

interface FreshnessResult {
  score: number;
  daysSinceReview: number;
  status: FreshnessStatus;
  alertType?: AlertType;
  severity?: AlertSeverity;
}

class DocFreshnessService {
  private documents: TrackedDocument[] = [];
  private alerts: FreshnessAlert[] = [];
  private loaded = false;

  private get documentsPath(): string {
    return path.join(DATA_DIR, DOCUMENTS_FILE);
  }

  private get alertsPath(): string {
    return path.join(DATA_DIR, ALERTS_FILE);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;

    await fs.mkdir(DATA_DIR, { recursive: true });

    try {
      const data = await fs.readFile(this.documentsPath, 'utf-8');
      this.documents = JSON.parse(data);
    } catch {
      this.documents = [];
      await this.saveDocuments();
    }

    try {
      const data = await fs.readFile(this.alertsPath, 'utf-8');
      this.alerts = JSON.parse(data);
    } catch {
      this.alerts = [];
      await this.saveAlerts();
    }

    this.loaded = true;
  }

  private async saveDocuments(): Promise<void> {
    await fs.writeFile(this.documentsPath, JSON.stringify(this.documents, null, 2));
  }

  private async saveAlerts(): Promise<void> {
    await fs.writeFile(this.alertsPath, JSON.stringify(this.alerts, null, 2));
  }

  private computeFreshness(doc: TrackedDocument): FreshnessResult {
    const lastReviewed = new Date(doc.lastReviewedAt).getTime();
    const now = Date.now();
    const daysSinceReview = Math.max(0, (now - lastReviewed) / (1000 * 60 * 60 * 24));
    const score = Math.max(0, 100 - (daysSinceReview / doc.maxAgeDays) * 100);

    if (daysSinceReview >= doc.maxAgeDays * 2) {
      return {
        score,
        daysSinceReview,
        status: 'expired',
        alertType: 'expired',
        severity: 'critical',
      };
    }

    if (daysSinceReview >= doc.maxAgeDays) {
      return {
        score,
        daysSinceReview,
        status: 'stale',
        alertType: 'stale',
        severity: 'warning',
      };
    }

    if (daysSinceReview >= doc.maxAgeDays * 0.75) {
      return {
        score,
        daysSinceReview,
        status: 'review-due',
        alertType: 'review-due',
        severity: 'info',
      };
    }

    return {
      score,
      daysSinceReview,
      status: 'fresh',
    };
  }

  private hydrateDocument(doc: TrackedDocument): TrackedDocument {
    const freshness = this.computeFreshness(doc);
    return {
      ...doc,
      freshnessScore: Math.round(freshness.score),
    };
  }

  private isReservedPath(id: string): boolean {
    return RESERVED_DOC_PATHS.has(id);
  }

  async listDocuments(filters?: {
    project?: string;
    type?: TrackedDocument['type'];
    stale?: boolean;
  }): Promise<TrackedDocument[]> {
    await this.ensureLoaded();

    let results = this.documents.map((doc) => this.hydrateDocument(doc));

    if (filters?.project) {
      results = results.filter((doc) => doc.project === filters.project);
    }

    if (filters?.type) {
      results = results.filter((doc) => doc.type === filters.type);
    }

    if (filters?.stale) {
      results = results.filter((doc) => {
        const freshness = this.computeFreshness(doc);
        return freshness.status === 'stale' || freshness.status === 'expired';
      });
    }

    return results;
  }

  async getDocument(id: string): Promise<TrackedDocument | null> {
    await this.ensureLoaded();
    if (this.isReservedPath(id)) return null;

    const doc = this.documents.find((d) => d.id === id);
    return doc ? this.hydrateDocument(doc) : null;
  }

  async createDocument(input: {
    title: string;
    path: string;
    project?: string;
    type?: TrackedDocument['type'];
    lastReviewedAt?: string;
    lastReviewedBy?: string;
    maxAgeDays?: number;
    tags?: string[];
    notes?: string;
  }): Promise<TrackedDocument> {
    await this.ensureLoaded();

    const now = new Date().toISOString();
    const doc: TrackedDocument = {
      id: `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: input.title,
      path: input.path,
      project: input.project,
      type: input.type ?? 'other',
      lastReviewedAt: input.lastReviewedAt ?? now,
      lastReviewedBy: input.lastReviewedBy,
      freshnessScore: 100,
      maxAgeDays: input.maxAgeDays ?? 30,
      tags: input.tags ?? [],
      notes: input.notes,
      createdAt: now,
      updatedAt: now,
    };

    const hydrated = this.hydrateDocument(doc);
    this.documents.push(hydrated);
    await this.saveDocuments();
    return hydrated;
  }

  async updateDocument(
    id: string,
    update: Partial<
      Pick<
        TrackedDocument,
        | 'title'
        | 'path'
        | 'project'
        | 'type'
        | 'lastReviewedAt'
        | 'lastReviewedBy'
        | 'maxAgeDays'
        | 'tags'
        | 'notes'
      >
    >
  ): Promise<TrackedDocument | null> {
    await this.ensureLoaded();
    if (this.isReservedPath(id)) return null;

    const doc = this.documents.find((d) => d.id === id);
    if (!doc) return null;

    Object.assign(doc, update, { updatedAt: new Date().toISOString() });
    const hydrated = this.hydrateDocument(doc);
    Object.assign(doc, hydrated);

    await this.saveDocuments();
    return hydrated;
  }

  async deleteDocument(id: string): Promise<boolean> {
    await this.ensureLoaded();
    if (this.isReservedPath(id)) return false;

    const before = this.documents.length;
    this.documents = this.documents.filter((d) => d.id !== id);
    if (this.documents.length === before) return false;

    this.alerts = this.alerts.filter((alert) => alert.documentId !== id);
    await Promise.all([this.saveDocuments(), this.saveAlerts()]);
    return true;
  }

  async markReviewed(
    id: string,
    reviewer?: string,
    reviewedAt?: string
  ): Promise<TrackedDocument | null> {
    await this.ensureLoaded();
    if (this.isReservedPath(id)) return null;

    const doc = this.documents.find((d) => d.id === id);
    if (!doc) return null;

    doc.lastReviewedAt = reviewedAt ?? new Date().toISOString();
    doc.lastReviewedBy = reviewer ?? doc.lastReviewedBy;
    doc.updatedAt = new Date().toISOString();

    const hydrated = this.hydrateDocument(doc);
    Object.assign(doc, hydrated);

    // Clear related alerts
    this.alerts = this.alerts.filter((alert) => alert.documentId !== id || alert.acknowledgedAt);

    await Promise.all([this.saveDocuments(), this.saveAlerts()]);
    return hydrated;
  }

  async listAlerts(filters?: {
    severity?: FreshnessAlert['severity'];
    acknowledged?: boolean;
  }): Promise<FreshnessAlert[]> {
    await this.ensureLoaded();

    let results = [...this.alerts];

    if (filters?.severity) {
      results = results.filter((alert) => alert.severity === filters.severity);
    }

    if (filters?.acknowledged !== undefined) {
      results = results.filter((alert) => Boolean(alert.acknowledgedAt) === filters.acknowledged);
    }

    results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return results;
  }

  async acknowledgeAlert(id: string, acknowledgedBy?: string): Promise<FreshnessAlert | null> {
    await this.ensureLoaded();

    const alert = this.alerts.find((a) => a.id === id);
    if (!alert) return null;

    alert.acknowledgedAt = new Date().toISOString();
    alert.acknowledgedBy = acknowledgedBy;
    await this.saveAlerts();
    return alert;
  }

  async scanForAlerts(): Promise<FreshnessAlert[]> {
    await this.ensureLoaded();

    const newAlerts: FreshnessAlert[] = [];
    const now = new Date().toISOString();

    for (const doc of this.documents) {
      const freshness = this.computeFreshness(doc);
      if (!freshness.alertType || !freshness.severity) {
        // Remove unacknowledged alerts for fresh docs
        this.alerts = this.alerts.filter(
          (alert) => alert.documentId !== doc.id || alert.acknowledgedAt
        );
        continue;
      }

      const existing = this.alerts.find(
        (alert) => alert.documentId === doc.id && !alert.acknowledgedAt
      );

      if (existing && existing.type === freshness.alertType) {
        continue;
      }

      this.alerts = this.alerts.filter(
        (alert) => alert.documentId !== doc.id || alert.acknowledgedAt
      );

      const alert: FreshnessAlert = {
        id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        documentId: doc.id,
        documentTitle: doc.title,
        type: freshness.alertType,
        severity: freshness.severity,
        createdAt: now,
      };
      this.alerts.push(alert);
      newAlerts.push(alert);
    }

    await this.saveAlerts();
    if (newAlerts.length > 0) {
      log.info({ count: newAlerts.length }, 'Generated documentation freshness alerts');
    }

    return newAlerts;
  }

  async getSummary(): Promise<{
    total: number;
    fresh: number;
    stale: number;
    expired: number;
    percentages: { fresh: number; stale: number; expired: number };
  }> {
    await this.ensureLoaded();

    let fresh = 0;
    let stale = 0;
    let expired = 0;

    for (const doc of this.documents) {
      const freshness = this.computeFreshness(doc);
      if (freshness.status === 'expired') {
        expired += 1;
      } else if (freshness.status === 'stale' || freshness.status === 'review-due') {
        stale += 1;
      } else {
        fresh += 1;
      }
    }

    const total = this.documents.length || 1;
    const percentages = {
      fresh: Math.round((fresh / total) * 100),
      stale: Math.round((stale / total) * 100),
      expired: Math.round((expired / total) * 100),
    };

    return {
      total: this.documents.length,
      fresh,
      stale,
      expired,
      percentages,
    };
  }
}

let instance: DocFreshnessService | null = null;

export function getDocFreshnessService(): DocFreshnessService {
  if (!instance) {
    instance = new DocFreshnessService();
  }
  return instance;
}
