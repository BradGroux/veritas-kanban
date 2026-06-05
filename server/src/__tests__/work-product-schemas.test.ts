import { describe, expect, it } from 'vitest';
import {
  CreateWorkProductBodySchema,
  UpdateWorkProductBodySchema,
} from '../schemas/work-product-schemas.js';

const baseCreateBody = {
  kind: 'markdown',
  title: 'Safe source links',
  render: { schemaVersion: 1, kind: 'markdown', markdown: '# Report' },
} as const;

describe('work product schemas', () => {
  it.each([
    ['https://example.com/report', 'https://example.com/report'],
    ['HTTP://EXAMPLE.COM/report', 'http://example.com/report'],
    ['mailto:owner@example.com', 'mailto:owner@example.com'],
    ['veritas://task/task-1?tab=work-products', 'veritas://task/task-1?tab=work-products'],
    ['/tasks/task-1', '/tasks/task-1'],
    ['#work-products', '#work-products'],
  ])('allows and normalizes safe source link href %s', (href, normalized) => {
    const parsed = CreateWorkProductBodySchema.safeParse({
      ...baseCreateBody,
      sourceLinks: [{ label: 'Source', href, type: 'url' }],
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.sourceLinks?.[0]?.href).toBe(normalized);
    }
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'java\nscript:alert(1)',
    '//evil.example/path',
  ])('rejects unsafe source link href %s', (href) => {
    const createParsed = CreateWorkProductBodySchema.safeParse({
      ...baseCreateBody,
      sourceLinks: [{ label: 'Source', href, type: 'url' }],
    });
    const updateParsed = UpdateWorkProductBodySchema.safeParse({
      sourceLinks: [{ label: 'Source', href, type: 'url' }],
    });

    expect(createParsed.success).toBe(false);
    expect(updateParsed.success).toBe(false);
  });
});
