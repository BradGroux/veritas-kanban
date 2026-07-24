import { createHash } from 'node:crypto';
import type { ExecutableAgentProvider, RunEventKind } from '@veritas-kanban/shared';

export interface ProviderMappedRunEvent {
  kind: RunEventKind;
  payload: Record<string, unknown>;
  providerEventId?: string;
  providerTimestamp?: string;
  turnId?: string;
  itemId?: string;
  parentEventId?: string;
  causalEventId?: string;
  dedupeKey?: string;
}

export interface ProviderRunEventMapper {
  mapStream(stream: 'stdout' | 'stderr', content: string): ProviderMappedRunEvent;
  mapEvent(
    providerType: string,
    event: Record<string, unknown>,
    summary?: string
  ): ProviderMappedRunEvent;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function boundedIdentifier(value: unknown): string | undefined {
  const identifier = optionalString(value);
  if (!identifier || identifier.length <= 160) return identifier;
  return `sha256_${createHash('sha256').update(identifier).digest('hex')}`;
}

function providerDedupeKey(
  provider: ExecutableAgentProvider,
  providerType: string,
  providerEventId: string | undefined
): string | undefined {
  if (!providerEventId) return undefined;
  const candidate = `${provider}:${providerType}:${providerEventId}`;
  return candidate.length <= 240
    ? candidate
    : `${provider}:sha256:${createHash('sha256').update(candidate).digest('hex')}`;
}

function nestedRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function eventIdentity(event: Record<string, unknown>): {
  providerEventId?: string;
  turnId?: string;
  itemId?: string;
  providerTimestamp?: string;
} {
  const item = nestedRecord(event.item);
  const providerEventId =
    boundedIdentifier(event.event_id) ??
    boundedIdentifier(event.eventId) ??
    boundedIdentifier(event.id) ??
    boundedIdentifier(item?.id);
  const turnId =
    boundedIdentifier(event.turn_id) ??
    boundedIdentifier(event.turnId) ??
    boundedIdentifier(nestedRecord(event.turn)?.id);
  const itemId =
    boundedIdentifier(event.item_id) ??
    boundedIdentifier(event.itemId) ??
    boundedIdentifier(item?.id);
  const timestamp =
    optionalString(event.timestamp) ??
    optionalString(event.created_at) ??
    optionalString(event.createdAt);
  const providerTimestamp =
    timestamp && !Number.isNaN(Date.parse(timestamp))
      ? new Date(timestamp).toISOString()
      : undefined;
  return { providerEventId, turnId, itemId, providerTimestamp };
}

function itemKind(type: string, event: Record<string, unknown>): RunEventKind {
  const normalized = type.toLowerCase();
  const item = nestedRecord(event.item);
  const itemType = optionalString(item?.type)?.toLowerCase() ?? '';
  const completed = /(?:completed|finished|done)$/.test(normalized);
  const started = /(?:started|begin)$/.test(normalized);

  if (normalized.includes('approval')) {
    return completed || normalized.includes('resolved')
      ? 'approval.resolved'
      : 'approval.requested';
  }
  if (normalized.includes('token') || normalized.includes('usage') || itemType.includes('usage')) {
    return 'usage.updated';
  }
  if (normalized.includes('failed') || normalized === 'error' || itemType.includes('error')) {
    return 'run.error';
  }
  if (itemType.includes('agent_message') || itemType === 'message') {
    return normalized.includes('delta') || normalized.includes('updated')
      ? 'message.delta'
      : 'message.assistant';
  }
  if (normalized.includes('message')) {
    return normalized.includes('delta') || normalized.includes('updated')
      ? 'message.delta'
      : 'message.assistant';
  }
  if (itemType.includes('reasoning') || normalized.includes('reasoning')) {
    return 'reasoning.delta';
  }
  if (itemType.includes('command') || normalized.includes('command')) {
    return completed ? 'command.completed' : 'command.started';
  }
  if (
    itemType.includes('file_change') ||
    itemType.includes('filechange') ||
    normalized.includes('file.change')
  ) {
    return 'file.changed';
  }
  if (
    itemType.includes('tool') ||
    itemType.includes('mcp') ||
    itemType.includes('web_search') ||
    normalized.includes('tool')
  ) {
    return completed ? 'tool.completed' : 'tool.started';
  }
  if (itemType.includes('artifact') || normalized.includes('artifact')) {
    return 'artifact.created';
  }
  if (
    normalized.includes('progress') ||
    normalized.includes('turn.started') ||
    normalized.includes('turn.completed') ||
    started ||
    completed
  ) {
    return 'progress';
  }
  return 'provider.unknown';
}

function codexMapper(provider: 'codex-cli' | 'codex-sdk'): ProviderRunEventMapper {
  return {
    mapStream(stream, content) {
      return {
        kind: stream === 'stdout' ? 'stream.stdout' : 'stream.stderr',
        payload: { stream, content },
      };
    },
    mapEvent(providerType, event, summary) {
      const identity = eventIdentity(event);
      return {
        ...identity,
        kind: itemKind(providerType, event),
        dedupeKey: providerDedupeKey(provider, providerType, identity.providerEventId),
        payload: {
          providerType,
          summary,
          raw: event,
        },
      };
    },
  };
}

const HERMES_MAPPER: ProviderRunEventMapper = {
  mapStream(stream, content) {
    return {
      kind: stream === 'stdout' ? 'message.delta' : 'stream.stderr',
      payload: { stream, content },
    };
  },
  mapEvent(providerType, event, summary) {
    const identity = eventIdentity(event);
    return {
      ...identity,
      kind: itemKind(providerType, event),
      dedupeKey: providerDedupeKey('hermes-cli', providerType, identity.providerEventId),
      payload: { providerType, summary, raw: event },
    };
  },
};

const OPENCLAW_MAPPER: ProviderRunEventMapper = {
  mapStream(stream, content) {
    return {
      kind: stream === 'stdout' ? 'message.delta' : 'stream.stderr',
      payload: { stream, content },
    };
  },
  mapEvent(providerType, event, summary) {
    const identity = eventIdentity(event);
    return {
      ...identity,
      kind: itemKind(providerType, event),
      dedupeKey: providerDedupeKey('openclaw', providerType, identity.providerEventId),
      payload: { providerType, summary, raw: event },
    };
  },
};

const MAPPERS: Record<ExecutableAgentProvider, ProviderRunEventMapper> = {
  openclaw: OPENCLAW_MAPPER,
  'codex-cli': codexMapper('codex-cli'),
  'codex-sdk': codexMapper('codex-sdk'),
  'hermes-cli': HERMES_MAPPER,
};

export function getProviderRunEventMapper(
  provider: ExecutableAgentProvider
): ProviderRunEventMapper {
  return MAPPERS[provider];
}
