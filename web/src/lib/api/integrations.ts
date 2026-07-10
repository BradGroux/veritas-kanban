import { API_BASE, apiFetch } from './helpers';
import type {
  CommunicationAdapterHealth,
  CommunicationAdapterInput,
  CommunicationAdapterRecord,
  CommunicationDeliveryAudit,
  CommunicationReplyIngestInput,
  CommunicationReplyIngestResult,
  CommunicationSendInput,
  CommunicationSendResult,
  CommunicationThreadMapping,
  ExternalTrackerConnectionInput,
  ExternalTrackerConnectionRecord,
  ExternalTrackerCreateWorkItemInput,
  ExternalTrackerCreateWorkItemResult,
  ExternalTrackerDryRunCreateInput,
  ExternalTrackerDryRunCreateResult,
  ExternalTrackerMappingProfile,
  ExternalTrackerMappingProfileInput,
  ExternalTrackerSchema,
  ExternalTrackerSyncAudit,
  ExternalTrackerValidationResult,
} from '@veritas-kanban/shared';

export type OutboundEndpointType =
  | 'broadcast-webhook'
  | 'lifecycle-hook-webhook'
  | 'transition-hook-webhook'
  | 'policy-webhook'
  | 'squad-webhook'
  | 'openclaw-wake'
  | 'openclaw-gateway'
  | 'failure-alert-webhook'
  | 'communication-adapter-webhook';

export type OutboundDeliveryStatus = 'success' | 'failed' | 'blocked' | 'timeout' | 'skipped';

export interface OutboundEndpointRecord {
  id: string;
  type: OutboundEndpointType;
  displayName: string;
  url: string;
  enabled: boolean;
  auth: {
    type: 'none' | 'hmac-sha256' | 'bearer' | 'custom-header';
    secretRef?: string;
    headerName?: string;
    hasSecret?: boolean;
  };
  validation: {
    valid: boolean;
    reason?: string;
  };
  updatedAt: string;
}

export interface OutboundDeliveryAttempt {
  id: string;
  endpointId: string;
  endpointType: OutboundEndpointType;
  displayName: string;
  method: string;
  sanitizedUrl: string;
  status: OutboundDeliveryStatus;
  responseStatus?: number;
  responseClass?: string;
  durationMs: number;
  attempt: number;
  error?: string;
  startedAt: string;
  completedAt: string;
}

export const integrationsApi = {
  outboundEndpoints: async (): Promise<OutboundEndpointRecord[]> => {
    return apiFetch<OutboundEndpointRecord[]>(`${API_BASE}/integrations/outbound/endpoints`);
  },

  outboundDeliveries: async (limit = 25): Promise<OutboundDeliveryAttempt[]> => {
    return apiFetch<OutboundDeliveryAttempt[]>(
      `${API_BASE}/integrations/outbound/deliveries?limit=${limit}`
    );
  },

  communicationAdapters: async (): Promise<CommunicationAdapterRecord[]> => {
    return apiFetch<CommunicationAdapterRecord[]>(
      `${API_BASE}/integrations/communication/adapters`
    );
  },

  configureCommunicationAdapter: async (
    adapterId: string,
    input: CommunicationAdapterInput
  ): Promise<CommunicationAdapterRecord> => {
    return apiFetch<CommunicationAdapterRecord>(
      `${API_BASE}/integrations/communication/adapters/${encodeURIComponent(adapterId)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }
    );
  },

  communicationHealth: async (adapterId: string): Promise<CommunicationAdapterHealth> => {
    return apiFetch<CommunicationAdapterHealth>(
      `${API_BASE}/integrations/communication/adapters/${encodeURIComponent(adapterId)}/health`
    );
  },

  testCommunicationAdapter: async (
    adapterId: string,
    message?: string
  ): Promise<CommunicationSendResult> => {
    return apiFetch<CommunicationSendResult>(
      `${API_BASE}/integrations/communication/adapters/${encodeURIComponent(adapterId)}/test`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      }
    );
  },

  sendCommunicationMessage: async (
    adapterId: string,
    input: CommunicationSendInput
  ): Promise<CommunicationSendResult> => {
    return apiFetch<CommunicationSendResult>(
      `${API_BASE}/integrations/communication/adapters/${encodeURIComponent(adapterId)}/send`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }
    );
  },

  ingestCommunicationReply: async (
    adapterId: string,
    input: CommunicationReplyIngestInput
  ): Promise<CommunicationReplyIngestResult> => {
    return apiFetch<CommunicationReplyIngestResult>(
      `${API_BASE}/integrations/communication/adapters/${encodeURIComponent(adapterId)}/replies`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }
    );
  },

  disconnectCommunicationAdapter: async (
    adapterId: string
  ): Promise<CommunicationAdapterRecord> => {
    return apiFetch<CommunicationAdapterRecord>(
      `${API_BASE}/integrations/communication/adapters/${encodeURIComponent(adapterId)}/disconnect`,
      {
        method: 'POST',
      }
    );
  },

  communicationMappings: async (adapterId?: string): Promise<CommunicationThreadMapping[]> => {
    const params = new URLSearchParams();
    if (adapterId) params.set('adapterId', adapterId);
    return apiFetch<CommunicationThreadMapping[]>(
      `${API_BASE}/integrations/communication/mappings?${params}`
    );
  },

  communicationDeliveries: async (
    limit = 25,
    adapterId?: string
  ): Promise<CommunicationDeliveryAudit[]> => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (adapterId) params.set('adapterId', adapterId);
    return apiFetch<CommunicationDeliveryAudit[]>(
      `${API_BASE}/integrations/communication/deliveries?${params}`
    );
  },

  trackerConnection: async (): Promise<ExternalTrackerConnectionRecord> => {
    return apiFetch<ExternalTrackerConnectionRecord>(
      `${API_BASE}/integrations/trackers/connection`
    );
  },

  saveTrackerConnection: async (
    input: ExternalTrackerConnectionInput
  ): Promise<ExternalTrackerConnectionRecord> => {
    return apiFetch<ExternalTrackerConnectionRecord>(
      `${API_BASE}/integrations/trackers/connection`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }
    );
  },

  introspectTracker: async (
    input: Partial<ExternalTrackerConnectionInput> = { provider: 'mock' }
  ): Promise<ExternalTrackerSchema> => {
    return apiFetch<ExternalTrackerSchema>(`${API_BASE}/integrations/trackers/introspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  },

  trackerSchema: async (): Promise<ExternalTrackerSchema> => {
    return apiFetch<ExternalTrackerSchema>(`${API_BASE}/integrations/trackers/schema`);
  },

  trackerProfiles: async (): Promise<ExternalTrackerMappingProfile[]> => {
    return apiFetch<ExternalTrackerMappingProfile[]>(`${API_BASE}/integrations/trackers/profiles`);
  },

  saveTrackerProfile: async (
    profileId: string,
    input: ExternalTrackerMappingProfileInput
  ): Promise<ExternalTrackerMappingProfile> => {
    return apiFetch<ExternalTrackerMappingProfile>(
      `${API_BASE}/integrations/trackers/profiles/${encodeURIComponent(profileId)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }
    );
  },

  validateTrackerProfile: async (profileId: string): Promise<ExternalTrackerValidationResult> => {
    return apiFetch<ExternalTrackerValidationResult>(
      `${API_BASE}/integrations/trackers/profiles/${encodeURIComponent(profileId)}/validate`,
      {
        method: 'POST',
      }
    );
  },

  dryRunTrackerCreate: async (
    input: ExternalTrackerDryRunCreateInput
  ): Promise<ExternalTrackerDryRunCreateResult> => {
    return apiFetch<ExternalTrackerDryRunCreateResult>(
      `${API_BASE}/integrations/trackers/profiles/${encodeURIComponent(input.profileId)}/dry-run-create`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: input.taskId, task: input.task }),
      }
    );
  },

  createTrackerWorkItem: async (
    input: ExternalTrackerCreateWorkItemInput
  ): Promise<ExternalTrackerCreateWorkItemResult> => {
    return apiFetch<ExternalTrackerCreateWorkItemResult>(
      `${API_BASE}/integrations/trackers/profiles/${encodeURIComponent(input.profileId)}/create`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: input.taskId,
          task: input.task,
          approvedBy: input.approvedBy,
        }),
      }
    );
  },

  trackerAudits: async (limit = 25): Promise<ExternalTrackerSyncAudit[]> => {
    return apiFetch<ExternalTrackerSyncAudit[]>(
      `${API_BASE}/integrations/trackers/audits?limit=${limit}`
    );
  },
};
