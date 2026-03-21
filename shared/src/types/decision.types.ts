export type DecisionAssumptionStatus = 'pending' | 'validated' | 'invalidated';

export interface DecisionAssumption {
  text: string;
  status: DecisionAssumptionStatus;
  updatedAt?: string;
  note?: string;
}

export interface DecisionRecord {
  id: string;
  inputContext: string;
  outputAction: string;
  assumptions: DecisionAssumption[];
  confidenceLevel: number;
  riskScore: number;
  parentDecisionId?: string;
  agentId: string;
  taskId: string;
  timestamp: string;
}

export interface CreateDecisionInput {
  inputContext: string;
  outputAction: string;
  assumptions?: Array<string | { text: string }>;
  confidenceLevel: number;
  riskScore: number;
  parentDecisionId?: string;
  agentId: string;
  taskId: string;
  timestamp?: string;
}

export interface DecisionListFilters {
  agent?: string;
  startTime?: string;
  endTime?: string;
  minConfidence?: number;
  maxConfidence?: number;
  minRisk?: number;
  maxRisk?: number;
}

export interface UpdateDecisionAssumptionInput {
  status: Exclude<DecisionAssumptionStatus, 'pending'>;
  note?: string;
}

export interface DecisionWithChain {
  decision: DecisionRecord;
  chain: DecisionRecord[];
}
