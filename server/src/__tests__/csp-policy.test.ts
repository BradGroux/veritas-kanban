import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { apiDocsCspOverride, buildCspDirectives } from '../config/csp.js';
import { injectCspNonceAttributes } from '../middleware/csp-nonce.js';

function directiveValues(value: unknown): unknown[] {
  return Array.from(value as Iterable<unknown>);
}

describe('CSP policy', () => {
  it('removes broad production style-src unsafe-inline and keeps nonce support', () => {
    const directives = buildCspDirectives({
      isDev: false,
      isDesktopRuntime: false,
      reportUri: 'https://reports.example.test/csp',
    });

    const scriptSrc = directiveValues(directives.scriptSrc);
    const styleSrc = directiveValues(directives.styleSrc);
    const styleSrcElem = directiveValues(directives.styleSrcElem);
    const styleSrcAttr = directiveValues(directives.styleSrcAttr);

    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc.some((value) => typeof value === 'function')).toBe(true);
    expect(styleSrc).toContain("'self'");
    expect(styleSrc).not.toContain("'unsafe-inline'");
    expect(styleSrc.some((value) => typeof value === 'function')).toBe(true);
    expect(styleSrcElem).toContain("'self'");
    expect(styleSrcElem).not.toContain("'unsafe-inline'");
    expect(styleSrcElem.some((value) => typeof value === 'function')).toBe(true);
    expect(styleSrcAttr).toEqual(["'unsafe-inline'"]);
    expect(directiveValues(directives.reportUri)).toEqual(['https://reports.example.test/csp']);
  });

  it('keeps dev-only inline script/style support scoped to dev mode', () => {
    const directives = buildCspDirectives({
      isDev: true,
      isDesktopRuntime: false,
    });

    expect(directiveValues(directives.scriptSrc)).toContain("'unsafe-inline'");
    expect(directiveValues(directives.styleSrc)).toContain("'unsafe-inline'");
    expect(directives.upgradeInsecureRequests).toBeNull();
  });

  it('injects the same nonce into script and style tags without duplicating existing nonces', () => {
    const html = [
      '<script type="module" src="/assets/app.js"></script>',
      '<style>body{color:red}</style>',
      '<script nonce="existing" src="/assets/other.js"></script>',
    ].join('');

    expect(injectCspNonceAttributes(html, 'abc123')).toBe(
      [
        '<script nonce="abc123" type="module" src="/assets/app.js"></script>',
        '<style nonce="abc123">body{color:red}</style>',
        '<script nonce="existing" src="/assets/other.js"></script>',
      ].join('')
    );
  });

  it('removes CSP headers only for API docs responses', async () => {
    const app = express();
    app.use((_req, res, next) => {
      res.setHeader('Content-Security-Policy', "default-src 'self'");
      res.setHeader('Content-Security-Policy-Report-Only', "default-src 'self'");
      next();
    });
    app.use('/api-docs', apiDocsCspOverride);
    app.get('/api-docs', (_req, res) => res.send('docs'));
    app.get('/not-docs', (_req, res) => res.send('regular'));

    const docs = await request(app).get('/api-docs');
    expect(docs.headers['content-security-policy']).toBeUndefined();
    expect(docs.headers['content-security-policy-report-only']).toBeUndefined();

    const regular = await request(app).get('/not-docs');
    expect(regular.headers['content-security-policy']).toBe("default-src 'self'");
    expect(regular.headers['content-security-policy-report-only']).toBe("default-src 'self'");
  });
});
