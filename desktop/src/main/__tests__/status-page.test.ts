import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { statusPage } from '../status-page.js';

function styleHash(style: string): string {
  return `'sha256-${createHash('sha256').update(style).digest('base64')}'`;
}

function inlineStyle(html: string): string {
  const match = html.match(/<style>([\s\S]*?)<\/style>/);
  if (!match) throw new Error('Expected inline style block');
  return match[1];
}

describe('desktop status pages CSP', () => {
  it('allows the generated status page style block by hash instead of unsafe-inline', () => {
    const html = statusPage('Starting', 'Preparing runtime');
    const csp = html.match(/content="([^"]+)"/)?.[1] || '';

    expect(csp).toContain(`style-src ${styleHash(inlineStyle(html))}`);
    expect(csp).not.toContain("'unsafe-inline'");
  });

  it('allows the static renderer startup style block by hash instead of unsafe-inline', () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const html = readFileSync(resolve(testDir, '../../renderer/index.html'), 'utf-8');
    const csp = html.match(/content="([^"]+)"/)?.[1] || '';

    expect(csp).toContain(`style-src ${styleHash(inlineStyle(html))}`);
    expect(csp).not.toContain("'unsafe-inline'");
  });
});
