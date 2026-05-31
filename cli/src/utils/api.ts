// Re-export shared API helpers with CLI permission preflight enabled.
import {
  API_BASE,
  createApiClient,
  createApiPermissionGuard,
  createGuardedApiClient,
  type ClientAuthContext,
} from '@veritas-kanban/shared';

export {
  API_BASE,
  ClientPermissionError,
  buildApiHeaders,
  createApiClient,
  createGuardedApiClient,
  getApiPermissionRequirement,
  type ClientAuthContext,
  type ClientAuthPermission,
} from '@veritas-kanban/shared';

export const api = createGuardedApiClient(API_BASE);

const contextApi = createApiClient(API_BASE);
export const assertApiPermissionForRequest = createApiPermissionGuard(() =>
  contextApi<ClientAuthContext>('/api/auth/context')
);
