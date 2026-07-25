#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CADENCE_CONTRACTS = {
  'AGENTS.md': [
    {
      description: 'sustainable execution cadence section',
      pattern: /## Sustainable execution cadence/i,
    },
    {
      description: 'one independently shippable behavior per issue and pull request',
      pattern: /one independently shippable behavior/i,
    },
    {
      description: 'narrowest useful implementation loop',
      pattern: /run the narrowest useful loop/i,
    },
    {
      description: '45-minute split or escalate delivery checkpoint',
      pattern: /45-minute delivery checkpoint/i,
    },
    {
      description: 'direct Vitest exact-file invocation',
      pattern: /exec vitest run/i,
    },
    {
      description: 'milestone-only complete workspace suite',
      pattern:
        /complete workspace suite once at an explicit integration, critical-security, or release milestone/i,
    },
    {
      description: 'optional independent and cross-model review',
      pattern: /Independent or cross-model review is optional/i,
    },
  ],
  'CONTRIBUTING.md': [
    {
      description: 'scope and verification budget section',
      pattern: /### Scope and Verification Budget/i,
    },
    {
      description: 'one independently shippable behavior per issue and pull request',
      pattern: /one independently shippable behavior per issue and pull request/i,
    },
    {
      description: 'deterministic CI scope authority',
      pattern: /Treat `Select Test Scope` as the CI authority/i,
    },
    {
      description: 'test count is not a quality target',
      pattern: /Do not use raw test count as a quality measure/i,
    },
    {
      description: 'direct Vitest exact-file invocation',
      pattern: /exec vitest run/i,
    },
    {
      description: 'one risk-proportional review before commit',
      pattern: /Review the changed behavior once before committing/i,
    },
    {
      description: 'affected-boundary runtime smoke tests',
      pattern: /Run browser or API smoke tests only when the change affects/i,
    },
  ],
  '.github/PULL_REQUEST_TEMPLATE.md': [
    {
      description: 'linked follow-up scope boundary',
      pattern: /\*\*Linked follow-ups:\*\*/i,
    },
    {
      description: 'verification tier selection',
      pattern: /\*\*Verification tier:\*\*/i,
    },
    {
      description: 'focused changed-package test tier',
      pattern: /Focused changed-package tests/i,
    },
    {
      description: 'full milestone gate tier',
      pattern: /Full milestone gate/i,
    },
    {
      description: 'one coherent independently shippable behavior checklist',
      pattern: /one coherent, independently shippable behavior/i,
    },
  ],
};

const PROMPT_REGISTRY_EXCLUSIONS = new Set([
  'prompt-registry/README.md',
  'prompt-registry/cross-model-review.md',
]);

function normalizeWhitespace(content) {
  return content.replace(/\s+/g, ' ').trim();
}

function sentenceContaining(content, matchIndex, fallbackLength = 240) {
  const sentenceStart = Math.max(
    content.lastIndexOf('.', matchIndex - 1),
    content.lastIndexOf('!', matchIndex - 1),
    content.lastIndexOf('?', matchIndex - 1)
  );
  const punctuation = ['.', '!', '?']
    .map((mark) => content.indexOf(mark, matchIndex))
    .filter((index) => index >= 0);
  const sentenceEnd =
    punctuation.length > 0 ? Math.min(...punctuation) + 1 : matchIndex + fallbackLength;
  return content.slice(sentenceStart + 1, sentenceEnd);
}

function isNarrowlyQualified(sentence) {
  return (
    /\bdo not\b/i.test(sentence) ||
    /\b(?:only|unless)\b/i.test(sentence) ||
    /\b(?:deterministic CI|integration|critical-security|release) milestone\b/i.test(sentence)
  );
}

function hasUnconditionalCrossModelReview(content) {
  return (
    /\bcross-model review\s+(?:is\s+)?(?:required|mandatory)\b/i.test(content) ||
    /\b(?:must|required to|shall)\s+(?:run|complete|obtain|perform)[^.]{0,120}\bcross-model review\b/i.test(
      content
    )
  );
}

export function findMissingCadenceContracts(files) {
  const violations = [];

  for (const [file, rules] of Object.entries(CADENCE_CONTRACTS)) {
    const content = files[file];
    if (content === undefined) {
      violations.push({ file, message: 'required cadence contract file is missing' });
      continue;
    }

    const normalized = normalizeWhitespace(content);
    for (const rule of rules) {
      if (!rule.pattern.test(normalized)) {
        violations.push({
          file,
          message: `required cadence contract is missing: ${rule.description}`,
        });
      }
    }
  }

  return violations;
}

function findUnqualifiedFullSuiteStatements(file, content) {
  const violations = [];
  const normalized = normalizeWhitespace(content);
  const pattern =
    /\b(?:run|execute)\s+(?:the\s+)?(?:complete|full|entire)\s+(?:workspace\s+)?(?:test\s+)?suite\b/gi;

  for (const match of normalized.matchAll(pattern)) {
    const matchIndex = match.index ?? 0;
    const sentence = sentenceContaining(normalized, matchIndex);

    if (!isNarrowlyQualified(sentence)) {
      violations.push({
        file,
        message: `unqualified complete-suite requirement: "${match[0]}"`,
      });
    }
  }

  return violations;
}

export function findUnsafePromptStatements(files) {
  const violations = [];

  for (const [file, content] of Object.entries(files)) {
    const normalized = normalizeWhitespace(content);
    const pnpmTestPattern = /\bpnpm\s+test(?=[\s`'"]|$)/gi;

    for (const match of normalized.matchAll(pnpmTestPattern)) {
      const sentence = sentenceContaining(normalized, match.index ?? 0);
      if (!isNarrowlyQualified(sentence)) {
        violations.push({
          file,
          message: 'active prompts must not prescribe an unconditional workspace-wide `pnpm test`',
        });
      }
    }

    if (hasUnconditionalCrossModelReview(normalized)) {
      violations.push({
        file,
        message: 'active prompts must not make cross-model review unconditional',
      });
    }

    violations.push(...findUnqualifiedFullSuiteStatements(file, content));
  }

  return violations;
}

export function findUnsafeCanonicalCadenceStatements(files) {
  const violations = [];

  for (const [file, content] of Object.entries(files)) {
    const normalized = normalizeWhitespace(content);

    if (
      /\bbefore every commit\b[^.]{0,240}\b(?:[2-9]|multiple|separate|two|three|four)\s+reviews?\b/i.test(
        normalized
      ) ||
      /\b(?:all|each)\s+(?:four|\d+)\s+reviews?\s+must pass\b/i.test(normalized) ||
      /\bthese reviews are mandatory,? not optional\b/i.test(normalized)
    ) {
      violations.push({
        file,
        message: 'canonical guidance must not require multiple reviews before every commit',
      });
    }

    if (hasUnconditionalCrossModelReview(normalized)) {
      violations.push({
        file,
        message: 'canonical guidance must not make cross-model review unconditional',
      });
    }

    if (
      /\bpnpm\s+typecheck\b[^.]{0,160}\bsucceeds?\s+for\s+all\s+workspace\s+packages\b/i.test(
        normalized
      ) ||
      /\bpnpm\s+build\b[^.]{0,160}\bsucceeds?\s+for\s+all\s+(?:workspace\s+)?packages\b/i.test(
        normalized
      ) ||
      /\bbefore\s+(?:every|any)\s+(?:commit|merge|pull request|pr|change)\b[^.]{0,320}\bpnpm\s+(?:typecheck|build)\b/i.test(
        normalized
      )
    ) {
      violations.push({
        file,
        message:
          'canonical guidance must not require workspace-wide build or typecheck for every merge',
      });
    }

    if (
      /\bbefore declaring (?:a|the) branch ready to merge[^.]{0,240}\b(?:runtime|browser)\b/i.test(
        normalized
      ) ||
      /\bmust test in a running browser\b/i.test(normalized) ||
      /\b(?:before|for)\s+(?:every|any)\s+(?:branch|pull request|pr|merge)\b[^.]{0,260}\b(?:browser|runtime smoke|api smoke)\b/i.test(
        normalized
      )
    ) {
      violations.push({
        file,
        message: 'canonical guidance must scope runtime smoke tests to affected product boundaries',
      });
    }

    violations.push(...findUnqualifiedFullSuiteStatements(file, content));
  }

  return violations;
}

export function findAmbiguousFocusedTestCommands(files) {
  const violations = [];
  const pattern =
    /\bpnpm\s+(?:--filter(?:=|\s+)|-F\s+)\S+\s+(?:run\s+)?test\s+--(?=\s)/gi;

  for (const [file, content] of Object.entries(files)) {
    const normalized = normalizeWhitespace(content);
    for (const match of normalized.matchAll(pattern)) {
      const sentence = sentenceContaining(normalized, match.index ?? 0);
      if (!/\b(?:do not|never|avoid|reject)\b/i.test(sentence)) {
        violations.push({
          file,
          message:
            'focused Vitest files must use direct `pnpm --filter <package> exec vitest run <exact-test-files>` invocation',
        });
      }
    }
  }

  return violations;
}

function readCadenceFiles(rootDir) {
  return Object.fromEntries(
    Object.keys(CADENCE_CONTRACTS).map((file) => {
      const absolutePath = path.join(rootDir, file);
      return [file, existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : undefined];
    })
  );
}

function readActivePromptFiles(rootDir) {
  const promptDir = path.join(rootDir, 'prompt-registry');
  return Object.fromEntries(
    readdirSync(promptDir)
      .filter((name) => name.endsWith('.md'))
      .map((name) => `prompt-registry/${name}`)
      .filter((file) => !PROMPT_REGISTRY_EXCLUSIONS.has(file))
      .map((file) => [file, readFileSync(path.join(rootDir, file), 'utf8')])
  );
}

export function runDeliveryCadenceCheck(rootDir = process.cwd()) {
  const cadenceFiles = readCadenceFiles(rootDir);
  const promptFiles = readActivePromptFiles(rootDir);
  const violations = [
    ...findMissingCadenceContracts(cadenceFiles),
    ...findUnsafeCanonicalCadenceStatements(cadenceFiles),
    ...findUnsafePromptStatements(promptFiles),
    ...findAmbiguousFocusedTestCommands({ ...cadenceFiles, ...promptFiles }),
  ];

  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(
        `::error file=${violation.file}::Delivery cadence check failed: ${violation.message}`
      );
    }
    return false;
  }

  console.log('Canonical delivery guidance and active prompts are consistent.');
  return true;
}

function isDirectExecution() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectExecution() && !runDeliveryCadenceCheck()) {
  process.exitCode = 1;
}
