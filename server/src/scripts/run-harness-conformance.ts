#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  HarnessConformanceExecutionInput,
  HarnessConformanceObservation,
  HarnessConformanceSuite,
} from '@veritas-kanban/shared';
import {
  HarnessConformanceExecutionError,
  HarnessConformanceService,
} from '../services/harness-conformance-service.js';

interface RecordedObservation {
  combinationId: string;
  scenarioId: string;
  trial: number;
  observation: HarnessConformanceObservation;
}

const MAX_INPUT_BYTES = 3 * 1024 * 1024;
const args = parseArgs(process.argv.slice(2));
const suite = await readJson<HarnessConformanceSuite>(args.suite);
const recorded = await readJson<RecordedObservation[]>(args.observations);
const byTrial = new Map(
  recorded.map((item) => [
    `${item.combinationId}\0${item.scenarioId}\0${item.trial}`,
    item.observation,
  ])
);
const service = new HarnessConformanceService();
const result = await service.run(
  suite,
  {
    async reset() {
      // Recorded fixtures are immutable; production executors provide a real reset.
    },
    async execute(input: HarnessConformanceExecutionInput) {
      const key = `${input.combination.id}\0${input.scenario.id}\0${input.trial}`;
      const observation = byTrial.get(key);
      if (!observation) {
        throw new HarnessConformanceExecutionError(
          'verification',
          `Recorded observation is missing for ${input.combination.id}/${input.scenario.id}/${input.trial}.`
        );
      }
      return structuredClone(observation);
    },
  },
  { allowCredentialGated: args.allowCredentialGated }
);

if (args.json) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  process.stdout.write(
    `${result.status.toUpperCase()} ${result.suiteId}@${result.suiteRevision}: ` +
      `${result.trials.filter((trial) => trial.passed).length}/${result.trials.length} trials passed, ` +
      `${result.aggregates.reduce((count, aggregate) => count + aggregate.regressions.length, 0)} regressions\n`
  );
}
service.assertPassed(result);

function parseArgs(values: string[]): {
  suite: string;
  observations: string;
  json: boolean;
  allowCredentialGated: boolean;
} {
  let suite: string | undefined;
  let observations: string | undefined;
  let json = false;
  let allowCredentialGated = false;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--') continue;
    if (value === '--suite') suite = values[++index];
    else if (value === '--observations') observations = values[++index];
    else if (value === '--json') json = true;
    else if (value === '--allow-credential-gated') allowCredentialGated = true;
    else throw new Error(`Unknown conformance option: ${value}`);
  }
  if (!suite || !observations) {
    throw new Error(
      'Usage: pnpm --filter @veritas-kanban/server exec tsx src/scripts/run-harness-conformance.ts -- --suite <suite.json> --observations <observations.json> [--json] [--allow-credential-gated]'
    );
  }
  const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
  return {
    suite: path.resolve(repositoryRoot, suite),
    observations: path.resolve(repositoryRoot, observations),
    json,
    allowCredentialGated,
  };
}

async function readJson<T>(filePath: string): Promise<T> {
  const content = await readFile(filePath, 'utf8');
  if (Buffer.byteLength(content, 'utf8') > MAX_INPUT_BYTES) {
    throw new Error(`Conformance input exceeds ${MAX_INPUT_BYTES} bytes: ${filePath}`);
  }
  return JSON.parse(content) as T;
}
