import type { SquadMessage } from './chat.types.js';

export type CommunicationAdapterKind = 'msteams' | 'buzz';

export type CommunicationAdapterDeliveryMode = 'manual' | 'webhook';

export type CommunicationAdapterDestinationType = 'channel' | 'direct';

export type CommunicationAdapterHealthStatus =
  'ok' | 'warning' | 'disabled' | 'error' | BuzzCompatibilityStatus;

export type CommunicationAdapterReplyMode = 'ingest-api';

export type CommunicationReplyTargetKind = 'squad' | 'task' | 'run' | 'approval' | 'notification';

export const BUZZ_COMPATIBILITY_SCHEMA_VERSION = 'buzz-compatibility/v1' as const;
export const BUZZ_PROBE_REVISION = 1;
export const BUZZ_TESTED_RELEASE = '0.4.24';
export const BUZZ_TESTED_COMMIT = '710ed9fff57878a1d69f809b80a6ee0416c53fc4';

export type BuzzCompatibilityStatus =
  | 'healthy'
  | 'degraded'
  | 'unsupported'
  | 'unauthorized'
  | 'not_member'
  | 'misconfigured'
  | 'unreachable';

export type BuzzCompatibilityReasonCode =
  | 'ok'
  | 'adapter_disabled'
  | 'configuration_missing'
  | 'configuration_invalid'
  | 'endpoint_invalid'
  | 'endpoint_mismatch'
  | 'network_policy_blocked'
  | 'relay_unreachable'
  | 'response_too_large'
  | 'relay_info_invalid'
  | 'query_response_invalid'
  | 'relay_software_mismatch'
  | 'relay_version_unsupported'
  | 'community_mismatch'
  | 'credential_unavailable'
  | 'auth_tag_invalid'
  | 'public_key_mismatch'
  | 'authentication_rejected'
  | 'relay_membership_required'
  | 'read_capability_rejected'
  | 'relay_rate_limited'
  | 'relay_error';

export type BuzzVerificationState = 'verified' | 'not_enforced' | 'unverified' | 'failed';

export interface BuzzCommandConfig {
  executable: string;
  args?: string[];
}

export interface BuzzCommandDiagnostic {
  command: 'buzz' | 'buzz-acp' | 'buzz-agent' | 'configured';
  executable: string;
  available: boolean;
  version?: string;
  detail?: string;
}

export interface BuzzCompatibilityChecks {
  relayIdentity: BuzzVerificationState;
  communityBinding: BuzzVerificationState;
  configuredIdentity: BuzzVerificationState;
  authentication: BuzzVerificationState;
  membership: BuzzVerificationState;
  channelRead: BuzzVerificationState;
  messageRead: BuzzVerificationState;
}

export interface BuzzRelayContract {
  software: string;
  version: string;
  supportedNips: number[];
  supportedExtensions: string[];
  relayPublicKey?: string;
  authRequired: boolean;
}

export interface BuzzCompatibilityResult {
  schemaVersion: typeof BUZZ_COMPATIBILITY_SCHEMA_VERSION;
  probeRevision: typeof BUZZ_PROBE_REVISION;
  testedRelease: typeof BUZZ_TESTED_RELEASE;
  testedCommit: typeof BUZZ_TESTED_COMMIT;
  status: BuzzCompatibilityStatus;
  reasonCode: BuzzCompatibilityReasonCode;
  detail: string;
  remediation?: string;
  configuredRelayHttpUrl: string;
  resolvedRelayHttpUrl?: string;
  configuredRelayWebSocketUrl?: string;
  resolvedRelayWebSocketUrl?: string;
  expectedCommunity?: string;
  observedCommunity?: string;
  publicKeyFingerprint: string;
  contract?: BuzzRelayContract;
  checks: BuzzCompatibilityChecks;
  commands: BuzzCommandDiagnostic[];
  evidenceKey: string;
  checkedAt: string;
}

export interface CommunicationReplyTarget {
  kind: CommunicationReplyTargetKind;
  squadMessageId?: string;
  taskId?: string;
  runId?: string;
  approvalId?: string;
  notificationId?: string;
}

export interface CommunicationAdapterRecord {
  id: string;
  kind: CommunicationAdapterKind;
  displayName: string;
  enabled: boolean;
  deliveryMode: CommunicationAdapterDeliveryMode;
  replyMode: CommunicationAdapterReplyMode;
  destinationType: CommunicationAdapterDestinationType;
  tenantId?: string;
  teamId?: string;
  channelId?: string;
  chatId?: string;
  webhookUrl?: string;
  webhookUrlConfigured?: boolean;
  webhookUrlRedacted?: boolean;
  hasCredential: boolean;
  relayHttpUrl?: string;
  relayWebSocketUrl?: string;
  expectedCommunity?: string;
  publicKey?: string;
  publicKeyFingerprint?: string;
  credentialRef?: string;
  authTagRef?: string;
  authTagConfigured?: boolean;
  allowLocalhost?: boolean;
  allowPrivateNetwork?: boolean;
  command?: BuzzCommandConfig;
  compatibility?: BuzzCompatibilityResult;
  createdAt: string;
  updatedAt: string;
  lastHealth?: CommunicationAdapterHealth;
}

export interface CommunicationAdapterInput {
  kind?: CommunicationAdapterKind;
  displayName?: string;
  enabled?: boolean;
  deliveryMode?: CommunicationAdapterDeliveryMode;
  destinationType?: CommunicationAdapterDestinationType;
  tenantId?: string;
  teamId?: string;
  channelId?: string;
  chatId?: string;
  webhookUrl?: string;
  credential?: string;
  relayHttpUrl?: string;
  relayWebSocketUrl?: string | null;
  expectedCommunity?: string | null;
  publicKey?: string;
  credentialRef?: string;
  authTagRef?: string | null;
  allowLocalhost?: boolean;
  allowPrivateNetwork?: boolean;
  command?: BuzzCommandConfig | null;
}

export interface CommunicationAdapterHealth {
  adapterId: string;
  status: CommunicationAdapterHealthStatus;
  configured: boolean;
  canSend: boolean;
  canReceiveReplies: boolean;
  checkedAt: string;
  detail: string;
  reasonCode?: BuzzCompatibilityReasonCode;
  remediation?: string;
  buzz?: BuzzCompatibilityResult;
  buzzRuntime?: BuzzRuntimeHealth;
}

export interface BuzzExternalCoordinate {
  community: string;
  channelId: string;
  eventId?: string;
  authorPubkey?: string;
  kind?: number;
  rootEventId?: string;
  parentEventId?: string;
  externalUrl?: string;
}

export interface BuzzChannelMapping {
  id: string;
  adapterId: string;
  community: string;
  channelId: string;
  target: CommunicationReplyTarget;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

export interface BuzzCursor {
  adapterId: string;
  community: string;
  channelId: string;
  createdAt: number;
  eventId: string;
  committedAt: string;
}

export interface BuzzRuntimeHealth {
  relayConnected: boolean;
  subscriptionActive: boolean;
  mappedChannels: number;
  reconnectAttempts: number;
  lastConnectedAt?: string;
  lastEventAt?: string;
  cursorLagSeconds?: number;
  lastSendAt?: string;
  lastSendStatus?: CommunicationDeliveryStatus;
  lastError?: string;
}

export interface CommunicationThreadMapping {
  id: string;
  adapterId: string;
  externalThreadId: string;
  externalUrl?: string;
  target: CommunicationReplyTarget;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  buzz?: BuzzExternalCoordinate;
}

export type CommunicationDeliveryOperation =
  | 'configure'
  | 'health'
  | 'send'
  | 'reply-ingest'
  | 'event-ingest'
  | 'reconcile'
  | 'poll'
  | 'disconnect';

export type CommunicationDeliveryStatus =
  | 'success'
  | 'queued'
  | 'delivery_unknown'
  | 'replayed'
  | 'ignored'
  | 'failed'
  | 'blocked'
  | 'skipped';

export interface CommunicationDeliveryAudit {
  id: string;
  adapterId: string;
  operation: CommunicationDeliveryOperation;
  status: CommunicationDeliveryStatus;
  target?: CommunicationReplyTarget;
  externalThreadId?: string;
  squadMessageId?: string;
  actor?: string;
  error?: string;
  detail?: string;
  buzz?: BuzzExternalCoordinate;
  createdAt: string;
}

export interface CommunicationSendInput {
  target: CommunicationReplyTarget;
  message: string;
  actor?: string;
  replyToSquadMessageId?: string;
  externalThreadId?: string;
  externalUrl?: string;
}

export interface CommunicationSendResult {
  delivery: CommunicationDeliveryAudit;
  mapping: CommunicationThreadMapping;
}

export type CommunicationAdapterTestResult = CommunicationSendResult | CommunicationAdapterHealth;

export interface CommunicationReplyIngestInput {
  externalThreadId: string;
  externalReplyId?: string;
  actor: string;
  displayName?: string;
  message: string;
  target?: CommunicationReplyTarget;
  externalUrl?: string;
}

export interface CommunicationReplyIngestResult {
  delivery: CommunicationDeliveryAudit;
  mapping: CommunicationThreadMapping;
  squadMessageId: string;
  squadMessage?: SquadMessage;
}
