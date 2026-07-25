import type { AdmissionControlService } from '../../services/admission-control-service.js';

export function workflowAdmissionStub(): AdmissionControlService {
  const reservationsByAttempt = new Map<string, string>();
  let pendingReservationId = 'admission_workflow_test';

  return {
    getExecutionHostId: () => 'test-execution-host',
    admit: async (input: { workflowRunId?: string; workflowStepId?: string }) => {
      pendingReservationId = `admission_${input.workflowRunId ?? 'run'}_${input.workflowStepId ?? 'root'}`;
      return {
        outcome: 'admitted',
        reservation: { id: pendingReservationId },
      };
    },
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
