import { API_BASE, handleResponse } from './helpers';
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
    const response = await fetch(`${API_BASE}/integrations/outbound/endpoints`, {
      credentials: 'include',
    });
    return handleResponse<OutboundEndpointRecord[]>(response);
  },

  outboundDeliveries: async (limit = 25): Promise<OutboundDeliveryAttempt[]> => {
    const response = await fetch(`${API_BASE}/integrations/outbound/deliveries?limit=${limit}`, {
      credentials: 'include',
    });
    return handleResponse<OutboundDeliveryAttempt[]>(response);
  },

  communicationAdapters: async (): Promise<CommunicationAdapterRecord[]> => {
    const response = await fetch(`${API_BASE}/integrations/communication/adapters`, {
      credentials: 'include',
    });
    return handleResponse<CommunicationAdapterRecord[]>(response);
  },

  configureCommunicationAdapter: async (
    adapterId: string,
    input: CommunicationAdapterInput
  ): Promise<CommunicationAdapterRecord> => {
    const response = await fetch(
      `${API_BASE}/integrations/communication/adapters/${encodeURIComponent(adapterId)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(input),
      }
    );
    return handleResponse<CommunicationAdapterRecord>(response);
  },

  communicationHealth: async (adapterId: string): Promise<CommunicationAdapterHealth> => {
    const response = await fetch(
      `${API_BASE}/integrations/communication/adapters/${encodeURIComponent(adapterId)}/health`,
      {
        credentials: 'include',
      }
    );
    return handleResponse<CommunicationAdapterHealth>(response);
  },

  testCommunicationAdapter: async (
    adapterId: string,
    message?: string
  ): Promise<CommunicationSendResult> => {
    const response = await fetch(
      `${API_BASE}/integrations/communication/adapters/${encodeURIComponent(adapterId)}/test`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message }),
      }
    );
    return handleResponse<CommunicationSendResult>(response);
  },

  sendCommunicationMessage: async (
    adapterId: string,
    input: CommunicationSendInput
  ): Promise<CommunicationSendResult> => {
    const response = await fetch(
      `${API_BASE}/integrations/communication/adapters/${encodeURIComponent(adapterId)}/send`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(input),
      }
    );
    return handleResponse<CommunicationSendResult>(response);
  },

  ingestCommunicationReply: async (
    adapterId: string,
    input: CommunicationReplyIngestInput
  ): Promise<CommunicationReplyIngestResult> => {
    const response = await fetch(
      `${API_BASE}/integrations/communication/adapters/${encodeURIComponent(adapterId)}/replies`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(input),
      }
    );
    return handleResponse<CommunicationReplyIngestResult>(response);
  },

  disconnectCommunicationAdapter: async (
    adapterId: string
  ): Promise<CommunicationAdapterRecord> => {
    const response = await fetch(
      `${API_BASE}/integrations/communication/adapters/${encodeURIComponent(adapterId)}/disconnect`,
      {
        method: 'POST',
        credentials: 'include',
      }
    );
    return handleResponse<CommunicationAdapterRecord>(response);
  },

  communicationMappings: async (adapterId?: string): Promise<CommunicationThreadMapping[]> => {
    const params = new URLSearchParams();
    if (adapterId) params.set('adapterId', adapterId);
    const response = await fetch(`${API_BASE}/integrations/communication/mappings?${params}`, {
      credentials: 'include',
    });
    return handleResponse<CommunicationThreadMapping[]>(response);
  },

  communicationDeliveries: async (
    limit = 25,
    adapterId?: string
  ): Promise<CommunicationDeliveryAudit[]> => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (adapterId) params.set('adapterId', adapterId);
    const response = await fetch(`${API_BASE}/integrations/communication/deliveries?${params}`, {
      credentials: 'include',
    });
    return handleResponse<CommunicationDeliveryAudit[]>(response);
  },

  trackerConnection: async (): Promise<ExternalTrackerConnectionRecord> => {
    const response = await fetch(`${API_BASE}/integrations/trackers/connection`, {
      credentials: 'include',
    });
    return handleResponse<ExternalTrackerConnectionRecord>(response);
  },

  saveTrackerConnection: async (
    input: ExternalTrackerConnectionInput
  ): Promise<ExternalTrackerConnectionRecord> => {
    const response = await fetch(`${API_BASE}/integrations/trackers/connection`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(input),
    });
    return handleResponse<ExternalTrackerConnectionRecord>(response);
  },

  introspectTracker: async (
    input: Partial<ExternalTrackerConnectionInput> = { provider: 'mock' }
  ): Promise<ExternalTrackerSchema> => {
    const response = await fetch(`${API_BASE}/integrations/trackers/introspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(input),
    });
    return handleResponse<ExternalTrackerSchema>(response);
  },

  trackerSchema: async (): Promise<ExternalTrackerSchema> => {
    const response = await fetch(`${API_BASE}/integrations/trackers/schema`, {
      credentials: 'include',
    });
    return handleResponse<ExternalTrackerSchema>(response);
  },

  trackerProfiles: async (): Promise<ExternalTrackerMappingProfile[]> => {
    const response = await fetch(`${API_BASE}/integrations/trackers/profiles`, {
      credentials: 'include',
    });
    return handleResponse<ExternalTrackerMappingProfile[]>(response);
  },

  saveTrackerProfile: async (
    profileId: string,
    input: ExternalTrackerMappingProfileInput
  ): Promise<ExternalTrackerMappingProfile> => {
    const response = await fetch(
      `${API_BASE}/integrations/trackers/profiles/${encodeURIComponent(profileId)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(input),
      }
    );
    return handleResponse<ExternalTrackerMappingProfile>(response);
  },

  validateTrackerProfile: async (profileId: string): Promise<ExternalTrackerValidationResult> => {
    const response = await fetch(
      `${API_BASE}/integrations/trackers/profiles/${encodeURIComponent(profileId)}/validate`,
      {
        method: 'POST',
        credentials: 'include',
      }
    );
    return handleResponse<ExternalTrackerValidationResult>(response);
  },

  dryRunTrackerCreate: async (
    input: ExternalTrackerDryRunCreateInput
  ): Promise<ExternalTrackerDryRunCreateResult> => {
    const response = await fetch(
      `${API_BASE}/integrations/trackers/profiles/${encodeURIComponent(input.profileId)}/dry-run-create`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ taskId: input.taskId, task: input.task }),
      }
    );
    return handleResponse<ExternalTrackerDryRunCreateResult>(response);
  },

  createTrackerWorkItem: async (
    input: ExternalTrackerCreateWorkItemInput
  ): Promise<ExternalTrackerCreateWorkItemResult> => {
    const response = await fetch(
      `${API_BASE}/integrations/trackers/profiles/${encodeURIComponent(input.profileId)}/create`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          taskId: input.taskId,
          task: input.task,
          approvedBy: input.approvedBy,
        }),
      }
    );
    return handleResponse<ExternalTrackerCreateWorkItemResult>(response);
  },

  trackerAudits: async (limit = 25): Promise<ExternalTrackerSyncAudit[]> => {
    const response = await fetch(`${API_BASE}/integrations/trackers/audits?limit=${limit}`, {
      credentials: 'include',
    });
    return handleResponse<ExternalTrackerSyncAudit[]>(response);
  },
};
