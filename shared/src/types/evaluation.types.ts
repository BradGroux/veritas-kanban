import type { AgentType } from './task.types.js';

export type ScorerType = 'RegexMatch' | 'KeywordContains' | 'NumericRange' | 'CustomExpression';

export type ScoringCompositeMethod = 'weightedAvg' | 'minimum' | 'geometricMean';

export type ScoringTarget = 'action' | 'output' | 'combined';

interface BaseScorer {
  id: string;
  name: string;
  description?: string;
  weight: number;
  target?: ScoringTarget;
}

export interface RegexMatchScorer extends BaseScorer {
  type: 'RegexMatch';
  pattern: string;
  flags?: string;
  scoreOnMatch?: number;
  scoreOnMiss?: number;
  invert?: boolean;
}

export interface KeywordContainsScorer extends BaseScorer {
  type: 'KeywordContains';
  keywords: string[];
  matchMode?: 'all' | 'any';
  caseSensitive?: boolean;
  partialCredit?: boolean;
}

export interface NumericRangeScorer extends BaseScorer {
  type: 'NumericRange';
  valuePath: string;
  min?: number;
  max?: number;
  scoreOnMiss?: number;
}

export interface CustomExpressionScorer extends BaseScorer {
  type: 'CustomExpression';
  expression: string;
}

export type Scorer =
  | RegexMatchScorer
  | KeywordContainsScorer
  | NumericRangeScorer
  | CustomExpressionScorer;

export interface ScoringProfile {
  id: string;
  name: string;
  description?: string;
  scorers: Scorer[];
  compositeMethod: ScoringCompositeMethod;
  builtIn?: boolean;
  created: string;
  updated: string;
}

export interface CreateScoringProfileInput {
  name: string;
  description?: string;
  scorers: Scorer[];
  compositeMethod: ScoringCompositeMethod;
}

export interface UpdateScoringProfileInput {
  name?: string;
  description?: string;
  scorers?: Scorer[];
  compositeMethod?: ScoringCompositeMethod;
}

export interface EvaluationRequest {
  profileId: string;
  action?: string;
  output: string;
  agent?: AgentType;
  taskId?: string;
  metadata?: Record<string, unknown>;
}

export interface EvaluationDimensionScore {
  scorerId: string;
  scorerName: string;
  scorerType: ScorerType;
  weight: number;
  score: number;
  matched: boolean;
  explanation: string;
}

export interface EvaluationResult {
  id: string;
  profileId: string;
  profileName: string;
  action?: string;
  output: string;
  agent?: AgentType;
  taskId?: string;
  metadata?: Record<string, unknown>;
  scores: EvaluationDimensionScore[];
  compositeScore: number;
  created: string;
}

export interface EvaluationHistoryQuery {
  profileId?: string;
  agent?: string;
  taskId?: string;
  limit?: number;
}
