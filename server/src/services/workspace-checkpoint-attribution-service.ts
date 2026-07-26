import type {
  RunEventEnvelope,
  RunEventPage,
  RunEventQuery,
  WorkspaceCheckpointDiff,
  WorkspaceCheckpointFileDiff,
  WorkspaceCheckpointHunkAttribution,
} from '@veritas-kanban/shared';
import { ConflictError } from '../middleware/error-handler.js';
import {
  extractProviderEventPaths,
  extractProviderEventToolName,
  isWriteCapableProviderTool,
  normalizeWorkspaceEvidencePath,
} from './provider-event-evidence.js';
import { RunEventJournalService } from './run-event-journal-service.js';
import {
  WorkspaceCheckpointDiffService,
  type WorkspaceCheckpointDiffInput,
} from './workspace-checkpoint-diff-service.js';

const MAX_EVENT_PAGES = 100;

export interface WorkspaceCheckpointEventSource {
  list(query: RunEventQuery): Promise<RunEventPage>;
}

export interface WorkspaceCheckpointAttributionServiceOptions {
  diffs?: Pick<WorkspaceCheckpointDiffService, 'compare'>;
  events?: WorkspaceCheckpointEventSource;
}

interface CheckpointEventWindow {
  evidenceComplete: boolean;
  fromEventSequence?: number;
  toEventSequence?: number;
  events: RunEventEnvelope[];
}

interface AttributionEvidence {
  source: Exclude<WorkspaceCheckpointHunkAttribution['source'], 'unknown'>;
  basis: Exclude<
    WorkspaceCheckpointHunkAttribution['basis'],
    'mixed-file-evidence' | 'no-file-evidence'
  >;
  event: RunEventEnvelope;
  tool?: string;
}

export class WorkspaceCheckpointAttributionService {
  private readonly diffs: Pick<WorkspaceCheckpointDiffService, 'compare'>;
  private readonly events: WorkspaceCheckpointEventSource;

  constructor(options: WorkspaceCheckpointAttributionServiceOptions = {}) {
    this.diffs = options.diffs ?? new WorkspaceCheckpointDiffService();
    this.events = options.events ?? new RunEventJournalService();
  }

  async compare(input: WorkspaceCheckpointDiffInput): Promise<WorkspaceCheckpointDiff> {
    const diff = await this.diffs.compare(input);
    const window = await this.loadEventWindow(input);
    const evidenceByPath = this.indexEvidence(window.events);
    const files = diff.files.map((file) =>
      this.attributeFile(file, evidenceByPath.get(file.path) ?? [])
    );
    return {
      ...diff,
      attribution: {
        evidenceComplete: window.evidenceComplete,
        ...(window.fromEventSequence === undefined
          ? {}
          : { fromEventSequence: window.fromEventSequence }),
        ...(window.toEventSequence === undefined
          ? {}
          : { toEventSequence: window.toEventSequence }),
        eventsConsidered: window.events.length,
      },
      files,
    };
  }

  private async loadEventWindow(
    input: WorkspaceCheckpointDiffInput
  ): Promise<CheckpointEventWindow> {
    let cursor = 0;
    let fromEventSequence: number | undefined;
    let toEventSequence: number | undefined;
    const events: RunEventEnvelope[] = [];
    for (let pageNumber = 0; pageNumber < MAX_EVENT_PAGES; pageNumber += 1) {
      const page = await this.events.list({
        taskId: input.taskId,
        attemptId: input.attemptId,
        afterSequence: cursor,
        limit: 500,
      });
      for (const event of page.events) {
        const checkpointId = trustedCheckpointEventId(event);
        if (checkpointId === input.fromCheckpointId) {
          fromEventSequence = event.sequence;
          events.length = 0;
          continue;
        }
        if (checkpointId === input.toCheckpointId) {
          if (fromEventSequence === undefined) {
            throw new ConflictError('Workspace checkpoint event boundaries are out of order.');
          }
          toEventSequence = event.sequence;
          break;
        }
        if (fromEventSequence !== undefined) events.push(event);
      }
      if (toEventSequence !== undefined) break;
      if (!page.hasMore) break;
      if (page.nextCursor <= cursor || page.events.length === 0) {
        throw new ConflictError('Workspace checkpoint event replay did not advance.');
      }
      cursor = page.nextCursor;
    }

    if (
      fromEventSequence !== undefined &&
      toEventSequence !== undefined &&
      fromEventSequence >= toEventSequence
    ) {
      throw new ConflictError('Workspace checkpoint event boundaries are out of order.');
    }
    if (fromEventSequence === undefined || toEventSequence === undefined) {
      return {
        evidenceComplete: false,
        fromEventSequence,
        toEventSequence,
        events: [],
      };
    }
    return {
      evidenceComplete: true,
      fromEventSequence,
      toEventSequence,
      events,
    };
  }

  private attributeFile(
    file: WorkspaceCheckpointFileDiff,
    evidence: AttributionEvidence[]
  ): WorkspaceCheckpointFileDiff {
    const attribution = summarizeAttribution(evidence);
    return {
      ...file,
      attribution,
      hunks: file.hunks.map((hunk) => ({ ...hunk, attribution })),
    };
  }

  private indexEvidence(events: RunEventEnvelope[]): Map<string, AttributionEvidence[]> {
    const byPath = new Map<string, AttributionEvidence[]>();
    for (const event of events) {
      const evidence = this.evidenceForEvent(event);
      if (!evidence) continue;
      for (const filePath of normalizedEventPaths(event)) {
        const existing = byPath.get(filePath) ?? [];
        existing.push(evidence);
        byPath.set(filePath, existing);
      }
    }
    return byPath;
  }

  private evidenceForEvent(event: RunEventEnvelope): AttributionEvidence | undefined {
    if (event.kind === 'file.changed') {
      if (event.source.provider === 'operator') {
        return { source: 'operator', basis: 'operator-file-event', event };
      }
      if (event.source.provider === 'system') {
        return { source: 'external', basis: 'filesystem-file-event', event };
      }
      return { source: 'agent-tool', basis: 'provider-file-event', event };
    }

    if (event.kind === 'tool.started' || event.kind === 'tool.completed') {
      const tool = normalizedEventTool(event);
      if (!isWriteCapableProviderTool(tool)) return undefined;
      if (event.source.provider === 'operator') {
        return { source: 'operator', basis: 'operator-file-event', event, tool };
      }
      if (event.source.provider === 'system') {
        return { source: 'external', basis: 'filesystem-file-event', event, tool };
      }
      return { source: 'agent-tool', basis: 'write-tool-event', event, tool };
    }
    return undefined;
  }
}

function normalizedEventPaths(event: RunEventEnvelope): string[] {
  const normalized = event.payload.paths;
  if (Array.isArray(normalized)) {
    return normalized.flatMap((entry) => {
      if (typeof entry !== 'string') return [];
      const path = normalizeWorkspaceEvidencePath(entry);
      return path ? [path] : [];
    });
  }
  return extractProviderEventPaths(event.payload);
}

function normalizedEventTool(event: RunEventEnvelope): string | undefined {
  return typeof event.payload.tool === 'string'
    ? event.payload.tool
    : extractProviderEventToolName(event.payload);
}

function summarizeAttribution(evidence: AttributionEvidence[]): WorkspaceCheckpointHunkAttribution {
  if (evidence.length === 0) {
    return {
      source: 'unknown',
      confidence: 'none',
      basis: 'no-file-evidence',
      scope: 'checkpoint-file-window',
      evidenceEventIds: [],
    };
  }
  const sources = new Set(evidence.map((entry) => entry.source));
  const eventIds = [...new Set(evidence.map((entry) => entry.event.eventId))].slice(0, 100);
  if (sources.size !== 1) {
    return {
      source: 'unknown',
      confidence: 'ambiguous',
      basis: 'mixed-file-evidence',
      scope: 'checkpoint-file-window',
      evidenceEventIds: eventIds,
    };
  }
  const source = evidence[0].source;
  const bases = new Set(evidence.map((entry) => entry.basis));
  const providers = new Set(evidence.map((entry) => entry.event.source.provider));
  const agents = new Set(
    evidence
      .map((entry) => entry.event.source.agent)
      .filter((entry): entry is string => Boolean(entry))
  );
  const tools = new Set(
    evidence.map((entry) => entry.tool).filter((entry): entry is string => Boolean(entry))
  );
  const provider = [...providers][0];
  const agent = [...agents][0];
  const tool = [...tools][0];
  return {
    source,
    confidence: 'high',
    basis: bases.size === 1 ? evidence[0].basis : sourceBasis(source),
    scope: 'checkpoint-file-window',
    evidenceEventIds: eventIds,
    ...(providers.size === 1 && provider ? { provider } : {}),
    ...(agents.size === 1 && agent ? { agent } : {}),
    ...(tools.size === 1 && tool ? { tool } : {}),
  };
}

function trustedCheckpointEventId(event: RunEventEnvelope): string | undefined {
  return event.kind === 'workspace.checkpoint.created' &&
    event.source.provider === 'system' &&
    event.source.adapter === 'workspace-checkpoint' &&
    typeof event.payload.checkpointId === 'string'
    ? event.payload.checkpointId
    : undefined;
}

function sourceBasis(
  source: Exclude<WorkspaceCheckpointHunkAttribution['source'], 'unknown'>
): Exclude<
  WorkspaceCheckpointHunkAttribution['basis'],
  'mixed-file-evidence' | 'no-file-evidence'
> {
  if (source === 'operator') return 'operator-file-event';
  if (source === 'external') return 'filesystem-file-event';
  return 'provider-file-event';
}
