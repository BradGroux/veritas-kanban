import { nanoid } from 'nanoid';
import {
  DEPENDENCY_CIRCUIT_OVERRIDE_SCHEMA_VERSION,
  type DependencyCircuitOverride,
  type DependencyCircuitOverrideMode,
} from '@veritas-kanban/shared';
import { redactString } from '../lib/redact.js';
import { auditLog, type AuditEvent } from './audit-service.js';
import { opaqueDependencyId } from './dependency-circuit-breaker.js';
import { DependencyCircuitRegistryService } from './dependency-circuit-registry-service.js';
import { getDependencyCircuitRegistryService } from './dependency-circuit-runtime.js';

export interface DependencyCircuitOverrideInput {
  circuitKey: string;
  mode: DependencyCircuitOverrideMode;
  reason: string;
  durationSeconds: number;
  actorId: string;
}

export class DependencyCircuitControlService {
  constructor(
    private readonly registry: DependencyCircuitRegistryService = getDependencyCircuitRegistryService(),
    private readonly audit: (event: AuditEvent) => Promise<void> = auditLog,
    private readonly now: () => number = Date.now
  ) {}

  async override(input: DependencyCircuitOverrideInput): Promise<DependencyCircuitOverride> {
    if (!Number.isInteger(input.durationSeconds) || input.durationSeconds < 60) {
      throw new Error('Dependency circuit override duration must be at least 60 seconds.');
    }
    if (input.durationSeconds > 3_600) {
      throw new Error('Dependency circuit override duration cannot exceed 3600 seconds.');
    }
    const createdAt = new Date(this.now());
    const override = await this.registry.setOverride({
      schemaVersion: DEPENDENCY_CIRCUIT_OVERRIDE_SCHEMA_VERSION,
      id: `ciroverride_${nanoid(18)}`,
      circuitKey: input.circuitKey,
      mode: input.mode,
      reason: redactString(input.reason).slice(0, 1_000),
      actorId: input.actorId,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(
        createdAt.getTime() + input.durationSeconds * 1_000
      ).toISOString(),
    });
    await this.audit({
      action: 'dependency-circuit.override.created',
      actor: input.actorId,
      resource: opaqueDependencyId(input.circuitKey),
      details: {
        overrideId: override.id,
        mode: override.mode,
        reason: override.reason,
        expiresAt: override.expiresAt,
      },
    });
    return override;
  }

  async clearOverride(circuitKey: string, actorId: string): Promise<boolean> {
    const cleared = await this.registry.clearOverride(circuitKey);
    if (cleared) {
      await this.audit({
        action: 'dependency-circuit.override.cleared',
        actor: actorId,
        resource: opaqueDependencyId(circuitKey),
      });
    }
    return cleared;
  }

  async reset(circuitKey: string, actorId: string, reason: string): Promise<boolean> {
    const reset = await this.registry.reset(circuitKey);
    if (reset) {
      await this.audit({
        action: 'dependency-circuit.reset',
        actor: actorId,
        resource: opaqueDependencyId(circuitKey),
        details: { reason: redactString(reason).slice(0, 1_000) },
      });
    }
    return reset;
  }
}

let singleton: DependencyCircuitControlService | undefined;

export function getDependencyCircuitControlService(): DependencyCircuitControlService {
  singleton ??= new DependencyCircuitControlService();
  return singleton;
}
