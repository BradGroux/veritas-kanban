import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import type { Event } from 'nostr-tools';
import { verifyEvent } from 'nostr-tools';
import type {
  AgentProfilePackage,
  BuzzDefinitionCollision,
  BuzzDefinitionCoordinate,
  BuzzDefinitionDiff,
  BuzzDefinitionFieldReport,
  BuzzDefinitionImportInput,
  BuzzDefinitionImportResult,
  BuzzDefinitionLink,
  BuzzDefinitionLinkedStatus,
  BuzzDefinitionListResult,
  BuzzDefinitionPreview,
  BuzzDefinitionPreviewInput,
  BuzzDefinitionSourceSnapshot,
  BuzzDefinitionSummary,
  TeamRosterManifest,
  TeamRosterMember,
} from '@veritas-kanban/shared';
import { auditLog, type AuditEvent } from './audit-service.js';
import {
  getAgentProfilePackageService,
  type AgentProfilePackageService,
} from './agent-profile-package-service.js';
import {
  getCommunicationAdapterService,
  type BuzzQueryContext,
  type CommunicationAdapterService,
} from './communication-adapter-service.js';
import {
  BuzzCommunicationService,
  type BuzzEventQueryFilter,
} from './buzz-communication-service.js';
import { getTeamRosterService, type TeamRosterService } from './team-roster-service.js';
import {
  BuzzPersonaContentSchema,
  BuzzTeamContentSchema,
} from '../schemas/buzz-definition-schemas.js';

const PERSONA_KIND = 30_175 as const;
const TEAM_KIND = 30_176 as const;
const MAX_EVENT_BYTES = 256 * 1024;
const MAX_CONTENT_BYTES = 64 * 1024;
const MAX_JSON_DEPTH = 10;
const MAX_OBJECT_KEYS = 200;
const MAX_TAGS = 50;
const HEX_64 = /^[a-f0-9]{64}$/i;
const FORBIDDEN_KEY =
  /(?:^|_)(?:env(?:ironment)?(?:_variables?)?|env_vars?|secrets?|tokens?|passwords?|api_?keys?|private_?keys?|nsec|commands?(?:_args?)?|cwd|working_directory|file_?paths?|paths?|pid|process(?:_state)?|managed_agent|runtime_state|agent_status|mcp(?:_servers?)?|hooks?|skills?(?:_files?)?|engrams?)(?:_|$)/i;
const FORBIDDEN_VALUE = [
  /\bnsec1[023456789acdefghjklmnpqrstuvwxyz]{20,}\b/i,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /(?:api[_-]?key|secret|token|password|private[_-]?key)\s*[:=]\s*\S{8,}/i,
] as const;

const PERSONA_KNOWN_FIELDS = new Set([
  'display_name',
  'system_prompt',
  'avatar_url',
  'runtime',
  'model',
  'provider',
  'name_pool',
  'respond_to',
  'respond_to_allowlist',
  'parallelism',
]);
const TEAM_KNOWN_FIELDS = new Set(['name', 'description', 'persona_ids']);

interface ParsedDefinition {
  event: Event;
  coordinate: BuzzDefinitionCoordinate;
  summary: BuzzDefinitionSummary;
  snapshot: BuzzDefinitionSourceSnapshot;
  fieldReport: BuzzDefinitionFieldReport[];
}

type ProfileMutationResult = {
  status: 'created' | 'linked' | 'refreshed' | 'unchanged';
  profile: AgentProfilePackage;
};

type RosterMutationResult = {
  status: 'created' | 'linked' | 'refreshed' | 'unchanged';
  roster: TeamRosterManifest;
};

interface BuzzDefinitionImportServiceOptions {
  communicationAdapters?: Pick<CommunicationAdapterService, 'getBuzzQueryContext'>;
  buzzCommunication?: Pick<BuzzCommunicationService, 'queryEvents'>;
  profiles?: AgentProfilePackageService;
  rosters?: TeamRosterService;
  audit?: (event: AuditEvent) => Promise<void>;
  now?: () => Date;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function localRevision(value: AgentProfilePackage | TeamRosterManifest): string {
  const clone = structuredClone(value);
  if (clone.metadata?.buzz) clone.metadata.buzz.localRevision = '';
  return sha256(stableJson(clone));
}

function withLocalRevision<T extends AgentProfilePackage | TeamRosterManifest>(value: T): T {
  if (!value.metadata?.buzz) return value;
  value.metadata.buzz.localRevision = localRevision(value);
  return value;
}

function teamImportRevision(
  roster: TeamRosterManifest | null | undefined,
  profiles: Map<string, AgentProfilePackage>
): string {
  return sha256(
    stableJson({
      roster: roster ? localRevision(roster) : null,
      profiles: [...profiles.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([personaId, profile]) => ({
          personaId,
          profileId: profile.id,
          revision: localRevision(profile),
        })),
    })
  );
}

function cleanText(value: string): string {
  return Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
    })
    .join('')
    .trim();
}

function stableSlug(value: string, prefix = 'buzz'): string {
  const cleaned = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return `${prefix}-${cleaned || sha256(value).slice(0, 12)}`.slice(0, 80);
}

function jsonDepth(value: unknown, depth = 0): number {
  if (!value || typeof value !== 'object') return depth;
  if (depth >= MAX_JSON_DEPTH) return depth + 1;
  const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  return children.reduce((max, entry) => Math.max(max, jsonDepth(entry, depth + 1)), depth);
}

function countObjectKeys(value: unknown): number {
  if (!value || typeof value !== 'object') return 0;
  if (Array.isArray(value)) return value.reduce((sum, entry) => sum + countObjectKeys(entry), 0);
  return Object.entries(value as Record<string, unknown>).reduce(
    (sum, [, entry]) => sum + 1 + countObjectKeys(entry),
    0
  );
}

function arraysWithinBounds(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length <= 200 && value.every(arraysWithinBounds);
  }
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).every(arraysWithinBounds);
  }
  return true;
}

function findForbiddenMaterial(
  value: unknown,
  path = '$'
): { path: string; reason: string } | undefined {
  if (typeof value === 'string') {
    if (FORBIDDEN_VALUE.some((pattern) => pattern.test(value))) {
      return { path, reason: 'secret-like value' };
    }
    return undefined;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findForbiddenMaterial(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return undefined;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key) || FORBIDDEN_KEY.test(key)) {
        return { path: `${path}.${key}`, reason: 'forbidden field' };
      }
      const found = findForbiddenMaterial(entry, `${path}.${key}`);
      if (found) return found;
    }
  }
  return undefined;
}

function validatePublicUrl(value: string): string {
  const parsed = new URL(value);
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.hostname === 'localhost' ||
    parsed.hostname.endsWith('.local') ||
    isIP(parsed.hostname)
  ) {
    throw new Error('Buzz avatar URL must be a credential-free public HTTP(S) URL');
  }
  return parsed.toString();
}

function sourceCoordinateKey(coordinate: BuzzDefinitionCoordinate): string {
  return `${coordinate.authorPubkey.toLowerCase()}:${coordinate.kind}:${coordinate.dTag}`;
}

function sameCoordinate(left: BuzzDefinitionCoordinate, right: BuzzDefinitionCoordinate): boolean {
  return sourceCoordinateKey(left) === sourceCoordinateKey(right);
}

function linkCoordinate(link: BuzzDefinitionLink): BuzzDefinitionCoordinate {
  return {
    authorPubkey: link.provenance.authorPubkey,
    kind: link.provenance.kind,
    dTag: link.provenance.dTag,
  };
}

function parseEventShape(value: unknown): Event {
  if (!value || typeof value !== 'object') throw new Error('Buzz definition is not an object');
  const candidate = value as Partial<Event>;
  if (
    typeof candidate.id !== 'string' ||
    !HEX_64.test(candidate.id) ||
    typeof candidate.pubkey !== 'string' ||
    !HEX_64.test(candidate.pubkey) ||
    !Number.isInteger(candidate.created_at) ||
    (candidate.created_at ?? 0) < 1 ||
    ![PERSONA_KIND, TEAM_KIND].includes(candidate.kind as typeof PERSONA_KIND) ||
    typeof candidate.content !== 'string' ||
    typeof candidate.sig !== 'string' ||
    !/^[a-f0-9]{128}$/i.test(candidate.sig) ||
    !Array.isArray(candidate.tags) ||
    candidate.tags.length > MAX_TAGS ||
    !candidate.tags.every(
      (tag) =>
        Array.isArray(tag) &&
        tag.length <= 10 &&
        tag.every((entry) => typeof entry === 'string' && entry.length <= 2_048)
    )
  ) {
    throw new Error('Buzz definition has an invalid Nostr shape');
  }
  const event: Event = {
    id: candidate.id,
    pubkey: candidate.pubkey,
    created_at: Number(candidate.created_at),
    kind: Number(candidate.kind),
    tags: candidate.tags.map((tag) => [...tag]),
    content: candidate.content,
    sig: candidate.sig,
  };
  if (event.created_at > Math.floor(Date.now() / 1000) + 300) {
    throw new Error('Buzz definition timestamp is outside the accepted range');
  }
  if (
    Buffer.byteLength(JSON.stringify(event), 'utf8') > MAX_EVENT_BYTES ||
    Buffer.byteLength(event.content, 'utf8') > MAX_CONTENT_BYTES
  ) {
    throw new Error('Buzz definition exceeds the supported size limit');
  }
  if (!verifyEvent(event)) throw new Error('Buzz definition signature is invalid');
  return event;
}

function buildFieldReport(
  kind: typeof PERSONA_KIND | typeof TEAM_KIND,
  content: Record<string, unknown>
): BuzzDefinitionFieldReport[] {
  const report: BuzzDefinitionFieldReport[] = [];
  const known = kind === PERSONA_KIND ? PERSONA_KNOWN_FIELDS : TEAM_KNOWN_FIELDS;
  const mapped =
    kind === PERSONA_KIND
      ? new Map([
          ['display_name', 'Mapped to profile displayName.'],
          ['system_prompt', 'Mapped to profile instructions.prompt when present.'],
        ])
      : new Map([
          ['name', 'Mapped to roster name.'],
          ['description', 'Mapped to roster description when present.'],
          ['persona_ids', 'Resolved to disabled roster members by same-author persona link.'],
        ]);
  const sourceOnly =
    kind === PERSONA_KIND
      ? new Map([
          ['avatar_url', 'Retained as public source metadata; no asset is fetched.'],
          ['runtime', 'Retained as a declared source preference, not runtime evidence.'],
          ['model', 'Retained as a declared source preference, not active configuration.'],
          ['provider', 'Retained as a declared source preference, not active configuration.'],
          ['name_pool', 'Retained as bounded source metadata; no agents are created from it.'],
          ['respond_to', 'Retained as reserved Buzz behavior; Veritas does not apply it.'],
          [
            'respond_to_allowlist',
            'Retained as reserved Buzz behavior; Veritas does not apply it.',
          ],
          ['parallelism', 'Retained as reserved Buzz behavior; Veritas does not apply it.'],
        ])
      : new Map<string, string>();
  for (const key of Object.keys(content).sort()) {
    const mappedDetail = mapped.get(key);
    const sourceOnlyDetail = sourceOnly.get(key);
    if (mappedDetail) {
      report.push({ field: key, disposition: 'mapped', detail: mappedDetail });
    } else if (sourceOnlyDetail) {
      report.push({ field: key, disposition: 'source-only', detail: sourceOnlyDetail });
    } else if (!known.has(key)) {
      report.push({
        field: key,
        disposition: 'ignored',
        detail: 'Unknown Buzz field ignored for forward compatibility.',
      });
    }
  }
  return report;
}

function parseDefinitionEnvelope(value: unknown, context: BuzzQueryContext): ParsedDefinition {
  const event = parseEventShape(value);
  const dTags = event.tags.filter((tag) => tag[0] === 'd' && tag.length >= 2);
  if (
    dTags.length !== 1 ||
    !dTags[0]?.[1] ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(dTags[0][1])
  ) {
    throw new Error('Buzz definition must contain exactly one bounded d tag');
  }
  const coordinate: BuzzDefinitionCoordinate = {
    authorPubkey: event.pubkey.toLowerCase(),
    kind: event.kind as typeof PERSONA_KIND | typeof TEAM_KIND,
    dTag: cleanText(dTags[0][1]),
  };
  return {
    event,
    coordinate,
    snapshot: {},
    fieldReport: [],
    summary: {
      ...coordinate,
      type: event.kind === PERSONA_KIND ? 'persona' : 'team',
      displayName: `${event.kind === PERSONA_KIND ? 'Persona' : 'Team'} ${coordinate.dTag}`,
      eventId: event.id,
      createdAt: event.created_at,
      contentHash: sha256(event.content),
      community: context.community,
      compatibility: 'rejected',
      detail: 'Definition content validation pending.',
    },
  };
}

function parseDefinition(value: unknown, context: BuzzQueryContext): ParsedDefinition {
  const envelope = parseDefinitionEnvelope(value, context);
  const { event, coordinate } = envelope;
  let content: unknown;
  try {
    content = JSON.parse(event.content);
  } catch {
    throw new Error('Buzz definition content is not valid JSON');
  }
  if (
    !content ||
    typeof content !== 'object' ||
    Array.isArray(content) ||
    jsonDepth(content) > MAX_JSON_DEPTH ||
    countObjectKeys(content) > MAX_OBJECT_KEYS ||
    !arraysWithinBounds(content)
  ) {
    throw new Error('Buzz definition JSON is outside the accepted structural bounds');
  }
  const forbidden = findForbiddenMaterial(content);
  if (forbidden) {
    throw new Error(`Buzz definition rejected ${forbidden.reason} at ${forbidden.path}`);
  }
  const raw = content as Record<string, unknown>;
  let displayName: string;
  let snapshot: BuzzDefinitionSourceSnapshot;
  if (event.kind === PERSONA_KIND) {
    const parsed = BuzzPersonaContentSchema.parse(raw);
    displayName = cleanText(parsed.display_name);
    snapshot = {
      displayName,
      systemPrompt: parsed.system_prompt ? cleanText(parsed.system_prompt) : undefined,
      avatarUrl: parsed.avatar_url ? validatePublicUrl(parsed.avatar_url) : undefined,
      runtime: parsed.runtime ? cleanText(parsed.runtime) : undefined,
      model: parsed.model ? cleanText(parsed.model) : undefined,
      provider: parsed.provider ? cleanText(parsed.provider) : undefined,
      namePool: parsed.name_pool?.map(cleanText),
      respondTo: parsed.respond_to ? cleanText(parsed.respond_to) : undefined,
      respondToAllowlist: parsed.respond_to_allowlist?.map(cleanText) ?? undefined,
      parallelism: parsed.parallelism ?? undefined,
    };
  } else {
    const parsed = BuzzTeamContentSchema.parse(raw);
    displayName = cleanText(parsed.name);
    snapshot = {
      name: displayName,
      description: parsed.description ? cleanText(parsed.description) : undefined,
      personaIds: parsed.persona_ids.map(cleanText),
    };
  }
  const contentHash = sha256(event.content);
  return {
    event,
    coordinate,
    snapshot,
    fieldReport: buildFieldReport(event.kind as typeof PERSONA_KIND | typeof TEAM_KIND, raw),
    summary: {
      ...coordinate,
      type: event.kind === PERSONA_KIND ? 'persona' : 'team',
      displayName,
      eventId: event.id,
      createdAt: event.created_at,
      contentHash,
      community: context.community,
      compatibility: 'compatible',
    },
  };
}

function rejectedDefinition(envelope: ParsedDefinition, error: unknown): ParsedDefinition {
  const detail = cleanText(error instanceof Error ? error.message : 'Definition content rejected')
    .replace(/\s+/g, ' ')
    .slice(0, 300);
  return {
    ...envelope,
    fieldReport: [
      {
        field: '$',
        disposition: 'rejected',
        detail: detail || 'Definition content rejected.',
      },
    ],
    summary: {
      ...envelope.summary,
      compatibility: 'rejected',
      detail: detail || 'Definition content rejected.',
    },
  };
}

function selectHeads(definitions: ParsedDefinition[]): ParsedDefinition[] {
  const heads = new Map<string, ParsedDefinition>();
  for (const definition of definitions) {
    const key = sourceCoordinateKey(definition.coordinate);
    const current = heads.get(key);
    if (
      !current ||
      definition.event.created_at > current.event.created_at ||
      (definition.event.created_at === current.event.created_at &&
        definition.event.id.localeCompare(current.event.id) < 0)
    ) {
      heads.set(key, definition);
    }
  }
  return [...heads.values()].sort(
    (left, right) =>
      left.summary.type.localeCompare(right.summary.type) ||
      left.summary.displayName.localeCompare(right.summary.displayName) ||
      left.summary.authorPubkey.localeCompare(right.summary.authorPubkey)
  );
}

function buildLink(
  definition: ParsedDefinition,
  context: BuzzQueryContext,
  input: {
    adapterId: string;
    fieldReport: BuzzDefinitionFieldReport[];
    sourceOwnedFields: string[];
    importedAt: string;
    refreshedAt?: string;
    materializedIds?: string[];
  }
): BuzzDefinitionLink {
  return {
    provenance: {
      schemaVersion: 'buzz-definition-link/v1',
      adapterId: input.adapterId,
      relay: context.relay,
      community: context.community,
      ...definition.coordinate,
      eventId: definition.event.id,
      createdAt: definition.event.created_at,
      contentHash: definition.summary.contentHash,
      importedAt: input.importedAt,
      refreshedAt: input.refreshedAt,
    },
    sourceSnapshot: definition.snapshot,
    fieldReport: input.fieldReport,
    sourceOwnedFields: input.sourceOwnedFields,
    localRevision: '0'.repeat(64),
    materializedIds: input.materializedIds,
  };
}

function sourceLinkMatches(
  link: BuzzDefinitionLink | undefined,
  coordinate: BuzzDefinitionCoordinate
) {
  return Boolean(link && sameCoordinate(linkCoordinate(link), coordinate));
}

function textSummary(value: string | undefined): string | undefined {
  return value === undefined ? undefined : value ? `present (${value.length} chars)` : 'empty';
}

function diffField(
  field: string,
  beforeSummary: string | undefined,
  afterSummary: string | undefined
): BuzzDefinitionDiff | undefined {
  if (beforeSummary === afterSummary) return undefined;
  return {
    field,
    change: beforeSummary === undefined ? 'add' : afterSummary === undefined ? 'remove' : 'update',
    beforeSummary,
    afterSummary,
  };
}

export class BuzzDefinitionImportService {
  private readonly communicationAdapters: Pick<CommunicationAdapterService, 'getBuzzQueryContext'>;
  private readonly buzzCommunication: Pick<BuzzCommunicationService, 'queryEvents'>;
  private readonly profiles: AgentProfilePackageService;
  private readonly rosters: TeamRosterService;
  private readonly audit: (event: AuditEvent) => Promise<void>;
  private readonly now: () => Date;

  constructor(options: BuzzDefinitionImportServiceOptions = {}) {
    this.communicationAdapters = options.communicationAdapters ?? getCommunicationAdapterService();
    this.buzzCommunication = options.buzzCommunication ?? new BuzzCommunicationService();
    this.profiles = options.profiles ?? getAgentProfilePackageService();
    this.rosters = options.rosters ?? getTeamRosterService();
    this.audit = options.audit ?? auditLog;
    this.now = options.now ?? (() => new Date());
  }

  async listDefinitions(adapterId: string): Promise<BuzzDefinitionListResult> {
    const { context, definitions, rejectedCount } = await this.loadDefinitions(adapterId);
    return {
      adapterId,
      relay: context.relay,
      community: context.community,
      definitions: definitions.map((definition) => definition.summary),
      rejectedCount,
    };
  }

  async preview(
    adapterId: string,
    input: BuzzDefinitionPreviewInput
  ): Promise<BuzzDefinitionPreview> {
    const loaded = await this.loadDefinitions(adapterId);
    const definition = this.requireDefinition(loaded.definitions, input.coordinate);
    if (definition.summary.compatibility === 'rejected') {
      return {
        definition: definition.summary,
        action: input.action,
        targetId: input.targetId,
        changed: false,
        diff: [],
        fieldReport: definition.fieldReport,
        collisions: [
          {
            field: 'source',
            value: definition.coordinate.dTag,
            detail: 'The current Buzz definition head failed content validation.',
          },
        ],
        unresolvedPersonaIds: [],
      };
    }
    return definition.coordinate.kind === PERSONA_KIND
      ? this.previewPersona(adapterId, loaded.context, definition, input)
      : this.previewTeam(adapterId, loaded.context, definition, input);
  }

  async importDefinition(
    adapterId: string,
    input: BuzzDefinitionImportInput,
    actor = 'system'
  ): Promise<BuzzDefinitionImportResult> {
    const loaded = await this.loadDefinitions(adapterId);
    const definition = this.requireDefinition(loaded.definitions, input.coordinate);
    if (definition.event.id !== input.expectedEventId) {
      throw new Error('Buzz source changed after preview; preview the current definition again');
    }
    if (input.action === 'skip') {
      const result: BuzzDefinitionImportResult = {
        status: 'skipped',
        definition: definition.summary,
      };
      await this.audit({
        action: 'buzz_definition.skipped',
        actor,
        resource: definition.coordinate.dTag,
        details: {
          adapterId,
          action: input.action,
          kind: definition.coordinate.kind,
          authorPubkey: definition.coordinate.authorPubkey,
          dTag: definition.coordinate.dTag,
          eventId: definition.event.id,
          status: result.status,
        },
      });
      return result;
    }
    if (definition.summary.compatibility === 'rejected') {
      throw new Error('Buzz definition content failed validation');
    }
    const preview =
      definition.coordinate.kind === PERSONA_KIND
        ? await this.previewPersona(adapterId, loaded.context, definition, input)
        : await this.previewTeam(adapterId, loaded.context, definition, input);
    if (preview.collisions.length || preview.unresolvedPersonaIds.length) {
      throw new Error('Buzz definition has unresolved import conflicts');
    }
    if (preview.expectedLocalRevision !== input.expectedLocalRevision) {
      throw new Error('Local target changed after preview; preview the import again');
    }

    const result =
      definition.coordinate.kind === PERSONA_KIND
        ? await this.importPersona(adapterId, loaded.context, definition, input)
        : await this.importTeam(adapterId, loaded.context, definition, input);
    await this.audit({
      action: `buzz_definition.${result.status}`,
      actor,
      resource: result.profile?.id ?? result.roster?.id ?? definition.coordinate.dTag,
      details: {
        adapterId,
        action: input.action,
        kind: definition.coordinate.kind,
        authorPubkey: definition.coordinate.authorPubkey,
        dTag: definition.coordinate.dTag,
        eventId: definition.event.id,
        status: result.status,
      },
    });
    return result;
  }

  async linkedStatus(adapterId: string): Promise<BuzzDefinitionLinkedStatus[]> {
    const configProfiles = await this.profiles.listProfilePackages();
    const roster = await this.rosters.getRoster();
    const linked = [
      ...configProfiles.flatMap((profile) => {
        const link = profile.metadata?.buzz;
        return link?.provenance.adapterId === adapterId
          ? [{ targetType: 'profile' as const, targetId: profile.id, link }]
          : [];
      }),
      ...(roster?.metadata?.buzz?.provenance.adapterId === adapterId
        ? [{ targetType: 'roster' as const, targetId: roster.id, link: roster.metadata.buzz }]
        : []),
    ];
    if (!linked.length) return [];
    try {
      const loaded = await this.loadDefinitions(adapterId);
      return linked.map(({ targetType, targetId, link }) => {
        const current = loaded.definitions.find((definition) =>
          sameCoordinate(definition.coordinate, linkCoordinate(link))
        );
        return {
          targetType,
          targetId,
          coordinate: linkCoordinate(link),
          status: !current
            ? ('missing' as const)
            : current.summary.compatibility === 'rejected'
              ? ('changed' as const)
              : current.event.id === link.provenance.eventId
                ? ('current' as const)
                : ('changed' as const),
          linkedEventId: link.provenance.eventId,
          currentEventId: current?.event.id,
          detail:
            current?.summary.compatibility === 'rejected'
              ? 'The current Buzz definition head failed content validation.'
              : undefined,
        };
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message.slice(0, 500) : 'Buzz unavailable';
      return linked.map(({ targetType, targetId, link }) => ({
        targetType,
        targetId,
        coordinate: linkCoordinate(link),
        status: 'unavailable',
        linkedEventId: link.provenance.eventId,
        detail,
      }));
    }
  }

  private async loadDefinitions(adapterId: string): Promise<{
    context: BuzzQueryContext;
    definitions: ParsedDefinition[];
    rejectedCount: number;
  }> {
    const context = await this.communicationAdapters.getBuzzQueryContext(adapterId);
    const filters: BuzzEventQueryFilter[] = [{ kinds: [PERSONA_KIND, TEAM_KIND], limit: 200 }];
    const events = await this.buzzCommunication.queryEvents(context.probeConfig, filters);
    const envelopes: ParsedDefinition[] = [];
    let rejectedCount = 0;
    for (const event of events) {
      try {
        envelopes.push(parseDefinitionEnvelope(event, context));
      } catch {
        rejectedCount += 1;
      }
    }
    const definitions = selectHeads(envelopes).map((envelope) => {
      try {
        return parseDefinition(envelope.event, context);
      } catch (error) {
        rejectedCount += 1;
        return rejectedDefinition(envelope, error);
      }
    });
    return { context, definitions, rejectedCount };
  }

  private requireDefinition(
    definitions: ParsedDefinition[],
    coordinate: BuzzDefinitionCoordinate
  ): ParsedDefinition {
    const definition = definitions.find((candidate) =>
      sameCoordinate(candidate.coordinate, coordinate)
    );
    if (!definition) throw new Error('Buzz definition was not found in the current relay heads');
    return definition;
  }

  private async previewPersona(
    adapterId: string,
    context: BuzzQueryContext,
    definition: ParsedDefinition,
    input: BuzzDefinitionPreviewInput
  ): Promise<BuzzDefinitionPreview> {
    const [profiles, configuredAgents] = await Promise.all([
      this.profiles.listProfilePackages(),
      this.profiles.listConfiguredAgents(),
    ]);
    const linked = profiles.filter((profile) =>
      sourceLinkMatches(profile.metadata?.buzz, definition.coordinate)
    );
    const targetId =
      input.targetId ??
      (input.action === 'refresh' ? linked[0]?.id : undefined) ??
      stableSlug(definition.coordinate.dTag);
    const target = profiles.find((profile) => profile.id === targetId);
    const collisions: BuzzDefinitionCollision[] = [];
    if (input.action === 'create') {
      const deterministicId = stableSlug(definition.coordinate.dTag);
      if (input.targetId && input.targetId !== deterministicId) {
        collisions.push({
          field: 'id',
          value: input.targetId,
          detail: `Create uses the deterministic profile ID ${deterministicId}; use link for an existing target.`,
        });
      }
      if (target) {
        collisions.push({
          field: 'id',
          value: targetId,
          detail: 'A profile already uses the proposed deterministic ID.',
        });
      }
      const nameMatch = profiles.find(
        (profile) =>
          profile.displayName.toLowerCase() === definition.summary.displayName.toLowerCase()
      );
      if (nameMatch) {
        collisions.push({
          field: 'name',
          value: nameMatch.displayName,
          detail: `Profile ${nameMatch.id} already uses this display name.`,
        });
      }
      const agentTypeMatch = configuredAgents.find((agent) => agent.type === targetId);
      if (agentTypeMatch) {
        collisions.push({
          field: 'id',
          value: targetId,
          detail: `Configured agent ${agentTypeMatch.name} already uses this runtime ID.`,
        });
      }
      const agentNameMatch = configuredAgents.find(
        (agent) => agent.name.toLowerCase() === definition.summary.displayName.toLowerCase()
      );
      if (agentNameMatch) {
        collisions.push({
          field: 'name',
          value: agentNameMatch.name,
          detail: `Configured agent ${agentNameMatch.type} already uses this display name.`,
        });
      }
      if (linked.length) {
        collisions.push({
          field: 'source',
          value: definition.coordinate.dTag,
          detail: `Buzz source is already linked to ${linked.map((item) => item.id).join(', ')}.`,
        });
      }
    } else if (input.action === 'link') {
      if (!target) {
        collisions.push({
          field: 'id',
          value: targetId,
          detail: 'Link requires an existing profile target.',
        });
      } else if (
        target.metadata?.buzz &&
        !sourceLinkMatches(target.metadata.buzz, definition.coordinate)
      ) {
        collisions.push({
          field: 'source',
          value: targetId,
          detail: 'Target profile is linked to a different Buzz source.',
        });
      }
      const otherLinks = linked.filter((profile) => profile.id !== targetId);
      if (otherLinks.length) {
        collisions.push({
          field: 'source',
          value: definition.coordinate.dTag,
          detail: `Buzz source is already linked to ${otherLinks.map((profile) => profile.id).join(', ')}.`,
        });
      }
    } else if (input.action === 'refresh') {
      if (!target || !sourceLinkMatches(target.metadata?.buzz, definition.coordinate)) {
        collisions.push({
          field: 'source',
          value: targetId,
          detail: 'Refresh requires the profile already linked to this Buzz source.',
        });
      }
      if (linked.length > 1) {
        collisions.push({
          field: 'source',
          value: definition.coordinate.dTag,
          detail: 'Buzz source has multiple profile links; resolve them before refresh.',
        });
      }
      const nameMatch = profiles.find(
        (profile) =>
          profile.id !== targetId &&
          profile.displayName.toLowerCase() === definition.summary.displayName.toLowerCase()
      );
      if (nameMatch) {
        collisions.push({
          field: 'name',
          value: definition.summary.displayName,
          detail: `Profile ${nameMatch.id} already uses the refreshed display name.`,
        });
      }
    }
    const proposed = this.materializePersona(
      adapterId,
      context,
      definition,
      input.action,
      target,
      targetId
    );
    const unchanged =
      target?.metadata?.buzz?.provenance.eventId === definition.event.id &&
      target.metadata.buzz.provenance.contentHash === definition.summary.contentHash;
    const diff = [
      diffField('displayName', target?.displayName, proposed?.displayName),
      diffField(
        'instructions.prompt',
        textSummary(target?.instructions?.prompt),
        textSummary(proposed?.instructions?.prompt)
      ),
      diffField(
        'source link',
        target?.metadata?.buzz ? target.metadata.buzz.provenance.eventId.slice(0, 12) : undefined,
        proposed?.metadata?.buzz
          ? proposed.metadata.buzz.provenance.eventId.slice(0, 12)
          : undefined
      ),
    ].filter((entry): entry is BuzzDefinitionDiff => Boolean(entry));
    return {
      definition: definition.summary,
      action: input.action,
      targetId,
      expectedLocalRevision: target ? localRevision(target) : undefined,
      changed: !unchanged,
      diff,
      fieldReport: definition.fieldReport,
      collisions,
      unresolvedPersonaIds: [],
      proposedProfile: proposed,
    };
  }

  private materializePersona(
    adapterId: string,
    context: BuzzQueryContext,
    definition: ParsedDefinition,
    action: BuzzDefinitionPreviewInput['action'],
    existing?: AgentProfilePackage,
    targetId = stableSlug(definition.coordinate.dTag)
  ): AgentProfilePackage | undefined {
    if (action === 'skip') return undefined;
    const displayName = definition.snapshot.displayName;
    if (!displayName) throw new Error('Buzz persona display name is unavailable');
    const now = this.now().toISOString();
    const importedAt = existing?.metadata?.buzz?.provenance.importedAt ?? now;
    const link = buildLink(definition, context, {
      adapterId,
      fieldReport: definition.fieldReport,
      sourceOwnedFields: action === 'link' ? [] : ['displayName', 'instructions.prompt'],
      importedAt,
      refreshedAt: action === 'refresh' ? now : undefined,
    });
    if (action === 'link' && existing) {
      return withLocalRevision({
        ...existing,
        metadata: {
          ...existing.metadata,
          source: existing.metadata?.source ?? `buzz:${sourceCoordinateKey(definition.coordinate)}`,
          importedAt: existing.metadata?.importedAt ?? now,
          updatedAt: now,
          buzz: link,
        },
      });
    }
    if (action === 'refresh' && existing) {
      const instructions = definition.snapshot.systemPrompt
        ? { ...existing.instructions, prompt: definition.snapshot.systemPrompt }
        : existing.instructions
          ? { ...existing.instructions, prompt: undefined }
          : undefined;
      return withLocalRevision({
        ...existing,
        displayName,
        instructions,
        metadata: { ...existing.metadata, updatedAt: now, buzz: link },
      });
    }
    const profile: AgentProfilePackage = {
      id: targetId,
      schemaVersion: 'agent-profile-package/v1',
      version: '1.0.0',
      displayName,
      role: 'Buzz persona',
      description:
        'Imported public Buzz persona definition. Configure a compatible runtime before enabling.',
      enabled: false,
      capabilities: [],
      defaultTaskTypes: [],
      runtime: { agent: stableSlug(definition.coordinate.dTag) },
      instructions: definition.snapshot.systemPrompt
        ? { prompt: definition.snapshot.systemPrompt }
        : undefined,
      metadata: {
        source: `buzz:${sourceCoordinateKey(definition.coordinate)}`,
        importedAt: now,
        updatedAt: now,
        buzz: link,
      },
    };
    return withLocalRevision(profile);
  }

  private async previewTeam(
    adapterId: string,
    context: BuzzQueryContext,
    definition: ParsedDefinition,
    input: BuzzDefinitionPreviewInput
  ): Promise<BuzzDefinitionPreview> {
    const profiles = await this.profiles.listProfilePackages();
    const existing = await this.rosters.getRoster();
    const targetId =
      input.targetId ?? existing?.id ?? stableSlug(definition.coordinate.dTag, 'buzz-team');
    const matchingProfiles = new Map<string, AgentProfilePackage>();
    for (const personaId of definition.snapshot.personaIds ?? []) {
      const profile = profiles.find(
        (candidate) =>
          candidate.metadata?.buzz?.provenance.kind === PERSONA_KIND &&
          candidate.metadata.buzz.provenance.authorPubkey.toLowerCase() ===
            definition.coordinate.authorPubkey.toLowerCase() &&
          candidate.metadata.buzz.provenance.dTag === personaId
      );
      if (profile) matchingProfiles.set(personaId, profile);
    }
    const unresolvedPersonaIds = (definition.snapshot.personaIds ?? []).filter(
      (personaId) => !matchingProfiles.has(personaId)
    );
    const collisions: BuzzDefinitionCollision[] = [];
    if (input.action === 'create') {
      const deterministicId = stableSlug(definition.coordinate.dTag, 'buzz-team');
      if (input.targetId && input.targetId !== deterministicId) {
        collisions.push({
          field: 'id',
          value: input.targetId,
          detail: `Create uses the deterministic roster ID ${deterministicId}; use link for an existing target.`,
        });
      }
      if (existing) {
        collisions.push({
          field: 'id',
          value: existing.id,
          detail: 'A team roster already exists; use link or refresh.',
        });
      }
    } else if (input.action === 'link') {
      if (!existing || existing.id !== targetId) {
        collisions.push({
          field: 'id',
          value: targetId,
          detail: 'Link requires the existing team roster target.',
        });
      } else if (
        existing.metadata?.buzz &&
        !sourceLinkMatches(existing.metadata.buzz, definition.coordinate)
      ) {
        collisions.push({
          field: 'source',
          value: existing.id,
          detail: 'Roster is linked to a different Buzz source.',
        });
      }
    } else if (
      input.action === 'refresh' &&
      (!existing ||
        existing.id !== targetId ||
        !sourceLinkMatches(existing.metadata?.buzz, definition.coordinate))
    ) {
      collisions.push({
        field: 'source',
        value: targetId,
        detail: 'Refresh requires the roster already linked to this Buzz source.',
      });
    }
    for (const profile of matchingProfiles.values()) {
      const source = profile.metadata?.buzz;
      if (!source) continue;
      const memberId = stableSlug(source.provenance.dTag);
      const conflicting = existing?.members.find(
        (member) => member.id === memberId && member.profileId !== profile.id
      );
      if (conflicting) {
        collisions.push({
          field: 'persona',
          value: memberId,
          detail: `Roster member ${memberId} points to a different profile.`,
        });
      }
    }
    const proposed = this.materializeTeam(
      adapterId,
      context,
      definition,
      input.action,
      existing ?? undefined,
      matchingProfiles,
      targetId
    );
    const unchanged =
      existing?.metadata?.buzz?.provenance.eventId === definition.event.id &&
      existing.metadata.buzz.provenance.contentHash === definition.summary.contentHash;
    const diff = [
      diffField('name', existing?.name, proposed?.name),
      diffField(
        'description',
        textSummary(existing?.description),
        textSummary(proposed?.description)
      ),
      diffField(
        'members',
        existing?.members
          .map((member) => member.profileId ?? member.id)
          .sort()
          .join(', '),
        proposed?.members
          .map((member) => member.profileId ?? member.id)
          .sort()
          .join(', ')
      ),
      diffField(
        'source link',
        existing?.metadata?.buzz
          ? existing.metadata.buzz.provenance.eventId.slice(0, 12)
          : undefined,
        proposed?.metadata?.buzz
          ? proposed.metadata.buzz.provenance.eventId.slice(0, 12)
          : undefined
      ),
    ].filter((entry): entry is BuzzDefinitionDiff => Boolean(entry));
    return {
      definition: definition.summary,
      action: input.action,
      targetId,
      expectedLocalRevision: teamImportRevision(existing, matchingProfiles),
      changed: !unchanged,
      diff,
      fieldReport: definition.fieldReport,
      collisions,
      unresolvedPersonaIds,
      proposedRoster: proposed,
    };
  }

  private materializeTeam(
    adapterId: string,
    context: BuzzQueryContext,
    definition: ParsedDefinition,
    action: BuzzDefinitionPreviewInput['action'],
    existing: TeamRosterManifest | undefined,
    matchingProfiles: Map<string, AgentProfilePackage>,
    targetId = stableSlug(definition.coordinate.dTag, 'buzz-team')
  ): TeamRosterManifest | undefined {
    if (action === 'skip') return undefined;
    const name = definition.snapshot.name;
    if (!name) throw new Error('Buzz team name is unavailable');
    const now = this.now().toISOString();
    const importedMembers: TeamRosterMember[] = [...matchingProfiles.entries()].map(
      ([personaId, profile]) => ({
        id: stableSlug(personaId),
        displayName: profile.displayName,
        role: profile.role,
        agent: profile.runtime.agent,
        profileId: profile.id,
        status: 'disabled',
        capabilities: profile.capabilities,
        defaultTaskTypes: profile.defaultTaskTypes,
      })
    );
    const importedIds = importedMembers.map((member) => member.id);
    const link = buildLink(definition, context, {
      adapterId,
      fieldReport: definition.fieldReport,
      sourceOwnedFields: action === 'link' ? [] : ['name', 'description', 'members'],
      importedAt: existing?.metadata?.buzz?.provenance.importedAt ?? now,
      refreshedAt: action === 'refresh' ? now : undefined,
      materializedIds: importedIds,
    });
    if (action === 'link' && existing) {
      return withLocalRevision({
        ...existing,
        metadata: {
          ...existing.metadata,
          source: existing.metadata?.source ?? `buzz:${sourceCoordinateKey(definition.coordinate)}`,
          importedAt: existing.metadata?.importedAt ?? now,
          updatedAt: now,
          buzz: link,
        },
      });
    }
    const currentImported = new Set(importedIds);
    const localMembers = (existing?.members ?? []).filter(
      (member) => !currentImported.has(member.id)
    );
    const roster: TeamRosterManifest = {
      id: existing?.id ?? targetId,
      schemaVersion: 'team-roster/v1',
      workspaceId: existing?.workspaceId ?? 'local',
      name,
      description: definition.snapshot.description,
      enabled: existing?.enabled ?? false,
      coordinatorMemberId: existing?.coordinatorMemberId,
      members: [...localMembers, ...importedMembers],
      routingRules: existing?.routingRules ?? [],
      metadata: {
        ...existing?.metadata,
        source: existing?.metadata?.source ?? `buzz:${sourceCoordinateKey(definition.coordinate)}`,
        importedAt: existing?.metadata?.importedAt ?? now,
        updatedAt: now,
        buzz: link,
      },
    };
    return withLocalRevision(roster);
  }

  private async importPersona(
    adapterId: string,
    context: BuzzQueryContext,
    definition: ParsedDefinition,
    input: BuzzDefinitionImportInput
  ): Promise<BuzzDefinitionImportResult> {
    const result = await this.profiles.mutateProfiles<ProfileMutationResult>(
      (profiles, configuredAgents) => {
        const linked = profiles.filter((profile) =>
          sourceLinkMatches(profile.metadata?.buzz, definition.coordinate)
        );
        const targetId =
          input.targetId ??
          (input.action === 'refresh' ? linked[0]?.id : undefined) ??
          stableSlug(definition.coordinate.dTag);
        const index = profiles.findIndex((profile) => profile.id === targetId);
        const existing = index >= 0 ? profiles[index] : undefined;
        if ((existing ? localRevision(existing) : undefined) !== input.expectedLocalRevision) {
          throw new Error('Local profile changed after preview; preview the import again');
        }
        if (
          existing?.metadata?.buzz?.provenance.eventId === definition.event.id &&
          existing.metadata.buzz.provenance.contentHash === definition.summary.contentHash &&
          sourceLinkMatches(existing.metadata.buzz, definition.coordinate)
        ) {
          return {
            profiles,
            result: { status: 'unchanged' as const, profile: existing },
          };
        }
        if (input.action === 'create' && (existing || linked.length)) {
          throw new Error('Profile collision changed after preview');
        }
        const duplicateName = profiles.some(
          (profile) =>
            profile.id !== targetId &&
            profile.displayName.toLowerCase() === definition.summary.displayName.toLowerCase()
        );
        if (input.action === 'create' && duplicateName) {
          throw new Error('Profile name collision changed after preview');
        }
        if (
          input.action === 'create' &&
          configuredAgents.some(
            (agent) =>
              agent.type === targetId ||
              agent.name.toLowerCase() === definition.summary.displayName.toLowerCase()
          )
        ) {
          throw new Error('Configured agent collision changed after preview');
        }
        if (
          input.action === 'link' &&
          (!existing ||
            (existing.metadata?.buzz &&
              !sourceLinkMatches(existing.metadata.buzz, definition.coordinate)))
        ) {
          throw new Error('Profile link target changed after preview');
        }
        if (input.action === 'link' && linked.some((profile) => profile.id !== targetId)) {
          throw new Error('Profile source collision changed after preview');
        }
        if (
          input.action === 'refresh' &&
          (!existing || !sourceLinkMatches(existing.metadata?.buzz, definition.coordinate))
        ) {
          throw new Error('Profile refresh target changed after preview');
        }
        if (input.action === 'refresh' && (linked.length > 1 || duplicateName)) {
          throw new Error('Profile refresh collision changed after preview');
        }
        const profile = this.materializePersona(
          adapterId,
          context,
          definition,
          input.action,
          existing,
          targetId
        );
        if (!profile) throw new Error('Buzz persona materialization was skipped unexpectedly');
        const next =
          index >= 0
            ? profiles.map((candidate, candidateIndex) =>
                candidateIndex === index ? profile : candidate
              )
            : [...profiles, profile];
        return {
          profiles: next,
          result: {
            status:
              input.action === 'create'
                ? ('created' as const)
                : input.action === 'link'
                  ? ('linked' as const)
                  : ('refreshed' as const),
            profile,
          },
        };
      }
    );
    return { ...result, definition: definition.summary };
  }

  private async importTeam(
    adapterId: string,
    context: BuzzQueryContext,
    definition: ParsedDefinition,
    input: BuzzDefinitionImportInput
  ): Promise<BuzzDefinitionImportResult> {
    const result = await this.rosters.mutateRoster<RosterMutationResult>((existing, profiles) => {
      const matchingProfiles = new Map<string, AgentProfilePackage>();
      for (const personaId of definition.snapshot.personaIds ?? []) {
        const profile = profiles.find(
          (candidate) =>
            candidate.metadata?.buzz?.provenance.kind === PERSONA_KIND &&
            candidate.metadata.buzz.provenance.authorPubkey.toLowerCase() ===
              definition.coordinate.authorPubkey.toLowerCase() &&
            candidate.metadata.buzz.provenance.dTag === personaId
        );
        if (!profile) throw new Error(`Buzz team persona is unresolved: ${personaId}`);
        matchingProfiles.set(personaId, profile);
      }
      if (teamImportRevision(existing, matchingProfiles) !== input.expectedLocalRevision) {
        throw new Error('Local roster changed after preview; preview the import again');
      }
      if (
        existing?.metadata?.buzz?.provenance.eventId === definition.event.id &&
        existing.metadata.buzz.provenance.contentHash === definition.summary.contentHash &&
        sourceLinkMatches(existing.metadata.buzz, definition.coordinate)
      ) {
        return { roster: existing, result: { status: 'unchanged' as const, roster: existing } };
      }
      if (input.action === 'create' && existing) {
        throw new Error('Roster collision changed after preview');
      }
      if (
        input.action === 'link' &&
        (!existing ||
          (existing.metadata?.buzz &&
            !sourceLinkMatches(existing.metadata.buzz, definition.coordinate)))
      ) {
        throw new Error('Roster link target changed after preview');
      }
      if (
        input.action === 'refresh' &&
        (!existing || !sourceLinkMatches(existing.metadata?.buzz, definition.coordinate))
      ) {
        throw new Error('Roster refresh target changed after preview');
      }
      const roster = this.materializeTeam(
        adapterId,
        context,
        definition,
        input.action,
        existing ?? undefined,
        matchingProfiles,
        input.targetId ?? existing?.id ?? stableSlug(definition.coordinate.dTag, 'buzz-team')
      );
      if (!roster) throw new Error('Buzz team materialization was skipped unexpectedly');
      return {
        roster,
        result: {
          status:
            input.action === 'create'
              ? ('created' as const)
              : input.action === 'link'
                ? ('linked' as const)
                : ('refreshed' as const),
          roster,
        },
      };
    });
    return { ...result, definition: definition.summary };
  }
}

let buzzDefinitionImportService: BuzzDefinitionImportService | null = null;

export function getBuzzDefinitionImportService(): BuzzDefinitionImportService {
  if (!buzzDefinitionImportService) {
    buzzDefinitionImportService = new BuzzDefinitionImportService();
  }
  return buzzDefinitionImportService;
}

export function resetBuzzDefinitionImportServiceForTests(): void {
  buzzDefinitionImportService = null;
}
