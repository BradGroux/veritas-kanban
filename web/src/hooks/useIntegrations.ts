import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

const PROVIDERS_KEY = ['integrations', 'providers'] as const;
const INTEGRATIONS_KEY = ['integrations', 'list'] as const;

export function useIntegrationProviders() {
  return useQuery({
    queryKey: PROVIDERS_KEY,
    queryFn: api.integrations.listProviders,
    staleTime: 10 * 60 * 1000,
  });
}

export function useIntegrations() {
  return useQuery({
    queryKey: INTEGRATIONS_KEY,
    queryFn: api.integrations.list,
    staleTime: 30 * 1000,
  });
}

export function useConnectIntegration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ providerId, params }: { providerId: string; params: Record<string, string> }) =>
      api.integrations.connect(providerId, params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INTEGRATIONS_KEY });
    },
  });
}

export function useDisconnectIntegration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (providerId: string) => api.integrations.disconnect(providerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INTEGRATIONS_KEY });
    },
  });
}

export function useSyncIntegration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (providerId: string) => api.integrations.sync(providerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INTEGRATIONS_KEY });
    },
  });
}
