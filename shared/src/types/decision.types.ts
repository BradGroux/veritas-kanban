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

export type DecisionReviewSourceType =
  | 'task'
  | 'work-product'
  | 'workflow-gate'
  | 'adr'
  | 'command-center';

export type DecisionReviewStatus = 'collecting' | 'critiquing' | 'synthesized' | 'canceled';

export type DecisionReviewTurnPhase = 'initial' | 'critique';

export interface DecisionReviewParticipant {
  id: string;
  label: string;
  agentId?: string;
  profileId?: string;
  provider?: string;
  model?: string;
  role?: string;
}

export interface DecisionReviewTurn {
  id: string;
  participantId: string;
  phase: DecisionReviewTurnPhase;
  round: number;
  prompt: string;
  response: string;
  critiquesParticipantIds?: string[];
  agentId?: string;
  profileId?: string;
  provider?: string;
  model?: string;
  createdAt: string;
}

export interface DecisionReviewFinalPacket {
  recommendation: string;
  dissentingViews: string[];
  assumptions: string[];
  risks: string[];
  validationPlan: string[];
  followUpTasks: string[];
  confidenceLevel: number;
  riskScore: number;
  summary?: string;
  workProductId?: string;
  decisionId?: string;
  createdAt?: string;
}

export interface DecisionReviewSession {
  id: string;
  taskId: string;
  title: string;
  prompt: string;
  context: string;
  sourceType: DecisionReviewSourceType;
  sourceId?: string;
  templateId?: string;
  contextLimit?: number;
  rounds: number;
  participants: DecisionReviewParticipant[];
  status: DecisionReviewStatus;
  initialResponses: DecisionReviewTurn[];
  critiqueRounds: DecisionReviewTurn[];
  finalPacket?: DecisionReviewFinalPacket;
  createdAt: string;
  updatedAt: string;
  canceledAt?: string;
}

export interface CreateDecisionReviewSessionInput {
  taskId: string;
  title: string;
  prompt: string;
  context: string;
  sourceType?: DecisionReviewSourceType;
  sourceId?: string;
  templateId?: string;
  contextLimit?: number;
  rounds?: number;
  participants: DecisionReviewParticipant[];
}

export interface DecisionReviewListFilters {
  taskId?: string;
  status?: DecisionReviewStatus;
  limit?: number;
}

export interface RecordDecisionReviewTurnInput {
  participantId: string;
  prompt?: string;
  response: string;
  provider?: string;
  model?: string;
  agentId?: string;
  profileId?: string;
}

export interface RecordDecisionReviewCritiqueInput extends RecordDecisionReviewTurnInput {
  round: number;
  critiquesParticipantIds?: string[];
}

export interface FinalizeDecisionReviewSessionInput {
  recommendation: string;
  dissentingViews?: string[];
  assumptions?: string[];
  risks?: string[];
  validationPlan?: string[];
  followUpTasks?: string[];
  confidenceLevel?: number;
  riskScore?: number;
  summary?: string;
  attachWorkProduct?: boolean;
}
