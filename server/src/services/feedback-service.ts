import { join } from 'path';
import { nanoid } from 'nanoid';
import type {
  AgentFeedbackScore,
  CreateFeedbackInput,
  Feedback,
  FeedbackAnalytics,
  FeedbackCategory,
  FeedbackQuery,
  RatingDistribution,
  SatisfactionTrend,
  Sentiment,
  UpdateFeedbackInput,
} from '@veritas-kanban/shared';
import { fileExists, mkdir, readdir, readFile, unlink, writeFile } from '../storage/fs-helpers.js';
import { withFileLock } from './file-lock.js';
import { createLogger } from '../lib/logger.js';
import { ensureWithinBase, validatePathSegment } from '../utils/sanitize.js';
import { NotFoundError } from '../middleware/error-handler.js';

const log = createLogger('feedback-service');

// ─── Sentiment Analysis ───────────────────────────────────────────────────────

const POSITIVE_KEYWORDS = [
  'great',
  'excellent',
  'amazing',
  'awesome',
  'perfect',
  'fantastic',
  'outstanding',
  'brilliant',
  'superb',
  'good',
  'well',
  'helpful',
  'accurate',
  'fast',
  'correct',
  'love',
  'wonderful',
  'impressive',
  'solid',
  'nice',
  'clear',
  'concise',
  'efficient',
  'effective',
  'resolved',
  'works',
  'working',
  'fixed',
  'improved',
  'appreciate',
  'thanks',
  'thank',
];

const NEGATIVE_KEYWORDS = [
  'bad',
  'terrible',
  'awful',
  'horrible',
  'poor',
  'wrong',
  'incorrect',
  'slow',
  'broken',
  'fail',
  'failed',
  'failure',
  'error',
  'bug',
  'issue',
  'problem',
  'crash',
  'worst',
  'useless',
  'confusing',
  'confused',
  'inaccurate',
  'misleading',
  'frustrating',
  'disappointed',
  'disappointing',
  'miss',
  'missed',
  'incomplete',
  'wrong',
  'never',
  'not working',
  'doesnt work',
  "doesn't work",
  "can't",
  'cannot',
];

export function detectSentiment(text: string): Sentiment {
  if (!text || text.trim().length === 0) return 'neutral';

  const lower = text.toLowerCase();
  let positiveScore = 0;
  let negativeScore = 0;

  for (const word of POSITIVE_KEYWORDS) {
    if (lower.includes(word)) positiveScore++;
  }
  for (const phrase of NEGATIVE_KEYWORDS) {
    if (lower.includes(phrase)) negativeScore++;
  }

  if (positiveScore === 0 && negativeScore === 0) return 'neutral';
  if (positiveScore > negativeScore) return 'positive';
  if (negativeScore > positiveScore) return 'negative';
  return 'neutral';
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class FeedbackService {
  private readonly feedbackDir = join(process.cwd(), 'storage', 'feedback');

  private async ensureDirs(): Promise<void> {
    await mkdir(this.feedbackDir, { recursive: true });
  }

  private feedbackPath(id: string): string {
    validatePathSegment(id);
    const filePath = join(this.feedbackDir, `${id}.json`);
    return ensureWithinBase(this.feedbackDir, filePath);
  }

  private async readFeedbackFile(filePath: string): Promise<Feedback | null> {
    try {
      const content = await readFile(filePath, 'utf-8');
      return JSON.parse(content) as Feedback;
    } catch (error) {
      log.error({ err: error, filePath }, 'Failed to read feedback file');
      return null;
    }
  }

  async list(query: FeedbackQuery = {}): Promise<Feedback[]> {
    await this.ensureDirs();

    const files = await readdir(this.feedbackDir);
    const limit = query.limit ?? 500;

    const items = await Promise.all(
      files
        .filter((file) => file.endsWith('.json'))
        .map((file) => this.readFeedbackFile(join(this.feedbackDir, file)))
    );

    return items
      .filter((item): item is Feedback => Boolean(item))
      .filter((item) => !query.taskId || item.taskId === query.taskId)
      .filter((item) => !query.agent || item.agent === query.agent)
      .filter((item) => !query.category || item.categories.includes(query.category))
      .filter((item) => !query.sentiment || item.sentiment === query.sentiment)
      .filter((item) => query.resolved === undefined || item.resolved === query.resolved)
      .filter((item) => !query.since || item.createdAt >= query.since)
      .filter((item) => !query.until || item.createdAt <= query.until)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async get(id: string): Promise<Feedback | null> {
    await this.ensureDirs();
    const filePath = this.feedbackPath(id);
    if (!(await fileExists(filePath))) return null;
    return this.readFeedbackFile(filePath);
  }

  async create(input: CreateFeedbackInput): Promise<Feedback> {
    await this.ensureDirs();

    const now = new Date().toISOString();
    const id = `feedback_${Date.now()}_${nanoid(6)}`;
    const sentiment = detectSentiment(input.comment ?? '');

    const feedback: Feedback = {
      id,
      taskId: input.taskId,
      agent: input.agent as Feedback['agent'],
      rating: input.rating,
      comment: input.comment,
      categories: input.categories ?? [],
      sentiment,
      resolved: false,
      createdAt: now,
      updatedAt: now,
    };

    const filePath = this.feedbackPath(id);
    await withFileLock(filePath, async () => {
      await writeFile(filePath, JSON.stringify(feedback, null, 2), 'utf-8');
    });

    log.info({ id, taskId: input.taskId, sentiment }, 'Feedback created');
    return feedback;
  }

  async update(id: string, input: UpdateFeedbackInput): Promise<Feedback | null> {
    await this.ensureDirs();

    const existing = await this.get(id);
    if (!existing) return null;

    const updated: Feedback = {
      ...existing,
      ...input,
      id: existing.id,
      taskId: existing.taskId,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
      // Re-run sentiment if comment changed
      sentiment:
        input.comment !== undefined
          ? detectSentiment(input.comment)
          : existing.sentiment,
    };

    const filePath = this.feedbackPath(id);
    await withFileLock(filePath, async () => {
      await writeFile(filePath, JSON.stringify(updated, null, 2), 'utf-8');
    });

    return updated;
  }

  async delete(id: string): Promise<boolean> {
    await this.ensureDirs();
    const filePath = this.feedbackPath(id);
    if (!(await fileExists(filePath))) return false;
    await unlink(filePath);
    return true;
  }

  async getAnalytics(query: Omit<FeedbackQuery, 'limit'> = {}): Promise<FeedbackAnalytics> {
    const allItems = await this.list({ ...query, limit: 10000 });

    const totalFeedback = allItems.length;
    const averageRating =
      totalFeedback > 0
        ? allItems.reduce((sum, item) => sum + item.rating, 0) / totalFeedback
        : 0;

    // Rating distribution (1–5)
    const ratingCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const item of allItems) {
      ratingCounts[item.rating] = (ratingCounts[item.rating] ?? 0) + 1;
    }
    const ratingDistribution: RatingDistribution[] = [1, 2, 3, 4, 5].map((star) => ({
      star,
      count: ratingCounts[star] ?? 0,
      percentage: totalFeedback > 0 ? ((ratingCounts[star] ?? 0) / totalFeedback) * 100 : 0,
    }));

    // Satisfaction trends by day
    const dayMap = new Map<string, { total: number; count: number }>();
    for (const item of allItems) {
      const day = item.createdAt.slice(0, 10); // YYYY-MM-DD
      const entry = dayMap.get(day) ?? { total: 0, count: 0 };
      entry.total += item.rating;
      entry.count++;
      dayMap.set(day, entry);
    }
    const satisfactionTrends: SatisfactionTrend[] = Array.from(dayMap.entries())
      .map(([date, { total, count }]) => ({
        date,
        averageRating: total / count,
        count,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Per-agent scores
    const agentMap = new Map<
      string,
      { total: number; count: number; sentiments: Record<Sentiment, number> }
    >();
    for (const item of allItems) {
      const agentKey = item.agent ?? 'unknown';
      const entry = agentMap.get(agentKey) ?? {
        total: 0,
        count: 0,
        sentiments: { positive: 0, neutral: 0, negative: 0 },
      };
      entry.total += item.rating;
      entry.count++;
      entry.sentiments[item.sentiment]++;
      agentMap.set(agentKey, entry);
    }
    const agentScores: AgentFeedbackScore[] = Array.from(agentMap.entries())
      .map(([agent, { total, count, sentiments }]) => ({
        agent,
        averageRating: total / count,
        totalFeedback: count,
        sentimentBreakdown: sentiments,
      }))
      .sort((a, b) => b.totalFeedback - a.totalFeedback);

    // Sentiment breakdown
    const sentimentBreakdown: Record<Sentiment, number> = {
      positive: 0,
      neutral: 0,
      negative: 0,
    };
    for (const item of allItems) {
      sentimentBreakdown[item.sentiment]++;
    }

    // Category breakdown
    const categoryBreakdown: Record<FeedbackCategory, number> = {
      quality: 0,
      performance: 0,
      accuracy: 0,
      safety: 0,
      ux: 0,
    };
    for (const item of allItems) {
      for (const cat of item.categories) {
        categoryBreakdown[cat]++;
      }
    }

    const unresolvedCount = allItems.filter((item) => !item.resolved).length;

    return {
      totalFeedback,
      averageRating,
      ratingDistribution,
      satisfactionTrends,
      agentScores,
      sentimentBreakdown,
      categoryBreakdown,
      unresolvedCount,
    };
  }

  async listUnresolved(limit = 100): Promise<Feedback[]> {
    return this.list({ resolved: false, limit });
  }
}

export const feedbackService = new FeedbackService();
