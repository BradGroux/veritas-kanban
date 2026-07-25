import type {
  AdmissionCapacityRequest,
  AdmissionLimitPolicy,
  AdmissionReservation,
} from '@veritas-kanban/shared';

function policyApplies(policy: AdmissionLimitPolicy, record: AdmissionReservation): boolean {
  const request = record.request;
  switch (policy.scope) {
    case 'global':
      return true;
    case 'task':
      return request.taskId === policy.scopeId;
    case 'workspace':
      return request.workspaceId === policy.scopeId;
    case 'root-task':
      return request.rootTaskId === policy.scopeId;
    case 'provider':
      return request.provider === policy.scopeId;
    case 'host':
      return request.hostId === policy.scopeId;
  }
}

function addCapacity(
  total: AdmissionCapacityRequest,
  requested: AdmissionCapacityRequest
): AdmissionCapacityRequest {
  return {
    runSlots: total.runSlots + requested.runSlots,
    processSlots: total.processSlots + requested.processSlots,
    estimatedMemoryMb: total.estimatedMemoryMb + requested.estimatedMemoryMb,
  };
}

function exceeds(requested: AdmissionCapacityRequest, policy: AdmissionLimitPolicy): boolean {
  return (
    (policy.limits.concurrentRuns !== undefined &&
      requested.runSlots > policy.limits.concurrentRuns) ||
    (policy.limits.processSlots !== undefined &&
      requested.processSlots > policy.limits.processSlots) ||
    (policy.limits.estimatedMemoryMb !== undefined &&
      requested.estimatedMemoryMb > policy.limits.estimatedMemoryMb)
  );
}

export function requestExceedsPolicies(
  requested: AdmissionCapacityRequest,
  policies: AdmissionLimitPolicy[]
): AdmissionLimitPolicy[] {
  return policies.filter((policy) => exceeds(requested, policy));
}

export function findLimitingAdmissionPolicies(
  active: AdmissionReservation[],
  candidate: AdmissionReservation
): AdmissionLimitPolicy[] {
  return candidate.policies.filter((policy) => {
    const used = active
      .filter((record) => record.state === 'active' && policyApplies(policy, record))
      .reduce((total, record) => addCapacity(total, record.request.requested), {
        runSlots: 0,
        processSlots: 0,
        estimatedMemoryMb: 0,
      });
    return exceeds(addCapacity(used, candidate.request.requested), policy);
  });
}
