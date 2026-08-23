/**
 * Error Learning Service
 *
 * Structured workflow for analyzing agent failures, documenting root causes,
 * and preventing repeat mistakes. Inspired by @nateherk's Klouse demo.
 *
 * Flow:
 * 1. Detect error (from telemetry run.error event or manual trigger)
 * 2. Gather context (task, recent telemetry, agent info)
 * 3. Generate structured analysis
 * 4. Store as lesson learned on the task
 * 5. Add to knowledge base for future agents
 */

import { getTaskService } from './task-service.js';
import { createLogger } from '../lib/logger.js';
import {
  FileErrorAnalysisRepository,
  type ErrorAnalysisRepository,
} from '../storage/error-analysis-repository.js';

const log = createLogger('error-learning');

// ─── Types ───────────────────────────────────────────────────────

export interface ErrorContext {
  /** Task ID where the error occurred */
  taskId?: string;
  /** Agent that experienced the error */
  agent?: string;
  /** Error message */
  errorMessage: string;
  /** Error category */
  errorType?: ErrorType;
  /** Raw error details (stack trace, API response, etc.) */
  rawDetails?: string;
  /** What the agent was trying to do when it failed */
  attemptDescription?: string;
  /** Timestamp of the error */
  occurredAt?: string;
}

export type ErrorType =
  | 'runtime' // Code execution failure
  | 'api' // External API error
  | 'validation' // Input validation failure
  | 'timeout' // Operation timed out
  | 'permission' // Access denied
  | 'resource' // Resource not found / exhausted
  | 'model' // AI model error (rate limit, hallucination, etc.)
  | 'git' // Git operation failure
  | 'build' // Build/compile failure
  | 'test' // Test failure
  | 'configuration' // Config/env issue
  | 'unknown';

export interface ErrorAnalysis {
  id: string;
  /** Original error context */
  context: ErrorContext;
  /** Root cause analysis */
  rootCause: string;
  /** What went wrong in plain language */
  summary: string;
  /** Severity: how impactful was this error? */
  severity: 'low' | 'medium' | 'high' | 'critical';
  /** Options considered for fixing */
  optionsConsidered: Array<{
    option: string;
    pros: string[];
    cons: string[];
    chosen: boolean;
  }>;
  /** The chosen fix */
  chosenFix: string;
  /** Steps to prevent recurrence */
  preventionSteps: string[];
  /** Tags for categorization */
  tags: string[];
  /** Related task IDs */
  relatedTasks: string[];
  /** Was this a repeat of a previous error? */
  isRepeat: boolean;
  previousOccurrences: string[];
  /** Timestamps */
  analyzedAt: string;
  /** Agent that performed the analysis */
  analyzedBy?: string;
}

export interface ErrorLearningStats {
  totalAnalyses: number;
  byType: Record<string, number>;
  bySeverity: Record<string, number>;
  repeatRate: number;
  topPreventionSteps: Array<{ step: string; count: number }>;
  recentAnalyses: Array<{ id: string; summary: string; severity: string; analyzedAt: string }>;
}

// ─── Service ─────────────────────────────────────────────────────

export class ErrorLearningService {
  constructor(
    private readonly repository: ErrorAnalysisRepository = new FileErrorAnalysisRepository()
  ) {}

  /**
   * Submit an error for analysis. Returns a structured analysis.
   *
   * In a full implementation, this would spawn a sub-agent to analyze the error.
   * For now, it creates a structured analysis template that agents can fill in
   * or that can be completed via the API.
   */
  async submitError(context: ErrorContext): Promise<ErrorAnalysis> {
    const analysis = await this.repository.mutate((analyses) => {
      const previousOccurrences = this.findSimilarErrors(analyses, context);
      const created: ErrorAnalysis = {
        id: `err_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        context: {
          ...context,
          occurredAt: context.occurredAt || new Date().toISOString(),
        },
        rootCause: '',
        summary: `Error in ${context.taskId || 'unknown task'}: ${context.errorMessage.slice(0, 200)}`,
        severity: this.estimateSeverity(context),
        optionsConsidered: [],
        chosenFix: '',
        preventionSteps: [],
        tags: this.autoTag(context),
        relatedTasks: context.taskId ? [context.taskId] : [],
        isRepeat: previousOccurrences.length > 0,
        previousOccurrences: previousOccurrences.map((candidate) => candidate.id),
        analyzedAt: new Date().toISOString(),
        analyzedBy: context.agent,
      };
      return { analyses: [...analyses, created], result: created };
    });

    // If linked to a task, update the task's lessonsLearned
    if (context.taskId) {
      await this.linkToTask(context.taskId, analysis);
    }

    log.info(
      { analysisId: analysis.id, taskId: context.taskId, isRepeat: analysis.isRepeat },
      'Error analysis created'
    );

    return analysis;
  }

  /**
   * Update an analysis with root cause, fix, and prevention steps.
   * This is called after an agent has analyzed the error.
   */
  async updateAnalysis(
    id: string,
    update: Partial<
      Pick<
        ErrorAnalysis,
        | 'rootCause'
        | 'summary'
        | 'severity'
        | 'optionsConsidered'
        | 'chosenFix'
        | 'preventionSteps'
        | 'tags'
        | 'analyzedBy'
      >
    >
  ): Promise<ErrorAnalysis | null> {
    const analysis = await this.repository.mutate((analyses) => {
      const index = analyses.findIndex((candidate) => candidate.id === id);
      if (index === -1) {
        return { analyses, result: null as ErrorAnalysis | null };
      }
      const updated: ErrorAnalysis = {
        ...analyses[index],
        ...update,
        analyzedAt: new Date().toISOString(),
      };
      const next = [...analyses];
      next[index] = updated;
      return { analyses: next, result: updated as ErrorAnalysis | null };
    });
    if (!analysis) return null;

    // Update linked task
    if (analysis.relatedTasks.length > 0) {
      await this.linkToTask(analysis.relatedTasks[0], analysis);
    }

    log.info({ analysisId: id }, 'Error analysis updated');
    return analysis;
  }

  /**
   * Get a specific analysis.
   */
  async getAnalysis(id: string): Promise<ErrorAnalysis | null> {
    const analyses = await this.repository.read();
    return analyses.find((analysis) => analysis.id === id) || null;
  }

  /**
   * List analyses with optional filters.
   */
  async listAnalyses(filters?: {
    taskId?: string;
    errorType?: ErrorType;
    severity?: string;
    agent?: string;
    limit?: number;
  }): Promise<ErrorAnalysis[]> {
    let results = [...(await this.repository.read())];

    if (filters?.taskId) {
      const taskId = filters.taskId;
      results = results.filter((analysis) => analysis.relatedTasks.includes(taskId));
    }
    if (filters?.errorType) {
      results = results.filter((a) => a.context.errorType === filters.errorType);
    }
    if (filters?.severity) {
      results = results.filter((a) => a.severity === filters.severity);
    }
    if (filters?.agent) {
      results = results.filter(
        (a) => a.context.agent === filters.agent || a.analyzedBy === filters.agent
      );
    }

    // Most recent first
    results.sort((a, b) => new Date(b.analyzedAt).getTime() - new Date(a.analyzedAt).getTime());

    if (filters?.limit) {
      results = results.slice(0, filters.limit);
    }

    return results;
  }

  /**
   * Get aggregate statistics about error patterns.
   */
  async getStats(): Promise<ErrorLearningStats> {
    const analyses = await this.repository.read();

    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    const preventionCounts: Record<string, number> = {};

    for (const analysis of analyses) {
      // By type
      const type = analysis.context.errorType || 'unknown';
      byType[type] = (byType[type] || 0) + 1;

      // By severity
      bySeverity[analysis.severity] = (bySeverity[analysis.severity] || 0) + 1;

      // Prevention steps
      for (const step of analysis.preventionSteps) {
        preventionCounts[step] = (preventionCounts[step] || 0) + 1;
      }
    }

    const repeats = analyses.filter((analysis) => analysis.isRepeat).length;
    const repeatRate = analyses.length > 0 ? repeats / analyses.length : 0;

    const topPreventionSteps = Object.entries(preventionCounts)
      .map(([step, count]) => ({ step, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const recentAnalyses = analyses
      .slice(-5)
      .reverse()
      .map((a) => ({
        id: a.id,
        summary: a.summary,
        severity: a.severity,
        analyzedAt: a.analyzedAt,
      }));

    return {
      totalAnalyses: analyses.length,
      byType,
      bySeverity,
      repeatRate: Math.round(repeatRate * 100) / 100,
      topPreventionSteps,
      recentAnalyses,
    };
  }

  /**
   * Search analyses for patterns matching a new error.
   * Useful for agents to check "have we seen this before?"
   */
  async searchSimilar(errorMessage: string, limit = 5): Promise<ErrorAnalysis[]> {
    const analyses = await this.repository.read();

    // Simple keyword matching — could be replaced with embeddings
    const keywords = errorMessage
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3);

    const scored = analyses.map((analysis) => {
      const text =
        `${analysis.context.errorMessage} ${analysis.rootCause} ${analysis.summary}`.toLowerCase();
      const matches = keywords.filter((kw) => text.includes(kw)).length;
      return { analysis, score: matches / Math.max(keywords.length, 1) };
    });

    return scored
      .filter((s) => s.score > 0.2)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.analysis);
  }

  // ─── Private Helpers ─────────────────────────────────────────

  private findSimilarErrors(analyses: ErrorAnalysis[], context: ErrorContext): ErrorAnalysis[] {
    const msg = context.errorMessage.toLowerCase();
    return analyses.filter((a) => {
      const existingMsg = a.context.errorMessage.toLowerCase();
      // Check for significant overlap
      const words = msg.split(/\s+/).filter((w) => w.length > 3);
      const matches = words.filter((w) => existingMsg.includes(w)).length;
      return matches >= Math.min(3, words.length * 0.5);
    });
  }

  private estimateSeverity(context: ErrorContext): 'low' | 'medium' | 'high' | 'critical' {
    const msg = context.errorMessage.toLowerCase();

    if (msg.includes('security') || msg.includes('data loss') || msg.includes('corruption')) {
      return 'critical';
    }
    if (msg.includes('crash') || msg.includes('fatal') || msg.includes('unhandled')) {
      return 'high';
    }
    if (msg.includes('timeout') || msg.includes('rate limit') || msg.includes('failed')) {
      return 'medium';
    }
    return 'low';
  }

  private autoTag(context: ErrorContext): string[] {
    const tags: string[] = [];
    const msg = context.errorMessage.toLowerCase();

    if (context.errorType) tags.push(context.errorType);
    if (msg.includes('git')) tags.push('git');
    if (msg.includes('npm') || msg.includes('pnpm')) tags.push('package-manager');
    if (msg.includes('typescript') || msg.includes('type')) tags.push('typescript');
    if (msg.includes('api') || msg.includes('fetch') || msg.includes('request')) tags.push('api');
    if (msg.includes('permission') || msg.includes('auth')) tags.push('auth');
    if (msg.includes('rate limit') || msg.includes('quota')) tags.push('rate-limit');
    if (context.agent) tags.push(`agent:${context.agent}`);

    return [...new Set(tags)];
  }

  private async linkToTask(taskId: string, analysis: ErrorAnalysis): Promise<void> {
    try {
      const taskService = getTaskService();
      const task = await taskService.getTask(taskId);
      if (!task) return;

      const lessonEntry = [
        `### Error Analysis: ${analysis.id}`,
        `**Error**: ${analysis.context.errorMessage.slice(0, 200)}`,
        analysis.rootCause ? `**Root Cause**: ${analysis.rootCause}` : '',
        analysis.chosenFix ? `**Fix**: ${analysis.chosenFix}` : '',
        analysis.preventionSteps.length > 0
          ? `**Prevention**:\n${analysis.preventionSteps.map((s) => `- ${s}`).join('\n')}`
          : '',
        `*Analyzed: ${analysis.analyzedAt}*`,
      ]
        .filter(Boolean)
        .join('\n');

      const existing = task.lessonsLearned || '';
      const updated = existing ? `${existing}\n\n---\n\n${lessonEntry}` : lessonEntry;

      await taskService.updateTask(taskId, {
        lessonsLearned: updated,
        lessonTags: [...new Set([...(task.lessonTags || []), ...analysis.tags])],
      } as Record<string, unknown>);
    } catch (err) {
      log.warn({ err, taskId }, 'Failed to link analysis to task');
    }
  }
}

// Singleton
let instance: ErrorLearningService | null = null;

export function getErrorLearningService(): ErrorLearningService {
  if (!instance) {
    instance = new ErrorLearningService();
  }
  return instance;
}
