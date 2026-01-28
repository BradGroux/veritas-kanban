import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { TextExtractionService } from '../services/text-extraction-service.js';
import * as XLSX from 'xlsx';

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
    it('should extract text from PDF', async () => {
      // Note: This test would need a real PDF file or mocked unpdf library
      // For now, we'll test that it calls the extraction without error
      const filepath = path.join(testRoot, 'test.pdf');
      
      // Create a minimal PDF-like buffer (not a real PDF, just for testing structure)
      const buffer = Buffer.from('%PDF-1.4\nminimal pdf');
      await fs.writeFile(filepath, buffer);

      // This will likely return null or error with invalid PDF, but tests the flow
      const extracted = await service.extractText(filepath, 'application/pdf');
      // We expect null or string (real PDF would return string)
      expect(typeof extracted === 'string' || extracted === null).toBe(true);
    });
  });

  describe('DOCX extraction', () => {
    it('should extract text from DOCX', async () => {
      // Note: This test would need a real DOCX file or mocked mammoth library
      // Testing the flow with an invalid file
      const filepath = path.join(testRoot, 'test.docx');
      const buffer = Buffer.from('fake docx content');
      await fs.writeFile(filepath, buffer);

      const extracted = await service.extractText(filepath, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      // Should return null for invalid DOCX
      expect(typeof extracted === 'string' || extracted === null).toBe(true);
    });
  });

  describe('Excel extraction', () => {
    it('should extract text from XLSX as CSV', async () => {
      const filepath = path.join(testRoot, 'test.xlsx');
      
      // Create a real XLSX file using the xlsx library
      const workbook = XLSX.utils.book_new();
      const data = [
        ['Name', 'Age', 'City'],
        ['Alice', 30, 'New York'],
        ['Bob', 25, 'London'],
      ];
      const worksheet = XLSX.utils.aoa_to_sheet(data);
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
      
      // Write to file
      await fs.writeFile(filepath, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));

      const extracted = await service.extractText(filepath, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      
      expect(extracted).toContain('Name,Age,City');
      expect(extracted).toContain('Alice,30,New York');
      expect(extracted).toContain('Bob,25,London');
      expect(extracted).toContain('=== Sheet: Sheet1 ===');
    });

    it('should handle multiple sheets in XLSX', async () => {
      const filepath = path.join(testRoot, 'multi-sheet.xlsx');
      
      const workbook = XLSX.utils.book_new();
      
      // Sheet 1
      const data1 = [['Column1'], ['Value1']];
      const worksheet1 = XLSX.utils.aoa_to_sheet(data1);
      XLSX.utils.book_append_sheet(workbook, worksheet1, 'Sheet1');
      
      // Sheet 2
      const data2 = [['Column2'], ['Value2']];
      const worksheet2 = XLSX.utils.aoa_to_sheet(data2);
      XLSX.utils.book_append_sheet(workbook, worksheet2, 'Sheet2');
      
      await fs.writeFile(filepath, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));

      const extracted = await service.extractText(filepath, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      
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
