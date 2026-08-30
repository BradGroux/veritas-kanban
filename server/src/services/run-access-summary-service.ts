import path from 'node:path';
import type {
  AdmissionReservation,
  CredentialDefinition,
  CredentialLease,
  PhaseCapabilityEvidence,
  ProviderRuntimeCapabilityState,
  RunAccessBlocker,
  RunAccessFieldSource,
  RunAccessFilesystemTarget,
  RunAccessIntegration,
  RunAccessSourceReference,
  RunAccessSummary,
  RunAccessSummaryResponse,
  RunAccessTool,
  RunPhaseAuthoritySnapshot,
  RunToolCatalog,
  Task,
  TaskAttempt,
} from '@veritas-kanban/shared';
import { RUN_ACCESS_SUMMARY_SCHEMA_VERSION } from '@veritas-kanban/shared';
import { NotFoundError } from '../middleware/error-handler.js';
import type { TaskRepository, ToolControlPlaneRepository } from '../storage/interfaces.js';
import { getStorage } from '../storage/index.js';
import { redactString } from '../lib/redact.js';
import { calculateRunToolCatalogDigest } from '../utils/tool-control-plane-digest.js';
import {
  digestRunLaunchValue,
  verifyRunLaunchManifestDigest,
} from '../utils/run-launch-manifest-digest.js';
import { verifyProviderRuntimeManifestDigest } from '../utils/provider-runtime-manifest-digest.js';
import { sanitizeProviderRuntimeDiagnostic } from '../utils/provider-runtime-manifest-sanitize.js';
import {
  calculateCredentialScopeDigest,
  verifyCredentialDefinitionDigest,
} from '../utils/credential-broker-digest.js';
import { verifyPhaseCapabilityEvidenceDigest } from './phase-capability-service.js';
import {
  getRunPhaseAuthorityService,
  type RunPhaseAuthorityService,
} from './run-phase-authority-service.js';
import {
  getAdmissionControlService,
  type AdmissionControlService,
} from './admission-control-service.js';
import {
  getCredentialBrokerService,
  type CredentialBrokerService,
} from './credential-broker-service.js';

type CredentialReader = Pick<CredentialBrokerService, 'listDefinitions' | 'listLeases'>;

export interface RunAccessSummaryServiceOptions {
  tasks?: Pick<TaskRepository, 'findById'>;
  phase?: Pick<RunPhaseAuthorityService, 'get'>;
  tools?: Pick<ToolControlPlaneRepository, 'getRunCatalog'>;
  admission?: Pick<AdmissionControlService, 'findByAttempt'>;
  credentials?: CredentialReader;
  now?: () => Date;
}

interface ProjectionContext {
  workspaceId: string;
  task: Task;
  attempt: TaskAttempt;
  phase: RunPhaseAuthoritySnapshot | null;
  evidence: PhaseCapabilityEvidence | null;
  sequence: number;
  transitionDigest?: string;
  catalog: RunToolCatalog | null;
  reservation: AdmissionReservation | null;
  definitions: CredentialDefinition[];
  leases: CredentialLease[];
  generatedAt: string;
  loadErrors: Partial<Record<'phase' | 'catalog' | 'admission' | 'credentials', string>>;
}

interface LoadResult<T> {
  value: T;
  error?: string;
}

export class RunAccessSummaryService {
  private readonly now: () => Date;

  constructor(private readonly options: RunAccessSummaryServiceOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  async get(
    workspaceId: string,
    taskId: string,
    attemptId: string
  ): Promise<RunAccessSummaryResponse> {
    const tasks = this.options.tasks ?? getStorage().tasks;
    const task = await tasks.findById(taskId);
    if (!task) throw new NotFoundError('Task not found.');
    const attempt = findAttempt(task, attemptId);
    if (!attempt) throw new NotFoundError('Run attempt not found.');

    const credentialReader = this.options.credentials ?? getCredentialBrokerService();
    const [phaseResult, catalogResult, reservationResult, credentialResult] = await Promise.all([
      captureLoad(
        (this.options.phase ?? getRunPhaseAuthorityService()).get(workspaceId, taskId, attemptId),
        null
      ),
      captureLoad(
        (this.options.tools ?? getStorage().toolControlPlane).getRunCatalog(taskId, attemptId),
        null
      ),
      captureLoad(
        (this.options.admission ?? getAdmissionControlService()).findByAttempt(
          workspaceId,
          taskId,
          attemptId
        ),
        null
      ),
      captureLoad(
        Promise.all([credentialReader.listDefinitions(), credentialReader.listLeases()]),
        [[], []] as [CredentialDefinition[], CredentialLease[]]
      ),
    ]);
    const generatedAt = this.now().toISOString();
    const [definitions, leases] = credentialResult.value;
    const base = {
      workspaceId,
      task,
      attempt,
      phase: phaseResult.value,
      catalog: catalogResult.value,
      reservation: reservationResult.value,
      definitions,
      leases,
      generatedAt,
      loadErrors: {
        ...(phaseResult.error ? { phase: phaseResult.error } : {}),
        ...(catalogResult.error ? { catalog: catalogResult.error } : {}),
        ...(reservationResult.error ? { admission: reservationResult.error } : {}),
        ...(credentialResult.error ? { credentials: credentialResult.error } : {}),
      },
    };
    const versions: RunAccessSummary[] = [];

    const launchEvidence = attempt.runLaunchManifest?.phase?.evidence ?? null;
    versions.push(this.project({ ...base, evidence: launchEvidence, sequence: 0 }));
    for (const transition of [...(phaseResult.value?.history ?? [])].sort(
      (left, right) => left.sequence - right.sequence
    )) {
      versions.push(
        this.project({
          ...base,
          evidence: transition.effectiveEvidence,
          sequence: transition.sequence,
          transitionDigest: digestRunLaunchValue(transition),
        })
      );
    }

    const current = versions.at(-1) as RunAccessSummary;
    return { current, history: versions.slice(0, -1).reverse() };
  }

  private project(context: ProjectionContext): RunAccessSummary {
    const { attempt, evidence, catalog, reservation, definitions, leases } = context;
    const manifest = attempt.runLaunchManifest;
    const providerRuntime = attempt.providerRuntimeManifest;
    const blockers: RunAccessBlocker[] = [];
    const sources: RunAccessSourceReference[] = [];

    for (const [record, message] of Object.entries(context.loadErrors)) {
      blockers.push(
        blocker(
          `${record}-projection-unavailable`,
          `Authoritative ${record} evidence could not be loaded: ${message}`
        )
      );
    }

    const manifestDigest = manifest?.digest ?? missingDigest('run-launch-manifest', attempt.id);
    const manifestSource = fieldSource('run-launch-manifest', manifestDigest, '$');
    sources.push(
      sourceReference(
        'run-launch-manifest',
        manifest?.schemaVersion ?? 'run-launch-manifest/v1',
        attempt.id,
        manifestDigest,
        !manifest ? 'missing' : verifyRunLaunchManifestDigest(manifest) ? 'verified' : 'conflict'
      )
    );
    if (!manifest) {
      blockers.push(
        blocker('missing-launch-manifest', 'Run launch manifest is unavailable.', manifestSource)
      );
    } else if (!verifyRunLaunchManifestDigest(manifest)) {
      blockers.push(
        blocker(
          'launch-manifest-digest-conflict',
          'Run launch manifest failed digest validation.',
          manifestSource
        )
      );
    }

    const phaseDigest = evidence?.digest ?? missingDigest('phase-capability-evidence', attempt.id);
    const phaseSource = fieldSource('phase-capability-evidence', phaseDigest, '$');
    sources.push(
      sourceReference(
        'phase-capability-evidence',
        evidence?.schemaVersion ?? 'phase-capability-evidence/v1',
        `${attempt.id}:${context.sequence}`,
        phaseDigest,
        !evidence
          ? 'missing'
          : verifyPhaseCapabilityEvidenceDigest(evidence)
            ? 'verified'
            : 'conflict'
      )
    );
    if (!evidence) {
      blockers.push(
        blocker('missing-phase-evidence', 'Run phase evidence is unavailable.', phaseSource)
      );
    } else if (!verifyPhaseCapabilityEvidenceDigest(evidence)) {
      blockers.push(
        blocker(
          'phase-evidence-digest-conflict',
          'Run phase evidence failed digest validation.',
          phaseSource
        )
      );
    }
    if (context.transitionDigest) {
      sources.push(
        sourceReference(
          'phase-transition-record',
          'phase-transition-record/v1',
          `${attempt.id}:${context.sequence}`,
          context.transitionDigest,
          'verified'
        )
      );
    }

    const providerDigest =
      providerRuntime?.digest ?? missingDigest('provider-runtime-manifest', attempt.id);
    const providerSource = fieldSource('provider-runtime-manifest', providerDigest, '$');
    const providerConflict =
      !!providerRuntime &&
      (!verifyProviderRuntimeManifestDigest(providerRuntime) ||
        (!!manifest && manifest.providerRuntime.digest !== providerRuntime.digest));
    sources.push(
      sourceReference(
        'provider-runtime-manifest',
        providerRuntime?.schemaVersion ?? 'provider-runtime-manifest/v1',
        providerRuntime?.provider ?? attempt.provider ?? attempt.agent,
        providerDigest,
        !providerRuntime ? 'missing' : providerConflict ? 'conflict' : 'verified'
      )
    );
    if (!providerRuntime) {
      blockers.push(
        blocker(
          'missing-provider-runtime-evidence',
          'Provider runtime evidence is unavailable.',
          providerSource
        )
      );
    } else if (providerConflict) {
      blockers.push(
        blocker(
          'provider-runtime-digest-conflict',
          'Provider runtime evidence conflicts with the launch manifest.',
          providerSource
        )
      );
    }

    const catalogDigest = catalog?.digest ?? missingDigest('run-tool-catalog', attempt.id);
    const catalogSource = fieldSource('run-tool-catalog', catalogDigest, '$');
    const catalogExpected = manifest?.tools.catalogDigest;
    const catalogConflict =
      !!catalog &&
      (calculateRunToolCatalogDigest(catalog) !== catalog.digest ||
        catalog.taskId !== manifest?.taskId ||
        catalog.attemptId !== manifest?.attemptId ||
        (!!providerRuntime && catalog.providerRuntimeManifestDigest !== providerRuntime.digest) ||
        (!!manifest && catalog.taskEnvelopeDigest !== manifest.taskEnvelope.digest) ||
        (!!catalogExpected && catalogExpected !== catalog.digest) ||
        (!!manifest?.phase?.evidence.digest &&
          !!catalog.phaseEvidenceDigest &&
          catalog.phaseEvidenceDigest !== manifest.phase.evidence.digest));
    sources.push(
      sourceReference(
        'run-tool-catalog',
        catalog?.schemaVersion ?? 'run-tool-catalog/v1',
        attempt.id,
        catalogDigest,
        !catalog ? 'missing' : catalogConflict ? 'conflict' : 'verified'
      )
    );
    if (catalogExpected && !catalog) {
      blockers.push(
        blocker('missing-tool-catalog', 'Required run tool catalog is unavailable.', catalogSource)
      );
    } else if (catalogConflict) {
      blockers.push(
        blocker(
          'tool-catalog-digest-conflict',
          'Run tool catalog conflicts with launch evidence.',
          catalogSource
        )
      );
    }

    const reservationDigest = reservation
      ? digestRunLaunchValue(reservation)
      : missingDigest('admission-reservation', attempt.id);
    const reservationSource = fieldSource('admission-reservation', reservationDigest, '$');
    const reservationConflict =
      !!reservation &&
      (reservation.request.taskId !== context.task.id ||
        reservation.request.workspaceId !== context.workspaceId ||
        reservation.attemptId !== attempt.id ||
        (!!manifest && reservation.request.hostId !== manifest.routing.selectedHost));
    sources.push(
      sourceReference(
        'admission-reservation',
        reservation?.schemaVersion ?? 'admission-reservation/v1',
        reservation?.id ?? attempt.id,
        reservationDigest,
        !reservation ? 'missing' : reservationConflict ? 'conflict' : 'verified'
      )
    );
    if (!reservation) {
      blockers.push(
        blocker(
          'missing-admission-reservation',
          'Concurrency ownership evidence is unavailable.',
          reservationSource
        )
      );
    } else if (reservationConflict) {
      blockers.push(
        blocker(
          'admission-reservation-conflict',
          'Concurrency ownership evidence conflicts with the run identity.',
          reservationSource
        )
      );
    }

    for (const manifestBlocker of manifest?.enforcement.blockers ?? []) {
      blockers.push(
        blocker(
          manifestBlocker.code,
          manifestBlocker.detail,
          fieldSource(
            'run-launch-manifest',
            manifestDigest,
            `enforcement.blockers.${manifestBlocker.field}`
          )
        )
      );
    }
    for (const phaseBlocker of evidence?.blockers ?? []) {
      blockers.push(blocker(phaseBlocker.code, phaseBlocker.message, phaseSource));
    }

    const tools = projectTools(catalog, manifest, catalogSource, manifestSource);
    const integrations = projectIntegrations(
      manifest,
      catalog,
      definitions,
      leases,
      sources,
      blockers,
      manifestSource
    );
    const filesystem = projectFilesystem(manifest, evidence, manifestSource, phaseSource);
    const network = projectNetwork(manifest, evidence, providerRuntime, manifestSource);
    const supportBlockers = blockers.filter((entry) =>
      /provider|enforce|unsupported|phase|manifest|catalog/.test(entry.code)
    );

    const status = statusFor(blockers, manifest, evidence);
    const immutableEvidenceDigest = context.transitionDigest ?? phaseDigest;
    const payload: Omit<RunAccessSummary, 'digest'> = {
      schemaVersion: RUN_ACCESS_SUMMARY_SCHEMA_VERSION,
      status,
      generatedAt: context.generatedAt,
      version: {
        kind: context.sequence === 0 ? 'launch' : 'transition',
        sequence: context.sequence,
        immutableEvidenceDigest,
      },
      identity: {
        taskId: context.task.id,
        runId: attempt.id,
        attemptId: attempt.id,
        launchManifestDigest: manifest?.digest ?? null,
        phaseEvidenceDigest: evidence?.digest ?? null,
        transitionSequence: context.sequence,
        phase: evidence?.identity ?? null,
        provider:
          providerRuntime?.provider ??
          manifest?.providerRuntime.provider ??
          attempt.provider ??
          null,
        adapter: providerRuntime?.adapter ?? manifest?.providerRuntime.adapter ?? null,
        selectedHost: manifest?.routing.selectedHost ?? reservation?.request.hostId ?? null,
        sources: [manifestSource, phaseSource, providerSource, reservationSource],
      },
      filesystem,
      network,
      tools,
      integrations,
      approvals: {
        requiredDimensions: [...(evidence?.approvalRequiredDimensions ?? [])],
        toolCount: tools.filter((tool) => tool.decision === 'approval').length,
        integrationCount: integrations.filter((integration) => integration.approval === 'required')
          .length,
        source: phaseSource,
      },
      budgets: {
        policy: manifest?.budget ?? attempt.budget?.policy ?? null,
        usage: attempt.budget?.usage ?? reservation?.executionBudget?.committed ?? null,
        capacity: reservation?.request.requested ?? null,
        concurrencyPolicies: reservation?.policies ?? [],
        reservationState: reservation?.state ?? 'missing',
        source: reservation ? reservationSource : manifestSource,
      },
      support: {
        tier:
          manifest?.harnessSupport.supportTier ?? attempt.harnessSupport?.supportTier ?? 'unknown',
        enforceable: manifest?.enforcement.enforceable === true && evidence?.status !== 'blocked',
        degraded:
          manifest?.harnessSupport.supportTier === 'degraded' ||
          attempt.harnessSupport?.supportTier === 'degraded' ||
          supportBlockers.length > 0,
        blockers: supportBlockers,
        source: providerSource,
      },
      sources,
      blockers,
    };
    return {
      ...payload,
      digest: digestRunLaunchValue({ ...payload, generatedAt: undefined }),
    };
  }
}

function projectFilesystem(
  manifest: TaskAttempt['runLaunchManifest'],
  evidence: PhaseCapabilityEvidence | null,
  manifestSource: RunAccessFieldSource,
  phaseSource: RunAccessFieldSource
): RunAccessSummary['filesystem'] {
  const filesystem = manifest?.sandbox.filesystem;
  const enforceability =
    filesystem?.state === 'enforced' || filesystem?.state === 'native'
      ? 'enforced'
      : filesystem?.state === 'advisory'
        ? 'advisory'
        : 'unavailable';
  const source = { ...manifestSource, field: 'sandbox.filesystem' };
  const targets: RunAccessFilesystemTarget[] = filesystem
    ? filesystem.roots.map((root) => ({
        label: filesystemScopeLabel(root.scope),
        access: root.access,
        scope: root.scope,
        pathDigest: root.pathDigest,
        enforceability,
        source: { ...source, field: `sandbox.filesystem.roots.${root.id}` },
      }))
    : manifest
      ? [
          {
            label: 'Task worktree',
            access:
              manifest.sandbox.effective.sandboxMode === 'read-only'
                ? ('read' as const)
                : manifest.sandbox.effective.sandboxMode === 'workspace-write'
                  ? ('write' as const)
                  : ('protected' as const),
            scope: 'task-worktree' as const,
            enforceability:
              manifest.sandbox.enforcement === 'required'
                ? ('advisory' as const)
                : ('unavailable' as const),
            source: { ...manifestSource, field: 'sandbox.effective.sandboxMode' },
          },
        ]
      : [];
  const artifactAllowed =
    !!evidence?.planArtifact ||
    (evidence?.effectiveAuthority['artifact.plan.write'].length ?? 0) > 0;
  return {
    sandboxMode: manifest?.sandbox.effective.sandboxMode ?? 'unknown',
    targets,
    artifactOutput: {
      allowed: artifactAllowed,
      label: evidence?.planArtifact
        ? path.basename(evidence.planArtifact.exactPath)
        : 'Run artifacts',
      enforceability: artifactAllowed ? enforceability : 'unavailable',
      source: { ...phaseSource, field: 'effectiveAuthority.artifact.plan.write' },
    },
    source,
  };
}

function projectNetwork(
  manifest: TaskAttempt['runLaunchManifest'],
  evidence: PhaseCapabilityEvidence | null,
  providerRuntime: TaskAttempt['providerRuntimeManifest'],
  manifestSource: RunAccessFieldSource
): RunAccessSummary['network'] {
  const enabled = manifest?.sandbox.effective.networkAccessEnabled ?? false;
  const scopes = evidence?.effectiveAuthority['network.egress'] ?? [];
  const policy = !manifest
    ? 'unknown'
    : !enabled
      ? 'disabled'
      : scopes.includes('*')
        ? 'unrestricted'
        : 'allowlist';
  const capabilityId = !enabled
    ? 'network.disable'
    : policy === 'allowlist'
      ? 'network.allowlist'
      : undefined;
  const enforceability = capabilityId
    ? (providerRuntime?.capabilities.find((capability) => capability.id === capabilityId)?.state ??
      'unknown')
    : ('supported' as ProviderRuntimeCapabilityState);
  return {
    enabled,
    policy,
    externalTargets: scopes.filter((scope) => scope !== '*').map(safeTargetLabel),
    approvalRequired: evidence?.approvalRequiredDimensions.includes('network.egress') ?? false,
    enforceability,
    source: { ...manifestSource, field: 'sandbox.effective.networkAccessEnabled' },
  };
}

function projectTools(
  catalog: RunToolCatalog | null,
  manifest: TaskAttempt['runLaunchManifest'],
  catalogSource: RunAccessFieldSource,
  manifestSource: RunAccessFieldSource
): RunAccessTool[] {
  if (catalog) {
    return catalog.entries.flatMap((entry) =>
      entry.tools.map((tool) => ({
        server: safeLabel(entry.serverId),
        name: safeLabel(tool.name),
        qualifiedName: safeLabel(tool.qualifiedName),
        decision: tool.decision,
        availability: entry.status,
        requirement: entry.requirement,
        enforceability: 'enforced' as const,
        ...(tool.externalAction ? { externalAction: tool.externalAction } : {}),
        source: { ...catalogSource, field: `entries.${entry.serverId}.tools.${tool.name}` },
      }))
    );
  }
  return [
    ...(manifest?.tools.allowed ?? []).map((name) => ({
      server: 'provider-native',
      name: safeLabel(name),
      qualifiedName: safeLabel(name),
      decision: 'allow' as const,
      availability: 'missing' as const,
      requirement: 'optional' as const,
      enforceability:
        manifest?.tools.enforcement === 'enforced'
          ? ('enforced' as const)
          : ('unavailable' as const),
      source: { ...manifestSource, field: 'tools.allowed' },
    })),
    ...(manifest?.tools.denied ?? []).map((name) => ({
      server: 'provider-native',
      name: safeLabel(name),
      qualifiedName: safeLabel(name),
      decision: 'deny' as const,
      availability: 'missing' as const,
      requirement: 'optional' as const,
      enforceability:
        manifest?.tools.enforcement === 'enforced'
          ? ('enforced' as const)
          : ('unavailable' as const),
      source: { ...manifestSource, field: 'tools.denied' },
    })),
  ];
}

function projectIntegrations(
  manifest: TaskAttempt['runLaunchManifest'],
  catalog: RunToolCatalog | null,
  definitions: CredentialDefinition[],
  leases: CredentialLease[],
  sources: RunAccessSourceReference[],
  blockers: RunAccessBlocker[],
  manifestSource: RunAccessFieldSource
): RunAccessIntegration[] {
  const references = new Map(
    (manifest?.credentials?.references ?? [])
      .filter((reference) => reference.classification === 'task-integration')
      .map((reference) => [reference.reference, reference])
  );
  for (const binding of catalog?.entries.flatMap((entry) => entry.credentialBindings ?? []) ?? []) {
    if (!references.has(binding.credentialReference)) {
      references.set(binding.credentialReference, {
        reference: binding.credentialReference,
        classification: 'task-integration',
        delivery: 'brokered-boundary',
        boundary: 'tool-control-plane',
        risk: 'brokered',
      });
    }
  }

  return [...references.values()].map((reference) => {
    const definition = definitions.find((candidate) => candidate.id === reference.reference);
    const bindings =
      catalog?.entries
        .flatMap((entry) => entry.credentialBindings ?? [])
        .filter((binding) => binding.credentialReference === reference.reference) ?? [];
    const matchingLeases = leases
      .filter(
        (lease) =>
          lease.taskId === manifest?.taskId &&
          lease.attemptId === manifest.attemptId &&
          lease.definitionId === reference.reference &&
          lease.runLaunchManifestDigest === manifest.digest
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const lease = matchingLeases[0];
    const definitionDigest =
      definition?.digest ?? missingDigest('credential-definition', reference.reference);
    const source = fieldSource('credential-definition', definitionDigest, '$');
    const definitionConflict =
      !!definition &&
      (!verifyCredentialDefinitionDigest(definition) ||
        bindings.some(
          (binding) =>
            binding.credentialDefinitionDigest !== definition.digest ||
            binding.scopeDigest !== calculateCredentialScopeDigest(definition.scope)
        ));
    const boundaryMissing =
      reference.delivery === 'brokered-boundary' &&
      reference.boundary === 'tool-control-plane' &&
      bindings.length === 0;
    sources.push(
      sourceReference(
        'credential-definition',
        definition?.schemaVersion ?? 'credential-definition/v1',
        reference.reference,
        definitionDigest,
        !definition ? 'missing' : definitionConflict ? 'conflict' : 'verified'
      )
    );
    if (!definition) {
      blockers.push(
        blocker(
          'missing-credential-definition',
          `Integration definition ${safeLabel(reference.reference)} is unavailable.`,
          source
        )
      );
    } else if (definitionConflict) {
      blockers.push(
        blocker(
          'credential-definition-conflict',
          `Integration definition ${safeLabel(reference.reference)} conflicts with launch evidence.`,
          source
        )
      );
    }
    if (boundaryMissing) {
      blockers.push(
        blocker(
          'integration-boundary-missing',
          `Integration ${safeLabel(reference.reference)} has no bound tool-control-plane delivery.`,
          { ...manifestSource, field: 'credentials.references' }
        )
      );
    }
    if (lease) {
      const leaseConflict =
        lease.definitionDigest !== definition?.digest ||
        (!!definition && lease.scopeDigest !== calculateCredentialScopeDigest(definition.scope));
      sources.push(
        sourceReference(
          'credential-lease',
          lease.schemaVersion,
          lease.id,
          digestRunLaunchValue(lease),
          leaseConflict ? 'conflict' : 'verified'
        )
      );
      if (leaseConflict) {
        blockers.push(
          blocker(
            'credential-lease-conflict',
            `Integration lease ${safeLabel(lease.id)} conflicts with its definition.`,
            source
          )
        );
      }
    }
    const state =
      reference.delivery === 'blocked' || !definition?.enabled || boundaryMissing
        ? 'unavailable'
        : lease?.state === 'expired'
          ? 'expired'
          : lease?.state === 'revoked'
            ? 'revoked'
            : !lease || lease.state === 'active'
              ? 'brokered'
              : 'unavailable';
    return {
      definition: safeLabel(reference.reference),
      accountLabel: safeLabel(definition?.name ?? reference.reference),
      delivery: reference.delivery,
      state,
      approval: definition?.approval ?? 'required',
      externalTargets: (definition?.scope.destinations ?? []).map(safeTargetLabel),
      expiresAt: lease?.expiresAt ?? null,
      source: definition ? source : { ...manifestSource, field: 'credentials.references' },
    };
  });
}

function statusFor(
  blockers: RunAccessBlocker[],
  manifest: TaskAttempt['runLaunchManifest'],
  evidence: PhaseCapabilityEvidence | null
): RunAccessSummary['status'] {
  if (
    !manifest ||
    !verifyRunLaunchManifestDigest(manifest) ||
    evidence?.status === 'blocked' ||
    blockers.some((entry) => entry.code.includes('conflict') || entry.code.includes('digest'))
  ) {
    return 'blocked';
  }
  return blockers.length > 0 ? 'incomplete' : 'complete';
}

function fieldSource(
  kind: RunAccessFieldSource['kind'],
  digest: string,
  field: string
): RunAccessFieldSource {
  return { kind, digest, field };
}

function sourceReference(
  kind: RunAccessSourceReference['kind'],
  schemaVersion: string,
  recordId: string,
  digest: string,
  state: RunAccessSourceReference['state']
): RunAccessSourceReference {
  return { kind, schemaVersion, recordId: safeLabel(recordId), digest, state };
}

function blocker(code: string, message: string, source?: RunAccessFieldSource): RunAccessBlocker {
  return { code: safeLabel(code), message: safeLabel(message, 300), ...(source ? { source } : {}) };
}

function missingDigest(kind: string, id: string): string {
  return digestRunLaunchValue({ kind, id, state: 'missing' });
}

function filesystemScopeLabel(scope: RunAccessFilesystemTarget['scope']): string {
  switch (scope) {
    case 'workspace':
      return 'Task workspace';
    case 'run-temp':
      return 'Run temporary storage';
    case 'run-cache':
      return 'Run cache';
    case 'protected-metadata':
      return 'Protected metadata';
    case 'platform-runtime':
      return 'Platform runtime';
    case 'home':
      return 'Home directory scope';
    case 'absolute':
      return 'Approved external scope';
    default:
      return 'Task worktree';
  }
}

function safeTargetLabel(value: string): string {
  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed);
    return safeLabel(parsed.hostname || parsed.protocol.replace(':', ''));
  } catch {
    if (path.isAbsolute(trimmed) || /^~[\\/]|^[A-Za-z]:[\\/]|^\\\\/.test(trimmed)) {
      return '[redacted-path]';
    }
    if (/^[A-Za-z0-9.-]+(?::\d+)?(?:[/?#]|$)/.test(trimmed)) {
      try {
        return safeLabel(new URL(`https://${trimmed}`).hostname);
      } catch {
        return '[redacted-target]';
      }
    }
    return safeLabel(trimmed);
  }
}

function safeLabel(value: string, maximum = 120): string {
  const normalized = sanitizeProviderRuntimeDiagnostic(redactString(value))
    .replace(/\p{Cc}/gu, ' ')
    .trim();
  if (!normalized) return 'unavailable';
  if (normalized !== value.trim() || /\[REDACTED/.test(normalized)) return '[redacted]';
  return normalized.slice(0, maximum);
}

function findAttempt(task: Task, attemptId: string): TaskAttempt | undefined {
  if (task.attempt?.id === attemptId) return task.attempt;
  return task.attempts?.find((attempt) => attempt.id === attemptId);
}

async function captureLoad<T>(promise: Promise<T>, fallback: T): Promise<LoadResult<T>> {
  try {
    return { value: await promise };
  } catch (error) {
    return {
      value: fallback,
      error: error instanceof Error ? safeLabel(error.message, 200) : 'unknown load failure',
    };
  }
}

let singleton: RunAccessSummaryService | undefined;

export function getRunAccessSummaryService(): RunAccessSummaryService {
  singleton ??= new RunAccessSummaryService();
  return singleton;
}
