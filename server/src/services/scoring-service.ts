import { join } from 'path';
import { nanoid } from 'nanoid';
import type {
  CreateScoringProfileInput,
  CustomExpressionScorer,
  EvaluationDimensionScore,
  EvaluationHistoryQuery,
  EvaluationRequest,
  EvaluationResult,
  KeywordContainsScorer,
  NumericRangeScorer,
  RegexMatchScorer,
  Scorer,
  ScoringProfile,
} from '@veritas-kanban/shared';
import { fileExists, mkdir, readdir, readFile, unlink, writeFile } from '../storage/fs-helpers.js';
import { withFileLock } from './file-lock.js';
import { createLogger } from '../lib/logger.js';
import { ensureWithinBase, validatePathSegment } from '../utils/sanitize.js';
import { NotFoundError } from '../middleware/error-handler.js';

const log = createLogger('scoring-service');

interface EvaluationContext {
  action: string;
  output: string;
  combined: string;
  metadata: Record<string, unknown>;
}

const clampScore = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
};

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const getTargetText = (scorer: Scorer, context: EvaluationContext): string => {
  switch (scorer.target) {
    case 'action':
      return context.action;
    case 'combined':
      return context.combined;
    case 'output':
    default:
      return context.output;
  }
};

const getValueAtPath = (root: Record<string, unknown>, path: string): unknown => {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (current && typeof current === 'object' && segment in current) {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, root);
};

const BUILT_IN_PROFILES: Array<Omit<ScoringProfile, 'created' | 'updated'>> = [
  {
    id: 'code-quality',
    name: 'Code Quality',
    description: 'Checks for verification language, test mentions, and unresolved TODO markers.',
    builtIn: true,
    compositeMethod: 'weightedAvg',
    scorers: [
      {
        id: 'mentions-verification',
        name: 'Mentions verification',
        type: 'KeywordContains',
        target: 'combined',
        weight: 0.35,
        keywords: ['test', 'tests', 'lint', 'verified', 'validation'],
        matchMode: 'any',
        partialCredit: true,
      },
      {
        id: 'avoids-todo',
        name: 'Avoids TODO/FIXME',
        type: 'RegexMatch',
        target: 'output',
        weight: 0.3,
        pattern: '\\b(?:TODO|FIXME|XXX)\\b',
        invert: true,
      },
      {
        id: 'balanced-length',
        name: 'Balanced response length',
        type: 'NumericRange',
        weight: 0.35,
        valuePath: 'metadata.outputWordCount',
        min: 40,
        max: 1200,
      },
    ],
  },
  {
    id: 'task-efficiency',
    name: 'Task Efficiency',
    description: 'Rewards concise, action-oriented output and penalizes unnecessary verbosity.',
    builtIn: true,
    compositeMethod: 'geometricMean',
    scorers: [
      {
        id: 'action-oriented',
        name: 'Action-oriented phrasing',
        type: 'KeywordContains',
        target: 'combined',
        weight: 0.4,
        keywords: ['implemented', 'updated', 'fixed', 'verified', 'added'],
        matchMode: 'any',
        partialCredit: true,
      },
      {
        id: 'efficient-size',
        name: 'Efficient size',
        type: 'NumericRange',
        weight: 0.35,
        valuePath: 'metadata.totalWordCount',
        min: 20,
        max: 900,
      },
      {
        id: 'limited-filler',
        name: 'Limited filler',
        type: 'CustomExpression',
        weight: 0.25,
        expression:
          'Math.max(0, 1 - (((output.match(/\\b(?:just|really|very|basically|simply)\\b/gi) || []).length) / Math.max(1, metadata.outputWordCount / 50)))',
      },
    ],
  },
  {
    id: 'convention-compliance',
    name: 'Convention Compliance',
    description: 'Checks for VK-style references, testing disclosure, and structured output.',
    builtIn: true,
    compositeMethod: 'minimum',
    scorers: [
      {
        id: 'file-references',
        name: 'Includes file references',
        type: 'RegexMatch',
        target: 'output',
        weight: 0.34,
        pattern: '\\[[^\\]]+\\]\\(/[^)]+\\)',
      },
      {
        id: 'mentions-test-status',
        name: 'Mentions test status',
        type: 'KeywordContains',
        target: 'output',
        weight: 0.33,
        keywords: ['tested', 'verification', 'not run', 'lint', 'vitest'],
        matchMode: 'any',
        partialCredit: true,
      },
      {
        id: 'has-structure',
        name: 'Has concise structure',
        type: 'CustomExpression',
        target: 'output',
        weight: 0.33,
        expression:
          'Math.min(1, ((output.match(/\\n/g) || []).length + (output.match(/\\./g) || []).length) / 4)',
      },
    ],
  },
];

export class ScoringService {
  private readonly profilesDir = join(process.cwd(), 'storage', 'scoring');
  private readonly evaluationsDir = join(process.cwd(), 'storage', 'evaluations');
  private builtInsSeeded = false;

  private async ensureDirs(): Promise<void> {
    await mkdir(this.profilesDir, { recursive: true });
    await mkdir(this.evaluationsDir, { recursive: true });
    await this.seedBuiltIns();
  }

  private async seedBuiltIns(): Promise<void> {
    if (this.builtInsSeeded) return;

    for (const profile of BUILT_IN_PROFILES) {
      const filePath = this.profilePath(profile.id);
      if (await fileExists(filePath)) continue;

      const now = new Date().toISOString();
      await writeFile(
        filePath,
        JSON.stringify({ ...profile, created: now, updated: now }, null, 2),
        'utf-8'
      );
    }

    this.builtInsSeeded = true;
  }

  private profilePath(id: string): string {
    validatePathSegment(id);
    const filePath = join(this.profilesDir, `${id}.json`);
    return ensureWithinBase(this.profilesDir, filePath);
  }

  private evaluationPath(id: string): string {
    validatePathSegment(id);
    const filePath = join(this.evaluationsDir, `${id}.json`);
    return ensureWithinBase(this.evaluationsDir, filePath);
  }

  private async readProfileFile(filePath: string): Promise<ScoringProfile | null> {
    try {
      const content = await readFile(filePath, 'utf-8');
      return JSON.parse(content) as ScoringProfile;
    } catch (error) {
      log.error({ err: error, filePath }, 'Failed to read scoring profile');
      return null;
    }
  }

  private async readEvaluationFile(filePath: string): Promise<EvaluationResult | null> {
    try {
      const content = await readFile(filePath, 'utf-8');
      return JSON.parse(content) as EvaluationResult;
    } catch (error) {
      log.error({ err: error, filePath }, 'Failed to read evaluation result');
      return null;
    }
  }

  async listProfiles(): Promise<ScoringProfile[]> {
    await this.ensureDirs();

    const files = await readdir(this.profilesDir);
    const profiles = await Promise.all(
      files
        .filter((file) => file.endsWith('.json'))
        .map((file) => this.readProfileFile(join(this.profilesDir, file)))
    );

    return profiles
      .filter((profile): profile is ScoringProfile => Boolean(profile))
      .sort((a, b) => {
        if (Boolean(b.builtIn) !== Boolean(a.builtIn)) {
          return Number(Boolean(b.builtIn)) - Number(Boolean(a.builtIn));
        }
        return a.name.localeCompare(b.name);
      });
  }

  async getProfile(id: string): Promise<ScoringProfile | null> {
    await this.ensureDirs();

    const filePath = this.profilePath(id);
    if (!(await fileExists(filePath))) return null;
    return this.readProfileFile(filePath);
  }

  async createProfile(input: CreateScoringProfileInput): Promise<ScoringProfile> {
    await this.ensureDirs();

    const now = new Date().toISOString();
    const id = `${slugify(input.name)}-${nanoid(6)}`;
    const profile: ScoringProfile = {
      id,
      name: input.name,
      description: input.description,
      scorers: input.scorers,
      compositeMethod: input.compositeMethod,
      builtIn: false,
      created: now,
      updated: now,
    };

    const filePath = this.profilePath(id);
    await withFileLock(filePath, async () => {
      await writeFile(filePath, JSON.stringify(profile, null, 2), 'utf-8');
    });

    return profile;
  }

  async updateProfile(
    id: string,
    input: Partial<CreateScoringProfileInput>
  ): Promise<ScoringProfile | null> {
    await this.ensureDirs();

    const existing = await this.getProfile(id);
    if (!existing) return null;
    if (existing.builtIn) {
      throw new Error('Built-in scoring profiles cannot be modified');
    }

    const updated: ScoringProfile = {
      ...existing,
      ...input,
      id: existing.id,
      builtIn: existing.builtIn,
      updated: new Date().toISOString(),
    };

    const filePath = this.profilePath(id);
    await withFileLock(filePath, async () => {
      await writeFile(filePath, JSON.stringify(updated, null, 2), 'utf-8');
    });

    return updated;
  }

  async deleteProfile(id: string): Promise<boolean> {
    await this.ensureDirs();

    const existing = await this.getProfile(id);
    if (!existing) return false;
    if (existing.builtIn) {
      throw new Error('Built-in scoring profiles cannot be deleted');
    }

    await unlink(this.profilePath(id));
    return true;
  }

  private evaluateRegex(
    scorer: RegexMatchScorer,
    context: EvaluationContext
  ): EvaluationDimensionScore {
    const text = getTargetText(scorer, context);
    const regex = new RegExp(scorer.pattern, scorer.flags);
    const didMatch = regex.test(text);
    const matched = scorer.invert ? !didMatch : didMatch;
    const score = matched ? (scorer.scoreOnMatch ?? 1) : (scorer.scoreOnMiss ?? 0);

    return {
      scorerId: scorer.id,
      scorerName: scorer.name,
      scorerType: scorer.type,
      weight: scorer.weight,
      score: clampScore(score),
      matched,
      explanation: matched
        ? `Pattern ${scorer.invert ? 'not found' : 'matched'}`
        : `Pattern ${scorer.invert ? 'found' : 'not found'}`,
    };
  }

  private evaluateKeywords(
    scorer: KeywordContainsScorer,
    context: EvaluationContext
  ): EvaluationDimensionScore {
    const text = getTargetText(scorer, context);
    const haystack = scorer.caseSensitive ? text : text.toLowerCase();
    const keywords = scorer.caseSensitive
      ? scorer.keywords
      : scorer.keywords.map((keyword) => keyword.toLowerCase());

    const matches = keywords.filter((keyword) => haystack.includes(keyword));
    const requiredCount = scorer.matchMode === 'all' ? keywords.length : 1;
    const matched =
      scorer.matchMode === 'all' ? matches.length === keywords.length : matches.length >= 1;
    const partialScore =
      scorer.partialCredit && keywords.length > 0
        ? matches.length / keywords.length
        : matched
          ? 1
          : 0;

    return {
      scorerId: scorer.id,
      scorerName: scorer.name,
      scorerType: scorer.type,
      weight: scorer.weight,
      score: clampScore(matched ? 1 : partialScore),
      matched: matches.length >= requiredCount,
      explanation:
        matches.length > 0 ? `Matched keywords: ${matches.join(', ')}` : 'No keywords matched',
    };
  }

  private evaluateNumeric(
    scorer: NumericRangeScorer,
    context: EvaluationContext
  ): EvaluationDimensionScore {
    const rawValue = getValueAtPath(
      {
        action: context.action,
        output: context.output,
        metadata: context.metadata,
      },
      scorer.valuePath
    );
    const numericValue = typeof rawValue === 'number' ? rawValue : Number(rawValue);
    const meetsMin = scorer.min === undefined || numericValue >= scorer.min;
    const meetsMax = scorer.max === undefined || numericValue <= scorer.max;
    const matched = Number.isFinite(numericValue) && meetsMin && meetsMax;

    return {
      scorerId: scorer.id,
      scorerName: scorer.name,
      scorerType: scorer.type,
      weight: scorer.weight,
      score: matched ? 1 : clampScore(scorer.scoreOnMiss ?? 0),
      matched,
      explanation: Number.isFinite(numericValue)
        ? `Observed value ${numericValue}`
        : 'No numeric value available',
    };
  }

  private evaluateCustom(
    scorer: CustomExpressionScorer,
    context: EvaluationContext
  ): EvaluationDimensionScore {
    const evaluator = new Function(
      'action',
      'output',
      'combined',
      'metadata',
      `return (${scorer.expression});`
    ) as (
      action: string,
      output: string,
      combined: string,
      metadata: Record<string, unknown>
    ) => unknown;

    let rawResult: unknown = 0;
    try {
      rawResult = evaluator(context.action, context.output, context.combined, context.metadata);
    } catch (error) {
      log.warn({ err: error, scorerId: scorer.id }, 'Custom scorer expression failed');
    }

    const score =
      typeof rawResult === 'boolean'
        ? rawResult
          ? 1
          : 0
        : typeof rawResult === 'number'
          ? rawResult
          : 0;

    return {
      scorerId: scorer.id,
      scorerName: scorer.name,
      scorerType: scorer.type,
      weight: scorer.weight,
      score: clampScore(score),
      matched: clampScore(score) > 0,
      explanation: `Custom expression returned ${String(rawResult)}`,
    };
  }

  private evaluateScorer(scorer: Scorer, context: EvaluationContext): EvaluationDimensionScore {
    switch (scorer.type) {
      case 'RegexMatch':
        return this.evaluateRegex(scorer, context);
      case 'KeywordContains':
        return this.evaluateKeywords(scorer, context);
      case 'NumericRange':
        return this.evaluateNumeric(scorer, context);
      case 'CustomExpression':
        return this.evaluateCustom(scorer, context);
    }
  }

  private computeComposite(profile: ScoringProfile, scores: EvaluationDimensionScore[]): number {
    if (scores.length === 0) return 0;

    if (profile.compositeMethod === 'minimum') {
      return clampScore(Math.min(...scores.map((score) => score.score)));
    }

    const totalWeight = scores.reduce((sum, score) => sum + Math.max(score.weight, 0), 0) || 1;

    if (profile.compositeMethod === 'geometricMean') {
      const weightedLogSum = scores.reduce((sum, score) => {
        if (score.score <= 0) return Number.NEGATIVE_INFINITY;
        return sum + Math.max(score.weight, 0) * Math.log(score.score);
      }, 0);

      if (!Number.isFinite(weightedLogSum)) return 0;
      return clampScore(Math.exp(weightedLogSum / totalWeight));
    }

    const weightedScore = scores.reduce(
      (sum, score) => sum + score.score * Math.max(score.weight, 0),
      0
    );
    return clampScore(weightedScore / totalWeight);
  }

  private buildContext(input: EvaluationRequest): EvaluationContext {
    const action = input.action ?? '';
    const output = input.output ?? '';
    const combined = [action, output].filter(Boolean).join('\n');
    const metadata = {
      ...(input.metadata ?? {}),
      actionLength: action.length,
      outputLength: output.length,
      totalLength: combined.length,
      actionWordCount: action.trim() ? action.trim().split(/\s+/).length : 0,
      outputWordCount: output.trim() ? output.trim().split(/\s+/).length : 0,
      totalWordCount: combined.trim() ? combined.trim().split(/\s+/).length : 0,
      outputLineCount: output ? output.split('\n').length : 0,
    };

    return { action, output, combined, metadata };
  }

  async evaluate(input: EvaluationRequest): Promise<EvaluationResult> {
    await this.ensureDirs();

    const profile = await this.getProfile(input.profileId);
    if (!profile) {
      throw new NotFoundError('Scoring profile not found');
    }

    const context = this.buildContext(input);
    const scores = profile.scorers.map((scorer) => this.evaluateScorer(scorer, context));
    const compositeScore = this.computeComposite(profile, scores);
    const result: EvaluationResult = {
      id: `evaluation_${Date.now()}_${nanoid(6)}`,
      profileId: profile.id,
      profileName: profile.name,
      action: input.action,
      output: input.output,
      agent: input.agent,
      taskId: input.taskId,
      metadata: context.metadata,
      scores,
      compositeScore,
      created: new Date().toISOString(),
    };

    const filePath = this.evaluationPath(result.id);
    await withFileLock(filePath, async () => {
      await writeFile(filePath, JSON.stringify(result, null, 2), 'utf-8');
    });

    return result;
  }

  async getHistory(query: EvaluationHistoryQuery = {}): Promise<EvaluationResult[]> {
    await this.ensureDirs();

    const files = await readdir(this.evaluationsDir);
    const limit = query.limit ?? 200;
    const results = await Promise.all(
      files
        .filter((file) => file.endsWith('.json'))
        .map((file) => this.readEvaluationFile(join(this.evaluationsDir, file)))
    );

    return results
      .filter((result): result is EvaluationResult => Boolean(result))
      .filter((result) => !query.profileId || result.profileId === query.profileId)
      .filter((result) => !query.agent || result.agent === query.agent)
      .filter((result) => !query.taskId || result.taskId === query.taskId)
      .sort((a, b) => b.created.localeCompare(a.created))
      .slice(0, limit);
  }
}

export const scoringService = new ScoringService();
