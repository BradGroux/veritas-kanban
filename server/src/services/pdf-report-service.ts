/**
 * PDF Report Generation Service
 *
 * Generates branded PDF reports from markdown content.
 * Supports templates, brand config (logo, colors, fonts),
 * and multiple report types.
 *
 * Uses HTML → PDF approach via built-in capabilities.
 * For richer output, pptxgenjs is available for PPTX.
 *
 * Inspired by @nateherk's Klouse branded reports.
 */

import { createLogger } from '../lib/logger.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import sanitizeHtml from 'sanitize-html';
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), '..', '.veritas-kanban');

const log = createLogger('pdf-reports');

// ─── Types ───────────────────────────────────────────────────────

export interface BrandConfig {
  companyName: string;
  logoUrl?: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  fontFamily: string;
  tagline?: string;
}

export type ReportTemplate = 'audit' | 'summary' | 'analysis' | 'standup' | 'custom';

export interface ReportConfig {
  title: string;
  subtitle?: string;
  template: ReportTemplate;
  /** Markdown content */
  content: string;
  /** Brand overrides (uses default if not provided) */
  brand?: Partial<BrandConfig>;
  /** Include table of contents */
  includeToc?: boolean;
  /** Include timestamp */
  includeTimestamp?: boolean;
  /** Include page numbers */
  includePageNumbers?: boolean;
  /** Author name */
  author?: string;
  /** Additional metadata */
  metadata?: Record<string, string>;
}

export interface GeneratedReport {
  id: string;
  title: string;
  template: ReportTemplate;
  /** HTML content (can be converted to PDF via browser print) */
  htmlPath: string;
  /** Relative path in docs */
  docsPath: string;
  /** File size */
  size: number;
  generatedAt: string;
  brand: BrandConfig;
}

// ─── Default Brand ───────────────────────────────────────────────

const DEFAULT_BRAND: BrandConfig = {
  companyName: 'Veritas Kanban',
  primaryColor: '#8b5cf6',
  secondaryColor: '#1e1b4b',
  accentColor: '#c4b5fd',
  fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
};

const SAFE_COLOR_PATTERN = /^#[0-9a-f]{3}(?:[0-9a-f]{3})?(?:[0-9a-f]{2})?$/i;
const SAFE_FONT_FAMILY_PATTERN = /^[a-zA-Z0-9\s'",.-]{1,160}$/;
const SAFE_RELATIVE_URL_PATTERN = /^(?:\/(?!\/)|#|\.{1,2}\/)[^\s"'<>\\]*$/;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeCssColor(value: string | undefined, fallback: string): string {
  const candidate = value?.trim();
  return candidate && SAFE_COLOR_PATTERN.test(candidate) ? candidate : fallback;
}

function sanitizeFontFamily(value: string | undefined, fallback: string): string {
  const candidate = value?.trim();
  if (!candidate || !SAFE_FONT_FAMILY_PATTERN.test(candidate)) {
    return fallback;
  }
  const lower = candidate.toLowerCase();
  return lower.includes('url') || lower.includes('expression') ? fallback : candidate;
}

function sanitizeReportUrl(
  value: string | undefined,
  allowedProtocols: ReadonlySet<string>
): string | undefined {
  const candidate = value?.trim();
  if (!candidate || hasControlCharacter(candidate)) {
    return undefined;
  }
  if (SAFE_RELATIVE_URL_PATTERN.test(candidate)) {
    return candidate;
  }
  try {
    const parsed = new URL(candidate);
    return allowedProtocols.has(parsed.protocol) ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127) {
      return true;
    }
  }
  return false;
}

function sanitizeBrandConfig(brand: BrandConfig): BrandConfig {
  const sanitized: BrandConfig = {
    companyName: brand.companyName || DEFAULT_BRAND.companyName,
    primaryColor: sanitizeCssColor(brand.primaryColor, DEFAULT_BRAND.primaryColor),
    secondaryColor: sanitizeCssColor(brand.secondaryColor, DEFAULT_BRAND.secondaryColor),
    accentColor: sanitizeCssColor(brand.accentColor, DEFAULT_BRAND.accentColor),
    fontFamily: sanitizeFontFamily(brand.fontFamily, DEFAULT_BRAND.fontFamily),
  };

  const logoUrl = sanitizeReportUrl(brand.logoUrl, new Set(['http:', 'https:']));
  if (logoUrl) {
    sanitized.logoUrl = logoUrl;
  }
  if (brand.tagline) {
    sanitized.tagline = brand.tagline;
  }
  return sanitized;
}

// ─── Template Styles ─────────────────────────────────────────────

function getTemplateCSS(brand: BrandConfig, template: ReportTemplate): string {
  const base = `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: ${brand.fontFamily};
      color: #1a1a2e;
      line-height: 1.6;
      padding: 40px;
      max-width: 800px;
      margin: 0 auto;
    }
    h1 { color: ${brand.primaryColor}; font-size: 28px; margin-bottom: 8px; border-bottom: 3px solid ${brand.primaryColor}; padding-bottom: 12px; }
    h2 { color: ${brand.secondaryColor}; font-size: 22px; margin-top: 32px; margin-bottom: 12px; }
    h3 { color: ${brand.primaryColor}; font-size: 18px; margin-top: 24px; margin-bottom: 8px; }
    p { margin-bottom: 12px; }
    ul, ol { margin-bottom: 12px; padding-left: 24px; }
    li { margin-bottom: 4px; }
    code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
    pre { background: #1e1b4b; color: #e2e8f0; padding: 16px; border-radius: 8px; overflow-x: auto; margin-bottom: 16px; }
    pre code { background: none; color: inherit; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    th { background: ${brand.primaryColor}; color: white; padding: 10px 12px; text-align: left; font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.5px; }
    td { padding: 10px 12px; border-bottom: 1px solid #e5e7eb; }
    tr:nth-child(even) td { background: #f9fafb; }
    blockquote { border-left: 4px solid ${brand.accentColor}; padding: 12px 16px; background: ${brand.accentColor}10; margin-bottom: 16px; font-style: italic; }
    hr { border: none; border-top: 2px solid #e5e7eb; margin: 24px 0; }
    a { color: ${brand.primaryColor}; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .report-header { margin-bottom: 32px; }
    .report-header .logo { max-height: 48px; margin-bottom: 16px; }
    .report-header .subtitle { color: #6b7280; font-size: 16px; }
    .report-header .meta { color: #9ca3af; font-size: 12px; margin-top: 12px; }
    .report-footer { margin-top: 40px; padding-top: 16px; border-top: 2px solid ${brand.primaryColor}; color: #9ca3af; font-size: 11px; text-align: center; }
    @media print {
      body { padding: 20px; }
      .no-print { display: none; }
    }
  `;

  const templateExtras: Record<ReportTemplate, string> = {
    audit: `
      .severity-critical { color: #dc2626; font-weight: bold; }
      .severity-high { color: #ea580c; font-weight: bold; }
      .severity-medium { color: #d97706; }
      .severity-low { color: #65a30d; }
      .finding { background: #fef2f2; border-left: 4px solid #dc2626; padding: 12px; margin-bottom: 12px; border-radius: 0 8px 8px 0; }
    `,
    summary: `
      .metric { display: inline-block; background: ${brand.primaryColor}10; border: 1px solid ${brand.accentColor}; border-radius: 8px; padding: 12px 16px; margin: 4px; text-align: center; min-width: 120px; }
      .metric-value { font-size: 24px; font-weight: bold; color: ${brand.primaryColor}; }
      .metric-label { font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; }
    `,
    analysis: `
      .pro { color: #16a34a; }
      .con { color: #dc2626; }
      .recommendation { background: ${brand.primaryColor}08; border: 1px solid ${brand.accentColor}; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
    `,
    standup: `
      .status-done { color: #16a34a; }
      .status-progress { color: #2563eb; }
      .status-blocked { color: #dc2626; }
      .agent-card { background: #f8fafc; border-radius: 8px; padding: 12px; margin-bottom: 8px; border-left: 3px solid ${brand.primaryColor}; }
    `,
    custom: '',
  };

  return base + (templateExtras[template] || '');
}

// ─── Markdown to HTML (basic) ────────────────────────────────────

function renderInlineMarkdown(input: string): string {
  const codeFragments: string[] = [];
  const tokenized = input.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    const index = codeFragments.push(`<code>${escapeHtml(code)}</code>`) - 1;
    return `\uE000CODE${index}\uE000`;
  });

  const renderBasic = (value: string): string => {
    let html = escapeHtml(value)
      .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>');

    html = html.replace(/\uE000CODE(\d+)\uE000/g, (_match, index: string) => {
      return codeFragments[Number(index)] ?? '';
    });
    return html;
  };

  const linkPattern = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
  let rendered = '';
  let lastIndex = 0;
  for (const match of tokenized.matchAll(linkPattern)) {
    rendered += renderBasic(tokenized.slice(lastIndex, match.index));
    const label = renderBasic(match[1] ?? '');
    const href = sanitizeReportUrl(match[2], new Set(['http:', 'https:', 'mailto:']));
    rendered += href
      ? `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${label}</a>`
      : label;
    lastIndex = (match.index ?? 0) + match[0].length;
  }
  rendered += renderBasic(tokenized.slice(lastIndex));
  return rendered;
}

function sanitizeReportContentHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'h1',
      'h2',
      'h3',
      'p',
      'strong',
      'em',
      'pre',
      'code',
      'blockquote',
      'hr',
      'ul',
      'ol',
      'li',
      'a',
    ],
    allowedAttributes: {
      a: ['href', 'rel'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    enforceHtmlBoundary: true,
  });
}

function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let inCodeBlock = false;
  let codeBuffer: string[] = [];

  const closeList = () => {
    if (!listType) return;
    html.push(`</${listType}>`);
    listType = null;
  };

  const openList = (type: 'ul' | 'ol') => {
    if (listType === type) return;
    closeList();
    listType = type;
    html.push(`<${type}>`);
  };

  const closeCodeBlock = () => {
    html.push(`<pre><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`);
    codeBuffer = [];
    inCodeBlock = false;
  };

  for (const line of lines) {
    if (line.startsWith('```')) {
      closeList();
      if (inCodeBlock) {
        closeCodeBlock();
      } else {
        inCodeBlock = true;
        codeBuffer = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    if (!line.trim()) {
      closeList();
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1]?.length ?? 1;
      html.push(`<h${level}>${renderInlineMarkdown(heading[2] ?? '')}</h${level}>`);
      continue;
    }

    if (/^---\s*$/.test(line)) {
      closeList();
      html.push('<hr>');
      continue;
    }

    const unorderedItem = /^-\s+(.+)$/.exec(line);
    if (unorderedItem) {
      openList('ul');
      html.push(`<li>${renderInlineMarkdown(unorderedItem[1] ?? '')}</li>`);
      continue;
    }

    const orderedItem = /^\d+\.\s+(.+)$/.exec(line);
    if (orderedItem) {
      openList('ol');
      html.push(`<li>${renderInlineMarkdown(orderedItem[1] ?? '')}</li>`);
      continue;
    }

    const quote = /^>\s+(.+)$/.exec(line);
    if (quote) {
      closeList();
      html.push(`<blockquote>${renderInlineMarkdown(quote[1] ?? '')}</blockquote>`);
      continue;
    }

    closeList();
    html.push(`<p>${renderInlineMarkdown(line)}</p>`);
  }

  closeList();
  if (inCodeBlock) {
    closeCodeBlock();
  }

  return sanitizeReportContentHtml(html.join('\n'));
}

// ─── Service ─────────────────────────────────────────────────────

class PdfReportService {
  private brandConfig: BrandConfig = { ...DEFAULT_BRAND };
  private reports: GeneratedReport[] = [];
  private loaded = false;

  private get configPath(): string {
    return path.join(DATA_DIR, 'report-brand.json');
  }

  private get reportsPath(): string {
    return path.join(DATA_DIR, 'generated-reports.json');
  }

  private get outputDir(): string {
    return path.join(DATA_DIR, '..', 'docs', 'reports');
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const data = await fs.readFile(this.configPath, 'utf-8');
      this.brandConfig = sanitizeBrandConfig({ ...DEFAULT_BRAND, ...JSON.parse(data) });
    } catch {
      // Use defaults
    }
    try {
      const data = await fs.readFile(this.reportsPath, 'utf-8');
      this.reports = JSON.parse(data);
    } catch {
      this.reports = [];
    }
    this.loaded = true;
  }

  /**
   * Get current brand config.
   */
  async getBrand(): Promise<BrandConfig> {
    await this.ensureLoaded();
    return { ...this.brandConfig };
  }

  /**
   * Update brand config.
   */
  async updateBrand(update: Partial<BrandConfig>): Promise<BrandConfig> {
    await this.ensureLoaded();
    this.brandConfig = sanitizeBrandConfig({ ...this.brandConfig, ...update });
    await fs.writeFile(this.configPath, JSON.stringify(this.brandConfig, null, 2));
    return { ...this.brandConfig };
  }

  /**
   * Generate a branded HTML report from markdown.
   * The HTML includes print-optimized CSS for PDF generation via browser.
   */
  async generateReport(config: ReportConfig): Promise<GeneratedReport> {
    await this.ensureLoaded();

    const brand = sanitizeBrandConfig({ ...this.brandConfig, ...config.brand });
    const css = getTemplateCSS(brand, config.template);
    const contentHtml = markdownToHtml(config.content);
    const title = escapeHtml(config.title);
    const companyName = escapeHtml(brand.companyName);
    const tagline = brand.tagline ? escapeHtml(brand.tagline) : '';

    const timestamp =
      config.includeTimestamp !== false
        ? `<div class="report-header meta">Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>`
        : '';

    const authorLine = config.author
      ? `<div class="report-header meta">Author: ${escapeHtml(config.author)}</div>`
      : '';
    const subtitleLine = config.subtitle
      ? `<div class="report-header subtitle">${escapeHtml(config.subtitle)}</div>`
      : '';

    const logoHtml = brand.logoUrl
      ? `<img src="${escapeHtml(brand.logoUrl)}" class="logo" alt="${companyName}" />`
      : '';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - ${companyName}</title>
  <style>${css}</style>
</head>
<body>
  <div class="report-header">
    ${logoHtml}
    <h1>${title}</h1>
    ${subtitleLine}
    ${timestamp}
    ${authorLine}
  </div>

  <div class="report-content">
    ${contentHtml}
  </div>

  <div class="report-footer">
    ${companyName}${tagline ? ` - ${tagline}` : ''} - Generated by Veritas Kanban
  </div>
</body>
</html>`;

    // Save HTML file
    await fs.mkdir(this.outputDir, { recursive: true });
    const fileName = `${config.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}.html`;
    const filePath = path.join(this.outputDir, fileName);
    await fs.writeFile(filePath, html, 'utf-8');

    const stat = await fs.stat(filePath);
    const docsPath = `reports/${fileName}`;

    const report: GeneratedReport = {
      id: `report_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: config.title,
      template: config.template,
      htmlPath: filePath,
      docsPath,
      size: stat.size,
      generatedAt: new Date().toISOString(),
      brand,
    };

    this.reports.push(report);
    await fs.writeFile(this.reportsPath, JSON.stringify(this.reports, null, 2));

    log.info({ reportId: report.id, template: config.template }, 'Report generated');
    return report;
  }

  /**
   * List generated reports.
   */
  async listReports(limit = 50): Promise<GeneratedReport[]> {
    await this.ensureLoaded();
    return this.reports
      .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime())
      .slice(0, limit);
  }

  /**
   * Get a specific report.
   */
  async getReport(id: string): Promise<GeneratedReport | null> {
    await this.ensureLoaded();
    return this.reports.find((r) => r.id === id) || null;
  }

  /**
   * Get available templates.
   */
  getTemplates(): Array<{ id: ReportTemplate; name: string; description: string }> {
    return [
      {
        id: 'audit',
        name: 'Audit Report',
        description: 'Security/code audit with findings and recommendations',
      },
      {
        id: 'summary',
        name: 'Summary Report',
        description: 'Sprint/standup summary with key metrics',
      },
      {
        id: 'analysis',
        name: 'Analysis Report',
        description: 'Comparison/research analysis with pros/cons',
      },
      {
        id: 'standup',
        name: 'Standup Report',
        description: 'Daily standup with status updates per agent',
      },
      { id: 'custom', name: 'Custom Report', description: 'Freeform markdown with brand styling' },
    ];
  }
}

// Singleton
let instance: PdfReportService | null = null;

export function getPdfReportService(): PdfReportService {
  if (!instance) {
    instance = new PdfReportService();
  }
  return instance;
}
