import ExcelJS from 'exceljs';
import { fileTypeFromBuffer } from 'file-type';
import sanitizeHtml from 'sanitize-html';
import { extractLinks, getDocumentProxy } from 'unpdf';
import {
  WORK_PRODUCT_ARTIFACT_PREVIEW_SCHEMA_VERSION,
  WORK_PRODUCT_HTML_PREVIEW_CSP,
  WORK_PRODUCT_HTML_PREVIEW_SANDBOX,
  type WorkProductArtifactPreview,
  type WorkProductArtifactPreviewCell,
  type WorkProductArtifactPreviewSheet,
} from '@veritas-kanban/shared';
import type { WorkProductArtifactPreviewSource } from './work-product-artifact-service.js';
import { ForbiddenError } from '../middleware/error-handler.js';
import {
  getWorkProductArtifactService,
  type WorkProductArtifactService,
} from './work-product-artifact-service.js';

const KIB = 1024;
const MIB = KIB * KIB;
const TEXT_LIMIT = 1 * MIB;
const HTML_LIMIT = 512 * KIB;
const CSV_LIMIT = 1 * MIB;
const IMAGE_LIMIT = 8 * MIB;
const PDF_LIMIT = 8 * MIB;
const SPREADSHEET_LIMIT = 5 * MIB;
const TABLE_RESULT_LIMIT = 1 * MIB;
const MAX_ROWS = 200;
const MAX_COLUMNS = 50;
const MAX_CELL_CHARACTERS = 10_000;
const MAX_PAGES = 100;
const MAX_PIXELS = 40_000_000;
const MAX_IMAGE_DIMENSION = 16_384;
const MAX_GIF_FRAMES = 200;
const MAX_ARCHIVE_ENTRIES = 500;
const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 25 * MIB;
const MAX_ARCHIVE_RATIO = 100;
const MAX_SHEETS = 5;

const IMAGE_MEDIA = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const SPREADSHEET_MEDIA = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PDF_BLOCKED_TOKENS = [
  '/JavaScript',
  '/JS',
  '/Launch',
  '/EmbeddedFile',
  '/OpenAction',
  '/AA',
  '/XFA',
  '/RichMedia',
  '/URI',
];
const SPREADSHEET_BLOCKED_ENTRIES = [
  'xl/externallinks/',
  'xl/connections.xml',
  'xl/embeddings/',
  'xl/vbaproject.bin',
];

interface ArtifactPreviewServiceOptions {
  artifacts?: Pick<WorkProductArtifactService, 'readPreviewSource'>;
  now?: () => Date;
}

interface PreviewInput {
  workspaceId: string;
  productId: string;
  version?: number;
}

interface TableBuildResult {
  sheets: WorkProductArtifactPreviewSheet[];
  truncated: boolean;
  reasons: string[];
}

export class WorkProductArtifactPreviewService {
  private readonly artifacts: Pick<WorkProductArtifactService, 'readPreviewSource'>;
  private readonly now: () => Date;

  constructor(options: ArtifactPreviewServiceOptions = {}) {
    this.artifacts = options.artifacts ?? getWorkProductArtifactService();
    this.now = options.now ?? (() => new Date());
  }

  async preview(input: PreviewInput): Promise<WorkProductArtifactPreview> {
    let source: WorkProductArtifactPreviewSource | null;
    try {
      source = await this.artifacts.readPreviewSource(input);
    } catch (error) {
      if (error instanceof ForbiddenError) throw error;
      return this.missingPreview(
        'policy-blocked',
        'Artifact integrity or storage identity could not be validated.'
      );
    }
    if (!source) return this.missingPreview();
    if (
      source.metadata.expiresAt &&
      Date.parse(source.metadata.expiresAt) <= this.now().getTime()
    ) {
      return this.statusPreview(source, 'expired', 'Artifact preview access has expired.');
    }
    if (source.metadata.state === 'quarantined') {
      return this.statusPreview(
        source,
        'quarantined',
        source.metadata.redaction.reason ?? 'Artifact bytes are quarantined by content policy.'
      );
    }
    if (source.metadata.state === 'deleted' || !source.content) {
      return this.statusPreview(source, 'missing', 'Artifact bytes are no longer available.');
    }

    const mediaType = normalizeMediaType(source.metadata.mediaType);
    const content = Buffer.from(source.content);
    try {
      if (mediaType === 'text/plain') return await this.textPreview(source, content, false);
      if (mediaType === 'text/markdown') return await this.textPreview(source, content, true);
      if (mediaType === 'text/html') return await this.htmlPreview(source, content);
      if (mediaType === 'text/csv') return await this.csvPreview(source, content);
      if (IMAGE_MEDIA.has(mediaType)) return await this.imagePreview(source, content, mediaType);
      if (mediaType === 'application/pdf') return await this.pdfPreview(source, content);
      if (mediaType === SPREADSHEET_MEDIA) return await this.spreadsheetPreview(source, content);
      return this.statusPreview(
        source,
        'unsupported',
        `Preview is not supported for validated media type ${mediaType || 'unknown'}.`
      );
    } catch (error) {
      const message =
        error instanceof PreviewLimitError
          ? error.message
          : 'Artifact preview parsing failed safely.';
      return this.statusPreview(
        source,
        error instanceof PreviewLimitError ? 'oversized' : 'malformed',
        message
      );
    }
  }

  private async htmlPreview(
    source: WorkProductArtifactPreviewSource,
    content: Buffer
  ): Promise<WorkProductArtifactPreview> {
    enforceBytes(content, HTML_LIMIT, 'HTML preview');
    const detected = await fileTypeFromBuffer(content);
    if (detected) {
      return this.statusPreview(
        source,
        'policy-blocked',
        `HTML preview content was detected as ${detected.mime}.`
      );
    }
    const html = decodeUtf8(content);
    if (html.includes('\0')) throw new Error('HTML contains null bytes.');
    const passiveBody = sanitizeHtml(html, {
      allowedTags: [
        'article',
        'aside',
        'blockquote',
        'br',
        'caption',
        'code',
        'col',
        'colgroup',
        'dd',
        'details',
        'div',
        'dl',
        'dt',
        'em',
        'figcaption',
        'figure',
        'footer',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'header',
        'hr',
        'kbd',
        'li',
        'main',
        'mark',
        'nav',
        'ol',
        'p',
        'pre',
        's',
        'section',
        'small',
        'span',
        'strong',
        'sub',
        'summary',
        'sup',
        'table',
        'tbody',
        'td',
        'tfoot',
        'th',
        'thead',
        'tr',
        'u',
        'ul',
      ],
      allowedAttributes: {
        '*': ['aria-label', 'aria-hidden', 'dir', 'lang', 'role', 'title'],
        col: ['span'],
        details: ['open'],
        li: ['value'],
        ol: ['reversed', 'start', 'type'],
        td: ['colspan', 'rowspan'],
        th: ['colspan', 'rowspan', 'scope'],
      },
      allowedSchemes: [],
      allowProtocolRelative: false,
      disallowedTagsMode: 'discard',
      enforceHtmlBoundary: true,
    });
    return this.readyPreview(
      source,
      'html',
      {
        kind: 'html',
        document: passiveHtmlDocument(passiveBody),
        interactive: false,
        contentSecurityPolicy: WORK_PRODUCT_HTML_PREVIEW_CSP,
        sandbox: WORK_PRODUCT_HTML_PREVIEW_SANDBOX,
      },
      { maxBytes: HTML_LIMIT }
    );
  }

  private async textPreview(
    source: WorkProductArtifactPreviewSource,
    content: Buffer,
    markdown: boolean
  ): Promise<WorkProductArtifactPreview> {
    enforceBytes(content, TEXT_LIMIT, 'Text preview');
    const detected = await fileTypeFromBuffer(content);
    if (detected) {
      return this.statusPreview(
        source,
        'policy-blocked',
        `Text preview content was detected as ${detected.mime}.`
      );
    }
    const text = decodeUtf8(content);
    if (text.includes('\0')) throw new Error('Text contains null bytes.');
    return this.readyPreview(
      source,
      markdown ? 'markdown' : 'text',
      {
        kind: 'text',
        text,
      },
      { maxBytes: TEXT_LIMIT }
    );
  }

  private async csvPreview(
    source: WorkProductArtifactPreviewSource,
    content: Buffer
  ): Promise<WorkProductArtifactPreview> {
    enforceBytes(content, CSV_LIMIT, 'CSV preview');
    const detected = await fileTypeFromBuffer(content);
    if (detected) {
      return this.statusPreview(
        source,
        'policy-blocked',
        `CSV preview content was detected as ${detected.mime}.`
      );
    }
    const table = parseCsv(decodeUtf8(content));
    return this.readyPreview(
      source,
      'table',
      { kind: 'table', sheets: table.sheets },
      tableLimits(CSV_LIMIT),
      table.truncated,
      table.reasons
    );
  }

  private async imagePreview(
    source: WorkProductArtifactPreviewSource,
    content: Buffer,
    mediaType: string
  ): Promise<WorkProductArtifactPreview> {
    enforceBytes(content, IMAGE_LIMIT, 'Image preview');
    const detected = await fileTypeFromBuffer(content);
    if (!detected || detected.mime !== mediaType) {
      return this.statusPreview(
        source,
        'policy-blocked',
        `Image bytes do not match validated media type ${mediaType}.`
      );
    }
    const dimensions = imageDimensions(content, mediaType);
    if (
      dimensions.width < 1 ||
      dimensions.height < 1 ||
      dimensions.width > MAX_IMAGE_DIMENSION ||
      dimensions.height > MAX_IMAGE_DIMENSION ||
      dimensions.width * dimensions.height > MAX_PIXELS
    ) {
      throw new PreviewLimitError('Image dimensions exceed the safe preview limit.');
    }
    if (dimensions.frames > MAX_GIF_FRAMES) {
      throw new PreviewLimitError('Animated image frame count exceeds the safe preview limit.');
    }
    return this.readyPreview(
      source,
      'image',
      {
        kind: 'image',
        base64: content.toString('base64'),
        width: dimensions.width,
        height: dimensions.height,
        animated: dimensions.frames > 1,
      },
      { maxBytes: IMAGE_LIMIT, maxPixels: MAX_PIXELS }
    );
  }

  private async pdfPreview(
    source: WorkProductArtifactPreviewSource,
    content: Buffer
  ): Promise<WorkProductArtifactPreview> {
    enforceBytes(content, PDF_LIMIT, 'PDF preview');
    const detected = await fileTypeFromBuffer(content);
    if (detected?.mime !== 'application/pdf') {
      return this.statusPreview(
        source,
        'policy-blocked',
        'PDF magic bytes are missing or invalid.'
      );
    }
    const sourceText = content.toString('latin1');
    if (PDF_BLOCKED_TOKENS.some((token) => sourceText.includes(token))) {
      return this.statusPreview(
        source,
        'policy-blocked',
        'PDF contains active actions, external references, or embedded content.'
      );
    }
    const document = await getDocumentProxy(new Uint8Array(content), {
      disableAutoFetch: true,
      disableRange: true,
      disableStream: true,
      maxImageSize: MAX_PIXELS,
      stopAtErrors: true,
    });
    const pages = document.numPages;
    try {
      if (pages < 1) throw new Error('PDF page tree could not be validated.');
      if (pages > MAX_PAGES) {
        throw new PreviewLimitError('PDF page count exceeds the safe preview limit.');
      }
      const links = await extractLinks(document);
      if (links.links.length > 0) {
        return this.statusPreview(
          source,
          'policy-blocked',
          'PDF contains external or interactive links.'
        );
      }
    } finally {
      await document.cleanup();
      await document.loadingTask.destroy();
    }
    return this.readyPreview(
      source,
      'pdf',
      { kind: 'pdf', base64: content.toString('base64'), pages },
      { maxBytes: PDF_LIMIT, maxPages: MAX_PAGES }
    );
  }

  private async spreadsheetPreview(
    source: WorkProductArtifactPreviewSource,
    content: Buffer
  ): Promise<WorkProductArtifactPreview> {
    enforceBytes(content, SPREADSHEET_LIMIT, 'Spreadsheet preview');
    const detected = await fileTypeFromBuffer(content);
    if (!detected || ![SPREADSHEET_MEDIA, 'application/zip'].includes(detected.mime)) {
      return this.statusPreview(
        source,
        'policy-blocked',
        'Spreadsheet bytes are not a validated Open XML workbook.'
      );
    }
    const archive = inspectZip(content);
    if (
      archive.entries.some((entry) =>
        SPREADSHEET_BLOCKED_ENTRIES.some((blocked) => entry.name.toLowerCase().startsWith(blocked))
      )
    ) {
      return this.statusPreview(
        source,
        'policy-blocked',
        'Spreadsheet contains macros, embedded content, connections, or external workbook links.'
      );
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(content as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    if (workbookHasExternalReferences(workbook)) {
      return this.statusPreview(
        source,
        'policy-blocked',
        'Spreadsheet contains external references, hyperlinks, or embedded media.'
      );
    }
    const table = workbookTable(workbook);
    return this.readyPreview(
      source,
      'table',
      { kind: 'table', sheets: table.sheets },
      tableLimits(SPREADSHEET_LIMIT),
      table.truncated,
      table.reasons
    );
  }

  private readyPreview(
    source: WorkProductArtifactPreviewSource,
    renderer: WorkProductArtifactPreview['renderer'],
    content: NonNullable<WorkProductArtifactPreview['content']>,
    limits: WorkProductArtifactPreview['limits'],
    truncated = false,
    reasons: string[] = []
  ): WorkProductArtifactPreview {
    return {
      ...this.basePreview(source),
      status: 'ready',
      renderer,
      message: truncated ? 'Preview is bounded and truncated.' : 'Preview is ready.',
      limits,
      truncation: { truncated, reasons },
      content,
    };
  }

  private statusPreview(
    source: WorkProductArtifactPreviewSource,
    status: Exclude<WorkProductArtifactPreview['status'], 'ready'>,
    message: string
  ): WorkProductArtifactPreview {
    return {
      ...this.basePreview(source),
      status,
      renderer: 'none',
      message,
      limits: { maxBytes: 0 },
      truncation: { truncated: false, reasons: [] },
      content: null,
    };
  }

  private missingPreview(
    status: 'missing' | 'policy-blocked' = 'missing',
    message = 'Artifact or requested version was not found.'
  ): WorkProductArtifactPreview {
    return {
      schemaVersion: WORK_PRODUCT_ARTIFACT_PREVIEW_SCHEMA_VERSION,
      status,
      renderer: 'none',
      message,
      artifact: null,
      sourceRunId: null,
      redactionState: null,
      causalEvent: null,
      limits: { maxBytes: 0 },
      truncation: { truncated: false, reasons: [] },
      actions: { downloadAllowed: false, openAssociatedAppAllowed: false },
      content: null,
    };
  }

  private basePreview(source: WorkProductArtifactPreviewSource) {
    const available =
      source.metadata.state === 'available' &&
      Boolean(source.content) &&
      (!source.metadata.expiresAt || Date.parse(source.metadata.expiresAt) > this.now().getTime());
    return {
      schemaVersion: WORK_PRODUCT_ARTIFACT_PREVIEW_SCHEMA_VERSION,
      artifact: source.metadata,
      sourceRunId: source.metadata.runId,
      redactionState: source.metadata.redaction.state,
      causalEvent: {
        taskId: source.metadata.taskId,
        runId: source.metadata.runId,
        attemptId: source.metadata.attemptId,
        eventId: source.metadata.producingEventId,
      },
      actions: {
        downloadAllowed: available,
        openAssociatedAppAllowed: available,
      },
    } as const;
  }
}

class PreviewLimitError extends Error {}

function normalizeMediaType(value: string): string {
  return value.toLowerCase().split(';', 1)[0]?.trim() ?? '';
}

function enforceBytes(content: Buffer, limit: number, label: string): void {
  if (content.byteLength > limit) {
    throw new PreviewLimitError(`${label} exceeds the ${limit}-byte limit.`);
  }
}

function decodeUtf8(content: Buffer): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(content);
}

function passiveHtmlDocument(body: string): string {
  const csp = WORK_PRODUCT_HTML_PREVIEW_CSP.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root { color-scheme: dark; font-family: Roboto, ui-sans-serif, system-ui, sans-serif; }
body { box-sizing: border-box; margin: 0; padding: 24px; color: #e5e7eb; background: #111827; line-height: 1.55; overflow-wrap: anywhere; }
*, *::before, *::after { box-sizing: inherit; }
h1, h2, h3, h4, h5, h6 { color: #f9fafb; line-height: 1.2; }
code, pre, kbd { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
pre { max-width: 100%; padding: 12px; overflow: auto; border: 1px solid #374151; border-radius: 6px; background: #030712; }
blockquote { margin-inline: 0; padding-left: 16px; border-left: 3px solid #6b7280; color: #d1d5db; }
table { width: 100%; border-collapse: collapse; }
caption { margin-bottom: 8px; font-weight: 600; text-align: left; }
th, td { padding: 8px; border: 1px solid #4b5563; text-align: left; vertical-align: top; }
th { background: #1f2937; }
hr { border: 0; border-top: 1px solid #4b5563; }
</style>
</head>
<body>${body}</body>
</html>`;
}

function tableLimits(maxBytes: number): WorkProductArtifactPreview['limits'] {
  return {
    maxBytes,
    maxRows: MAX_ROWS,
    maxColumns: MAX_COLUMNS,
    maxCellCharacters: MAX_CELL_CHARACTERS,
  };
}

function previewCell(value: unknown): WorkProductArtifactPreviewCell {
  const formula = typeof value === 'string' && /^[=+\-@]/.test(value.trimStart());
  const text = value === null || value === undefined ? '' : String(value);
  return {
    text: text.slice(0, MAX_CELL_CHARACTERS),
    formula,
    truncated: text.length > MAX_CELL_CHARACTERS,
  };
}

function parseCsv(value: string): TableBuildResult {
  const parsed: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let index = 0;
  let totalResultBytes = 0;
  let resultTruncated = false;
  let totalColumns = 0;
  let totalRows = 0;
  while (index <= value.length) {
    const character = value[index];
    if (quoted) {
      if (character === '"' && value[index + 1] === '"') {
        cell += '"';
        index += 2;
        continue;
      }
      if (character === '"') quoted = false;
      else if (character === undefined) throw new Error('CSV has an unterminated quoted cell.');
      else cell += character;
      index += 1;
      continue;
    }
    if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (
      character === ',' ||
      character === '\n' ||
      character === '\r' ||
      character === undefined
    ) {
      row.push(cell);
      cell = '';
      if (character === ',' && row.length > MAX_COLUMNS) resultTruncated = true;
      if (character !== ',') {
        if (!(character === '\n' && value[index - 1] === '\r')) {
          totalRows += 1;
          totalColumns = Math.max(totalColumns, row.length);
          if (parsed.length < MAX_ROWS && totalResultBytes < TABLE_RESULT_LIMIT) {
            const bounded = row.slice(0, MAX_COLUMNS);
            totalResultBytes += bounded.reduce((sum, entry) => sum + entry.length, 0);
            parsed.push(bounded);
          } else resultTruncated = true;
          row = [];
        }
      }
    } else {
      cell += character;
    }
    index += 1;
  }
  if (value.length === 0) parsed.length = 0;
  const cells = parsed.map((candidate) => candidate.map(previewCell));
  const cellTruncated = cells.some((candidate) => candidate.some((entry) => entry.truncated));
  const truncated =
    resultTruncated || totalRows > MAX_ROWS || totalColumns > MAX_COLUMNS || cellTruncated;
  return {
    sheets: [{ name: 'CSV', rows: cells, totalRows, totalColumns, truncated }],
    truncated,
    reasons: [
      ...(totalRows > MAX_ROWS ? [`Rows limited to ${MAX_ROWS}.`] : []),
      ...(totalColumns > MAX_COLUMNS ? [`Columns limited to ${MAX_COLUMNS}.`] : []),
      ...(cellTruncated ? [`Cells limited to ${MAX_CELL_CHARACTERS} characters.`] : []),
      ...(totalResultBytes >= TABLE_RESULT_LIMIT ? ['Rendered table size limit reached.'] : []),
    ],
  };
}

function workbookTable(workbook: ExcelJS.Workbook): TableBuildResult {
  const sheets: WorkProductArtifactPreviewSheet[] = [];
  const reasons = new Set<string>();
  let resultBytes = 0;
  let workbookTruncated = workbook.worksheets.length > MAX_SHEETS;
  if (workbookTruncated) reasons.add(`Sheets limited to ${MAX_SHEETS}.`);
  for (const worksheet of workbook.worksheets.slice(0, MAX_SHEETS)) {
    const totalRows = worksheet.actualRowCount;
    const totalColumns = worksheet.actualColumnCount;
    const rows: WorkProductArtifactPreviewCell[][] = [];
    let sheetTruncated = totalRows > MAX_ROWS || totalColumns > MAX_COLUMNS;
    if (totalRows > MAX_ROWS) reasons.add(`Rows limited to ${MAX_ROWS}.`);
    if (totalColumns > MAX_COLUMNS) reasons.add(`Columns limited to ${MAX_COLUMNS}.`);
    for (let rowIndex = 1; rowIndex <= Math.min(totalRows, MAX_ROWS); rowIndex += 1) {
      const row: WorkProductArtifactPreviewCell[] = [];
      for (
        let columnIndex = 1;
        columnIndex <= Math.min(totalColumns, MAX_COLUMNS);
        columnIndex += 1
      ) {
        const cell = worksheet.getCell(rowIndex, columnIndex);
        const raw = cell.value;
        const value =
          raw && typeof raw === 'object' && 'formula' in raw
            ? `=${String(raw.formula)}`
            : raw && typeof raw === 'object' && 'richText' in raw
              ? raw.richText.map((part) => part.text).join('')
              : cell.text;
        const projected = previewCell(value);
        if (projected.truncated) {
          sheetTruncated = true;
          reasons.add(`Cells limited to ${MAX_CELL_CHARACTERS} characters.`);
        }
        resultBytes += projected.text.length;
        if (resultBytes > TABLE_RESULT_LIMIT) {
          sheetTruncated = true;
          workbookTruncated = true;
          reasons.add('Rendered table size limit reached.');
          break;
        }
        row.push(projected);
      }
      if (row.length > 0) rows.push(row);
      if (resultBytes > TABLE_RESULT_LIMIT) break;
    }
    sheets.push({
      name: worksheet.name.slice(0, 200),
      rows,
      totalRows,
      totalColumns,
      truncated: sheetTruncated,
    });
    workbookTruncated ||= sheetTruncated;
    if (resultBytes > TABLE_RESULT_LIMIT) break;
  }
  return { sheets, truncated: workbookTruncated, reasons: [...reasons] };
}

function workbookHasExternalReferences(workbook: ExcelJS.Workbook): boolean {
  if (workbook.model.media.length > 0) return true;
  for (const worksheet of workbook.worksheets) {
    if (worksheet.getImages().length > 0) return true;
    let blocked = false;
    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        const value = cell.value;
        if (!value || typeof value !== 'object') return;
        if ('hyperlink' in value && value.hyperlink) blocked = true;
        if (
          'formula' in value &&
          /(?:\[[^\]]+\]|\b(?:HYPERLINK|WEBSERVICE|RTD)\s*\()/i.test(String(value.formula))
        ) {
          blocked = true;
        }
      });
    });
    if (blocked) return true;
  }
  return false;
}

function inspectZip(content: Buffer): { entries: Array<{ name: string }> } {
  const entries: Array<{ name: string }> = [];
  let totalCompressed = 0;
  let totalUncompressed = 0;
  for (let offset = 0; offset + 46 <= content.length; offset += 1) {
    if (content.readUInt32LE(offset) !== 0x02014b50) continue;
    const compressed = content.readUInt32LE(offset + 20);
    const uncompressed = content.readUInt32LE(offset + 24);
    const nameLength = content.readUInt16LE(offset + 28);
    const extraLength = content.readUInt16LE(offset + 30);
    const commentLength = content.readUInt16LE(offset + 32);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > content.length) throw new Error('Spreadsheet archive directory is malformed.');
    const name = content.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    entries.push({ name });
    totalCompressed += compressed;
    totalUncompressed += uncompressed;
    if (entries.length > MAX_ARCHIVE_ENTRIES) {
      throw new PreviewLimitError('Spreadsheet archive has too many entries.');
    }
    if (totalUncompressed > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
      throw new PreviewLimitError('Spreadsheet decompressed size exceeds the safe preview limit.');
    }
    offset = end - 1;
  }
  if (entries.length === 0) throw new Error('Spreadsheet archive directory is missing.');
  if (totalCompressed === 0 || totalUncompressed / totalCompressed > MAX_ARCHIVE_RATIO) {
    throw new PreviewLimitError('Spreadsheet compression ratio exceeds the safe preview limit.');
  }
  return { entries };
}

function imageDimensions(
  content: Buffer,
  mediaType: string
): { width: number; height: number; frames: number } {
  if (mediaType === 'image/png' && content.length >= 24) {
    return { width: content.readUInt32BE(16), height: content.readUInt32BE(20), frames: 1 };
  }
  if (mediaType === 'image/gif' && content.length >= 10) {
    let frames = 0;
    for (const byte of content) if (byte === 0x2c) frames += 1;
    return { width: content.readUInt16LE(6), height: content.readUInt16LE(8), frames };
  }
  if (mediaType === 'image/jpeg') return jpegDimensions(content);
  if (mediaType === 'image/webp') return webpDimensions(content);
  throw new Error('Image dimensions could not be parsed.');
}

function jpegDimensions(content: Buffer): { width: number; height: number; frames: number } {
  let offset = 2;
  while (offset + 9 < content.length) {
    if (content[offset] !== 0xff) throw new Error('JPEG marker stream is malformed.');
    const marker = content[offset + 1] ?? 0;
    if (
      [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
        marker
      )
    ) {
      return {
        width: content.readUInt16BE(offset + 7),
        height: content.readUInt16BE(offset + 5),
        frames: 1,
      };
    }
    const length = content.readUInt16BE(offset + 2);
    if (length < 2) throw new Error('JPEG marker length is invalid.');
    offset += length + 2;
  }
  throw new Error('JPEG dimensions could not be parsed.');
}

function webpDimensions(content: Buffer): { width: number; height: number; frames: number } {
  if (content.length < 30) throw new Error('WebP header is incomplete.');
  const kind = content.subarray(12, 16).toString('ascii');
  if (kind === 'VP8X') {
    const width = content.readUIntLE(24, 3) + 1;
    const height = content.readUIntLE(27, 3) + 1;
    const animated = Boolean((content[20] ?? 0) & 0x02);
    return { width, height, frames: animated ? 2 : 1 };
  }
  if (kind === 'VP8L') {
    const bits = content.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, frames: 1 };
  }
  if (kind === 'VP8 ' && content.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))) {
    return {
      width: content.readUInt16LE(26) & 0x3fff,
      height: content.readUInt16LE(28) & 0x3fff,
      frames: 1,
    };
  }
  throw new Error('WebP dimensions could not be parsed.');
}

let workProductArtifactPreviewService: WorkProductArtifactPreviewService | undefined;

export function getWorkProductArtifactPreviewService(): WorkProductArtifactPreviewService {
  workProductArtifactPreviewService ??= new WorkProductArtifactPreviewService();
  return workProductArtifactPreviewService;
}

export function resetWorkProductArtifactPreviewServiceForTests(): void {
  workProductArtifactPreviewService = undefined;
}
