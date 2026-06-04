import { API_BASE, handleResponse } from './helpers';

export type OutboundEndpointType =
  | 'broadcast-webhook'
  | 'lifecycle-hook-webhook'
  | 'transition-hook-webhook'
  | 'policy-webhook'
  | 'squad-webhook'
  | 'openclaw-wake'
  | 'openclaw-gateway'
  | 'failure-alert-webhook';

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
};
