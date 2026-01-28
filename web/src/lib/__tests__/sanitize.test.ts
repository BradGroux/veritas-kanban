import { describe, it, expect } from 'vitest';
import { sanitizeHtml, sanitizeText } from '../sanitize';

describe('sanitizeHtml', () => {
  it('strips script tags', () => {
    expect(sanitizeHtml('<script>alert("xss")</script>')).toBe('');
  });

  it('strips script tags mixed with content', () => {
    const input = 'Hello <script>alert("xss")</script> world';
    expect(sanitizeHtml(input)).toBe('Hello  world');
  });

  it('strips event handlers on img tags', () => {
    const input = '<img onerror="alert(\'xss\')" src=x>';
    const result = sanitizeHtml(input);
    expect(result).not.toContain('onerror');
    expect(result).not.toContain('alert');
  });

  it('strips javascript: links', () => {
    const input = '<a href="javascript:alert(\'xss\')">click me</a>';
    const result = sanitizeHtml(input);
    expect(result).not.toContain('javascript:');
    expect(result).toContain('click me');
  });

  it('preserves safe Markdown HTML tags', () => {
    const input = '<p>Hello <strong>bold</strong> and <em>italic</em></p>';
    expect(sanitizeHtml(input)).toContain('<strong>bold</strong>');
    expect(sanitizeHtml(input)).toContain('<em>italic</em>');
  });

  it('preserves code blocks', () => {
    const input = '<pre><code>const x = 1;</code></pre>';
    expect(sanitizeHtml(input)).toContain('<code>const x = 1;</code>');
  });

  it('preserves headings', () => {
    const input = '<h1>Title</h1><h2>Subtitle</h2>';
    expect(sanitizeHtml(input)).toContain('<h1>Title</h1>');
    expect(sanitizeHtml(input)).toContain('<h2>Subtitle</h2>');
  });

  it('preserves lists', () => {
    const input = '<ul><li>Item 1</li><li>Item 2</li></ul>';
    expect(sanitizeHtml(input)).toContain('<li>Item 1</li>');
  });

  it('preserves blockquotes', () => {
    const input = '<blockquote>Quote text</blockquote>';
    expect(sanitizeHtml(input)).toContain('<blockquote>Quote text</blockquote>');
  });

  it('preserves safe links', () => {
    const input = '<a href="https://example.com">link</a>';
    const result = sanitizeHtml(input);
    expect(result).toContain('href="https://example.com"');
    expect(result).toContain('target="_blank"');
    expect(result).toContain('rel="noopener noreferrer"');
  });

  it('preserves tables', () => {
    const input = '<table><tr><td>Cell</td></tr></table>';
    expect(sanitizeHtml(input)).toContain('<td>Cell</td>');
  });

  it('strips iframe tags', () => {
    const input = '<iframe src="https://evil.com"></iframe>';
    expect(sanitizeHtml(input)).toBe('');
  });

  it('strips form elements', () => {
    const input = '<form action="https://evil.com"><input type="text"></form>';
    expect(sanitizeHtml(input)).toBe('');
  });

  it('strips style tags', () => {
    const input = '<style>body { background: red; }</style>';
    expect(sanitizeHtml(input)).toBe('');
  });

  it('handles empty/falsy input', () => {
    expect(sanitizeHtml('')).toBe('');
    expect(sanitizeHtml(null as unknown as string)).toBe('');
    expect(sanitizeHtml(undefined as unknown as string)).toBe('');
  });

  it('strips nested script injection', () => {
    const input = '<div><scr<script>ipt>alert("xss")</scr</script>ipt></div>';
    const result = sanitizeHtml(input);
    expect(result).not.toContain('alert');
  });

  it('strips SVG-based XSS', () => {
    const input = '<svg onload="alert(\'xss\')"><circle r="10"/></svg>';
    const result = sanitizeHtml(input);
    expect(result).not.toContain('onload');
    expect(result).not.toContain('alert');
  });

  it('strips data: URI in links', () => {
    const input = '<a href="data:text/html,<script>alert(1)</script>">click</a>';
    const result = sanitizeHtml(input);
    expect(result).not.toContain('data:');
  });
});

describe('sanitizeText', () => {
  it('strips ALL HTML tags', () => {
    const input = '<p>Hello <strong>world</strong></p>';
    expect(sanitizeText(input)).toBe('Hello world');
  });

  it('strips script tags and their content', () => {
    const input = '<script>alert("xss")</script>';
    expect(sanitizeText(input)).toBe('');
  });

  it('strips img tags with event handlers', () => {
    const input = '<img onerror="alert(\'xss\')" src=x>';
    expect(sanitizeText(input)).toBe('');
  });

  it('strips javascript: links but keeps text', () => {
    const input = '<a href="javascript:alert(\'xss\')">click me</a>';
    expect(sanitizeText(input)).toBe('click me');
  });

  it('preserves plain text content', () => {
    const input = 'Just a normal description with no HTML';
    expect(sanitizeText(input)).toBe('Just a normal description with no HTML');
  });

  it('preserves text with special characters', () => {
    const input = 'Use array[0] && value > 5';
    // DOMPurify may encode special chars, but should preserve meaning
    const result = sanitizeText(input);
    expect(result).toContain('array[0]');
    expect(result).toContain('value');
  });

  it('handles Markdown-like XSS payloads', () => {
    const input = '[link](javascript:alert("xss"))';
    const result = sanitizeText(input);
    // As plain text, the markdown syntax is kept as literal characters
    expect(result).not.toContain('<script>');
    expect(result).not.toContain('javascript:');
  });

  it('handles empty/falsy input', () => {
    expect(sanitizeText('')).toBe('');
    expect(sanitizeText(null as unknown as string)).toBe('');
    expect(sanitizeText(undefined as unknown as string)).toBe('');
  });

  it('strips complex nested XSS', () => {
    const input = '"><img src=x onerror=alert(1)>';
    const result = sanitizeText(input);
    expect(result).not.toContain('onerror');
    expect(result).not.toContain('<img');
    expect(result).toBe('">');
  });
});
