/**
 * Scheduled Deliverables Service
 *
 * Manages recurring agent workflows and their outputs.
 * Think: daily pulses, weekly audits, scheduled reports.
 */

import { createLogger } from '../lib/logger.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { SqliteDatabase, type SqliteConnectionOptions } from '../storage/sqlite/database.js';
import { SqliteScheduledDeliverablesRepository } from '../storage/sqlite/scheduled-deliverables-repository.js';
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), '..', '.veritas-kanban');

const log = createLogger('deliverables');

// ─── Types ───────────────────────────────────────────────────────

export type DeliverableSchedule = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'custom';

export interface Deliverable {
  id: string;
  /** Display name */
  name: string;
  /** Description of what this deliverable produces */
  description: string;
  /** Schedule type */
  schedule: DeliverableSchedule;
  /** Cron expression (for custom schedules) */
  cronExpr?: string;
  /** Human-readable schedule description */
  scheduleDescription: string;
  /** Is this deliverable active? */
  enabled: boolean;
  /** Agent responsible for producing this */
  agent?: string;
  /** Output directory (relative to docs root) */
  outputPath?: string;
  /** Tags for categorization */
  tags: string[];
  /** Creation timestamp */
  createdAt: string;
  /** Last run timestamp */
  lastRunAt?: string;
  /** Next scheduled run */
  nextRunAt?: string;
  /** Total runs completed */
  totalRuns: number;
}

export interface DeliverableRun {
  id: string;
  deliverableId: string;
  /** Status of this run */
  status: 'success' | 'failed' | 'skipped';
  /** Output file path (if produced) */
  outputFile?: string;
  /** Summary of what was produced */
  summary?: string;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Error message if failed */
  error?: string;
  /** Source workflow run captured into this scheduled result */
  sourceRunId?: string;
  /** Workflow definition that produced the result */
  workflowId?: string;
  /** Stable result snapshot for dashboards and completion packets */
  snapshot?: DeliverableRunSnapshot;
  /** Run timestamp */
  runAt: string;
}

export interface DeliverableRunSnapshot {
  status: DeliverableRun['status'];
  capturedAt: string;
  sourceRunId?: string;
  workflowId?: string;
  outputFile?: string;
  summary?: string;
  durationMs?: number;
  error?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface ScheduledDeliverablesServiceOptions {
  dataDir?: string;
  deliverablesFile?: string;
  runsFile?: string;
  storageType?: 'file' | 'sqlite';
  sqliteDatabase?: SqliteDatabase;
  sqliteConnectionOptions?: SqliteConnectionOptions;
  runRetentionLimit?: number;
}

// ─── Service ─────────────────────────────────────────────────────

export class ScheduledDeliverablesService {
  private deliverables: Deliverable[] = [];
  private runs: DeliverableRun[] = [];
  private loaded = false;
  private readonly deliverablesFile: string;
  private readonly runsFile: string;
  private readonly runRetentionLimit: number;
  private readonly repository: SqliteScheduledDeliverablesRepository | null = null;
  private readonly sqliteDatabase: SqliteDatabase | null = null;
  private readonly ownsSqliteDatabase: boolean = false;

  constructor(options: ScheduledDeliverablesServiceOptions = {}) {
    const dataDir = options.dataDir ?? DATA_DIR;
    this.deliverablesFile =
      options.deliverablesFile ?? path.join(dataDir, 'scheduled-deliverables.json');
    this.runsFile = options.runsFile ?? path.join(dataDir, 'deliverable-runs.json');
    this.runRetentionLimit = options.runRetentionLimit ?? 500;
    const storageType =
      options.storageType ?? (process.env.VERITAS_STORAGE === 'sqlite' ? 'sqlite' : 'file');

    if (storageType === 'sqlite') {
      this.sqliteDatabase =
        options.sqliteDatabase ?? new SqliteDatabase(options.sqliteConnectionOptions);
      this.ownsSqliteDatabase = !options.sqliteDatabase;
      this.sqliteDatabase.open();
      this.repository = new SqliteScheduledDeliverablesRepository(this.sqliteDatabase);
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (this.repository) {
      this.deliverables = this.repository.loadDeliverables();
      this.runs = this.repository.loadRuns();
      if (this.runs.length > this.runRetentionLimit) {
        this.runs = this.runs.slice(-this.runRetentionLimit);
        this.repository.saveRuns(this.runs);
      }
      this.loaded = true;
      return;
    }

    try {
      const data = await fs.readFile(this.deliverablesFile, 'utf-8');
      this.deliverables = JSON.parse(data);
    } catch {
      this.deliverables = [];
    }
    try {
      const data = await fs.readFile(this.runsFile, 'utf-8');
      this.runs = JSON.parse(data);
      // Keep only last 500 runs
      if (this.runs.length > this.runRetentionLimit) {
        this.runs = this.runs.slice(-this.runRetentionLimit);
      }
    } catch {
      this.runs = [];
    }
    this.loaded = true;
  }

  private async saveDeliverables(): Promise<void> {
    if (this.repository) {
      this.repository.saveDeliverables(this.deliverables);
      return;
    }

    await fs.mkdir(path.dirname(this.deliverablesFile), { recursive: true });
    await fs.writeFile(this.deliverablesFile, JSON.stringify(this.deliverables, null, 2));
  }

  private async saveRuns(): Promise<void> {
    if (this.repository) {
      this.repository.saveRuns(this.runs);
      return;
    }

    await fs.mkdir(path.dirname(this.runsFile), { recursive: true });
    await fs.writeFile(this.runsFile, JSON.stringify(this.runs, null, 2));
  }

  /**
   * Create a new scheduled deliverable.
   */
  async create(params: {
    name: string;
    description: string;
    schedule: DeliverableSchedule;
    cronExpr?: string;
    scheduleDescription?: string;
    agent?: string;
    outputPath?: string;
    tags?: string[];
    enabled?: boolean;
  }): Promise<Deliverable> {
    await this.ensureLoaded();

    const scheduleDesc =
      params.scheduleDescription || this.describeSchedule(params.schedule, params.cronExpr);

    const deliverable: Deliverable = {
      id: `del_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: params.name,
      description: params.description,
      schedule: params.schedule,
      cronExpr: params.cronExpr,
      scheduleDescription: scheduleDesc,
      enabled: params.enabled ?? true,
      agent: params.agent,
      outputPath: params.outputPath,
      tags: params.tags || [],
      createdAt: new Date().toISOString(),
      totalRuns: 0,
    };

    this.deliverables.push(deliverable);
    await this.saveDeliverables();
    log.info({ id: deliverable.id, name: deliverable.name }, 'Deliverable created');
    return deliverable;
  }

  /**
   * Update a deliverable.
   */
  async update(
    id: string,
    update: Partial<
      Pick<
        Deliverable,
        | 'name'
        | 'description'
        | 'schedule'
        | 'cronExpr'
        | 'scheduleDescription'
        | 'enabled'
        | 'agent'
        | 'outputPath'
        | 'tags'
      >
    >
  ): Promise<Deliverable | null> {
    await this.ensureLoaded();
    const del = this.deliverables.find((d) => d.id === id);
    if (!del) return null;

    Object.assign(del, update);
    if (update.schedule || update.cronExpr) {
      del.scheduleDescription =
        update.scheduleDescription || this.describeSchedule(del.schedule, del.cronExpr);
    }

    await this.saveDeliverables();
    return del;
  }

  /**
   * Delete a deliverable.
   */
  async delete(id: string): Promise<boolean> {
    await this.ensureLoaded();
    const before = this.deliverables.length;
    this.deliverables = this.deliverables.filter((d) => d.id !== id);
    if (this.deliverables.length === before) return false;
    await this.saveDeliverables();
    return true;
  }

  /**
   * Record a run for a deliverable.
   */
  async recordRun(params: {
    deliverableId: string;
    status: 'success' | 'failed' | 'skipped';
    outputFile?: string;
    summary?: string;
    durationMs?: number;
    error?: string;
    sourceRunId?: string;
    workflowId?: string;
    snapshotMetadata?: Record<string, string | number | boolean | null>;
  }): Promise<DeliverableRun> {
    await this.ensureLoaded();
    const runAt = new Date().toISOString();
    const snapshot: DeliverableRunSnapshot = {
      status: params.status,
      capturedAt: runAt,
      sourceRunId: params.sourceRunId,
      workflowId: params.workflowId,
      outputFile: params.outputFile,
      summary: params.summary,
      durationMs: params.durationMs,
      error: params.error,
      metadata: params.snapshotMetadata,
    };

    const run: DeliverableRun = {
      id: `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      deliverableId: params.deliverableId,
      status: params.status,
      outputFile: params.outputFile,
      summary: params.summary,
      durationMs: params.durationMs,
      error: params.error,
      sourceRunId: params.sourceRunId,
      workflowId: params.workflowId,
      snapshot,
      runAt,
    };

    this.runs.push(run);

    // Update deliverable
    const del = this.deliverables.find((d) => d.id === params.deliverableId);
    if (del) {
      del.lastRunAt = run.runAt;
      del.totalRuns++;
      del.nextRunAt = this.calculateNextRun(del);
      await this.saveDeliverables();
    }

    await this.saveRuns();
    return run;
  }

  /**
   * List all deliverables.
   */
  async list(filters?: {
    enabled?: boolean;
    agent?: string;
    tag?: string;
  }): Promise<Deliverable[]> {
    await this.ensureLoaded();

    let results = [...this.deliverables];
    if (filters?.enabled !== undefined) {
      results = results.filter((d) => d.enabled === filters.enabled);
    }
    if (filters?.agent) {
      results = results.filter((d) => d.agent === filters.agent);
    }
    if (filters?.tag) {
      results = results.filter((d) => d.tags.includes(filters.tag!));
    }

    return results.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get a specific deliverable with its recent runs.
   */
  async get(
    id: string
  ): Promise<{ deliverable: Deliverable; recentRuns: DeliverableRun[] } | null> {
    await this.ensureLoaded();
    const deliverable = this.deliverables.find((d) => d.id === id);
    if (!deliverable) return null;

    const recentRuns = this.runs
      .filter((r) => r.deliverableId === id)
      .sort((a, b) => new Date(b.runAt).getTime() - new Date(a.runAt).getTime())
      .slice(0, 20);

    return { deliverable, recentRuns };
  }

  /**
   * Get runs for a deliverable.
   */
  async getRuns(deliverableId: string, limit = 20): Promise<DeliverableRun[]> {
    await this.ensureLoaded();
    return this.runs
      .filter((r) => r.deliverableId === deliverableId)
      .sort((a, b) => new Date(b.runAt).getTime() - new Date(a.runAt).getTime())
      .slice(0, limit);
  }

  dispose(): void {
    if (this.ownsSqliteDatabase) {
      this.sqliteDatabase?.close();
    }
  }

  // ─── Private ─────────────────────────────────────────────────

  private describeSchedule(schedule: DeliverableSchedule, cronExpr?: string): string {
    switch (schedule) {
      case 'daily':
        return 'Every day';
      case 'weekly':
        return 'Every week';
      case 'biweekly':
        return 'Every 2 weeks';
      case 'monthly':
        return 'Every month';
      case 'custom':
        return cronExpr ? `Cron: ${cronExpr}` : 'Custom schedule';
    }
  }

  private calculateNextRun(del: Deliverable): string {
    const lastRun = del.lastRunAt ? new Date(del.lastRunAt) : new Date();
    const next = new Date(lastRun);

    switch (del.schedule) {
      case 'daily':
        next.setDate(next.getDate() + 1);
        break;
      case 'weekly':
        next.setDate(next.getDate() + 7);
        break;
      case 'biweekly':
        next.setDate(next.getDate() + 14);
        break;
      case 'monthly':
        next.setMonth(next.getMonth() + 1);
        break;
      default:
        next.setDate(next.getDate() + 1);
        break;
    }

    return next.toISOString();
  }
}

// Singleton
let instance: ScheduledDeliverablesService | null = null;

export function getScheduledDeliverablesService(): ScheduledDeliverablesService {
  if (!instance) {
    instance = new ScheduledDeliverablesService();
  }
  return instance;
}
