import { apiFetch } from './helpers';

export const authApi = {
  reset: (): Promise<void> => apiFetch('/api/auth/reset', { method: 'POST' }),
};
