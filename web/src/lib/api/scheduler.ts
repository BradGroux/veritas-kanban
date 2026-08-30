import type {
  AutomationDraft,
  AutomationDraftHints,
  AutomationDraftListResponse,
  AutomationActivationPreview,
  AutomationActivationResult,
  AutomationVersionListResponse,
  SchedulerDueRunResult,
  SchedulerListResponse,
  SchedulerRunResult,
  SchedulerValidationResult,
} from '@veritas-kanban/shared';
import { API_BASE, apiFetch } from './helpers';

function itemPath(itemId: string, action?: string): string {
  const encoded = encodeURIComponent(itemId);
  return `${API_BASE}/scheduler/items/${encoded}${action ? `/${action}` : ''}`;
}

export const schedulerApi = {
  list: () => apiFetch<SchedulerListResponse>(`${API_BASE}/scheduler`),

  listDrafts: () => apiFetch<AutomationDraftListResponse>(`${API_BASE}/scheduler/drafts`),

  previewDraft: (input: { intent: string; requestId: string; hints?: AutomationDraftHints }) =>
    apiFetch<AutomationDraft>(`${API_BASE}/scheduler/drafts/preview`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  saveDraft: (input: { intent: string; requestId: string; hints?: AutomationDraftHints }) =>
    apiFetch<AutomationDraft>(`${API_BASE}/scheduler/drafts`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  previewActivation: (input: { draftId: string; revision: number; requestId: string }) =>
    apiFetch<AutomationActivationPreview>(
      `${API_BASE}/scheduler/drafts/${encodeURIComponent(input.draftId)}/activation-preview`,
      {
        method: 'POST',
        body: JSON.stringify({ revision: input.revision, requestId: input.requestId }),
      }
    ),

  applyActivation: (input: {
    draftId: string;
    revision: number;
    requestId: string;
    expectedRequestRevision: string;
    approvalId?: string;
  }) =>
    apiFetch<AutomationActivationResult>(
      `${API_BASE}/scheduler/drafts/${encodeURIComponent(input.draftId)}/activate`,
      {
        method: 'POST',
        body: JSON.stringify({
          revision: input.revision,
          requestId: input.requestId,
          expectedRequestRevision: input.expectedRequestRevision,
          ...(input.approvalId ? { approvalId: input.approvalId } : {}),
        }),
      }
    ),

  listAutomations: () =>
    apiFetch<AutomationVersionListResponse>(`${API_BASE}/scheduler/automations`),

  runDue: () =>
    apiFetch<SchedulerDueRunResult>(`${API_BASE}/scheduler/due/run`, {
      method: 'POST',
    }),

  runItem: (itemId: string) =>
    apiFetch<SchedulerRunResult>(itemPath(itemId, 'run'), {
      method: 'POST',
    }),

  pause: (itemId: string) =>
    apiFetch<SchedulerRunResult>(itemPath(itemId, 'pause'), {
      method: 'POST',
    }),

  resume: (itemId: string) =>
    apiFetch<SchedulerRunResult>(itemPath(itemId, 'resume'), {
      method: 'POST',
    }),

  validate: (itemId: string) =>
    apiFetch<SchedulerValidationResult>(itemPath(itemId, 'validate'), {
      method: 'POST',
    }),
};
