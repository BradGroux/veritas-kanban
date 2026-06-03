import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, API_BASE } from '@/lib/api/helpers';

export interface AgentNotification {
  id: string;
  taskId: string;
  targetAgent: string;
  fromAgent: string;
  content: string;
  type: string;
  title?: string;
  taskTitle?: string;
  project?: string;
  targetUrl?: string;
  dedupeKey?: string;
  source?: Record<string, string | number | boolean | null>;
  delivered: boolean;
  deliveredAt?: string;
  createdAt: string;
}

export function useUndeliveredNotifications(limit = 50) {
  return useQuery({
    queryKey: ['notifications', 'undelivered', limit],
    queryFn: () =>
      apiFetch<AgentNotification[]>(
        `${API_BASE}/notifications?undelivered=true&limit=${encodeURIComponent(String(limit))}`
      ),
    staleTime: 30_000,
  });
}

export function useMarkNotificationDelivered() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ success: true }>(`${API_BASE}/notifications/${encodeURIComponent(id)}/delivered`, {
        method: 'POST',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}
