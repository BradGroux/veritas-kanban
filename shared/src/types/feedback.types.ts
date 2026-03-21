import type { AgentType } from './task.types.js';

// ─── Category & Sentiment ────────────────────────────────────────────────────

export type FeedbackCategory = 'quality' | 'performance' | 'accuracy' | 'safety' | 'ux';

export type Sentiment = 'positive' | 'neutral' | 'negative';

// ─── Core Feedback types ─────────────────────────────────────────────────────

export interface Feedback {
  id: string;
  taskId: string;
  agent?: AgentType;
  rating: number; // 1–5 stars
  comment?: string;
  categories: FeedbackCategory[];
  sentiment: Sentiment;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFeedbackInput {
  taskId: string;
  agent?: string;
  rating: number;
  comment?: string;
  categories?: FeedbackCategory[];
}

export interface UpdateFeedbackInput {
  rating?: number;
  comment?: string;
  categories?: FeedbackCategory[];
  resolved?: boolean;
}

// ─── Query / Filter types ─────────────────────────────────────────────────────

/** Alias used in the web layer for list filtering */
export interface FeedbackListFilters {
  taskId?: string;
  agent?: string;
  category?: FeedbackCategory;
  sentiment?: Sentiment;
  resolved?: boolean;
  since?: string;
  until?: string;
  limit?: number;
}

/** Alias used in the web layer for analytics filtering */
export interface FeedbackAnalyticsFilters {
  taskId?: string;
  agent?: string;
  category?: FeedbackCategory;
  sentiment?: Sentiment;
  since?: string;
  until?: string;
}

export interface FeedbackQuery {
  taskId?: string;
  agent?: string;
  category?: FeedbackCategory;
  sentiment?: Sentiment;
  resolved?: boolean;
  /** ISO date string – only return feedback created on or after this */
  since?: string;
  /** ISO date string – only return feedback created on or before this */
  until?: string;
  limit?: number;
}

// ─── Analytics types ──────────────────────────────────────────────────────────

export interface RatingDistribution {
  star: number; // 1–5
  count: number;
  percentage: number;
}

export interface SatisfactionTrend {
  /** ISO date string (truncated to the day: YYYY-MM-DD) */
  date: string;
  averageRating: number;
  count: number;
}

export interface AgentFeedbackScore {
  agent: string;
  averageRating: number;
  totalFeedback: number;
  sentimentBreakdown: Record<Sentiment, number>;
}

export interface FeedbackAnalytics {
  totalFeedback: number;
  averageRating: number;
  ratingDistribution: RatingDistribution[];
  satisfactionTrends: SatisfactionTrend[];
  agentScores: AgentFeedbackScore[];
  sentimentBreakdown: Record<Sentiment, number>;
  categoryBreakdown: Record<FeedbackCategory, number>;
  unresolvedCount: number;
}
