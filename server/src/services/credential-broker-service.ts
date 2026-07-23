import { createHash, randomBytes } from 'node:crypto';
import type {
  CredentialAction,
  CredentialBrokerAuditEvent,
  CredentialBrokerReconciliationResult,
  CredentialDefinition,
  CredentialDefinitionInput,
  CredentialLease,
  CredentialLeaseIssueRequest,
  CredentialLeaseTerminalReason,
  CredentialLeaseUseRequest,
  CredentialRunBinding,
  CredentialRunRevocationRequest,
  CredentialSecretSourceReference,
  IssuedCredentialLease,
} from '@veritas-kanban/shared';
import {
  CREDENTIAL_BROKER_AUDIT_SCHEMA_VERSION,
  CREDENTIAL_DEFINITION_SCHEMA_VERSION,
  CREDENTIAL_LEASE_SCHEMA_VERSION,
} from '@veritas-kanban/shared';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/error-handler.js';
import {
  credentialActionSchema,
  credentialDefinitionInputSchema,
  credentialDefinitionSchema,
  credentialLeaseSchema,
  credentialRunBindingSchema,
} from '../schemas/credential-broker-schemas.js';
import {
  FileCredentialBrokerRepository,
  type CredentialBrokerRepository,
  type CredentialBrokerState,
} from '../storage/credential-broker-repository.js';
import {
  calculateCredentialActionFingerprint,
  calculateCredentialDefinitionDigest,
  calculateCredentialScopeDigest,
  hashCredentialHandle,
} from '../utils/credential-broker-digest.js';
import { parseRunLaunchManifest } from '../schemas/run-launch-manifest-schemas.js';
import { TaskService } from './task-service.js';
import { auditLog } from './audit-service.js';

const CREDENTIAL_PLACEHOLDER_PATTERN = /\{\{vk-credential:(vkcred_[A-Za-z0-9_-]{3,})\}\}/g;
const MAX_AUDIT_EVENTS = 5000;
const SAFE_ERROR_PROTOTYPES = new Set<object>([
  Error.prototype,
  EvalError.prototype,
  RangeError.prototype,
  ReferenceError.prototype,
  SyntaxError.prototype,
  TypeError.prototype,
  URIError.prototype,
  AggregateError.prototype,
]);

export interface CredentialSecretSource {
  supports(reference: CredentialSecretSourceReference): boolean;
  isAvailable(reference: CredentialSecretSourceReference): Promise<boolean>;
  resolve(reference: CredentialSecretSourceReference): Promise<string | undefined>;
}

export class EnvironmentCredentialSecretSource implements CredentialSecretSource {
  constructor(private readonly environment: NodeJS.ProcessEnv = process.env) {}

  supports(reference: CredentialSecretSourceReference): boolean {
    return reference.kind === 'environment';
  }

  async isAvailable(reference: CredentialSecretSourceReference): Promise<boolean> {
    return Boolean(await this.resolve(reference));
  }

  async resolve(reference: CredentialSecretSourceReference): Promise<string | undefined> {
    if (reference.kind !== 'environment') return undefined;
    const value = this.environment[reference.reference];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }
}

export interface CredentialRunBindingReader {
  read(taskId: string): Promise<CredentialRunBinding | null>;
}

export interface CredentialApprovalVerifier {
  verify(input: {
    definition: CredentialDefinition;
    binding: CredentialRunBinding;
    action: CredentialAction;
    actionFingerprint: string;
  }): Promise<{
    approved: boolean;
    approvalId?: string;
    actionFingerprint: string;
  }>;
}

export type CredentialBrokerAuditSink = (event: CredentialBrokerAuditEvent) => Promise<void>;

export interface CredentialBrokerServiceOptions {
  repository?: CredentialBrokerRepository;
  secretSources?: CredentialSecretSource[];
  runBindings?: CredentialRunBindingReader;
  approvals?: CredentialApprovalVerifier;
  audit?: CredentialBrokerAuditSink;
  now?: () => Date;
  createHandle?: () => string;
}

interface CredentialUseClaim {
  allowed: boolean;
  event: CredentialBrokerAuditEvent;
  lease?: CredentialLease;
  definition?: CredentialDefinition;
  reason?: string;
}

interface CredentialReconciliationEvidence {
  leaseId: string;
  leaseUpdatedAt: string;
  definitionDigest: string;
  sourceAvailable: boolean;
  binding: CredentialRunBinding | null;
}

class TaskCredentialRunBindingReader implements CredentialRunBindingReader {
  constructor(private readonly tasks = new TaskService()) {}

  async read(taskId: string): Promise<CredentialRunBinding | null> {
    const task = await this.tasks.getTask(taskId);
    const attempt = task?.attempt;
    if (!task || !attempt?.runLaunchManifest) return null;
    const manifest = parseRunLaunchManifest(attempt.runLaunchManifest);
    return credentialRunBindingSchema.parse({
      taskId: task.id,
      attemptId: attempt.id,
      status: attempt.status === 'running' ? 'running' : 'terminal',
      runLaunchManifestDigest: manifest.digest,
      credentialReferences: uniqueSorted([
        ...manifest.runtime.credentialReferences,
        ...manifest.sandbox.effective.credentialReferences,
      ]),
    }) as CredentialRunBinding;
  }
}

const denyRequiredApproval: CredentialApprovalVerifier = {
  async verify({ actionFingerprint }) {
    return { approved: false, actionFingerprint };
  },
};

export class CredentialBrokerService {
  private readonly repository: CredentialBrokerRepository;
  private readonly secretSources: CredentialSecretSource[];
  private readonly runBindings: CredentialRunBindingReader;
  private readonly approvals: CredentialApprovalVerifier;
  private readonly auditSink: CredentialBrokerAuditSink;
  private readonly now: () => Date;
  private readonly createHandle: () => string;

  constructor(options: CredentialBrokerServiceOptions = {}) {
    this.repository = options.repository ?? new FileCredentialBrokerRepository();
    this.secretSources = options.secretSources ?? [new EnvironmentCredentialSecretSource()];
    this.runBindings = options.runBindings ?? new TaskCredentialRunBindingReader();
    this.approvals = options.approvals ?? denyRequiredApproval;
    this.auditSink =
      options.audit ??
      (async (event) => {
        await auditLog({
          action: `credential-broker.${event.type}`,
          actor: 'system',
          resource: event.leaseId ?? event.definitionId,
          details: { ...event },
        });
      });
    this.now = options.now ?? (() => new Date());
    this.createHandle =
      options.createHandle ?? (() => `vkcred_${randomBytes(32).toString('base64url')}`);
  }

  async listDefinitions(): Promise<CredentialDefinition[]> {
    return (await this.repository.read()).definitions.map((definition) =>
      structuredClone(definition)
    );
  }

  async getDefinition(id: string): Promise<CredentialDefinition | null> {
    const normalizedId = normalizeDefinitionId(id);
    const definition = (await this.repository.read()).definitions.find(
      (candidate) => candidate.id === normalizedId
    );
    return definition ? structuredClone(definition) : null;
  }

  async createDefinition(input: CredentialDefinitionInput): Promise<CredentialDefinition> {
    const normalized = normalizeDefinitionInput(input);
    const parsed = credentialDefinitionInputSchema.parse(normalized) as CredentialDefinitionInput;
    const now = this.now().toISOString();
    const payload = {
      ...parsed,
      schemaVersion: CREDENTIAL_DEFINITION_SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
    };
    const definition = credentialDefinitionSchema.parse({
      ...payload,
      digest: calculateCredentialDefinitionDigest(payload),
    }) as CredentialDefinition;
    const event = this.event({
      type: 'definition-created',
      decision: 'recorded',
      definition,
      reason: 'definition-created',
    });

    await this.repository.transact((state) => {
      if (state.definitions.some((candidate) => candidate.id === definition.id)) {
        throw new ConflictError(`Credential definition already exists: ${definition.id}`);
      }
      return {
        state: appendAudit(
          {
            ...state,
            definitions: [...state.definitions, definition].sort((left, right) =>
              left.id.localeCompare(right.id)
            ),
          },
          event
        ),
        result: undefined,
      };
    });
    await this.emitAudit(event);
    return structuredClone(definition);
  }

  async updateDefinition(
    id: string,
    input: CredentialDefinitionInput
  ): Promise<CredentialDefinition> {
    const normalizedId = normalizeDefinitionId(id);
    const normalized = normalizeDefinitionInput(input);
    if (normalized.id !== normalizedId) {
      throw new ValidationError('Credential definition id in URL must match request body');
    }
    const parsed = credentialDefinitionInputSchema.parse(normalized) as CredentialDefinitionInput;
    const now = this.now().toISOString();
    const events: CredentialBrokerAuditEvent[] = [];
    let updated!: CredentialDefinition;

    await this.repository.transact((state) => {
      const existing = state.definitions.find((candidate) => candidate.id === normalizedId);
      if (!existing) throw new NotFoundError(`Credential definition not found: ${normalizedId}`);
      const payload = {
        ...parsed,
        schemaVersion: CREDENTIAL_DEFINITION_SCHEMA_VERSION,
        createdAt: existing.createdAt,
        updatedAt: now,
      };
      updated = credentialDefinitionSchema.parse({
        ...payload,
        digest: calculateCredentialDefinitionDigest(payload),
      }) as CredentialDefinition;
      const updateEvent = this.event({
        type: 'definition-updated',
        decision: 'recorded',
        definition: updated,
        reason: 'definition-updated',
      });
      events.push(updateEvent);
      const terminalReason: CredentialLeaseTerminalReason = updated.enabled
        ? 'definition-changed'
        : 'definition-disabled';
      const definitionChanged = updated.digest !== existing.digest;
      const leases = state.leases.map((lease) => {
        if (
          lease.definitionId !== normalizedId ||
          lease.state !== 'active' ||
          (updated.enabled && !definitionChanged)
        ) {
          return lease;
        }
        const next = terminateLease(lease, 'revoked', terminalReason, now);
        events.push(
          this.event({
            type: 'revoke',
            decision: 'recorded',
            definition: updated,
            lease: next,
            reason: terminalReason,
          })
        );
        return next;
      });
      return {
        state: events.reduce((current, auditEvent) => appendAudit(current, auditEvent), {
          ...state,
          definitions: state.definitions.map((candidate) =>
            candidate.id === normalizedId ? updated : candidate
          ),
          leases,
        }),
        result: undefined,
      };
    });
    await Promise.all(events.map((event) => this.emitAudit(event)));
    return structuredClone(updated);
  }

  async deleteDefinition(id: string): Promise<void> {
    const normalizedId = normalizeDefinitionId(id);
    let event!: CredentialBrokerAuditEvent;
    await this.repository.transact((state) => {
      const existing = state.definitions.find((candidate) => candidate.id === normalizedId);
      if (!existing) throw new NotFoundError(`Credential definition not found: ${normalizedId}`);
      if (
        state.leases.some(
          (lease) => lease.definitionId === normalizedId && lease.state === 'active'
        )
      ) {
        throw new ConflictError(
          'Credential definition has active leases and cannot be deleted; disable it first'
        );
      }
      event = this.event({
        type: 'definition-deleted',
        decision: 'recorded',
        definition: existing,
        reason: 'definition-deleted',
      });
      return {
        state: appendAudit(
          {
            ...state,
            definitions: state.definitions.filter((candidate) => candidate.id !== normalizedId),
          },
          event
        ),
        result: undefined,
      };
    });
    await this.emitAudit(event);
  }

  async listLeases(): Promise<CredentialLease[]> {
    return (await this.repository.read()).leases.map((lease) => structuredClone(lease));
  }

  async listAuditEvents(): Promise<CredentialBrokerAuditEvent[]> {
    return (await this.repository.read()).auditEvents.map((event) => structuredClone(event));
  }

  async issueLease(request: CredentialLeaseIssueRequest): Promise<IssuedCredentialLease> {
    let action: CredentialAction;
    try {
      action = normalizeCredentialAction(request.action);
    } catch (error) {
      await this.recordStandaloneDenial({
        request,
        reason: 'invalid-action',
      });
      throw error;
    }
    const actionFingerprint = calculateCredentialActionFingerprint(action);
    let binding: CredentialRunBinding;
    try {
      binding = await this.assertActiveBinding(request);
    } catch (error) {
      await this.recordStandaloneDenial({
        request,
        actionFingerprint,
        reason: 'run-binding-stale',
      });
      throw error;
    }
    const state = await this.repository.read();
    const definition = state.definitions.find(
      (candidate) => candidate.id === normalizeDefinitionId(request.definitionId)
    );
    if (!definition) {
      await this.recordStandaloneDenial({
        request,
        binding,
        actionFingerprint,
        reason: 'definition-missing',
      });
      throw new NotFoundError(`Credential definition not found: ${request.definitionId}`);
    }
    if (!definition.enabled) {
      await this.recordStandaloneDenial({
        request,
        definition,
        binding,
        actionFingerprint,
        reason: 'definition-disabled',
      });
      throw new ConflictError('Credential definition is disabled');
    }
    try {
      assertActionWithinScope(definition, action);
    } catch (error) {
      await this.recordStandaloneDenial({
        request,
        definition,
        binding,
        actionFingerprint,
        reason: 'action-outside-scope',
      });
      throw error;
    }

    let approvalId: string | undefined;
    if (definition.approval === 'required') {
      const approval = await this.approvals
        .verify({
          definition,
          binding,
          action,
          actionFingerprint,
        })
        .catch(() => ({
          approved: false,
          approvalId: undefined,
          actionFingerprint,
        }));
      if (
        !approval.approved ||
        approval.actionFingerprint !== actionFingerprint ||
        !isValidOpaqueId(approval.approvalId)
      ) {
        await this.recordStandaloneDenial({
          request,
          definition,
          binding,
          actionFingerprint,
          reason: 'approval-required',
        });
        throw new ConflictError(
          'Credential lease requires a correlated approval for this exact action'
        );
      }
      approvalId = approval.approvalId.trim();
    }

    const handle = this.createHandle();
    assertOpaqueHandle(handle);
    const handleHash = hashCredentialHandle(handle);
    const issuedAt = this.now();
    const expiresAt = new Date(issuedAt.getTime() + definition.lease.ttlSeconds * 1000);
    const scopeDigest = calculateCredentialScopeDigest(definition.scope);
    const lease = credentialLeaseSchema.parse({
      schemaVersion: CREDENTIAL_LEASE_SCHEMA_VERSION,
      id: `lease_${handleHash.slice(0, 24)}`,
      handleHash,
      definitionId: definition.id,
      definitionDigest: definition.digest,
      taskId: binding.taskId,
      attemptId: binding.attemptId,
      runLaunchManifestDigest: binding.runLaunchManifestDigest,
      scopeDigest,
      actionFingerprint,
      ...(approvalId ? { approvalId } : {}),
      state: 'active',
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      updatedAt: issuedAt.toISOString(),
      uses: 0,
      maxUses: definition.lease.maxUses,
      operations: [],
    }) as CredentialLease;
    const event = this.event({
      type: 'issue',
      decision: 'allowed',
      definition,
      lease,
      reason: 'lease-issued',
    });

    try {
      await this.repository.transact((current) => {
        const currentDefinition = current.definitions.find(
          (candidate) => candidate.id === definition.id
        );
        if (!currentDefinition || currentDefinition.digest !== definition.digest) {
          throw new ConflictError('Credential definition changed during lease issuance');
        }
        if (current.leases.some((candidate) => candidate.handleHash === handleHash)) {
          throw new ConflictError('Generated credential handle collides with an existing lease');
        }
        return {
          state: appendAudit(
            {
              ...current,
              leases: [...current.leases, lease],
            },
            event
          ),
          result: undefined,
        };
      });
    } catch (error) {
      await this.recordStandaloneDenial({
        request,
        definition,
        binding,
        actionFingerprint,
        reason: 'lease-issuance-race',
      });
      throw error;
    }
    await this.emitAudit(event);
    try {
      await this.assertActiveBinding(request);
    } catch {
      await this.revokeLease(handle, 'run-binding-changed');
      await this.recordStandaloneDenial({
        request,
        definition,
        binding,
        actionFingerprint,
        reason: 'run-binding-changed-during-issuance',
      });
      throw new ConflictError(
        'Credential lease run or launch manifest binding became stale during issuance'
      );
    }
    return {
      handle,
      placeholder: `{{vk-credential:${handle}}}`,
      lease: structuredClone(lease),
    };
  }

  async withCredential<T>(
    request: CredentialLeaseUseRequest,
    dispatch: (credential: string) => Promise<T>
  ): Promise<T> {
    const operationId = normalizeOperationId(request.operationId);
    const action = normalizeCredentialAction(request.action);
    const actionFingerprint = calculateCredentialActionFingerprint(action);
    const handleHash = hashCredentialHandle(request.handle);
    const binding = await this.readMatchingBinding(request);
    const now = this.now().toISOString();

    const claim = await this.repository.transact<CredentialUseClaim>((state) => {
      const lease = state.leases.find((candidate) => candidate.handleHash === handleHash);
      if (!lease) {
        const event = this.event({
          type: 'denial',
          decision: 'denied',
          reason: 'unknown-lease-handle',
          taskId: request.taskId,
          attemptId: request.attemptId,
          runLaunchManifestDigest: request.runLaunchManifestDigest,
          actionFingerprint,
          operationId,
        });
        return {
          state: appendAudit(state, event),
          result: { allowed: false, event, reason: 'Credential lease was not found' },
        };
      }
      const definition = state.definitions.find((candidate) => candidate.id === lease.definitionId);
      if (lease.operations.some((operation) => operation.id === operationId)) {
        const event = this.event({
          type: 'denial',
          decision: 'denied',
          definition,
          lease,
          operationId,
          reason: 'duplicate-operation-id',
        });
        return {
          state: appendAudit(state, event),
          result: {
            allowed: false,
            event,
            reason: 'Credential lease operation was already claimed',
          },
        };
      }
      if (lease.operations.length >= 2048) {
        const event = this.event({
          type: 'denial',
          decision: 'denied',
          definition,
          lease,
          operationId,
          reason: 'operation-history-exhausted',
        });
        return {
          state: appendAudit(state, event),
          result: {
            allowed: false,
            event,
            reason: 'Credential lease operation history is exhausted',
          },
        };
      }
      const denial = this.validateUseClaim({
        lease,
        definition,
        request,
        binding,
        actionFingerprint,
        now,
      });
      if (denial) {
        const nextLease = denial.lease ?? lease;
        const event = this.event({
          type: denial.eventType ?? 'denial',
          decision: 'denied',
          definition,
          lease: nextLease,
          operationId,
          reason: denial.reason,
        });
        return {
          state: appendAudit(
            {
              ...state,
              leases: state.leases.map((candidate) =>
                candidate.id === nextLease.id ? nextLease : candidate
              ),
            },
            event
          ),
          result: { allowed: false, event, reason: denial.message },
        };
      }
      const uses = lease.uses + 1;
      const nextLease = credentialLeaseSchema.parse({
        ...lease,
        uses,
        state: uses >= lease.maxUses ? 'exhausted' : 'active',
        updatedAt: now,
        operations: [...lease.operations, { id: operationId, type: 'use', occurredAt: now }],
      }) as CredentialLease;
      const event = this.event({
        type: 'use',
        decision: 'allowed',
        definition,
        lease: nextLease,
        operationId,
        reason: 'lease-use-claimed',
      });
      return {
        state: appendAudit(
          {
            ...state,
            leases: state.leases.map((candidate) =>
              candidate.id === nextLease.id ? nextLease : candidate
            ),
          },
          event
        ),
        result: {
          allowed: true,
          event,
          lease: nextLease,
          definition,
        },
      };
    });
    await this.emitAudit(claim.event);
    if (!claim.allowed || !claim.lease || !claim.definition) {
      throw new ConflictError(claim.reason ?? 'Credential lease use was denied');
    }

    const source = this.secretSources.find((candidate) =>
      candidate.supports(claim.definition?.source as CredentialSecretSourceReference)
    );
    const credential = source
      ? await source.resolve(claim.definition.source).catch(() => undefined)
      : undefined;
    if (!credential) {
      await this.blockLease(claim.lease, claim.definition, 'source-unavailable');
      throw new ConflictError('Credential source is unavailable for the claimed lease');
    }
    await this.assertClaimStillCurrent(request, claim.lease, claim.definition);

    let result: T;
    try {
      result = await dispatch(credential);
    } catch {
      throw new ConflictError('Controlled credential dispatch failed');
    }
    let safeResult: T;
    try {
      if (containsCredentialMaterial(result, credential)) {
        throw new Error('unsafe-result');
      }
      safeResult = structuredClone(result);
      if (containsCredentialMaterial(safeResult, credential)) {
        throw new Error('unsafe-clone');
      }
    } catch {
      throw new ConflictError('Controlled dispatch returned credential material');
    }
    return safeResult;
  }

  async refreshLease(request: CredentialLeaseUseRequest): Promise<CredentialLease> {
    const operationId = normalizeOperationId(request.operationId);
    const action = normalizeCredentialAction(request.action);
    const actionFingerprint = calculateCredentialActionFingerprint(action);
    const binding = await this.assertActiveBinding(request);
    const handleHash = hashCredentialHandle(request.handle);
    const now = this.now();
    let event!: CredentialBrokerAuditEvent;
    let expired = false;
    let denied: string | undefined;
    const refreshed = await this.repository.transact<CredentialLease>((state) => {
      const lease = state.leases.find((candidate) => candidate.handleHash === handleHash);
      if (!lease) throw new NotFoundError('Credential lease not found');
      const definition = state.definitions.find((candidate) => candidate.id === lease.definitionId);
      if (!definition) throw new ConflictError('Credential lease definition no longer exists');
      if (lease.operations.some((operation) => operation.id === operationId)) {
        denied = 'Credential lease operation was already claimed';
        event = this.event({
          type: 'denial',
          decision: 'denied',
          definition,
          lease,
          operationId,
          reason: 'duplicate-operation-id',
        });
        return {
          state: appendAudit(state, event),
          result: lease,
        };
      }
      if (lease.operations.length >= 2048) {
        denied = 'Credential lease operation history is exhausted';
        event = this.event({
          type: 'denial',
          decision: 'denied',
          definition,
          lease,
          operationId,
          reason: 'operation-history-exhausted',
        });
        return {
          state: appendAudit(state, event),
          result: lease,
        };
      }
      if (!definition.lease.renewable) throw new ConflictError('Credential lease is not renewable');
      if (lease.state !== 'active') {
        throw new ConflictError(`Credential lease is ${lease.state} and cannot be refreshed`);
      }
      assertLeaseBinding(lease, binding, request, actionFingerprint);
      if (new Date(lease.expiresAt).getTime() <= now.getTime()) {
        expired = true;
        const next = terminateLease(lease, 'expired', 'expired', now.toISOString());
        event = this.event({
          type: 'expire',
          decision: 'denied',
          definition,
          lease: next,
          operationId,
          reason: 'expired',
        });
        return {
          state: appendAudit(
            {
              ...state,
              leases: state.leases.map((candidate) =>
                candidate.id === next.id ? next : candidate
              ),
            },
            event
          ),
          result: next,
        };
      }
      const next = credentialLeaseSchema.parse({
        ...lease,
        expiresAt: new Date(now.getTime() + definition.lease.ttlSeconds * 1000).toISOString(),
        updatedAt: now.toISOString(),
        operations: [
          ...lease.operations,
          { id: operationId, type: 'refresh', occurredAt: now.toISOString() },
        ],
      }) as CredentialLease;
      event = this.event({
        type: 'refresh',
        decision: 'allowed',
        definition,
        lease: next,
        operationId,
        reason: 'lease-refreshed',
      });
      return {
        state: appendAudit(
          {
            ...state,
            leases: state.leases.map((candidate) => (candidate.id === next.id ? next : candidate)),
          },
          event
        ),
        result: next,
      };
    });
    await this.emitAudit(event);
    if (denied) throw new ConflictError(denied);
    if (expired) throw new ConflictError('Credential lease is expired and cannot be refreshed');
    return structuredClone(refreshed);
  }

  async revokeLease(
    handle: string,
    reason: CredentialLeaseTerminalReason = 'operator-revoked'
  ): Promise<boolean> {
    const handleHash = hashCredentialHandle(handle);
    const now = this.now().toISOString();
    let event: CredentialBrokerAuditEvent | undefined;
    const revoked = await this.repository.transact<boolean>((state) => {
      const lease = state.leases.find((candidate) => candidate.handleHash === handleHash);
      if (!lease) return { state, result: false };
      if (lease.state !== 'active') return { state, result: true };
      const next = terminateLease(lease, 'revoked', reason, now);
      const definition = state.definitions.find((candidate) => candidate.id === lease.definitionId);
      event = this.event({
        type: 'revoke',
        decision: 'recorded',
        definition,
        lease: next,
        reason,
      });
      return {
        state: appendAudit(
          {
            ...state,
            leases: state.leases.map((candidate) => (candidate.id === next.id ? next : candidate)),
          },
          event
        ),
        result: true,
      };
    });
    if (event) await this.emitAudit(event);
    return revoked;
  }

  async revokeRun(request: CredentialRunRevocationRequest): Promise<number> {
    const snapshot = await this.repository.read();
    if (
      !snapshot.leases.some(
        (lease) =>
          (lease.state === 'active' || lease.state === 'exhausted') &&
          lease.taskId === request.taskId &&
          lease.attemptId === request.attemptId &&
          (!request.runLaunchManifestDigest ||
            lease.runLaunchManifestDigest === request.runLaunchManifestDigest)
      )
    ) {
      return 0;
    }
    const now = this.now().toISOString();
    const events: CredentialBrokerAuditEvent[] = [];
    const count = await this.repository.transact<number>((state) => {
      let revoked = 0;
      const leases = state.leases.map((lease) => {
        if (
          (lease.state !== 'active' && lease.state !== 'exhausted') ||
          lease.taskId !== request.taskId ||
          lease.attemptId !== request.attemptId ||
          (request.runLaunchManifestDigest &&
            lease.runLaunchManifestDigest !== request.runLaunchManifestDigest)
        ) {
          return lease;
        }
        revoked++;
        const next = terminateLease(lease, 'revoked', request.reason, now);
        const definition = state.definitions.find(
          (candidate) => candidate.id === lease.definitionId
        );
        events.push(
          this.event({
            type: 'revoke',
            decision: 'recorded',
            definition,
            lease: next,
            reason: request.reason,
          })
        );
        return next;
      });
      return {
        state: events.reduce((current, event) => appendAudit(current, event), { ...state, leases }),
        result: revoked,
      };
    });
    await Promise.all(events.map((event) => this.emitAudit(event)));
    return count;
  }

  async reconcile(): Promise<CredentialBrokerReconciliationResult> {
    const now = this.now();
    const snapshot = await this.repository.read();
    if (!snapshot.leases.some((lease) => lease.state === 'active' || lease.state === 'exhausted')) {
      return {
        active: 0,
        revoked: snapshot.leases.filter((lease) => lease.state === 'revoked').length,
        expired: snapshot.leases.filter((lease) => lease.state === 'expired').length,
        blocked: snapshot.leases.filter((lease) => lease.state === 'blocked').length,
      };
    }
    const candidates = snapshot.leases.flatMap((lease) => {
      if (
        (lease.state !== 'active' && lease.state !== 'exhausted') ||
        new Date(lease.expiresAt).getTime() <= now.getTime()
      ) {
        return [];
      }
      const definition = snapshot.definitions.find(
        (candidate) => candidate.id === lease.definitionId
      );
      if (!definition?.enabled || definition.digest !== lease.definitionDigest) {
        return [];
      }
      return [{ lease, definition }];
    });
    const evidenceEntries = await mapWithConcurrency(
      candidates,
      16,
      async ({ lease, definition }): Promise<CredentialReconciliationEvidence> => {
        const source = this.secretSources.find((candidate) =>
          candidate.supports(definition.source)
        );
        const sourceAvailable = source
          ? await source.isAvailable(definition.source).catch(() => false)
          : false;
        const binding = sourceAvailable
          ? await this.runBindings.read(lease.taskId).catch(() => null)
          : null;
        return {
          leaseId: lease.id,
          leaseUpdatedAt: lease.updatedAt,
          definitionDigest: definition.digest,
          sourceAvailable,
          binding,
        };
      }
    );
    const evidenceByLeaseId = new Map(
      evidenceEntries.map((evidence) => [evidence.leaseId, evidence])
    );
    const events: CredentialBrokerAuditEvent[] = [];
    const result = await this.repository.transact<CredentialBrokerReconciliationResult>((state) => {
      const leases: CredentialLease[] = [];
      for (const lease of state.leases) {
        if (lease.state !== 'active' && lease.state !== 'exhausted') {
          leases.push(lease);
          continue;
        }
        const definition = state.definitions.find(
          (candidate) => candidate.id === lease.definitionId
        );
        let next = lease;
        let reason: CredentialLeaseTerminalReason | undefined;
        let nextState: CredentialLease['state'] = 'revoked';
        if (new Date(lease.expiresAt).getTime() <= now.getTime()) {
          reason = 'expired';
          nextState = 'expired';
        } else if (!definition?.enabled) {
          reason = 'definition-disabled';
        } else if (definition.digest !== lease.definitionDigest) {
          reason = 'definition-changed';
        } else {
          const evidence = evidenceByLeaseId.get(lease.id);
          if (
            !evidence ||
            evidence.leaseUpdatedAt !== lease.updatedAt ||
            evidence.definitionDigest !== definition.digest
          ) {
            leases.push(lease);
            continue;
          }
          if (!evidence.sourceAvailable) {
            reason = 'source-unavailable';
            nextState = 'blocked';
          } else {
            const binding = evidence.binding;
            if (!binding) {
              reason = 'run-missing';
            } else if (
              binding.status !== 'running' ||
              binding.attemptId !== lease.attemptId ||
              binding.runLaunchManifestDigest !== lease.runLaunchManifestDigest
            ) {
              reason = 'run-binding-changed';
            }
          }
        }
        if (reason) {
          next = terminateLease(lease, nextState, reason, now.toISOString());
          events.push(
            this.event({
              type: nextState === 'expired' ? 'expire' : 'reconcile',
              decision: 'recorded',
              definition,
              lease: next,
              reason,
            })
          );
        }
        leases.push(next);
      }
      const nextState = events.reduce((current, event) => appendAudit(current, event), {
        ...state,
        leases,
      });
      return {
        state: nextState,
        result: {
          active: leases.filter((lease) => lease.state === 'active').length,
          revoked: leases.filter((lease) => lease.state === 'revoked').length,
          expired: leases.filter((lease) => lease.state === 'expired').length,
          blocked: leases.filter((lease) => lease.state === 'blocked').length,
        },
      };
    });
    await Promise.all(events.map((event) => this.emitAudit(event)));
    return result;
  }

  private async assertActiveBinding(input: {
    taskId: string;
    attemptId: string;
    runLaunchManifestDigest: string;
    definitionId?: string;
  }): Promise<CredentialRunBinding> {
    const binding = await this.runBindings.read(input.taskId);
    if (!binding) throw new ConflictError('Credential lease run binding was not found');
    credentialRunBindingSchema.parse(binding);
    if (
      binding.status !== 'running' ||
      binding.attemptId !== input.attemptId ||
      binding.runLaunchManifestDigest !== input.runLaunchManifestDigest
    ) {
      throw new ConflictError('Credential lease run or launch manifest binding is stale');
    }
    if (
      input.definitionId &&
      !binding.credentialReferences.some((reference) => reference.trim() === input.definitionId)
    ) {
      throw new ConflictError(
        'Credential definition is not declared by the immutable run launch manifest'
      );
    }
    return binding;
  }

  private async readMatchingBinding(
    request: CredentialLeaseUseRequest
  ): Promise<CredentialRunBinding | null> {
    const binding = await this.runBindings.read(request.taskId);
    return binding ? (credentialRunBindingSchema.parse(binding) as CredentialRunBinding) : null;
  }

  private validateUseClaim(input: {
    lease: CredentialLease;
    definition: CredentialDefinition | undefined;
    request: CredentialLeaseUseRequest;
    binding: CredentialRunBinding | null;
    actionFingerprint: string;
    now: string;
  }):
    | {
        reason: string;
        message: string;
        lease?: CredentialLease;
        eventType?: CredentialBrokerAuditEvent['type'];
      }
    | undefined {
    const { lease, definition, request, binding, actionFingerprint, now } = input;
    if (lease.state !== 'active') {
      return {
        reason: `lease-${lease.state}`,
        message: `Credential lease is ${lease.state}`,
      };
    }
    if (new Date(lease.expiresAt).getTime() <= new Date(now).getTime()) {
      return {
        reason: 'expired',
        message: 'Credential lease is expired',
        lease: terminateLease(lease, 'expired', 'expired', now),
        eventType: 'expire',
      };
    }
    if (!definition?.enabled) {
      return {
        reason: 'definition-disabled',
        message: 'Credential definition is disabled or missing',
        lease: terminateLease(lease, 'revoked', 'definition-disabled', now),
      };
    }
    if (definition.digest !== lease.definitionDigest) {
      return {
        reason: 'definition-changed',
        message: 'Credential definition changed after lease issuance',
        lease: terminateLease(lease, 'revoked', 'definition-changed', now),
      };
    }
    if (
      !binding ||
      binding.status !== 'running' ||
      binding.attemptId !== request.attemptId ||
      binding.runLaunchManifestDigest !== request.runLaunchManifestDigest
    ) {
      return {
        reason: 'run-binding-changed',
        message: 'Credential lease run or launch manifest binding changed',
        lease: terminateLease(lease, 'revoked', 'run-binding-changed', now),
      };
    }
    try {
      assertLeaseBinding(lease, binding, request, actionFingerprint);
    } catch {
      return {
        reason: 'action-binding-changed',
        message: 'Credential lease action or run binding does not match',
      };
    }
    return undefined;
  }

  private async blockLease(
    lease: CredentialLease,
    definition: CredentialDefinition,
    reason: 'source-unavailable'
  ): Promise<void> {
    const now = this.now().toISOString();
    let event!: CredentialBrokerAuditEvent;
    await this.repository.transact((state) => {
      const current = state.leases.find((candidate) => candidate.id === lease.id);
      const currentDefinition = state.definitions.find(
        (candidate) => candidate.id === definition.id
      );
      const canBlock =
        current?.state === lease.state &&
        current.updatedAt === lease.updatedAt &&
        current.definitionDigest === lease.definitionDigest &&
        currentDefinition?.digest === definition.digest;
      const next = current && canBlock ? terminateLease(current, 'blocked', reason, now) : current;
      event = this.event({
        type: 'denial',
        decision: 'denied',
        definition: currentDefinition ?? definition,
        lease: next ?? lease,
        reason: canBlock ? reason : 'source-unavailable-after-terminal-transition',
      });
      return {
        state: appendAudit(
          next
            ? {
                ...state,
                leases: state.leases.map((candidate) =>
                  candidate.id === next.id ? next : candidate
                ),
              }
            : state,
          event
        ),
        result: undefined,
      };
    });
    await this.emitAudit(event);
  }

  private async assertClaimStillCurrent(
    request: CredentialLeaseUseRequest,
    claimedLease: CredentialLease,
    claimedDefinition: CredentialDefinition
  ): Promise<void> {
    const binding = await this.readMatchingBinding(request);
    if (
      !binding ||
      binding.status !== 'running' ||
      binding.attemptId !== request.attemptId ||
      binding.runLaunchManifestDigest !== request.runLaunchManifestDigest
    ) {
      throw new ConflictError(
        'Credential dispatch was cancelled because the run binding changed after the use claim'
      );
    }
    const state = await this.repository.read();
    const lease = state.leases.find((candidate) => candidate.id === claimedLease.id);
    const definition = state.definitions.find((candidate) => candidate.id === claimedDefinition.id);
    if (!lease || !definition || definition.digest !== claimedDefinition.digest) {
      throw new ConflictError(
        'Credential dispatch was cancelled because its definition changed after the use claim'
      );
    }
    if (lease.state === 'revoked' || lease.state === 'expired' || lease.state === 'blocked') {
      throw new ConflictError(
        `Credential dispatch was cancelled because the lease is ${lease.state}`
      );
    }
    if (new Date(lease.expiresAt).getTime() <= this.now().getTime()) {
      throw new ConflictError(
        'Credential dispatch was cancelled because the lease expired after the use claim'
      );
    }
  }

  private async recordStandaloneDenial(input: {
    request: Pick<CredentialLeaseIssueRequest, 'taskId' | 'attemptId' | 'runLaunchManifestDigest'>;
    definition?: CredentialDefinition;
    binding?: CredentialRunBinding;
    actionFingerprint?: string;
    reason: string;
  }): Promise<void> {
    const event = this.event({
      type: 'denial',
      decision: 'denied',
      definition: input.definition,
      taskId: input.binding?.taskId ?? input.request.taskId,
      attemptId: input.binding?.attemptId ?? input.request.attemptId,
      runLaunchManifestDigest:
        input.binding?.runLaunchManifestDigest ?? input.request.runLaunchManifestDigest,
      scopeDigest: input.definition
        ? calculateCredentialScopeDigest(input.definition.scope)
        : undefined,
      actionFingerprint: input.actionFingerprint,
      reason: input.reason,
    });
    await this.repository.transact((state) => ({
      state: appendAudit(state, event),
      result: undefined,
    }));
    await this.emitAudit(event);
  }

  private event(input: {
    type: CredentialBrokerAuditEvent['type'];
    decision: CredentialBrokerAuditEvent['decision'];
    reason: string;
    definition?: CredentialDefinition;
    lease?: CredentialLease;
    taskId?: string;
    attemptId?: string;
    runLaunchManifestDigest?: string;
    actionFingerprint?: string;
    scopeDigest?: string;
    operationId?: string;
  }): CredentialBrokerAuditEvent {
    const occurredAt = this.now().toISOString();
    return {
      schemaVersion: CREDENTIAL_BROKER_AUDIT_SCHEMA_VERSION,
      id: `cred-audit_${randomBytes(12).toString('hex')}`,
      type: input.type,
      occurredAt,
      decision: input.decision,
      definitionId: input.definition?.id,
      definitionDigest: input.definition?.digest,
      leaseId: input.lease?.id,
      taskId: input.lease?.taskId ?? input.taskId,
      attemptId: input.lease?.attemptId ?? input.attemptId,
      runLaunchManifestDigest:
        input.lease?.runLaunchManifestDigest ?? input.runLaunchManifestDigest,
      scopeDigest: input.lease?.scopeDigest ?? input.scopeDigest,
      actionFingerprint: input.lease?.actionFingerprint ?? input.actionFingerprint,
      operationId: input.operationId,
      reason: input.reason,
    };
  }

  private async emitAudit(event: CredentialBrokerAuditEvent): Promise<void> {
    try {
      await this.auditSink(structuredClone(event));
    } catch {
      // Broker state already contains the metadata-only event. External audit
      // projection is best-effort and must not expose or resurrect a secret.
    }
  }
}

function normalizeDefinitionInput(input: CredentialDefinitionInput): CredentialDefinitionInput {
  const dispatchTypes = uniqueSorted(input.scope.dispatchTypes);
  return {
    ...input,
    id: normalizeDefinitionId(input.id),
    name: input.name.trim(),
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
    source:
      input.source.kind === 'environment'
        ? {
            kind: 'environment',
            reference: input.source.reference.trim().toUpperCase(),
          }
        : {
            kind: 'external',
            provider: input.source.provider.trim(),
            reference: input.source.reference.trim(),
          },
    scope: {
      dispatchTypes,
      hosts: uniqueSorted(input.scope.hosts.map(normalizeHost)),
      tools: uniqueSorted(input.scope.tools.map((value) => value.trim())),
      destinations: uniqueSorted(
        input.scope.destinations.map((value) =>
          dispatchTypes.includes('http')
            ? normalizeHttpDestination(value)
            : normalizeDestination(value)
        )
      ),
      methods: uniqueSorted(input.scope.methods.map((value) => value.trim().toUpperCase())),
      actions: uniqueSorted(input.scope.actions.map((value) => value.trim())),
      pathPrefixes: uniqueSorted(input.scope.pathPrefixes.map(normalizePathPrefix)),
    },
    lease: { ...input.lease },
  };
}

function normalizeDefinitionId(id: string): string {
  return id.trim().toLowerCase();
}

function normalizeOperationId(operationId: string): string {
  const normalized = operationId.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(normalized)) {
    throw new ValidationError('Credential lease operation ID is invalid');
  }
  return `sha256:${createHash('sha256').update(normalized).digest('hex')}`;
}

function isValidOpaqueId(value: string | undefined): value is string {
  return Boolean(value && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(value.trim()));
}

function normalizeCredentialAction(input: CredentialAction): CredentialAction {
  const action = credentialActionSchema.parse({
    ...input,
    ...(input.host ? { host: normalizeHost(input.host) } : {}),
    ...(input.tool ? { tool: input.tool.trim() } : {}),
    ...(input.destination
      ? {
          destination:
            input.dispatchType === 'http'
              ? normalizeHttpDestination(input.destination)
              : normalizeDestination(input.destination),
        }
      : {}),
    ...(input.method ? { method: input.method.trim().toUpperCase() } : {}),
    ...(input.action ? { action: input.action.trim() } : {}),
    ...(input.path ? { path: normalizeScopedPath(input.path, false) } : {}),
  }) as CredentialAction;
  if (action.dispatchType === 'http' && action.destination && action.host) {
    const destinationHost = normalizeHost(new URL(action.destination).hostname);
    if (destinationHost !== action.host) {
      throw new ValidationError('Credential action host must match its HTTP destination');
    }
  }
  return action;
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase();
}

function normalizePath(value: string): string {
  const normalized = value.trim();
  return normalized.length > 1 ? normalized.replace(/\/+$/, '') || '/' : normalized;
}

function normalizePathPrefix(value: string): string {
  return normalizeScopedPath(value, true);
}

function normalizeScopedPath(value: string, preserveTrailingSlash: boolean): string {
  const normalized = value.trim();
  if (!normalized.startsWith('/')) {
    throw new ValidationError('Credential scope paths must be absolute paths');
  }
  if (normalized.includes('?') || normalized.includes('#') || normalized.includes('\\')) {
    throw new ValidationError(
      'Credential scope paths cannot contain queries, fragments, or backslashes'
    );
  }
  if (/%(?:2f|5c)/i.test(normalized)) {
    throw new ValidationError('Credential scope paths cannot contain encoded path separators');
  }
  const canonical = new URL(normalized, 'https://credential.invalid').pathname.replace(
    /\/{2,}/g,
    '/'
  );
  if (canonical === '/') return canonical;
  if (preserveTrailingSlash && normalized.endsWith('/')) {
    return canonical.endsWith('/') ? canonical : `${canonical}/`;
  }
  return canonical.replace(/\/+$/, '') || '/';
}

function normalizeDestination(value: string): string {
  const normalized = value.trim();
  try {
    const url = new URL(normalized);
    if (url.username || url.password) {
      throw new ValidationError('Credential destinations cannot contain URL credentials');
    }
    url.hash = '';
    url.search = '';
    url.hostname = url.hostname.toLowerCase();
    url.pathname = normalizePath(url.pathname || '/');
    return `${url.origin}${url.pathname === '/' ? '' : url.pathname}`;
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    return normalized;
  }
}

function normalizeHttpDestination(value: string): string {
  const normalized = value.trim();
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new ValidationError('HTTP credential destinations must be absolute URLs');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ValidationError('HTTP credential destinations must use http or https');
  }
  if (url.username || url.password) {
    throw new ValidationError('Credential destinations cannot contain URL credentials');
  }
  if (url.search || url.hash) {
    throw new ValidationError(
      'Credential destinations cannot contain query strings or fragments; bind them in the action digest'
    );
  }
  url.hostname = url.hostname.toLowerCase();
  url.pathname = normalizePath(url.pathname || '/');
  return `${url.origin}${url.pathname === '/' ? '' : url.pathname}`;
}

function assertActionWithinScope(definition: CredentialDefinition, action: CredentialAction): void {
  const { scope } = definition;
  const actionPath = action.path;
  const checks: Array<[boolean, string]> = [
    [scope.dispatchTypes.includes(action.dispatchType), 'dispatch type'],
    [scope.hosts.length === 0 || Boolean(action.host && scope.hosts.includes(action.host)), 'host'],
    [scope.tools.length === 0 || Boolean(action.tool && scope.tools.includes(action.tool)), 'tool'],
    [
      scope.destinations.length === 0 ||
        Boolean(action.destination && scope.destinations.includes(action.destination)),
      'destination',
    ],
    [
      scope.methods.length === 0 || Boolean(action.method && scope.methods.includes(action.method)),
      'method',
    ],
    [
      scope.actions.length === 0 || Boolean(action.action && scope.actions.includes(action.action)),
      'action',
    ],
    [
      scope.pathPrefixes.length === 0 ||
        Boolean(
          actionPath &&
          scope.pathPrefixes.some(
            (prefix) =>
              actionPath === prefix ||
              actionPath.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`)
          )
        ),
      'path',
    ],
  ];
  const failed = checks.find(([allowed]) => !allowed);
  if (failed) {
    throw new ConflictError(`Credential action is outside the allowed ${failed[1]} scope`);
  }
}

function assertLeaseBinding(
  lease: CredentialLease,
  binding: CredentialRunBinding,
  request: CredentialLeaseUseRequest,
  actionFingerprint: string
): void {
  if (
    lease.taskId !== request.taskId ||
    lease.attemptId !== request.attemptId ||
    lease.runLaunchManifestDigest !== request.runLaunchManifestDigest ||
    binding.taskId !== request.taskId ||
    binding.attemptId !== request.attemptId ||
    binding.runLaunchManifestDigest !== request.runLaunchManifestDigest ||
    lease.actionFingerprint !== actionFingerprint
  ) {
    throw new ConflictError('Credential lease action or run binding does not match');
  }
}

function assertOpaqueHandle(handle: string): void {
  if (!/^vkcred_[A-Za-z0-9_-]{3,}$/.test(handle)) {
    throw new ValidationError('Credential handle generator returned an invalid opaque handle');
  }
}

function terminateLease(
  lease: CredentialLease,
  state: Extract<CredentialLease['state'], 'revoked' | 'expired' | 'blocked'>,
  reason: CredentialLeaseTerminalReason,
  timestamp: string
): CredentialLease {
  return credentialLeaseSchema.parse({
    ...lease,
    state,
    updatedAt: timestamp,
    revokedAt: timestamp,
    terminalReason: reason,
  }) as CredentialLease;
}

function appendAudit(
  state: CredentialBrokerState,
  event: CredentialBrokerAuditEvent
): CredentialBrokerState {
  return {
    ...state,
    auditEvents: [...state.auditEvents, event].slice(-MAX_AUDIT_EVENTS),
  };
}

function uniqueSorted<T extends string>(values: T[]): T[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function containsCredentialMaterial(value: unknown, credential: string): boolean {
  const seen = new Set<unknown>();
  let visitedNodes = 0;

  function visitOwnProperties(candidate: object, depth: number): boolean {
    return Reflect.ownKeys(candidate).some((key) => {
      const keyText = typeof key === 'symbol' ? (key.description ?? '') : key;
      if (keyText.includes(credential)) return true;
      const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
      if (!descriptor) return false;
      if (descriptor.get || descriptor.set) return true;
      return 'value' in descriptor && visit(descriptor.value, depth + 1);
    });
  }

  function visit(candidate: unknown, depth: number): boolean {
    visitedNodes++;
    if (depth > 10 || visitedNodes > 10_000) return true;
    if (candidate === null || candidate === undefined) return false;
    if (typeof candidate === 'string') return candidate.includes(credential);
    if (
      typeof candidate === 'number' ||
      typeof candidate === 'boolean' ||
      typeof candidate === 'bigint'
    ) {
      return false;
    }
    if (typeof candidate === 'symbol' || typeof candidate === 'function') return true;
    if (seen.has(candidate)) return true;
    seen.add(candidate);
    // Binary results are rejected wholesale. A view can expose bytes outside
    // its visible slice through `.buffer`, and SharedArrayBuffer remains mutable
    // after inspection. Controlled dispatches must return data-only structures.
    if (ArrayBuffer.isView(candidate) || candidate instanceof ArrayBuffer) return true;
    if (candidate instanceof URL) {
      return (
        Object.getPrototypeOf(candidate) !== URL.prototype ||
        candidate.href.includes(credential) ||
        visitOwnProperties(candidate, depth)
      );
    }
    if (candidate instanceof URLSearchParams) {
      return (
        Object.getPrototypeOf(candidate) !== URLSearchParams.prototype ||
        candidate.toString().includes(credential) ||
        visitOwnProperties(candidate, depth)
      );
    }
    if (candidate instanceof Date) {
      return (
        Object.getPrototypeOf(candidate) !== Date.prototype || visitOwnProperties(candidate, depth)
      );
    }
    if (Array.isArray(candidate)) {
      return (
        Object.getPrototypeOf(candidate) !== Array.prototype || visitOwnProperties(candidate, depth)
      );
    }
    if (candidate instanceof Map) {
      return (
        Object.getPrototypeOf(candidate) !== Map.prototype ||
        [...candidate.entries()].some(
          ([key, entry]) => visit(key, depth + 1) || visit(entry, depth + 1)
        ) ||
        visitOwnProperties(candidate, depth)
      );
    }
    if (candidate instanceof Set) {
      return (
        Object.getPrototypeOf(candidate) !== Set.prototype ||
        [...candidate.values()].some((entry) => visit(entry, depth + 1)) ||
        visitOwnProperties(candidate, depth)
      );
    }
    if (candidate instanceof Error) {
      return (
        !SAFE_ERROR_PROTOTYPES.has(Object.getPrototypeOf(candidate)) ||
        candidate.message.includes(credential) ||
        candidate.stack?.includes(credential) === true ||
        visitOwnProperties(candidate, depth)
      );
    }
    if (typeof candidate === 'object') {
      const prototype = Object.getPrototypeOf(candidate);
      return (
        (prototype !== Object.prototype && prototype !== null) ||
        visitOwnProperties(candidate, depth)
      );
    }
    return false;
  }

  return visit(value, 0);
}

async function mapWithConcurrency<T, R>(
  values: T[],
  limit: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await mapper(values[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return results;
}

export function parseCredentialPlaceholder(value: string): string {
  const matches = [...value.matchAll(CREDENTIAL_PLACEHOLDER_PATTERN)];
  if (matches.length !== 1) {
    throw new ValidationError(
      matches.length > 1
        ? 'Credential placeholder is ambiguous'
        : 'Credential placeholder is missing or invalid'
    );
  }
  if (matches[0][0] !== value.trim()) {
    throw new ValidationError('Credential placeholder must be the complete value');
  }
  return matches[0][1];
}

let singleton: CredentialBrokerService | null = null;

export function getCredentialBrokerService(): CredentialBrokerService {
  singleton ??= new CredentialBrokerService();
  return singleton;
}
