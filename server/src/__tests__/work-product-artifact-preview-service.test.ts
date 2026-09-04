import ExcelJS from 'exceljs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkProductArtifactMetadata } from '@veritas-kanban/shared';
import {
  WORK_PRODUCT_HTML_PREVIEW_CSP,
  WORK_PRODUCT_HTML_PREVIEW_SANDBOX,
} from '@veritas-kanban/shared';
import { WorkProductArtifactPreviewService } from '../services/work-product-artifact-preview-service.js';
import type { WorkProductArtifactPreviewSource } from '../services/work-product-artifact-service.js';

describe('WorkProductArtifactPreviewService', () => {
  const readPreviewSource = vi.fn();
  let service: WorkProductArtifactPreviewService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new WorkProductArtifactPreviewService({
      artifacts: { readPreviewSource },
      now: () => new Date('2026-08-30T12:00:00.000Z'),
    });
  });

  it('renders bounded UTF-8 text and markdown from validated content', async () => {
    for (const [mediaType, renderer] of [
      ['text/plain', 'text'],
      ['text/markdown', 'markdown'],
    ] as const) {
      readPreviewSource.mockResolvedValueOnce(source(mediaType, Buffer.from('# Safe\n')));
      await expect(preview()).resolves.toMatchObject({
        status: 'ready',
        renderer,
        content: { kind: 'text', text: '# Safe\n' },
        artifact: { version: 2, sha256: 'a'.repeat(64) },
        causalEvent: { eventId: 'runevt_preview' },
        actions: { downloadAllowed: true, openAssociatedAppAllowed: true },
      });
    }
  });

  it('reduces hostile HTML to a passive unique-origin document contract', async () => {
    readPreviewSource.mockResolvedValue(
      source(
        'text/html',
        Buffer.from(`<!doctype html>
          <html><head>
            <meta http-equiv="refresh" content="0;url=https://attacker.invalid/refresh">
            <style>@import url(https://attacker.invalid/style.css)</style>
            <script>parent.fetch('/api/tasks')</script>
          </head><body onload="alert(document.cookie)">
            <h1>Reviewed report</h1>
            <a href="javascript:alert(1)" download>unsafe link</a>
            <img src="https://attacker.invalid/pixel" onerror="alert(1)">
            <form action="https://attacker.invalid/submit"><button>Submit</button></form>
            <iframe src="file:///etc/passwd"></iframe>
          </body></html>`)
      )
    );

    const result = await preview();

    expect(result).toMatchObject({
      status: 'ready',
      renderer: 'html',
      limits: { maxBytes: 512 * 1024 },
      content: {
        kind: 'html',
        interactive: false,
        contentSecurityPolicy: WORK_PRODUCT_HTML_PREVIEW_CSP,
        sandbox: WORK_PRODUCT_HTML_PREVIEW_SANDBOX,
      },
    });
    if (result.content?.kind !== 'html') throw new Error('Expected HTML preview.');
    expect(result.content.document).toContain('<h1>Reviewed report</h1>');
    expect(result.content.document).toContain('unsafe link');
    expect(result.content.document).not.toMatch(
      /<script|<meta[^>]+refresh|<iframe|<form|<img|onload=|onerror=|javascript:|attacker\.invalid|file:\/\//i
    );
    expect(result.content.document).toContain('http-equiv="Content-Security-Policy"');
  });

  it('fails closed for malformed or oversized HTML', async () => {
    readPreviewSource.mockResolvedValueOnce(source('text/html', Buffer.from([0xc3, 0x28])));
    await expect(preview()).resolves.toMatchObject({ status: 'malformed', content: null });

    readPreviewSource.mockResolvedValueOnce(source('text/html', Buffer.alloc(512 * 1024 + 1, 'a')));
    await expect(preview()).resolves.toMatchObject({ status: 'oversized', content: null });
  });

  it('parses CSV literally, marks formula-shaped cells, and exposes truncation', async () => {
    const csv = [
      'name,value',
      'safe,1',
      '=HYPERLINK("https://example.com"),2',
      ...Array(205).fill('extra,3'),
    ].join('\n');
    readPreviewSource.mockResolvedValue(source('text/csv', Buffer.from(csv)));

    const result = await preview();

    expect(result).toMatchObject({
      status: 'ready',
      renderer: 'table',
      truncation: { truncated: true },
      content: { kind: 'table', sheets: [{ totalRows: 208, totalColumns: 2 }] },
    });
    if (result.content?.kind !== 'table') throw new Error('Expected table preview.');
    expect(result.content.sheets[0]?.rows[2]?.[0]).toMatchObject({ formula: true });
    expect(JSON.stringify(result)).not.toContain('storageKey');
  });

  it('validates raster magic bytes and rejects decompression-sized dimensions', async () => {
    const valid = png(640, 480);
    readPreviewSource.mockResolvedValueOnce(source('image/png', valid));
    await expect(preview()).resolves.toMatchObject({
      status: 'ready',
      renderer: 'image',
      content: { kind: 'image', width: 640, height: 480 },
      limits: { maxPixels: 40_000_000 },
    });

    readPreviewSource.mockResolvedValueOnce(source('image/png', png(20_000, 20_000)));
    await expect(preview()).resolves.toMatchObject({ status: 'oversized', renderer: 'none' });
  });

  it('offers PDF download without preview bytes and preserves active-content rejection', async () => {
    readPreviewSource.mockResolvedValueOnce(source('application/pdf', pdfFixture()));
    await expect(preview()).resolves.toMatchObject({
      status: 'unsupported',
      renderer: 'none',
      content: null,
      message: expect.stringContaining('preferred PDF viewer'),
      actions: { downloadAllowed: true },
    });

    readPreviewSource.mockResolvedValueOnce(
      source('application/pdf', Buffer.from('%PDF-1.7\n<</Type /Page /OpenAction /JS>>'))
    );
    await expect(preview()).resolves.toMatchObject({
      status: 'policy-blocked',
      renderer: 'none',
    });
  });

  it('renders formulas as inert spreadsheet text and bounds archive expansion', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Review');
    sheet.addRow(['name', 'value']);
    sheet.addRow(['safe', { formula: 'SUM(1, 2)', result: 3 }]);
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    readPreviewSource.mockResolvedValueOnce(source(xlsxMediaType, bytes));

    const result = await preview();
    expect(result).toMatchObject({ status: 'ready', renderer: 'table' });
    if (result.content?.kind !== 'table') throw new Error('Expected table preview.');
    expect(result.content.sheets[0]?.rows[1]?.[1]).toEqual({
      text: '=SUM(1, 2)',
      formula: true,
      truncated: false,
    });

    const externalWorkbook = new ExcelJS.Workbook();
    externalWorkbook.addWorksheet('External').getCell('A1').value = {
      text: 'Remote',
      hyperlink: 'https://example.com/private',
    };
    readPreviewSource.mockResolvedValueOnce(
      source(xlsxMediaType, Buffer.from(await externalWorkbook.xlsx.writeBuffer()))
    );
    await expect(preview()).resolves.toMatchObject({
      status: 'policy-blocked',
      content: null,
    });

    readPreviewSource.mockResolvedValueOnce(source(xlsxMediaType, zipExpansionFixture()));
    await expect(preview()).resolves.toMatchObject({ status: 'oversized', renderer: 'none' });
  });

  it('returns actionable fail-closed states without exposing unavailable bytes', async () => {
    readPreviewSource.mockRejectedValueOnce(new Error('storage/private/path'));
    await expect(preview()).resolves.toMatchObject({
      status: 'policy-blocked',
      artifact: null,
      message: 'Artifact integrity or storage identity could not be validated.',
    });

    readPreviewSource.mockResolvedValueOnce(null);
    await expect(preview()).resolves.toMatchObject({
      status: 'missing',
      artifact: null,
      actions: { downloadAllowed: false },
    });

    readPreviewSource.mockResolvedValueOnce({
      ...source('text/plain', Buffer.from('expired')),
      metadata: {
        ...metadata('text/plain'),
        expiresAt: '2026-08-30T11:59:59.000Z',
      },
    });
    await expect(preview()).resolves.toMatchObject({
      status: 'expired',
      content: null,
      actions: { downloadAllowed: false, openAssociatedAppAllowed: false },
    });

    readPreviewSource.mockResolvedValueOnce({
      ...source('image/svg+xml', null),
      metadata: metadata('image/svg+xml', 'quarantined'),
    });
    await expect(preview()).resolves.toMatchObject({
      status: 'quarantined',
      content: null,
      actions: { downloadAllowed: false },
    });

    readPreviewSource.mockResolvedValueOnce(source('application/octet-stream', Buffer.from('x')));
    await expect(preview()).resolves.toMatchObject({ status: 'unsupported', renderer: 'none' });

    readPreviewSource.mockResolvedValueOnce(source('text/plain', Buffer.alloc(1024 * 1024 + 1)));
    await expect(preview()).resolves.toMatchObject({ status: 'oversized', content: null });
  });

  function preview() {
    return service.preview({ workspaceId: 'local', productId: 'wp_preview', version: 2 });
  }
});

const xlsxMediaType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function metadata(
  mediaType: string,
  state: WorkProductArtifactMetadata['state'] = 'available'
): WorkProductArtifactMetadata {
  return {
    schemaVersion: 'work-product-artifact/v1',
    id: 'wpa_preview',
    productId: 'wp_preview',
    version: 2,
    workspaceId: 'local',
    taskId: 'task_preview',
    runId: 'run_preview',
    attemptId: 'attempt_preview',
    producingEventId: 'runevt_preview',
    requestIdDigest: `sha256:${'b'.repeat(64)}`,
    launchManifestDigest: `sha256:${'c'.repeat(64)}`,
    mediaType,
    byteSize: 10,
    sha256: 'a'.repeat(64),
    safeName: 'preview.bin',
    state,
    redaction:
      state === 'quarantined' ? { state: 'quarantined', reason: 'Blocked.' } : { state: 'none' },
    createdAt: '2026-08-30T00:00:00.000Z',
  };
}

function source(mediaType: string, content: Buffer | null): WorkProductArtifactPreviewSource {
  return { metadata: metadata(mediaType), productStatus: 'active', content };
}

function png(width: number, height: number): Buffer {
  const result = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(result);
  result.writeUInt32BE(13, 8);
  result.write('IHDR', 12, 'ascii');
  result.writeUInt32BE(width, 16);
  result.writeUInt32BE(height, 20);
  return result;
}

function zipExpansionFixture(): Buffer {
  const name = Buffer.from('[Content_Types].xml');
  const local = Buffer.alloc(30 + name.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(name.length, 26);
  name.copy(local, 30);
  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt32LE(1, 20);
  central.writeUInt32LE(26 * 1024 * 1024, 24);
  central.writeUInt16LE(name.length, 28);
  name.copy(central, 46);
  return Buffer.concat([local, central]);
}

function pdfFixture(): Buffer {
  const stream = 'BT\nET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}
