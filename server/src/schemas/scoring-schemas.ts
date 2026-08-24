import { z } from 'zod';
import type {
  CreateScoringProfileInput,
  EvaluationRequest,
  Scorer,
  UpdateScoringProfileInput,
} from '@veritas-kanban/shared';
import {
  SCORING_MAX_ACTION_LENGTH,
  SCORING_MAX_OUTPUT_LENGTH,
  SCORING_MAX_PATTERN_LENGTH,
} from '../config/scoring.js';

const regexFlagsSchema = z
  .string()
  .max(8)
  .refine((flags) => {
    try {
      void new RegExp('', flags);
      return true;
    } catch {
      return false;
    }
  }, 'Regex flags must be a valid, non-duplicated JavaScript flag set');

const metadataFitsLimit = (value: Record<string, unknown>): boolean => {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength <= 64_000;
  } catch {
    return false;
  }
};

const baseScorerShape = {
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(256),
  description: z.string().max(2_000).optional(),
  weight: z.number().min(0).max(1_000_000),
  target: z.enum(['action', 'output', 'combined']).optional(),
};

export const scorerSchema: z.ZodType<Scorer> = z.discriminatedUnion('type', [
  z.object({
    ...baseScorerShape,
    type: z.literal('RegexMatch'),
    pattern: z.string().min(1).max(SCORING_MAX_PATTERN_LENGTH),
    flags: regexFlagsSchema.optional(),
    scoreOnMatch: z.number().min(0).max(1).optional(),
    scoreOnMiss: z.number().min(0).max(1).optional(),
    invert: z.boolean().optional(),
  }),
  z.object({
    ...baseScorerShape,
    type: z.literal('KeywordContains'),
    keywords: z.array(z.string().min(1).max(256)).min(1).max(64),
    matchMode: z.enum(['all', 'any']).optional(),
    caseSensitive: z.boolean().optional(),
    partialCredit: z.boolean().optional(),
  }),
  z.object({
    ...baseScorerShape,
    type: z.literal('NumericRange'),
    valuePath: z.string().min(1).max(256),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    scoreOnMiss: z.number().min(0).max(1).optional(),
  }),
  z.object({
    ...baseScorerShape,
    type: z.literal('OccurrenceRatio'),
    needles: z.array(z.string().min(1).max(64)).min(1).max(32),
    caseSensitive: z.boolean().optional(),
    wholeWord: z.boolean().optional(),
    denominator: z.number().positive().max(1_000_000).optional(),
    denominatorPath: z.string().min(1).max(256).optional(),
    denominatorScale: z.number().positive().max(1_000_000).optional(),
    minimumDenominator: z.number().positive().max(1_000_000).optional(),
    invert: z.boolean().optional(),
  }),
]);

const createScoringProfileObjectSchema = z.object({
  name: z.string().min(1).max(256),
  description: z.string().max(4_000).optional(),
  scorers: z.array(scorerSchema).min(1).max(64),
  compositeMethod: z.enum(['weightedAvg', 'minimum', 'geometricMean']),
});

export const createScoringProfileSchema: z.ZodType<CreateScoringProfileInput> =
  createScoringProfileObjectSchema;

export const updateScoringProfileSchema: z.ZodType<UpdateScoringProfileInput> =
  createScoringProfileObjectSchema.partial();

export const evaluateScoringSchema: z.ZodType<EvaluationRequest> = z.object({
  profileId: z.string().min(1).max(128),
  action: z.string().max(SCORING_MAX_ACTION_LENGTH).optional(),
  output: z.string().min(1).max(SCORING_MAX_OUTPUT_LENGTH),
  agent: z.string().optional(),
  taskId: z.string().max(128).optional(),
  metadata: z
    .record(z.string(), z.unknown())
    .refine(metadataFitsLimit, 'Metadata must be JSON serializable and cannot exceed 64,000 bytes')
    .optional(),
});
