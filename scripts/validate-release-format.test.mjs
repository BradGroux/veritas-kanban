import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { releaseBodyFormattingIssues } from './validate-release.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const cleanBody = `Veritas Kanban 6.0.2 is the supported stable release.

## What changed

- **Chat stays inside the application window.** The Workbench dock is reversible.
- **Version information is authoritative.** Support data comes from one record.

\`\`\`bash
brew update
brew upgrade --cask bradgroux/tap/veritas-kanban
\`\`\`
`;

test('accepts full-width release Markdown', () => {
  assert.deepEqual(releaseBodyFormattingIssues(cleanBody), []);
});

test('rejects release formatting that forces narrow or manual line breaks', () => {
  const cases = [
    ['carriage return', 'First paragraph.\r\n'],
    ['Markdown hard break', 'First paragraph.  \n'],
    ['literal escaped newline', String.raw`First paragraph.\nSecond paragraph.`],
    ['HTML break', 'First paragraph.<br>\n'],
    ['blockquote', '> Narrow callout.\n'],
    ['hard-wrapped prose', 'First half of a paragraph\nsecond half of the paragraph.\n'],
    ['overlong prose block', `${'word '.repeat(50)}end\n`],
    ['unclosed code fence', '```bash\nbrew update\n'],
  ];

  for (const [name, body] of cases) {
    assert.notDeepEqual(releaseBodyFormattingIssues(body), [], name);
  }
});

test('accepts every checked-in GitHub release body', async () => {
  const releaseBodyDir = path.join(rootDir, 'docs', 'releases');
  const releaseBodyFiles = (await readdir(releaseBodyDir))
    .filter((file) => /^v\d+\.\d+\.\d+\.md$/.test(file))
    .sort();

  assert.ok(releaseBodyFiles.length > 0, 'expected at least one checked-in release body');

  for (const file of releaseBodyFiles) {
    const body = await readFile(path.join(releaseBodyDir, file), 'utf8');
    assert.deepEqual(releaseBodyFormattingIssues(body), [], file);
  }
});
