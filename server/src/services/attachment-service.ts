import fs from 'fs/promises';
import path from 'path';
import { nanoid } from 'nanoid';
import mime from 'mime-types';
import type { Attachment, AttachmentLimits } from '@veritas-kanban/shared';
import { DEFAULT_ATTACHMENT_LIMITS, ALLOWED_MIME_TYPES } from '@veritas-kanban/shared';
import { validateMimeType, getAllowedTypesDescription } from './mime-validation.js';

// Default paths - resolve to project root (one level up from server/)
const DEFAULT_PROJECT_ROOT = path.resolve(process.cwd(), '..');
const DEFAULT_ATTACHMENTS_DIR = path.join(DEFAULT_PROJECT_ROOT, 'tasks', 'attachments');
const DEFAULT_ARCHIVE_ATTACHMENTS_DIR = path.join(
  DEFAULT_PROJECT_ROOT,
  'tasks',
  'archive-attachments'
);

export interface AttachmentServiceOptions {
  attachmentsDir?: string;
  archiveAttachmentsDir?: string;
  limits?: AttachmentLimits;
}

export class AttachmentService {
  private attachmentsDir: string;
  private archiveAttachmentsDir: string;
  private limits: AttachmentLimits;

  constructor(options: AttachmentServiceOptions = {}) {
    this.attachmentsDir = options.attachmentsDir || DEFAULT_ATTACHMENTS_DIR;
    this.archiveAttachmentsDir = options.archiveAttachmentsDir || DEFAULT_ARCHIVE_ATTACHMENTS_DIR;
    this.limits = options.limits || DEFAULT_ATTACHMENT_LIMITS;
    this.ensureDirectories();
  }

  private async ensureDirectories(): Promise<void> {
    await fs.mkdir(this.attachmentsDir, { recursive: true });
    await fs.mkdir(this.archiveAttachmentsDir, { recursive: true });
  }

  private sanitizeFilename(filename: string): string {
    // Remove path separators and special characters
    return filename
      .replace(/[/\\]/g, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/\.{2,}/g, '.') // Collapse consecutive dots (prevent path traversal artifacts)
      .slice(0, 200); // Limit length
  }

  /**
   * Sanitize task ID to prevent path traversal
   * Only allow alphanumeric, underscore, and hyphen
   */
  private sanitizeTaskId(taskId: string): string {
    return taskId.replace(/[^a-zA-Z0-9_-]/g, '');
  }

  /**
   * Validate that a resolved path stays within the allowed base directory
   * Throws if path traversal is detected
   */
  private validatePathWithinBase(resolvedPath: string, baseDir: string, context: string): void {
    const normalizedPath = path.normalize(resolvedPath);
    const normalizedBase = path.normalize(baseDir);

    if (
      !normalizedPath.startsWith(normalizedBase + path.sep) &&
      normalizedPath !== normalizedBase
    ) {
      console.error(`Path traversal attempt blocked: ${context}`, { resolvedPath, baseDir });
      throw new Error('Invalid path: access denied');
    }
  }

  private getTaskAttachmentDir(taskId: string): string {
    const sanitizedId = this.sanitizeTaskId(taskId);
    const dir = path.join(this.attachmentsDir, sanitizedId);
    this.validatePathWithinBase(dir, this.attachmentsDir, 'getTaskAttachmentDir');
    return dir;
  }

  private getArchiveTaskAttachmentDir(taskId: string): string {
    const sanitizedId = this.sanitizeTaskId(taskId);
    const dir = path.join(this.archiveAttachmentsDir, sanitizedId);
    this.validatePathWithinBase(dir, this.archiveAttachmentsDir, 'getArchiveTaskAttachmentDir');
    return dir;
  }

  private getExtractedTextDir(taskId: string): string {
    return path.join(this.getTaskAttachmentDir(taskId), '.extracted');
  }

  private getArchiveExtractedTextDir(taskId: string): string {
    return path.join(this.getArchiveTaskAttachmentDir(taskId), '.extracted');
  }

  /**
   * Get attachment limits configuration
   */
  setLimits(limits: AttachmentLimits): void {
    this.limits = limits;
  }

  getLimits(): AttachmentLimits {
    return this.limits;
  }

  /**
   * Validate file against limits and allowed types (basic checks only).
   * For full MIME validation including magic bytes, use validateFileWithMime().
   */
  validateFile(file: Express.Multer.File, currentAttachments: Attachment[] = []): void {
    // Check file size (global limit)
    if (file.size > this.limits.maxFileSize) {
      throw new Error(
        `File size (${Math.round(file.size / 1024 / 1024)}MB) exceeds maximum allowed size (${Math.round(this.limits.maxFileSize / 1024 / 1024)}MB)`
      );
    }

    // Check number of files
    if (currentAttachments.length >= this.limits.maxFilesPerTask) {
      throw new Error(
        `Maximum number of attachments (${this.limits.maxFilesPerTask}) already reached`
      );
    }

    // Check total size
    const totalSize = currentAttachments.reduce((sum, att) => sum + att.size, 0);
    if (totalSize + file.size > this.limits.maxTotalSize) {
      throw new Error(
        `Total attachment size would exceed maximum (${Math.round(this.limits.maxTotalSize / 1024 / 1024)}MB)`
      );
    }

    // Check MIME type against shared allowed list (quick pre-check)
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new Error(
        `File type "${file.mimetype}" is not allowed. Allowed types: ${getAllowedTypesDescription()}`
      );
    }
  }

  /**
   * Validate file with full server-side MIME type detection using magic bytes.
   * This verifies the actual file content matches the claimed type to prevent
   * disguised file uploads (e.g., executables renamed as .jpg).
   *
   * Returns the validated/detected MIME type to use for the attachment metadata.
   */
  async validateFileWithMime(
    file: Express.Multer.File,
    currentAttachments: Attachment[] = []
  ): Promise<string> {
    // Run basic validation first (size, count, total limits)
    this.validateFile(file, currentAttachments);

    // Run magic-byte MIME validation
    const result = await validateMimeType(file.buffer, file.originalname, file.mimetype, file.size);

    if (!result.valid) {
      throw new Error(result.error || 'File type validation failed');
    }

    return result.effectiveMime;
  }

  /**
   * Save an uploaded file and return attachment metadata.
   * Performs full MIME validation using magic bytes before saving.
   */
  async saveAttachment(
    taskId: string,
    file: Express.Multer.File,
    currentAttachments: Attachment[] = []
  ): Promise<Attachment> {
    // Validate file with magic-byte MIME detection
    const validatedMime = await this.validateFileWithMime(file, currentAttachments);

    // Generate attachment ID and sanitize filename
    const attachmentId = `att_${Date.now()}_${nanoid(6)}`;
    const sanitizedFilename = this.sanitizeFilename(file.originalname);
    const filename = `${attachmentId}_${sanitizedFilename}`;

    // Ensure task attachment directory exists
    const taskDir = this.getTaskAttachmentDir(taskId);
    await fs.mkdir(taskDir, { recursive: true });

    // Save file
    const filepath = path.join(taskDir, filename);
    await fs.writeFile(filepath, file.buffer);

    // Create attachment metadata (use validated MIME type, not client-provided)
    const attachment: Attachment = {
      id: attachmentId,
      filename,
      originalName: file.originalname,
      mimeType: validatedMime,
      size: file.size,
      uploaded: new Date().toISOString(),
    };

    return attachment;
  }

  /**
   * Save extracted text for an attachment
   */
  async saveExtractedText(taskId: string, attachmentId: string, text: string): Promise<void> {
    const extractedDir = this.getExtractedTextDir(taskId);
    await fs.mkdir(extractedDir, { recursive: true });

    const filepath = path.join(extractedDir, `${attachmentId}.json`);
    await fs.writeFile(
      filepath,
      JSON.stringify({ text, extracted: new Date().toISOString() }),
      'utf-8'
    );
  }

  /**
   * Get extracted text for an attachment
   */
  async getExtractedText(taskId: string, attachmentId: string): Promise<string | null> {
    const filepath = path.join(this.getExtractedTextDir(taskId), `${attachmentId}.json`);

    try {
      const content = await fs.readFile(filepath, 'utf-8');
      const data = JSON.parse(content);
      return data.text || null;
    } catch {
      // Intentionally silent: extracted text file may not exist
      return null;
    }
  }

  /**
   * Get file path for an attachment (with path traversal protection)
   */
  getAttachmentPath(taskId: string, filename: string): string {
    const taskDir = this.getTaskAttachmentDir(taskId);
    // Sanitize filename to prevent traversal
    const sanitizedFilename = this.sanitizeFilename(filename);
    const filePath = path.join(taskDir, sanitizedFilename);

    // Double-check the resolved path stays within task directory
    this.validatePathWithinBase(filePath, taskDir, 'getAttachmentPath');

    return filePath;
  }

  /**
   * Delete an attachment file and its extracted text
   */
  async deleteAttachment(taskId: string, attachment: Attachment): Promise<void> {
    // Delete file
    const filepath = this.getAttachmentPath(taskId, attachment.filename);
    try {
      await fs.unlink(filepath);
    } catch (err) {
      console.error(`Failed to delete attachment file: ${filepath}`, err);
    }

    // Delete extracted text
    const extractedPath = path.join(this.getExtractedTextDir(taskId), `${attachment.id}.json`);
    try {
      await fs.unlink(extractedPath);
    } catch {
      // Ignore if doesn't exist
    }

    // Cleanup empty directories
    await this.cleanupEmptyDirectories(taskId);
  }

  /**
   * Cleanup empty directories for a task
   */
  private async cleanupEmptyDirectories(taskId: string): Promise<void> {
    // Try to remove .extracted dir if empty
    const extractedDir = this.getExtractedTextDir(taskId);
    try {
      const files = await fs.readdir(extractedDir);
      if (files.length === 0) {
        await fs.rmdir(extractedDir);
      }
    } catch {
      // Directory doesn't exist or not empty
    }

    // Try to remove task dir if empty
    const taskDir = this.getTaskAttachmentDir(taskId);
    try {
      const files = await fs.readdir(taskDir);
      if (files.length === 0) {
        await fs.rmdir(taskDir);
      }
    } catch {
      // Directory doesn't exist or not empty
    }
  }

  /**
   * Move attachments when task is archived
   */
  async archiveAttachments(taskId: string): Promise<void> {
    const sourceDir = this.getTaskAttachmentDir(taskId);
    const destDir = this.getArchiveTaskAttachmentDir(taskId);

    try {
      // Check if source directory exists
      await fs.access(sourceDir);

      // Ensure parent directory exists
      await fs.mkdir(this.archiveAttachmentsDir, { recursive: true });

      // Move directory
      await fs.rename(sourceDir, destDir);
    } catch (err) {
      // Ignore if source doesn't exist
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`Failed to archive attachments for task ${taskId}:`, err);
      }
    }
  }

  /**
   * Move attachments when task is restored from archive
   */
  async restoreAttachments(taskId: string): Promise<void> {
    const sourceDir = this.getArchiveTaskAttachmentDir(taskId);
    const destDir = this.getTaskAttachmentDir(taskId);

    try {
      // Check if source directory exists
      await fs.access(sourceDir);

      // Ensure parent directory exists
      await fs.mkdir(this.attachmentsDir, { recursive: true });

      // Move directory
      await fs.rename(sourceDir, destDir);
    } catch (err) {
      // Ignore if source doesn't exist
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`Failed to restore attachments for task ${taskId}:`, err);
      }
    }
  }

  /**
   * Delete all attachments for a task
   */
  async deleteAllAttachments(taskId: string): Promise<void> {
    const taskDir = this.getTaskAttachmentDir(taskId);

    try {
      await fs.rm(taskDir, { recursive: true, force: true });
    } catch (err) {
      console.error(`Failed to delete attachments directory for task ${taskId}:`, err);
    }
  }

  /**
   * List all files in a task's attachment directory
   */
  async listFiles(taskId: string): Promise<string[]> {
    const taskDir = this.getTaskAttachmentDir(taskId);

    try {
      const files = await fs.readdir(taskDir);
      // Filter out .extracted directory
      return files.filter((f) => f !== '.extracted');
    } catch {
      // Intentionally silent: directory may not exist — return empty list
      return [];
    }
  }
}

// Singleton instance
let attachmentServiceInstance: AttachmentService | null = null;

export function getAttachmentService(options?: AttachmentServiceOptions): AttachmentService {
  if (!attachmentServiceInstance) {
    attachmentServiceInstance = new AttachmentService(options);
  }
  return attachmentServiceInstance;
}
