import type { AdmissionControlService } from '../../services/admission-control-service.js';

export function workflowAdmissionStub(): AdmissionControlService {
  const reservationsByAttempt = new Map<string, string>();
  const requestsByReservation = new Map<
    string,
    { budgetPolicies?: import('@veritas-kanban/shared').ExecutionTreeBudgetPolicy[] }
  >();
  let pendingReservationId = 'admission_workflow_test';

  return {
    getExecutionHostId: () => 'test-execution-host',
    admit: async (input: {
      workflowRunId?: string;
      workflowStepId?: string;
      budgetPolicies?: import('@veritas-kanban/shared').ExecutionTreeBudgetPolicy[];
    }) => {
      pendingReservationId = `admission_${input.workflowRunId ?? 'run'}_${input.workflowStepId ?? 'root'}`;
      requestsByReservation.set(pendingReservationId, {
        budgetPolicies: input.budgetPolicies,
      });
      return {
        outcome: 'admitted',
        reservation: { id: pendingReservationId },
      };
    },
    get: async (id: string) => ({ id, request: requestsByReservation.get(id) ?? {} }),
    recordBudgetUsage: async (id: string) => ({ id }),
    bindAttempt: async (id: string, attemptId: string) => {
      reservationsByAttempt.set(attemptId, id);
      return { id };
    },
    recoverVerifiedRun: async (input: { attemptId: string }) => {
      const id = reservationsByAttempt.get(input.attemptId);
      return id ? { id } : null;
    },
    release: async (id: string) => ({ id }),
    releaseIfUnbound: async (id: string) => ({ id }),
    expireAbandoned: async () => [],
  } as unknown as AdmissionControlService;
}
