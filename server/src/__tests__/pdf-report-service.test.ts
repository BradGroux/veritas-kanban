import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('pdf-report-service', () => {
  let testRoot: string;
  let dataDir: string;
  let getPdfReportService: typeof import('../services/pdf-report-service.js').getPdfReportService;

  beforeEach(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'veritas-report-service-'));
    dataDir = path.join(testRoot, '.veritas-kanban');
    await fs.mkdir(dataDir, { recursive: true });
    process.env.DATA_DIR = dataDir;

    vi.resetModules();
    ({ getPdfReportService } = await import('../services/pdf-report-service.js'));
  });

  afterEach(async () => {
    delete process.env.DATA_DIR;
    await fs.rm(testRoot, { recursive: true, force: true }).catch(() => {});
  });

  it('escapes report text and sanitizes unsafe generated HTML', async () => {
    const report = await getPdfReportService().generateReport({
      title: 'Audit <img src=x onerror=alert(1)>',
      subtitle: '<script>alert("subtitle")</script> subtitle',
      template: 'audit',
      author: 'Alice <svg onload=alert(1)>',
      brand: {
        companyName: 'Acme <img src=x onerror=alert(1)>',
        logoUrl: 'javascript:alert(1)',
        primaryColor: '#fff;}</style><script>alert(1)</script>',
        secondaryColor: 'red;}</style><script>alert(1)</script>',
        accentColor: '#00ff00',
        fontFamily: 'Inter;}</style><script>alert(1)</script>',
        tagline: '<img src=x onerror=alert(1)>Tagline',
      },
      content: [
        '# Finding <img src=x onerror=alert(1)>',
        'Plain <script>alert("content")</script> **bold** [bad](javascript:alert(1)) [ok](https://example.com/report?a=1&b=2)',
        '- item <img src=x onerror=alert(1)>',
        '```html',
        '<script>alert("code")</script>',
        '```',
      ].join('\n'),
    });

    const html = await fs.readFile(report.htmlPath, 'utf8');

    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/<[^>]+\son\w+=/i);
    expect(html).not.toMatch(/href=["']javascript:/i);
    expect(html).not.toMatch(/src=["']javascript:/i);
    expect(html).not.toContain('</style><script>');
    expect(html).not.toContain('<img src=');

    expect(html).toContain('Audit &lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;alert("code")&lt;/script&gt;');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('bad');
    expect(html).toContain('href="https://example.com/report?a=1&amp;b=2"');
    expect(html).toContain('color: #8b5cf6');
    expect(report.brand.logoUrl).toBeUndefined();
    expect(report.brand.primaryColor).toBe('#8b5cf6');
    expect(report.brand.secondaryColor).toBe('#1e1b4b');
    expect(report.brand.fontFamily).toBe('Inter, system-ui, -apple-system, sans-serif');
  });

  it('preserves allowlisted logo and markdown link URLs', async () => {
    const report = await getPdfReportService().generateReport({
      title: 'Safe report',
      template: 'summary',
      content:
        '[External](https://example.com/report) [Relative](/docs/report) [Mail](mailto:test@example.com) [Data](data:text/html,<script>)',
      brand: {
        logoUrl: 'https://cdn.example.com/logo.png',
      },
    });

    const html = await fs.readFile(report.htmlPath, 'utf8');

    expect(html).toContain('<img src="https://cdn.example.com/logo.png"');
    expect(html).toContain('href="https://example.com/report"');
    expect(html).toContain('href="/docs/report"');
    expect(html).toContain('href="mailto:test@example.com"');
    expect(html).not.toMatch(/href=["']data:/i);
    expect(report.brand.logoUrl).toBe('https://cdn.example.com/logo.png');
  });

  it('normalizes persisted brand config on update', async () => {
    const service = getPdfReportService();
    const brand = await service.updateBrand({
      companyName: 'Acme',
      logoUrl: 'data:image/svg+xml,<svg onload=alert(1)>',
      primaryColor: '#123456',
      secondaryColor: 'red;}</style><script>alert(1)</script>',
      accentColor: '#abcdef',
      fontFamily: 'Inter;}</style><script>alert(1)</script>',
      tagline: 'Reports',
    });

    expect(brand.logoUrl).toBeUndefined();
    expect(brand.primaryColor).toBe('#123456');
    expect(brand.secondaryColor).toBe('#1e1b4b');
    expect(brand.accentColor).toBe('#abcdef');
    expect(brand.fontFamily).toBe('Inter, system-ui, -apple-system, sans-serif');

    const stored = JSON.parse(await fs.readFile(path.join(dataDir, 'report-brand.json'), 'utf8'));
    expect(stored.logoUrl).toBeUndefined();
    expect(stored.secondaryColor).toBe('#1e1b4b');
    expect(stored.fontFamily).toBe('Inter, system-ui, -apple-system, sans-serif');
  });
});
