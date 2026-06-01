import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useTaskWorkProducts(taskId: string | undefined) {
  return useQuery({
    queryKey: ['tasks', taskId, 'work-products'],
    queryFn: () =>
      taskId
        ? api.workProducts.listForTask(taskId, { includeArchived: true, limit: 20 })
        : Promise.resolve([]),
    enabled: Boolean(taskId),
  });
}

export function useWorkProductVersions(productId: string | null) {
  return useQuery({
    queryKey: ['work-products', productId, 'versions'],
    queryFn: () => (productId ? api.workProducts.listVersions(productId) : Promise.resolve([])),
    enabled: Boolean(productId),
  });
}
