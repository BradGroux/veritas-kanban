import { describe, expect, it } from 'vitest';
import {
  sanitizeAuthor,
  sanitizeCommentText,
  sanitizeTaskFields,
  stripHtml,
} from '../utils/sanitize.js';

describe('plain text sanitization compatibility', () => {
  it('preserves Unicode and Markdown content', () => {
    const value = 'Équipe\n## Next steps\n- **Review** the release';
    expect(stripHtml(value)).toBe(value);
    expect(sanitizeCommentText(value)).toBe(value);
  });

  it('strips markup and active content from task fields in place', () => {
    const fields = {
      title: '<b>Reviewed task</b><script>discard()</script>',
      description: '<style>discard</style>## Safe description',
    };
    sanitizeTaskFields(fields);
    expect(fields).toEqual({ title: 'Reviewed task', description: '## Safe description' });
    const partial = { title: 'Untouched text' };
    sanitizeTaskFields(partial);
    expect(partial).toEqual({ title: 'Untouched text' });
  });

  it('keeps readable comment and author text without executable markup', () => {
    expect(sanitizeCommentText('Hello <em>team</em><img src=x onerror="discard()">')).toBe(
      'Hello team'
    );
    expect(sanitizeAuthor('<a href="javascript:discard()">Alice</a>')).toBe('Alice');
  });
});
