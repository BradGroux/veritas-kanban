#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const trackedFiles = execFileSync('git', ['ls-files', '-z'], {
  cwd: repoRoot,
  encoding: 'utf8',
})
  .split('\0')
  .filter(Boolean);
const markdownFiles = trackedFiles.filter((file) => file.toLowerCase().endsWith('.md'));

const violations = [];
const counts = new Map();

for (const file of markdownFiles) {
  const content = readFileSync(path.join(repoRoot, file), 'utf8');
  const forbiddenReason = internalArtifactReason(file, content);
  if (forbiddenReason) violations.push(`${file}: ${forbiddenReason}`);

  const category = publicCategory(file);
  if (!category) violations.push(`${file}: no public documentation category`);
  else counts.set(category, (counts.get(category) ?? 0) + 1);

  for (const target of relativeMarkdownTargets(content)) {
    const targetPath = path.resolve(repoRoot, path.dirname(file), target);
    if (!targetPath.startsWith(`${repoRoot}${path.sep}`) && targetPath !== repoRoot) {
      violations.push(`${file}: relative link escapes the repository (${target})`);
    } else if (!existsSync(targetPath)) {
      violations.push(`${file}: missing relative link target (${target})`);
    }
  }
}

if (violations.length > 0) {
  console.error('Public documentation check failed:');
  for (const violation of [...new Set(violations)].sort()) console.error(`- ${violation}`);
  process.exit(1);
}

const summary = [...counts.entries()]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([category, count]) => `${category}=${count}`)
  .join(', ');
console.log(
  `Public documentation check passed (${markdownFiles.length} Markdown files; ${summary}).`
);

function internalArtifactReason(file, content) {
  if (file === 'INTEGRATION.md') return 'one-time integration handoffs are internal workflow';
  if (file === 'docs/VERITAS-CUTOVER.md')
    return 'organization-specific operating playbooks are internal workflow';
  if (file.startsWith('.learnings/')) return 'raw learning logs are internal workflow';
  if (file.startsWith('docs/archive/')) return 'historical working archives are not public docs';
  if (/^docs\/security\/.*-audit\.md$/i.test(file))
    return 'raw security audits belong in the issue workflow';
  if (/goal-prompt/i.test(path.basename(file)))
    return 'execution goal prompts are internal workflow';
  if (/^docs\/[^/]*-audit-\d{4}-\d{2}-\d{2}\.md$/i.test(file)) {
    return 'dated working audits belong in the issue or task workflow';
  }
  if (/private execution artifact/i.test(content)) {
    return 'explicit private execution artifacts cannot be public docs';
  }
  if (/\*\*Status:\*\*\s*Design Draft/i.test(content)) {
    return 'design drafts belong in the issue or task workflow';
  }
  if (/^# .*goal prompt$/im.test(content) || /^\/goal\b/m.test(content)) {
    return 'execution prompt content cannot be public docs';
  }
  return null;
}

function publicCategory(file) {
  if (file.startsWith('prompt-registry/')) return 'runtime-template';
  if (file.startsWith('tasks/examples/')) return 'runtime-example';
  if (file.startsWith('server/src/__fixtures__/')) return 'test-fixture';
  if (file.startsWith('server/src/contracts/')) return 'runtime-contract';
  if (file.startsWith('.github/')) return 'repository-template';
  if (file === 'AGENTS.md' || file === 'CLAUDE.md') return 'harness-instructions';
  if (file === 'CHANGELOG.md' || file.startsWith('docs/releases/')) return 'release-source';
  if (file.startsWith('docs/architecture/')) return 'architecture-contract';
  if (file.startsWith('docs/design/')) return 'design-contract';
  if (file === 'docs/security.md' || file.startsWith('docs/security/')) return 'security-guide';
  if (file.startsWith('docs/testing/')) return 'test-policy';
  if (file.startsWith('docs/features/')) return 'feature-guide';
  if (file.startsWith('docs/')) return 'product-operator-guide';
  if (
    ['README.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md'].includes(file) ||
    /(^|\/)README\.md$/i.test(file)
  ) {
    return 'project-guide';
  }
  return null;
}

function relativeMarkdownTargets(content) {
  const targets = [];
  const linkPattern = /!?\[[^\]]*\]\(([^)\n]+)\)/g;
  for (const match of content.matchAll(linkPattern)) {
    let target = match[1].trim();
    if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
    else target = target.split(/\s+["']/u, 1)[0];

    if (
      !target ||
      target.startsWith('#') ||
      target.startsWith('/') ||
      target.includes('{{') ||
      /^[a-z][a-z0-9+.-]*:/iu.test(target)
    ) {
      continue;
    }

    target = target.split('#', 1)[0].split('?', 1)[0];
    if (!target) continue;
    try {
      targets.push(decodeURIComponent(target));
    } catch {
      violations.push(`invalid URL encoding in Markdown target (${target})`);
    }
  }
  return targets;
}
