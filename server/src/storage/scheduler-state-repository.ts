import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import type {
  AutomationBinding,
  AutomationDraft,
  AutomationRunClaim,
  AutomationVersion,
  SchedulerEvent,
  SchedulerRunStatus,
} from '@veritas-kanban/shared';
import { withFileLock } from '../services/file-lock.js';
import { getRuntimeDir } from '../utils/paths.js';
import { ensureWithinBase } from '../utils/sanitize.js';
import { atomicWriteFile } from './fs-helpers.js';
import {
  AutomationBindingSchema,
  AutomationDraftSchema,
  AutomationRunClaimSchema,
  AutomationVersionSchema,
} from '../schemas/automation-draft-schemas.js';

const MAX_SCHEDULER_STATE_BYTES = 8 * 1024 * 1024;
const MAX_EVENTS = 200;
const MAX_AUTOMATION_DRAFTS = 200;
const MAX_AUTOMATION_DRAFT_REVISIONS = 50;
const MAX_AUTOMATION_VERSIONS = 500;
const MAX_AUTOMATION_CLAIMS = 1_000;

export interface SchedulerItemState {
  attempts?: number;
  nextAttemptAt?: string;
  lastRunAt?: string;
  nextRunAt?: string;
  lastStatus?: SchedulerRunStatus;
  lastSummary?: string;
  lastError?: string;
  sourceRunId?: string;
}

export interface SchedulerState {
  version: 1;
  items: Record<string, SchedulerItemState>;
  events: SchedulerEvent[];
  drafts: Record<string, AutomationDraft[]>;
  automationVersions: Record<string, AutomationVersion>;
  automationBindings: Record<string, AutomationBinding>;
  automationClaims: AutomationRunClaim[];
}

export interface SchedulerStateRepository {
  read(): Promise<SchedulerState>;
  update(updater: (state: SchedulerState) => SchedulerState): Promise<SchedulerState>;
}

function emptyState(): SchedulerState {
  return {
    version: 1,
    items: {},
    events: [],
    drafts: {},
    automationVersions: {},
    automationBindings: {},
    automationClaims: [],
  };
}

function normalizeState(parsed: Partial<SchedulerState>): SchedulerState {
  return {
    version: 1,
    items: parsed.items && typeof parsed.items === 'object' ? parsed.items : {},
    events: Array.isArray(parsed.events) ? parsed.events.slice(-MAX_EVENTS) : [],
    drafts: normalizeDrafts(parsed.drafts),
    automationVersions: normalizeRecord(
      parsed.automationVersions,
      AutomationVersionSchema,
      MAX_AUTOMATION_VERSIONS,
      'versions'
    ),
    automationBindings: normalizeRecord(
      parsed.automationBindings,
      AutomationBindingSchema,
      MAX_AUTOMATION_VERSIONS,
      'bindings'
    ),
    automationClaims: normalizeClaims(parsed.automationClaims),
  };
}

function normalizeRecord<T>(
  value: unknown,
  schema: { parse(candidate: unknown): T },
  limit: number,
  label: string
): Record<string, T> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Scheduler automation ${label} must be a record.`);
  }
  const entries = Object.entries(value);
  if (entries.length > limit) {
    throw new Error(`Scheduler automation ${label} exceed the ${limit}-record limit.`);
  }
  return Object.fromEntries(
    entries.map(([id, candidate]) => {
      const parsed = schema.parse(candidate) as T & { id?: string };
      if (parsed.id !== id) {
        throw new Error(`Scheduler automation ${label} entry ${id} has conflicting identity.`);
      }
      return [id, parsed];
    })
  );
}

function normalizeClaims(value: unknown): AutomationRunClaim[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Scheduler automation claims must be an array.');
  return value
    .slice(-MAX_AUTOMATION_CLAIMS)
    .map((claim) => AutomationRunClaimSchema.parse(claim)) as AutomationRunClaim[];
}

function normalizeDrafts(value: unknown): Record<string, AutomationDraft[]> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Scheduler automation drafts must be a versioned record.');
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_AUTOMATION_DRAFTS) {
    throw new Error(`Scheduler automation drafts exceed the ${MAX_AUTOMATION_DRAFTS}-draft limit.`);
  }
  return Object.fromEntries(
    entries.map(([draftId, rawRevisions]) => {
      if (
        !Array.isArray(rawRevisions) ||
        rawRevisions.length < 1 ||
        rawRevisions.length > MAX_AUTOMATION_DRAFT_REVISIONS
      ) {
        throw new Error(`Scheduler automation draft ${draftId} has invalid revision history.`);
      }
      const revisions = rawRevisions.map((candidate, index) => {
        const draft = AutomationDraftSchema.parse(candidate) as AutomationDraft;
        if (draft.id !== draftId || draft.revision !== index + 1) {
          throw new Error(
            `Scheduler automation draft ${draftId} has conflicting identity or revision order.`
          );
        }
        return draft;
      });
      return [draftId, revisions];
    })
  );
}

export class FileSchedulerStateRepository implements SchedulerStateRepository {
  private readonly storageDir: string;
  private readonly stateFile: string;

  constructor(stateFile = path.join(getRuntimeDir(), 'scheduler-state.json')) {
    this.storageDir = path.resolve(path.dirname(stateFile));
    this.stateFile = ensureWithinBase(this.storageDir, path.resolve(stateFile));
  }

  async read(): Promise<SchedulerState> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(this.stateFile, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const [pathStats, stats] = await Promise.all([lstat(this.stateFile), handle.stat()]);
      if (
        pathStats.isSymbolicLink() ||
        pathStats.dev !== stats.dev ||
        pathStats.ino !== stats.ino
      ) {
        throw new Error('Scheduler state must not use a symbolic link or changed file');
      }
      if (!stats.isFile() || stats.size > MAX_SCHEDULER_STATE_BYTES) {
        throw new Error('Scheduler state must use a bounded regular file');
      }
      return normalizeState(JSON.parse(await handle.readFile({ encoding: 'utf8' })));
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode === 'ENOENT') return emptyState();
      if (errorCode === 'ELOOP') {
        throw new Error('Scheduler state must not use a symbolic link', { cause: error });
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }

  async update(updater: (state: SchedulerState) => SchedulerState): Promise<SchedulerState> {
    await this.prepareDirectory();
    return withFileLock(this.stateFile, async () => {
      const state = normalizeState(updater(await this.read()));
      const content = JSON.stringify(state, null, 2);
      if (Buffer.byteLength(content, 'utf8') > MAX_SCHEDULER_STATE_BYTES) {
        throw new Error('Scheduler state exceeds the 8 MiB storage limit');
      }
      await atomicWriteFile(this.stateFile, content, 'utf8');
      return state;
    });
  }

  private async prepareDirectory(): Promise<void> {
    await mkdir(this.storageDir, { recursive: true, mode: 0o700 });
    const stats = await lstat(this.storageDir);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error('Scheduler state path must use a regular directory');
    }
  }
}
