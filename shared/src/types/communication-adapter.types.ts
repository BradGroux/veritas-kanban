import type { SquadMessage } from './chat.types.js';

export type CommunicationAdapterKind = 'msteams';

export type CommunicationAdapterDeliveryMode = 'manual' | 'webhook';

export type CommunicationAdapterDestinationType = 'channel' | 'direct';

export type CommunicationAdapterHealthStatus = 'ok' | 'warning' | 'disabled' | 'error';

export type CommunicationAdapterReplyMode = 'ingest-api';

export type CommunicationReplyTargetKind = 'squad' | 'task' | 'run' | 'approval' | 'notification';

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
}

export interface CommunicationAdapterHealth {
  adapterId: string;
  status: CommunicationAdapterHealthStatus;
  configured: boolean;
  canSend: boolean;
  canReceiveReplies: boolean;
  checkedAt: string;
  detail: string;
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
}

export type CommunicationDeliveryOperation =
  | 'configure'
  | 'health'
  | 'send'
  | 'reply-ingest'
  | 'poll'
  | 'disconnect';

export type CommunicationDeliveryStatus = 'success' | 'queued' | 'failed' | 'blocked' | 'skipped';

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
  createdAt: string;
}

export interface CommunicationSendInput {
  target: CommunicationReplyTarget;
  message: string;
  actor?: string;
  externalThreadId?: string;
  externalUrl?: string;
}

export interface CommunicationSendResult {
  delivery: CommunicationDeliveryAudit;
  mapping: CommunicationThreadMapping;
}

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
