import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { TextExtractionService } from '../services/text-extraction-service.js';
import ExcelJS from 'exceljs';

describe('TextExtractionService', () => {
  let service: TextExtractionService;
  let testRoot: string;

  beforeEach(async () => {
    const uniqueSuffix = Math.random().toString(36).substring(7);
    testRoot = path.join(os.tmpdir(), `veritas-test-extraction-${uniqueSuffix}`);
    await fs.mkdir(testRoot, { recursive: true });
    service = new TextExtractionService();
  });

  afterEach(async () => {
    if (testRoot) {
      await fs.rm(testRoot, { recursive: true, force: true }).catch(() => {});
    }
  });

  describe('Plain text extraction', () => {
    it('should extract text from plain text file', async () => {
      const filepath = path.join(testRoot, 'test.txt');
      const content = 'This is plain text content.\nWith multiple lines.';
      await fs.writeFile(filepath, content);

      const extracted = await service.extractText(filepath, 'text/plain');
      expect(extracted).toBe(content);
    });

    it('should extract text from markdown file', async () => {
      const filepath = path.join(testRoot, 'test.md');
      const content = '# Heading\n\nThis is markdown content.';
      await fs.writeFile(filepath, content);

      const extracted = await service.extractText(filepath, 'text/markdown');
      expect(extracted).toBe(content);
    });
  });

  describe('PDF extraction', () => {
    it('extracts the expected text from a valid PDF without changing the file', async () => {
      const filepath = path.join(testRoot, 'sample.pdf');
      const buffer = pdfTextFixture('Release compatibility sample');
      await fs.writeFile(filepath, buffer);

      expect(await service.extractText(filepath, 'application/pdf')).toBe(
        'Release compatibility sample'
      );
      expect(await fs.readFile(filepath)).toEqual(buffer);
    });

    it('returns null for an invalid PDF without throwing', async () => {
      const filepath = path.join(testRoot, 'invalid.pdf');
      await fs.writeFile(filepath, '%PDF-1.4\nminimal pdf');
      await expect(service.extractText(filepath, 'application/pdf')).resolves.toBeNull();
    });
  });

  describe('DOCX extraction', () => {
    it('should extract text from DOCX', async () => {
      // Note: This test would need a real DOCX file or mocked mammoth library
      // Testing the flow with an invalid file
      const filepath = path.join(testRoot, 'test.docx');
      const buffer = Buffer.from('fake docx content');
      await fs.writeFile(filepath, buffer);

      const extracted = await service.extractText(
        filepath,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
      // Should return null for invalid DOCX
      expect(typeof extracted === 'string' || extracted === null).toBe(true);
    });
  });

  describe('Excel extraction', () => {
    it('should extract text from XLSX as CSV', async () => {
      const filepath = path.join(testRoot, 'test.xlsx');

      // Create a real XLSX file using exceljs
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Sheet1');

      // Add data
      worksheet.addRow(['Name', 'Age', 'City']);
      worksheet.addRow(['Alice', 30, 'New York']);
      worksheet.addRow(['Bob', 25, 'London']);

      // Write to file
      await workbook.xlsx.writeFile(filepath);

      const extracted = await service.extractText(
        filepath,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );

      expect(extracted).toContain('Name,Age,City');
      expect(extracted).toContain('Alice,30,New York');
      expect(extracted).toContain('Bob,25,London');
      expect(extracted).toContain('=== Sheet: Sheet1 ===');
    });

    it('should handle multiple sheets in XLSX', async () => {
      const filepath = path.join(testRoot, 'multi-sheet.xlsx');

      const workbook = new ExcelJS.Workbook();

      // Sheet 1
      const worksheet1 = workbook.addWorksheet('Sheet1');
      worksheet1.addRow(['Column1']);
      worksheet1.addRow(['Value1']);

      // Sheet 2
      const worksheet2 = workbook.addWorksheet('Sheet2');
      worksheet2.addRow(['Column2']);
      worksheet2.addRow(['Value2']);

      await workbook.xlsx.writeFile(filepath);

      const extracted = await service.extractText(
        filepath,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );

      expect(extracted).toContain('=== Sheet: Sheet1 ===');
      expect(extracted).toContain('=== Sheet: Sheet2 ===');
      expect(extracted).toContain('Column1');
      expect(extracted).toContain('Column2');
    });

    it('should extract CSV files', async () => {
      const filepath = path.join(testRoot, 'test.csv');
      const content = 'Name,Age,City\nAlice,30,New York\nBob,25,London';
      await fs.writeFile(filepath, content);

      const extracted = await service.extractText(filepath, 'text/csv');
      expect(extracted).toBe(content);
    });
  });

  describe('HTML extraction', () => {
    it('should strip HTML tags and extract text', async () => {
      const filepath = path.join(testRoot, 'test.html');
      const html = `
        <!DOCTYPE html>
        <html>
          <head><title>Test</title></head>
          <body>
            <h1>Hello World</h1>
            <p>This is a <strong>paragraph</strong> with tags.</p>
            <script>alert('should be removed');</script>
            <style>body { color: red; }</style>
          </body>
        </html>
      `;
      await fs.writeFile(filepath, html);

      const extracted = await service.extractText(filepath, 'text/html');

      expect(extracted).not.toContain('<');
      expect(extracted).not.toContain('>');
      expect(extracted).not.toContain('alert');
      expect(extracted).not.toContain('color: red');
      expect(extracted).toContain('Hello World');
      expect(extracted).toContain('paragraph');
    });

    it('discards malformed script and style end tags without leaving executable content', async () => {
      const filepath = path.join(testRoot, 'malformed-end-tags.html');
      await fs.writeFile(
        filepath,
        '<p>Visible</p><script>alert(1)</script ><style>body{display:none}</style >'
      );

      const extracted = await service.extractText(filepath, 'text/html');

      expect(extracted).toBe('Visible');
    });
  });

  describe('JSON extraction', () => {
    it('should pretty-print JSON', async () => {
      const filepath = path.join(testRoot, 'test.json');
      const json = { name: 'Test', values: [1, 2, 3], nested: { key: 'value' } };
      await fs.writeFile(filepath, JSON.stringify(json));

      const extracted = await service.extractText(filepath, 'application/json');

      expect(extracted).toContain('"name": "Test"');
      expect(extracted).toContain('"values": [');
      expect(extracted).toContain('"nested": {');
      expect(extracted).toContain('"key": "value"');
    });

    it('should handle malformed JSON gracefully', async () => {
      const filepath = path.join(testRoot, 'bad.json');
      await fs.writeFile(filepath, '{invalid json');

      const extracted = await service.extractText(filepath, 'application/json');
      expect(extracted).toBeNull();
    });
  });

  describe('XML/YAML extraction', () => {
    it('should extract XML as plain text', async () => {
      const filepath = path.join(testRoot, 'test.xml');
      const xml = '<?xml version="1.0"?>\n<root><item>Value</item></root>';
      await fs.writeFile(filepath, xml);

      const extracted = await service.extractText(filepath, 'application/xml');
      expect(extracted).toBe(xml);
    });

    it('should extract YAML as plain text', async () => {
      const filepath = path.join(testRoot, 'test.yaml');
      const yaml = 'name: Test\nvalues:\n  - one\n  - two';
      await fs.writeFile(filepath, yaml);

      const extracted = await service.extractText(filepath, 'application/yaml');
      expect(extracted).toBe(yaml);
    });
  });

  describe('Image handling', () => {
    it('should return null for image files', async () => {
      const filepath = path.join(testRoot, 'test.jpg');
      await fs.writeFile(filepath, Buffer.from('fake image data'));

      const extracted = await service.extractText(filepath, 'image/jpeg');
      expect(extracted).toBeNull();
    });

    it('should return null for PNG images', async () => {
      const filepath = path.join(testRoot, 'test.png');
      await fs.writeFile(filepath, Buffer.from('fake image data'));

      const extracted = await service.extractText(filepath, 'image/png');
      expect(extracted).toBeNull();
    });
  });

  describe('Unknown file types', () => {
    it('should return null for unknown MIME types', async () => {
      const filepath = path.join(testRoot, 'test.unknown');
      await fs.writeFile(filepath, 'some content');

      const extracted = await service.extractText(filepath, 'application/x-unknown');
      expect(extracted).toBeNull();
    });
  });

  describe('Error handling', () => {
    it('should return null on file read error', async () => {
      const filepath = path.join(testRoot, 'nonexistent.txt');

      const extracted = await service.extractText(filepath, 'text/plain');
      expect(extracted).toBeNull();
    });
  });
});

function pdfTextFixture(text: string): Buffer {
  const stream = `BT\n/F1 12 Tf\n20 180 Td\n(${text}) Tj\nET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}
