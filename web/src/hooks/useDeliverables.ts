import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { DeliverableType, DeliverableStatus } from '@veritas-kanban/shared';

interface AddDeliverableParams {
  taskId: string;
  title: string;
  type: DeliverableType;
  path?: string;
  description?: string;
  agent?: string;
}

interface UpdateDeliverableParams {
  taskId: string;
  deliverableId: string;
  title?: string;
  type?: DeliverableType;
  path?: string;
  status?: DeliverableStatus;
  description?: string;
  agent?: string;
}

interface DeleteDeliverableParams {
  taskId: string;
  deliverableId: string;
}

export function useAddDeliverable() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ taskId, ...body }: AddDeliverableParams) => {
      return await api.tasks.addDeliverable(taskId, body);
    },
    onSuccess: (updatedTask) => {
      queryClient.setQueryData(['task', updatedTask.id], updatedTask);
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useUpdateDeliverable() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ taskId, deliverableId, ...body }: UpdateDeliverableParams) => {
      return await api.tasks.updateDeliverable(taskId, deliverableId, body);
    },
    onSuccess: (updatedTask) => {
      queryClient.setQueryData(['task', updatedTask.id], updatedTask);
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useDeleteDeliverable() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ taskId, deliverableId }: DeleteDeliverableParams) => {
      return await api.tasks.deleteDeliverable(taskId, deliverableId);
    },
    onSuccess: (updatedTask) => {
      queryClient.setQueryData(['task', updatedTask.id], updatedTask);
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}
