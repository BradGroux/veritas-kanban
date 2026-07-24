import type { AgentProfilePackage } from './agent-profile-package.types.js';
import type { TeamRosterManifest } from './team-roster.types.js';

export type BuzzDefinitionKind = 30175 | 30176;
export type BuzzDefinitionType = 'persona' | 'team';
export type BuzzDefinitionAction = 'create' | 'link' | 'refresh' | 'skip';
export type BuzzDefinitionDisposition =
  'mapped' | 'source-only' | 'ignored' | 'rejected' | 'conflict';

export interface BuzzDefinitionCoordinate {
  authorPubkey: string;
  kind: BuzzDefinitionKind;
  dTag: string;
}

export interface BuzzDefinitionFieldReport {
  field: string;
  disposition: BuzzDefinitionDisposition;
  detail: string;
}

export interface BuzzDefinitionSourceSnapshot {
  displayName?: string;
  systemPrompt?: string;
  avatarUrl?: string;
  runtime?: string;
  model?: string;
  provider?: string;
  namePool?: string[];
  respondTo?: string;
  respondToAllowlist?: string[];
  parallelism?: number;
  name?: string;
  description?: string;
  personaIds?: string[];
}

export interface BuzzDefinitionProvenance {
  schemaVersion: 'buzz-definition-link/v1';
  adapterId: string;
  relay: string;
  community: string;
  authorPubkey: string;
  kind: BuzzDefinitionKind;
  dTag: string;
  eventId: string;
  createdAt: number;
  contentHash: string;
  importedAt: string;
  refreshedAt?: string;
}

export interface BuzzDefinitionLink {
  provenance: BuzzDefinitionProvenance;
  sourceSnapshot: BuzzDefinitionSourceSnapshot;
  fieldReport: BuzzDefinitionFieldReport[];
  sourceOwnedFields: string[];
  localRevision: string;
  materializedIds?: string[];
}

export interface BuzzDefinitionSummary extends BuzzDefinitionCoordinate {
  type: BuzzDefinitionType;
  displayName: string;
  eventId: string;
  createdAt: number;
  contentHash: string;
  community: string;
  compatibility: 'compatible' | 'rejected';
  detail?: string;
}

export interface BuzzDefinitionListResult {
  adapterId: string;
  relay: string;
  community: string;
  definitions: BuzzDefinitionSummary[];
  rejectedCount: number;
}

export interface BuzzDefinitionPreviewInput {
  coordinate: BuzzDefinitionCoordinate;
  action: BuzzDefinitionAction;
  targetId?: string;
}

export interface BuzzDefinitionCollision {
  field: 'id' | 'name' | 'source' | 'persona';
  value: string;
  detail: string;
}

export interface BuzzDefinitionDiff {
  field: string;
  change: 'add' | 'update' | 'remove';
  beforeSummary?: string;
  afterSummary?: string;
}

export interface BuzzDefinitionPreview {
  definition: BuzzDefinitionSummary;
  action: BuzzDefinitionAction;
  targetId?: string;
  expectedLocalRevision?: string;
  changed: boolean;
  diff: BuzzDefinitionDiff[];
  fieldReport: BuzzDefinitionFieldReport[];
  collisions: BuzzDefinitionCollision[];
  unresolvedPersonaIds: string[];
  proposedProfile?: AgentProfilePackage;
  proposedRoster?: TeamRosterManifest;
}

export interface BuzzDefinitionImportInput extends BuzzDefinitionPreviewInput {
  expectedEventId: string;
  expectedLocalRevision?: string;
}

export interface BuzzDefinitionImportResult {
  status: 'created' | 'linked' | 'refreshed' | 'unchanged' | 'skipped';
  definition: BuzzDefinitionSummary;
  profile?: AgentProfilePackage;
  roster?: TeamRosterManifest;
}

export interface BuzzDefinitionLinkedStatus {
  targetType: 'profile' | 'roster';
  targetId: string;
  coordinate: BuzzDefinitionCoordinate;
  status: 'current' | 'changed' | 'missing' | 'unavailable';
  linkedEventId: string;
  currentEventId?: string;
  detail?: string;
}
