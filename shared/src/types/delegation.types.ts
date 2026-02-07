/**
 * Delegation / Vacation Mode Types
 *
 * Allows humans to delegate task approval authority to an agent for a set period.
 */

export interface DelegationApproval {
  id: string; // Unique approval ID
  taskId: string;
  taskTitle: string;
  agent: string; // Which agent approved
  delegated: true;
  timestamp: string;
  originalDelegation: string; // Reference to delegation ID when it was set up
}

export interface DelegationLog {
  approvals: DelegationApproval[];
}
