import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export const SCHEDULER_KEY = ['scheduler'] as const;
export const AUTOMATION_DRAFTS_KEY = ['scheduler', 'drafts'] as const;
export const AUTOMATIONS_KEY = ['scheduler', 'automations'] as const;

export function useScheduler() {
  return useQuery({
    queryKey: SCHEDULER_KEY,
    queryFn: api.scheduler.list,
  });
}

export function useAutomationDrafts() {
  return useQuery({
    queryKey: AUTOMATION_DRAFTS_KEY,
    queryFn: api.scheduler.listDrafts,
  });
}

export function useAutomationDraftPreview() {
  return useMutation({ mutationFn: api.scheduler.previewDraft });
}

export function useAutomationDraftSave() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.scheduler.saveDraft,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: AUTOMATION_DRAFTS_KEY }),
  });
}

export function useAutomationActivationPreview() {
  return useMutation({ mutationFn: api.scheduler.previewActivation });
}

export function useAutomationActivationApply() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.scheduler.applyActivation,
    onSuccess: (result) => {
      if (!result.version) return;
      void queryClient.invalidateQueries({ queryKey: SCHEDULER_KEY });
      void queryClient.invalidateQueries({ queryKey: AUTOMATIONS_KEY });
    },
  });
}

export function useAutomations() {
  return useQuery({ queryKey: AUTOMATIONS_KEY, queryFn: api.scheduler.listAutomations });
}

export function useSchedulerRunDue() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.scheduler.runDue,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SCHEDULER_KEY }),
  });
}

export function useSchedulerRunItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => api.scheduler.runItem(itemId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SCHEDULER_KEY }),
  });
}

export function useSchedulerPause() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => api.scheduler.pause(itemId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SCHEDULER_KEY }),
  });
}

export function useSchedulerResume() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => api.scheduler.resume(itemId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SCHEDULER_KEY }),
  });
}

export function useSchedulerValidate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => api.scheduler.validate(itemId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SCHEDULER_KEY }),
  });
}
