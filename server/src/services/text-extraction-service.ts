import fs from 'fs/promises';
import { extractText as unpdfExtract } from 'unpdf';
import mammoth from 'mammoth';
import ExcelJS from 'exceljs';
import { createLogger } from '../lib/logger.js';
const log = createLogger('text-extraction-service');

export interface TextExtractionResult {
  text: string | null;
  error?: string;
}

export class TextExtractionService {
  /**
   * Extract text from a file based on its MIME type
   */
  async extractText(filepath: string, mimeType: string): Promise<string | null> {
    try {
      // Plain text files
      if (mimeType.startsWith('text/plain') || mimeType === 'text/markdown') {
        return await this.extractPlainText(filepath);
      }

      // PDF
      if (mimeType === 'application/pdf') {
        return await this.extractPDF(filepath);
      }

      // DOCX
      if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        return await this.extractDOCX(filepath);
      }

      // DOC (old format) - mammoth can handle it
      if (mimeType === 'application/msword') {
        return await this.extractDOCX(filepath);
      }

      // Excel files
      if (
        mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        mimeType === 'application/vnd.ms-excel'
      ) {
        return await this.extractXLSX(filepath);
      }

      // CSV
      if (mimeType === 'text/csv') {
        return await this.extractPlainText(filepath);
      }

      // HTML
      if (mimeType === 'text/html') {
        return await this.extractHTML(filepath);
      }

      // JSON
      if (mimeType === 'application/json') {
        return await this.extractJSON(filepath);
      }

      // XML/YAML
      if (
        mimeType === 'application/xml' ||
        mimeType === 'text/xml' ||
        mimeType === 'application/yaml' ||
        mimeType === 'text/yaml'
      ) {
        return await this.extractPlainText(filepath);
      }

      // Images - return null (agents will use vision APIs)
      if (mimeType.startsWith('image/')) {
        return null;
      }

      // Unknown type
      return null;
    } catch (error) {
      log.error({ err: error }, `Text extraction failed for ${filepath}`);
      return null;
    }
  }

  /**
   * Extract plain text
   */
  private async extractPlainText(filepath: string): Promise<string> {
    const buffer = await fs.readFile(filepath);
    return buffer.toString('utf-8');
  }

  /**
   * Extract text from PDF using unpdf
   */
  private async extractPDF(filepath: string): Promise<string | null> {
    try {
      const buffer = await fs.readFile(filepath);
      const { text } = await unpdfExtract(buffer, { mergePages: true });
      return text || null;
    } catch (error) {
      log.error({ err: error }, 'PDF extraction error');
      return null;
    }
  }

  /**
   * Extract text from DOCX using mammoth
   */
  private async extractDOCX(filepath: string): Promise<string | null> {
    try {
      const buffer = await fs.readFile(filepath);
      const result = await mammoth.extractRawText({ buffer });
      return result.value || null;
    } catch (error) {
      log.error({ err: error }, 'DOCX extraction error');
      return null;
    }
  }

  /**
   * Extract text from Excel files (convert to CSV-like format)
   * Note: Only supports .xlsx format (Excel 2007+). Legacy .xls format is not supported.
   */
  private async extractXLSX(filepath: string): Promise<string | null> {
    try {
      const workbook = new ExcelJS.Workbook();

      // Read the workbook directly from file
      await workbook.xlsx.readFile(filepath);

      // Extract all sheets
      const sheets: string[] = [];

      workbook.eachSheet((worksheet) => {
        const rows: string[] = [];

        worksheet.eachRow((row) => {
          const values: string[] = [];

          row.eachCell({ includeEmpty: true }, (cell) => {
            // Get cell value as string
            const value = cell.value;

            // Handle different value types
            if (value === null || value === undefined) {
              values.push('');
            } else if (typeof value === 'object' && 'text' in value) {
              // Rich text
              values.push(value.text || '');
            } else if (typeof value === 'object' && 'formula' in value) {
              // Formula - use result if available
              values.push(value.result?.toString() || '');
            } else {
              values.push(value.toString());
            }
          });

          rows.push(values.join(','));
        });

        if (rows.length > 0) {
          sheets.push(`=== Sheet: ${worksheet.name} ===\n${rows.join('\n')}`);
        }
      });

      return sheets.length > 0 ? sheets.join('\n\n') : null;
    } catch (error) {
      log.error({ err: error }, 'XLSX extraction error');
      return null;
    }
  }

  /**
   * Extract text from HTML (strip tags)
   */
  private async extractHTML(filepath: string): Promise<string | null> {
    try {
      const html = await fs.readFile(filepath, 'utf-8');

      // Simple tag stripping (for more complex HTML, consider using a library like cheerio)
      const text = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      return text || null;
    } catch (error) {
      log.error({ err: error }, 'HTML extraction error');
      return null;
    }
  }

  /**
   * Extract text from JSON (pretty print)
   */
  private async extractJSON(filepath: string): Promise<string | null> {
    try {
      const content = await fs.readFile(filepath, 'utf-8');
      const json = JSON.parse(content);
      return JSON.stringify(json, null, 2);
    } catch (error) {
      log.error({ err: error }, 'JSON extraction error');
      return null;
    }
  }
}

// Singleton instance
let textExtractionServiceInstance: TextExtractionService | null = null;

export function getTextExtractionService(): TextExtractionService {
  if (!textExtractionServiceInstance) {
    textExtractionServiceInstance = new TextExtractionService();
  }
  return textExtractionServiceInstance;
}
