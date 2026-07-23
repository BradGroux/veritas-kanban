import path from 'node:path';
import { z } from 'zod';
import type {
  CredentialBrokerAuditEvent,
  CredentialDefinition,
  CredentialLease,
} from '@veritas-kanban/shared';
import {
  credentialBrokerAuditEventSchema,
  credentialDefinitionSchema,
  credentialLeaseSchema,
} from '../schemas/credential-broker-schemas.js';
import { getRuntimeDir } from '../utils/paths.js';
import { ensureWithinBase } from '../utils/sanitize.js';
import { atomicWriteFile, fileExists, mkdir, readFile } from './fs-helpers.js';
import { withCredentialBrokerStateLock } from './credential-broker-state-lock.js';

const CREDENTIAL_BROKER_STATE_SCHEMA_VERSION = 'credential-broker-state/v1' as const;
const MAX_AUDIT_EVENTS = 5000;

export interface CredentialBrokerState {
  schemaVersion: typeof CREDENTIAL_BROKER_STATE_SCHEMA_VERSION;
  revision: number;
  definitions: CredentialDefinition[];
  leases: CredentialLease[];
  auditEvents: CredentialBrokerAuditEvent[];
}

export interface CredentialBrokerTransaction<T> {
  state: CredentialBrokerState;
  result: T;
}

export interface CredentialBrokerRepository {
  read(): Promise<CredentialBrokerState>;
  transact<T>(
    mutate: (
      state: CredentialBrokerState
    ) => CredentialBrokerTransaction<T> | Promise<CredentialBrokerTransaction<T>>
  ): Promise<T>;
}

const credentialBrokerStateSchema = z
  .object({
    schemaVersion: z.literal(CREDENTIAL_BROKER_STATE_SCHEMA_VERSION),
    revision: z.number().int().min(0),
    definitions: z.array(credentialDefinitionSchema).max(500),
    leases: z.array(credentialLeaseSchema).max(20_000),
    auditEvents: z.array(credentialBrokerAuditEventSchema).max(MAX_AUDIT_EVENTS),
  })
  .strict();

function emptyState(): CredentialBrokerState {
  return {
    schemaVersion: CREDENTIAL_BROKER_STATE_SCHEMA_VERSION,
    revision: 0,
    definitions: [],
    leases: [],
    auditEvents: [],
  };
}

function cloneState(state: CredentialBrokerState): CredentialBrokerState {
  return structuredClone(state);
}

function normalizeState(state: CredentialBrokerState): CredentialBrokerState {
  return credentialBrokerStateSchema.parse({
    ...state,
    auditEvents: state.auditEvents.slice(-MAX_AUDIT_EVENTS),
  }) as CredentialBrokerState;
}

export class InMemoryCredentialBrokerRepository implements CredentialBrokerRepository {
  private state = emptyState();
  private queue: Promise<void> = Promise.resolve();

  async read(): Promise<CredentialBrokerState> {
    await this.queue;
    return cloneState(this.state);
  }

  async transact<T>(
    mutate: (
      state: CredentialBrokerState
    ) => CredentialBrokerTransaction<T> | Promise<CredentialBrokerTransaction<T>>
  ): Promise<T> {
    let result!: T;
    const operation = this.queue.then(async () => {
      const transaction = await mutate(cloneState(this.state));
      this.state = normalizeState({
        ...transaction.state,
        revision: this.state.revision + 1,
      });
      result = transaction.result;
    });
    this.queue = operation.then(
      () => undefined,
      () => undefined
    );
    await operation;
    return result;
  }
}

export interface FileCredentialBrokerRepositoryOptions {
  statePath?: string;
  lockTimeoutMs?: number;
}

export class FileCredentialBrokerRepository implements CredentialBrokerRepository {
  private readonly statePath: string;
  private readonly stateDir: string;
  private readonly lockTimeoutMs: number;

  constructor(options: FileCredentialBrokerRepositoryOptions = {}) {
    this.statePath =
      options.statePath ?? path.join(getRuntimeDir(), 'credential-broker', 'state.json');
    this.stateDir = path.dirname(this.statePath);
    this.lockTimeoutMs = options.lockTimeoutMs ?? 5_000;
    ensureWithinBase(this.stateDir, this.statePath);
  }

  async read(): Promise<CredentialBrokerState> {
    return this.readUnlocked();
  }

  async transact<T>(
    mutate: (
      state: CredentialBrokerState
    ) => CredentialBrokerTransaction<T> | Promise<CredentialBrokerTransaction<T>>
  ): Promise<T> {
    return withCredentialBrokerStateLock(
      this.statePath,
      async () => {
        const current = await this.readUnlocked();
        const transaction = await mutate(cloneState(current));
        const next = normalizeState({
          ...transaction.state,
          revision: current.revision + 1,
        });
        await mkdir(this.stateDir, { recursive: true });
        await atomicWriteFile(this.statePath, `${JSON.stringify(next, null, 2)}\n`);
        return transaction.result;
      },
      this.lockTimeoutMs
    );
  }

  private async readUnlocked(): Promise<CredentialBrokerState> {
    if (!(await fileExists(this.statePath))) return emptyState();
    const content = await readFile(this.statePath, 'utf8');
    return normalizeState(JSON.parse(content) as CredentialBrokerState);
  }
}
