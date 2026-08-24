import { Worker } from 'node:worker_threads';
import type { OccurrenceRatioScorer, ScoringTarget } from '@veritas-kanban/shared';
import { ValidationError } from '../middleware/error-handler.js';
import {
  SCORING_MAX_COMBINED_LENGTH,
  SCORING_MAX_PATTERN_LENGTH,
  SCORING_REGEX_MAX_CONCURRENCY,
  SCORING_REGEX_MAX_QUEUE,
  SCORING_REGEX_TIMEOUT_MS,
} from '../config/scoring.js';

let activeRegexWorkers = 0;
const regexWorkerWaiters: Array<() => void> = [];

async function acquireRegexWorkerSlot(): Promise<void> {
  if (activeRegexWorkers < SCORING_REGEX_MAX_CONCURRENCY) {
    activeRegexWorkers += 1;
    return;
  }
  if (regexWorkerWaiters.length >= SCORING_REGEX_MAX_QUEUE) {
    throw new ValidationError('Regex evaluation capacity is temporarily exhausted');
  }
  await new Promise<void>((resolve) => regexWorkerWaiters.push(resolve));
}

function releaseRegexWorkerSlot(): void {
  const next = regexWorkerWaiters.shift();
  if (next) {
    next();
    return;
  }
  activeRegexWorkers = Math.max(0, activeRegexWorkers - 1);
}

export function getScoringRegexRuntimeSnapshot(): {
  activeWorkers: number;
  queuedEvaluations: number;
} {
  return {
    activeWorkers: activeRegexWorkers,
    queuedEvaluations: regexWorkerWaiters.length,
  };
}

const REGEX_WORKER_SOURCE = String.raw`
  const { parentPort, workerData } = require('node:worker_threads');
  try {
    const regex = new RegExp(workerData.pattern, workerData.flags);
    parentPort.postMessage({ matched: regex.test(workerData.text) });
  } catch (error) {
    parentPort.postMessage({ error: error instanceof Error ? error.message : 'Invalid pattern' });
  }
`;

export interface ScoringRuntimeContext {
  action: string;
  output: string;
  combined: string;
  metadata: Record<string, unknown>;
}

function targetText(target: ScoringTarget | undefined, context: ScoringRuntimeContext): string {
  switch (target) {
    case 'action':
      return context.action;
    case 'combined':
      return context.combined;
    case 'output':
    default:
      return context.output;
  }
}

function valueAtPath(root: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (
      !current ||
      typeof current !== 'object' ||
      segment === '__proto__' ||
      segment === 'prototype' ||
      segment === 'constructor' ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      return undefined;
    }
    return (current as Record<string, unknown>)[segment];
  }, root);
}

function isWordCharacter(value: string | undefined): boolean {
  return value !== undefined && /[A-Za-z0-9_]/.test(value);
}

function countOccurrences(text: string, needle: string, wholeWord: boolean): number {
  let count = 0;
  let offset = 0;
  while (offset <= text.length - needle.length) {
    const index = text.indexOf(needle, offset);
    if (index < 0) break;
    const before = index > 0 ? text[index - 1] : undefined;
    const after = text[index + needle.length];
    if (!wholeWord || (!isWordCharacter(before) && !isWordCharacter(after))) count += 1;
    offset = index + Math.max(needle.length, 1);
  }
  return count;
}

export function evaluateOccurrenceRatio(
  scorer: OccurrenceRatioScorer,
  context: ScoringRuntimeContext
): number {
  const rawText = targetText(scorer.target, context);
  const text = scorer.caseSensitive ? rawText : rawText.toLowerCase();
  const needles = scorer.caseSensitive
    ? scorer.needles
    : scorer.needles.map((needle) => needle.toLowerCase());
  const occurrences = needles.reduce(
    (sum, needle) => sum + countOccurrences(text, needle, scorer.wholeWord === true),
    0
  );
  const pathValue = scorer.denominatorPath
    ? valueAtPath(
        { action: context.action, output: context.output, metadata: context.metadata },
        scorer.denominatorPath
      )
    : undefined;
  const numericPathValue = typeof pathValue === 'number' ? pathValue : Number(pathValue);
  const scaledPathValue = Number.isFinite(numericPathValue)
    ? numericPathValue / (scorer.denominatorScale ?? 1)
    : undefined;
  const denominator = Math.max(
    scorer.minimumDenominator ?? 1,
    scaledPathValue ?? scorer.denominator ?? 1
  );
  const ratio = occurrences / denominator;
  return scorer.invert ? 1 - ratio : ratio;
}

export async function boundedRegexTest(
  pattern: string,
  flags: string | undefined,
  text: string
): Promise<boolean> {
  if (pattern.length > SCORING_MAX_PATTERN_LENGTH) {
    throw new ValidationError(`Regex patterns cannot exceed ${SCORING_MAX_PATTERN_LENGTH} characters`);
  }
  if (text.length > SCORING_MAX_COMBINED_LENGTH) {
    throw new ValidationError(
      `Combined scoring text cannot exceed ${SCORING_MAX_COMBINED_LENGTH} characters`
    );
  }

  await acquireRegexWorkerSlot();
  try {
    return await new Promise<boolean>((resolve, reject) => {
      const worker = new Worker(REGEX_WORKER_SOURCE, {
        eval: true,
        workerData: { pattern, flags: flags ?? '', text },
      });
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;
      const finish = (callback: () => void, terminate = true) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (!terminate) {
          callback();
          return;
        }
        void worker.terminate().then(callback, callback);
      };
      timer = setTimeout(() => {
        finish(() => reject(new ValidationError('Regex evaluation exceeded the 100ms limit')));
      }, SCORING_REGEX_TIMEOUT_MS);
      worker.once('message', (message: { matched?: boolean; error?: string }) => {
        if (message.error) {
          finish(() => reject(new ValidationError(`Invalid regex pattern: ${message.error}`)));
          return;
        }
        const matched = message.matched;
        if (typeof matched !== 'boolean') {
          finish(() => reject(new ValidationError('Regex worker returned an invalid response')));
          return;
        }
        finish(() => resolve(matched));
      });
      worker.once('error', (error) => finish(() => reject(error)));
      worker.once('exit', () => {
        finish(
          () => reject(new ValidationError('Regex evaluation stopped unexpectedly')),
          false
        );
      });
    });
  } finally {
    releaseRegexWorkerSlot();
  }
}
